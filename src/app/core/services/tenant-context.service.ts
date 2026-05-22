import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { FeatureKey, MacroCategoryType, PlanTypeId, SubCategoryType } from '../enums';
import { GIRO_FEATURE_MAP } from '../enums/feature-key.enum';
import { BusinessSettings } from '../models/business-settings.model';
import { BusinessTypeCatalog, PosExperience } from '../models/catalog.model';
import { extractFeaturesFromJwt, extractMacroCategoryFromJwt } from '../utils/jwt.utils';
import { BusinessService } from './business.service';
import { CatalogService } from './catalog.service';
import { TaxService } from './tax.service';

/**
 * Single source of truth for the current tenant's runtime context:
 * plan tier, business vertical, and the set of feature keys enabled
 * by the backend for this session.
 *
 * Hydrated by `AuthService` after a successful login or when the
 * user is restored from localStorage on app boot. All reads are
 * signal-based so consumers re-render automatically when the
 * backend pushes a new plan or feature set.
 */
@Injectable({ providedIn: 'root' })
export class TenantContextService {

  //#region Injections

  private readonly catalogService = inject(CatalogService);
  private readonly businessService = inject(BusinessService);
  private readonly taxService = inject(TaxService);

  //#endregion

  //#region Backing signals

  private readonly _currentPlan = signal<PlanTypeId>(PlanTypeId.Free);
  private readonly _currentMacro = signal<MacroCategoryType | null>(null);
  private readonly _currentSubCategory = signal<SubCategoryType | null>(null);
  private readonly _activeFeatures = signal<ReadonlySet<FeatureKey>>(new Set());

  /**
   * Business settings (currently `{ defaultTaxId }`). Hydrated by
   * `ensureHydrated()` post-auth. Null until the first hydration resolves.
   * Read-shape `defaultTaxId` is nullable: a freshly onboarded tenant
   * may not have selected one yet — the `TaxConfigGuard` blocks POS
   * access in that state.
   */
  private readonly _business = signal<BusinessSettings | null>(null);

  /**
   * Cached promise of the in-flight or resolved hydration. Multiple
   * callers (login awaiter, guards, dashboard banner) share a single
   * round-trip. Reset on logout via `clear()`.
   */
  private hydrationPromise: Promise<void> | null = null;

  //#endregion

  //#region Public read API

  /** Current subscription plan tier */
  readonly currentPlan = this._currentPlan.asReadonly();

  /** Current macro category (primary business vertical) */
  readonly currentMacro = this._currentMacro.asReadonly();

  /**
   * Vertical sub-category derived from the tenant's selected sub-giros.
   * Drives UI verticalization (POS layouts, cart slots) without
   * affecting feature gating, which stays keyed by `currentMacro`.
   * Null until the sub-giro selection has been hydrated.
   */
  readonly currentSubCategory = this._currentSubCategory.asReadonly();

  /** Set of feature keys currently enabled for this tenant */
  readonly activeFeatures = this._activeFeatures.asReadonly();

  /** Number of active features — useful for debug / dev tooling */
  readonly featureCount = computed(() => this._activeFeatures().size);

  /**
   * Business type catalog entry matching the tenant's current sub-category.
   * Looks up `catalogService.businessTypes()` by `code === currentSubCategory()`.
   * Returns null when no sub-category is set or no match exists.
   */
  readonly currentBusinessType = computed<BusinessTypeCatalog | null>(() => {
    const sub = this._currentSubCategory();
    if (sub === null) return null;
    return this.catalogService.businessTypes().find(b => b.code === sub) ?? null;
  });

  /**
   * True when the tenant's business type has a kitchen (food prep area).
   * Falls back to `true` for any FoodBeverage tenant — the macro alone
   * implies a kitchen, even before the sub-category is hydrated.
   */
  readonly hasKitchen = computed(
    () => this.currentBusinessType()?.hasKitchen
      ?? (this.currentMacro() === MacroCategoryType.FoodBeverage),
  );

  /** POS experience variant for the current tenant — drives UI verticalization */
  readonly posExperience = computed<PosExperience | undefined>(
    () => this.currentBusinessType()?.posExperience,
  );

  /**
   * True when the post-auth hydration cycle has completed — i.e. the
   * tenant's macro category has been resolved from the JWT (and any
   * downstream features, sub-category, business settings followed).
   *
   * Use this in components that need to defer rendering until the
   * tenant context is known (e.g. dashboards, sidebars), instead of
   * the legacy pattern `currentMacro() === null`. Avoids leaking macro
   * comparisons into views whose intent is "wait for ready", not
   * "branch by vertical".
   */
  readonly isHydrated = computed(() => this._currentMacro() !== null);

  /**
   * True when the tenant can route line items to a kitchen — drives the
   * "send to kitchen" button, kitchen comanda printing, and table
   * assignment in the cart.
   *
   * Mapped to F&B-style capability features (`PrintedTickets`,
   * `MaxKdsScreens`, `TableMap`) rather than the macro itself, so a
   * future vertical (e.g. Hospitality / Room Service) gains these flows
   * by acquiring the features without touching cart-panel code.
   */
  readonly supportsKitchenOrders = computed(() =>
    this.hasAnyFeature([
      FeatureKey.PrintedTickets,
      FeatureKey.MaxKdsScreens,
      FeatureKey.TableMap,
    ]),
  );

  /**
   * True when the tenant sells subscription / membership products
   * (gym mensualidades, spa packages, recurring services).
   *
   * Mapped to `posExperience in {'Quick', 'Services'}` — the backend
   * emits `'Services'` as the canonical value for Services-macro tenants
   * but the internal catalog still uses `'Quick'` as a synonym during
   * the cross-repo migration (see `PosExperience` type docs).
   *
   * If product later decouples memberships from Services-vertical,
   * promote this to a dedicated `FeatureKey.MembershipProducts` claim
   * on the backend.
   */
  readonly supportsMemberships = computed(() => {
    const exp = this.posExperience();
    return exp === 'Quick' || exp === 'Services';
  });

  /** Business settings snapshot — null until `ensureHydrated()` resolves */
  readonly business = this._business.asReadonly();

  /**
   * Tenant's default tax rate as integer percentage (e.g. `16` for IVA
   * 16%, `0` for exempt). Returns `null` while the business config or
   * the tax catalog are still loading, OR when the admin has not yet
   * configured a default. **Safe to call from computed signals** — never
   * throws. Consumers in the cart preview path use `?? 0` to render a
   * neutral preview while hydration completes; the backend remains
   * authoritative on save.
   */
  defaultTaxRatePercent(): number | null {
    const businessSnapshot = this._business();
    if (!businessSnapshot) return null;
    const id = businessSnapshot.defaultTaxId;
    if (id === null || id === undefined) return null;
    const tax = this.taxService.findById(id);
    return tax?.ratePercent ?? null;
  }

  /**
   * Strict variant of `defaultTaxRatePercent()` for **write-side** code
   * paths (persisting an order, generating a ticket, saving settings).
   * Throws when the business has no default tax configured so the caller
   * can surface an actionable toast instead of writing a malformed order.
   *
   * Never call this from a computed signal or template binding — see
   * `defaultTaxRatePercent()` for the safe read variant.
   */
  requireDefaultTaxRatePercent(): number {
    const rate = this.defaultTaxRatePercent();
    if (rate === null) {
      throw new Error(
        'CONFIG_ERROR: El negocio no tiene impuesto configurado. ' +
        'Operación bloqueada — ve a Configuración → Fiscal.',
      );
    }
    return rate;
  }

  /**
   * Returns true when the tenant has the given feature enabled.
   * O(1) lookup against the active features set.
   * @param feature Feature key to check
   */
  hasFeature(feature: FeatureKey): boolean {
    return this._activeFeatures().has(feature);
  }

  /**
   * Returns true when the tenant has at least one of the given features
   * enabled. Used by route guards and templates that accept OR logic
   * (e.g. `/kitchen` unlocks with either KdsBasic or RealtimeKds).
   * @param features Candidate feature keys
   */
  hasAnyFeature(features: readonly FeatureKey[]): boolean {
    const active = this._activeFeatures();
    return features.some(f => active.has(f));
  }

  /**
   * Returns true when the feature is relevant for the current giro,
   * regardless of whether the current plan unlocks it. Drives the
   * hide-vs-lock distinction in the UI: features that are not
   * applicable to a giro are hidden, features that are applicable
   * but not yet unlocked are shown with a padlock.
   *
   * Fail-fast: throws when the tenant's macro has not been loaded yet.
   * Callers that may run before auth hydration must guard with
   * `currentMacro() !== null` first.
   *
   * @param feature Feature key to check
   * @throws Error when `currentMacro()` is null
   */
  isApplicableToGiro(feature: FeatureKey): boolean {
    const macro = this._currentMacro();
    if (macro === null) {
      throw new Error(
        '[TenantContextService] isApplicableToGiro called before tenant context was loaded. ' +
        'Macro category is null — cannot read feature map.',
      );
    }
    return GIRO_FEATURE_MAP[macro].includes(feature);
  }

  //#endregion

  //#region Mutators (called by AuthService)

  /**
   * Replaces the tenant context with a fresh snapshot.
   * Unknown feature strings (not present in the `FeatureKey` enum)
   * are silently dropped — the enum is authoritative on the client.
   *
   * `subCategory` is optional because the JWT does not yet carry it —
   * pass `undefined` to leave the current sub-category untouched, or
   * `null` to clear it. Hydrate it via `setSubCategory()` after the
   * sub-giro fetch resolves.
   *
   * @param plan Subscription plan from the JWT
   * @param macro Primary macro category from the JWT
   * @param features Array of feature key strings from the JWT `features` claim
   * @param subCategory Vertical sub-category, or null to clear, or omit to keep current
   */
  setContext(
    plan: PlanTypeId,
    macro: MacroCategoryType,
    features: readonly string[],
    subCategory?: SubCategoryType | null,
  ): void {
    this._currentPlan.set(plan);
    this._currentMacro.set(macro);
    this._activeFeatures.set(this.parseFeatures(features));
    if (subCategory !== undefined) {
      this._currentSubCategory.set(subCategory);
    }

    // Kick off the dynamic plan-catalog fetch as soon as the tenant
    // context is hydrated. Fire-and-forget — the service handles its
    // own errors and falls back to the static catalog on failure.
    this.catalogService.fetchPlanCatalog();
  }

  /**
   * Hydrates the vertical sub-category independently of the macro/plan
   * snapshot — used by callers that resolve sub-giros after the JWT
   * has already primed the rest of the context (e.g. the onboarding
   * wizard or `BusinessService.getGiro()`).
   */
  setSubCategory(subCategory: SubCategoryType | null): void {
    this._currentSubCategory.set(subCategory);
  }

  /**
   * Populates tenant state from a device JWT.
   *
   * Used by unattended hardware shells (kiosk / kitchen / reception)
   * that never go through the user-login → `setContext()` path. Without
   * this, the device boots with an empty features set and `featureGuard`
   * rebounds it to /admin/upgrade → /login the moment it tries to enter
   * its own shell — which is exactly what we are curing here.
   *
   * Deliberately leaner than `setContext()`:
   *   - Touches `_activeFeatures` and (when present) `_currentMacro`.
   *     Plan and sub-category stay untouched — the device JWT does not
   *     carry the plan tier and the sub-category is hydrated by a
   *     separate sub-giro fetch.
   *   - Does NOT trigger `catalogService.fetchPlanCatalog()`. Callers
   *     run from constructors and bootstrap paths where an HTTP call
   *     would close the auth-interceptor DI cycle (see AUDIT-046).
   *
   * The `macroCategory` extraction was added after AUDIT-049 traced a
   * bug where unattended shells in the Services vertical landed on the
   * Restaurant POS because `currentMacro` stayed null. Empty / unknown
   * claim values resolve to a no-op so legacy device tokens (which
   * historically emitted `"macroCategory": ""`) keep working.
   *
   * Malformed JWTs and missing claims resolve to a no-op rather than an
   * exception, so callers can invoke this freely without try/catch.
   *
   * @param token Raw device JWT string.
   */
  hydrateFromDeviceToken(token: string): void {
    const features = extractFeaturesFromJwt(token);
    if (features !== undefined) {
      this._activeFeatures.set(this.parseFeatures(features));
    }

    const macro = extractMacroCategoryFromJwt(token);
    if (macro !== null) {
      this._currentMacro.set(macro);
    }
  }

  /**
   * Ensures the post-auth async dependencies are resolved before any
   * caller acts on `business()` or `defaultTaxRatePercent()`. Idempotent:
   * the cached promise is shared across all callers within a session.
   *
   * Hydrates in parallel:
   *   - `BusinessService.getSettings()` → `_business`
   *   - `TaxService.loadCatalog()` → tax catalog signal
   *
   * Errors are intentionally swallowed (fail-soft): the signals remain
   * null/empty, and downstream guards / banners surface the missing
   * config to the user as actionable UX. Throwing here would break the
   * post-login flow on transient network glitches.
   */
  ensureHydrated(): Promise<void> {
    if (this.hydrationPromise) return this.hydrationPromise;
    this.hydrationPromise = this.runHydration();
    return this.hydrationPromise;
  }

  private async runHydration(): Promise<void> {
    try {
      const [settings] = await Promise.all([
        firstValueFrom(this.businessService.getSettings()).catch(() => null),
        this.taxService.loadCatalog().catch(() => []),
      ]);
      if (settings) this._business.set(settings);
    } catch {
      // Swallow — best-effort hydration, see method docstring.
    }
  }

  /**
   * Updates the cached business settings after a successful save (e.g.
   * the admin selects a `defaultTaxId` in the Fiscal tab). Components
   * that consume `business()` re-render automatically.
   */
  setBusinessSettings(settings: BusinessSettings): void {
    this._business.set(settings);
  }

  /** Clears the tenant context — called on logout */
  clear(): void {
    this._currentPlan.set(PlanTypeId.Free);
    this._currentMacro.set(null);
    this._currentSubCategory.set(null);
    this._activeFeatures.set(new Set());
    this._business.set(null);
    this.hydrationPromise = null;
    this.taxService.clear();
  }

  //#endregion

  //#region Private helpers

  /**
   * Validates raw feature strings against the `FeatureKey` enum
   * and returns a set of the recognized ones.
   * @param raw Array of feature strings from the backend
   */
  private parseFeatures(raw: readonly string[]): ReadonlySet<FeatureKey> {
    const known = new Set<string>(Object.values(FeatureKey));
    const valid = new Set<FeatureKey>();
    for (const feature of raw) {
      if (known.has(feature)) {
        valid.add(feature as FeatureKey);
      }
    }
    return valid;
  }

  //#endregion

}
