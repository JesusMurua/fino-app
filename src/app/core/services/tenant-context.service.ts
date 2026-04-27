import { Injectable, computed, inject, signal } from '@angular/core';

import { FeatureKey, MacroCategoryType, PlanTypeId, SubCategoryType } from '../enums';
import { GIRO_FEATURE_MAP } from '../enums/feature-key.enum';
import { BusinessTypeCatalog, PosExperience } from '../models/catalog.model';
import { CatalogService } from './catalog.service';

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

  //#endregion

  //#region Backing signals

  private readonly _currentPlan = signal<PlanTypeId>(PlanTypeId.Free);
  private readonly _currentMacro = signal<MacroCategoryType | null>(null);
  private readonly _currentSubCategory = signal<SubCategoryType | null>(null);
  private readonly _activeFeatures = signal<ReadonlySet<FeatureKey>>(new Set());

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
    //
    // Deferred to a microtask so callers invoking this from inside their
    // own constructor (e.g. AuthService.syncTenantContext during DI
    // graph hydration) don't fire HTTP synchronously. The auth interceptor
    // injects ConfigService at request time, and ConfigService's own
    // constructor depends on AuthService — so any HTTP call originating
    // from AuthService.constructor cycles through ConfigService → AuthService
    // (NG0200). Running the fetch on the next microtask lets the entire
    // DI graph hydrate first, so every service the interceptor needs is
    // already cached when the HTTP request actually fires.
    queueMicrotask(() => this.catalogService.fetchPlanCatalog());
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

  /** Clears the tenant context — called on logout */
  clear(): void {
    this._currentPlan.set(PlanTypeId.Free);
    this._currentMacro.set(null);
    this._currentSubCategory.set(null);
    this._activeFeatures.set(new Set());
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
