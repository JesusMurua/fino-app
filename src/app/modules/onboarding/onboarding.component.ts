import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MessageService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { InputTextModule } from 'primeng/inputtext';

import { environment } from '../../../environments/environment';
import {
  FEATURE_LABELS,
  PRICING_GROUP_BY_MACRO,
  PricingGroup,
  UpdateBusinessGiroRequest,
} from '../../core/models';
import {
  BusinessTypeId,
  FeatureKey,
  GIRO_FEATURE_MAP,
  MACRO_CATEGORY_LABELS,
  MacroCategoryType,
  deriveSubCategory,
} from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { DeviceRoutingService } from '../../core/services/device-routing.service';
import { BusinessService } from '../../core/services/business.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { BrioMascotComponent, BrioSkin } from './brio-mascot/brio-mascot.component';

const ONBOARDING_KEY_PREFIX = 'onboarding-completed-';

/** Sub-giro descriptor rendered as a chip inside an expanded macro card. */
interface SubGiroOption {
  /** Real BusinessTypeId — null only for the synthetic "Otra" chip */
  id: BusinessTypeId | null;
  label: string;
  /** Optional PrimeNG icon class — surfaces verticalized chips (e.g. Gym). */
  icon?: string;
}

/** Macro card rendered at the top of Step 1. */
interface MacroCard {
  id: MacroCategoryType;
  label: string;
  description: string;
  /** PrimeNG icon class, e.g. 'pi pi-shopping-bag' */
  icon: string;
  /** CSS accent for the icon background + badge color */
  accent: string;
  /** Mascot skin to activate when this card is selected/hovered */
  skin: BrioSkin;
  subGiros: SubGiroOption[];
}

/** Plan slug used internally and by the Stripe price matrix. */
type PlanSlug = 'free' | 'basic' | 'pro' | 'enterprise';

type BillingCycle = 'monthly' | 'annual';

/** Plans ordered from cheapest to most expensive — drives grid layout. */
const PLAN_ORDER: PlanSlug[] = ['free', 'basic', 'pro', 'enterprise'];

/** Plans that require Stripe — Free short-circuits to `continueWithTrial`. */
const PAID_PLANS: PlanSlug[] = ['basic', 'pro', 'enterprise'];

/**
 * Plans available per macro (feature gating per `.claude/business-rules-matrix.md`):
 *   - FoodBeverage → all 4 tiers
 *   - QuickService → Free / Basic / Pro (Enterprise locked)
 *   - Retail       → all 4 tiers
 *   - Services     → Free / Pro (Basic and Enterprise locked)
 */
const AVAILABLE_PLANS_BY_MACRO: Record<MacroCategoryType, ReadonlySet<PlanSlug>> = {
  [MacroCategoryType.FoodBeverage]: new Set(['free', 'basic', 'pro', 'enterprise']),
  [MacroCategoryType.QuickService]: new Set(['free', 'basic', 'pro']),
  [MacroCategoryType.Retail]:       new Set(['free', 'basic', 'pro', 'enterprise']),
  [MacroCategoryType.Services]:     new Set(['free', 'pro']),
};

/** Short tagline per plan — kept local to the onboarding UI (not in the catalog). */
const PLAN_DESCRIPTIONS: Record<PlanSlug, string> = {
  free:       'Para probar sin compromiso',
  basic:      'Para negocios que arrancan',
  pro:        'El favorito de nuestros clientes',
  enterprise: 'Para cadenas y franquicias',
};

/** Free tier copy tweak — the catalog leaves `badge` blank for Free. */
const FREE_BADGE_FALLBACK = 'Gratis';

/**
 * Catalog of macro cards + their sub-giros. `id: null` means the chip is
 * the synthetic "Otra" option; it contributes `customGiroDescription`
 * instead of a BusinessTypeId when the wizard is submitted.
 */
const MACRO_CARDS: MacroCard[] = [
  {
    id: MacroCategoryType.FoodBeverage,
    label: MACRO_CATEGORY_LABELS[MacroCategoryType.FoodBeverage],
    description: 'Mesas, comandas y cocina',
    icon: 'pi pi-apple',
    accent: '#EF4444',
    skin: 'restaurant',
    subGiros: [
      { id: BusinessTypeId.Restaurante, label: 'Restaurante' },
      { id: BusinessTypeId.BarCantina,  label: 'Bar / Cantina' },
      { id: BusinessTypeId.SportsBar,   label: 'Sports Bar / Wings' },
      { id: null,                       label: 'Otra' },
    ],
  },
  {
    id: MacroCategoryType.QuickService,
    label: MACRO_CATEGORY_LABELS[MacroCategoryType.QuickService],
    description: 'Mostrador, con o sin cocina',
    icon: 'pi pi-sun',
    accent: '#F59E0B',
    skin: 'cafe',
    subGiros: [
      { id: BusinessTypeId.Taqueria,     label: 'Taquería' },
      { id: BusinessTypeId.Dogos,        label: 'Dogos' },
      { id: BusinessTypeId.Hamburguesas, label: 'Hamburguesas' },
      { id: BusinessTypeId.Cafeteria,    label: 'Cafetería' },
      { id: BusinessTypeId.Paleteria,    label: 'Paletería / Nevería' },
      { id: BusinessTypeId.Panaderia,    label: 'Panadería / Repostería' },
      { id: null,                        label: 'Otra' },
    ],
  },
  {
    id: MacroCategoryType.Retail,
    label: MACRO_CATEGORY_LABELS[MacroCategoryType.Retail],
    description: 'Inventario rápido, sin errores',
    icon: 'pi pi-shopping-bag',
    accent: '#3B82F6',
    skin: 'retail',
    subGiros: [
      { id: BusinessTypeId.Abarrotes,     label: 'Abarrotes / Miscelánea' },
      { id: BusinessTypeId.Expendio,      label: 'Expendio / Depósito' },
      { id: BusinessTypeId.Refaccionaria, label: 'Refaccionaria / Autopartes' },
      { id: BusinessTypeId.Ferreteria,    label: 'Ferretería' },
      { id: BusinessTypeId.Papeleria,     label: 'Papelería' },
      { id: BusinessTypeId.Farmacia,      label: 'Farmacia' },
      { id: BusinessTypeId.Boutique,      label: 'Boutique / Ropa y Calzado' },
      { id: null,                         label: 'Otra' },
    ],
  },
  {
    id: MacroCategoryType.Services,
    label: MACRO_CATEGORY_LABELS[MacroCategoryType.Services],
    description: 'Cobras por lo que haces',
    icon: 'pi pi-wrench',
    accent: '#8B5CF6',
    skin: 'services',
    subGiros: [
      { id: BusinessTypeId.Estetica,       label: 'Estética / Barbería' },
      { id: BusinessTypeId.TallerMecanico, label: 'Taller Mecánico' },
      { id: BusinessTypeId.Consultorio,    label: 'Consultorio / Clínica' },
      { id: BusinessTypeId.Gimnasio,       label: 'Gimnasio / Deportes', icon: 'pi pi-heart-fill' },
      { id: null,                          label: 'Otra' },
    ],
  },
];

/** Sentinel sub-giro id used client-side only to represent the "Otra" chip. */
const OTRA_SUB_ID = -1;

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, InputTextModule, BrioMascotComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent implements OnInit {

  //#region Injections

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly businessService = inject(BusinessService);
  private readonly catalogService = inject(CatalogService);
  private readonly deviceRoutingService = inject(DeviceRoutingService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly tenantContext = inject(TenantContextService);

  //#endregion

  //#region Wizard shape

  readonly totalSteps = 2;
  readonly currentStep = signal(1);
  readonly macroCards = MACRO_CARDS;

  /** `OTRA_SUB_ID` sentinel exposed so the template can bind to it. */
  readonly otraId = OTRA_SUB_ID;

  /** Display name of the authenticated owner — welcomes them in Step 1. */
  readonly ownerName = computed(() => this.authService.currentUser()?.name ?? '');

  /** Step 1 is submitting (handoff to `PUT /business/giro`). */
  readonly isSavingGiro = signal(false);

  /** Step 2 is submitting (Stripe checkout or complete-onboarding trial). */
  readonly isSubmitting = signal(false);

  /** Progress percentage — simple linear split across the 2 steps. */
  readonly progress = computed(() =>
    Math.round((this.currentStep() / this.totalSteps) * 100),
  );

  //#endregion

  //#region Step 1 — Macro + sub-giros

  /** Currently selected macro — always a single value (radio behavior). */
  readonly selectedMacroId = signal<MacroCategoryType | null>(null);

  /**
   * Selected sub-giros for the ACTIVE macro only — changing macro resets
   * this set. Uses `OTRA_SUB_ID` for the synthetic "Otra" chip so the
   * map is a simple `number[]` instead of a discriminated union.
   */
  readonly selectedSubGiroIds = signal<number[]>([]);

  /** Free-text description attached when the "Otra" chip is checked. */
  readonly customGiroText = signal('');

  /** Mascot skin tracks hover → falls back to the selected macro's skin. */
  readonly hoveredMacroId = signal<MacroCategoryType | null>(null);
  readonly mascotSkin = computed<BrioSkin>(() => {
    const hoverId = this.hoveredMacroId();
    const activeId = this.selectedMacroId();
    const focusedId = hoverId ?? activeId;
    return focusedId !== null
      ? (MACRO_CARDS.find(c => c.id === focusedId)?.skin ?? 'default')
      : 'default';
  });

  /** True when "Otra" is in the current selection for the active macro. */
  readonly isOtraChecked = computed(() =>
    this.selectedSubGiroIds().includes(OTRA_SUB_ID),
  );

  /** Count of real sub-giros (excludes the "Otra" sentinel) for badge display. */
  readonly selectedSubCount = computed(() =>
    this.selectedSubGiroIds().filter(id => id !== OTRA_SUB_ID).length,
  );

  //#endregion

  //#region Step 2 — Plan + Stripe checkout

  readonly selectedPlan = signal<PlanSlug | null>(null);
  readonly billingCycle = signal<BillingCycle>('annual');
  readonly checkoutLoading = signal(false);
  readonly checkoutError = signal('');

  /** Pricing group derived from the selected macro; defaults to 'general'. */
  readonly pricingGroup = computed<PricingGroup>(() => {
    const macro = this.selectedMacroId();
    return macro !== null ? PRICING_GROUP_BY_MACRO[macro] : 'general';
  });

  /** Plan cards ordered for the grid, including locked state per macro. */
  readonly planCards = computed(() => {
    const macro = this.selectedMacroId();
    const allowed = macro !== null
      ? AVAILABLE_PLANS_BY_MACRO[macro]
      : new Set<PlanSlug>(PLAN_ORDER);
    // Feature whitelist for the current macro — keeps F&B-only bullets
    // (TableMap, WaiterApp, …) out of Retail/Services cards.
    const applicableFeatures = macro !== null
      ? new Set<FeatureKey>(GIRO_FEATURE_MAP[macro])
      : null;
    const group = this.pricingGroup();
    const cycle = this.billingCycle();
    const catalog = this.catalogService.planCatalog();
    return PLAN_ORDER.map(slug => {
      const tier = catalog.find(t => t.slug === slug);
      if (!tier) throw new Error(`[onboarding] Missing tier in plan catalog for slug "${slug}"`);
      const isLocked = !allowed.has(slug);
      const priceTable = cycle === 'annual' ? tier.annualPrice : tier.monthlyPrice;
      const features = tier.features
        .filter(key => applicableFeatures === null || applicableFeatures.has(key))
        .map(key => FEATURE_LABELS[key]);
      return {
        slug,
        name: tier.name,
        badge: tier.badge ?? FREE_BADGE_FALLBACK,
        description: PLAN_DESCRIPTIONS[slug],
        features,
        price: priceTable[group],
        isFree: slug === 'free',
        isFeatured: slug === 'pro',
        isLocked,
      };
    });
  });

  /** Best-fit default plan for the current macro: Pro if available, else first available. */
  readonly defaultPlan = computed<PlanSlug>(() => {
    const macro = this.selectedMacroId();
    const allowed = macro !== null
      ? AVAILABLE_PLANS_BY_MACRO[macro]
      : new Set<PlanSlug>(PLAN_ORDER);
    if (allowed.has('pro')) return 'pro';
    for (const slug of PLAN_ORDER) {
      if (allowed.has(slug)) return slug;
    }
    return 'free';
  });

  readonly cycleLabel = computed(() =>
    this.billingCycle() === 'monthly' ? '/ mes' : '/ mes · anual',
  );

  readonly isCheckoutPlan = computed(() =>
    PAID_PLANS.includes(this.selectedPlan() as PlanSlug),
  );

  readonly ctaLabel = computed(() => {
    const slug = this.selectedPlan();
    if (!slug) return 'Elige un plan';
    const tier = this.catalogService.planCatalog().find(t => t.slug === slug);
    return tier ? `Comenzar con ${tier.name}` : 'Elige un plan';
  });

  //#endregion

  //#region Constructor & lifecycle

  constructor() {
    // Keep `selectedPlan` aligned with what's available for the current macro.
    // Runs whenever plan cards change (macro switch, cycle change, etc.).
    effect(() => {
      const cards = this.planCards();
      const current = this.selectedPlan();
      const isValid = current !== null
        && cards.find(c => c.slug === current && !c.isLocked) !== undefined;
      if (isValid) return;

      const pending = this.readPendingPlan();
      const pendingCard = pending ? cards.find(c => c.slug === pending && !c.isLocked) : undefined;
      if (pendingCard) {
        this.selectedPlan.set(pendingCard.slug);
        return;
      }
      this.selectedPlan.set(this.defaultPlan());
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    // Guard: wizard requires a live session; redirect if AuthService has no user.
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    // Belt-and-suspenders: TenantContextService already fires a catalog
    // fetch after JWT hydration, but if the user lands on onboarding via
    // a direct URL before that pipeline completes the signal would still
    // be on the static fallback. Re-fetching is idempotent — the service
    // just replaces `_planApiFeatures` with the latest response.
    this.catalogService.fetchPlanCatalog();

    // Restore step from user profile (survives page refresh when the backend
    // updated `currentOnboardingStep` on the last nextStep() sync).
    const user = this.authService.currentUser();
    const savedStep = user?.currentOnboardingStep;
    if (savedStep && savedStep > 1 && savedStep <= this.totalSteps) {
      this.currentStep.set(savedStep);
    }

    // Pre-fill macro from the landing handshake: `primaryMacroCategoryId`
    // is the only vertical info carried by the JWT. The silent `getGiro()`
    // fetch below may overwrite this with the authoritative server state.
    const macro = this.authService.primaryMacroCategoryId();
    if (macro !== null) {
      this.selectedMacroId.set(macro);
    }

    // Silent hydration — best-effort. If the call fails (first-time
    // tenant, network error, 404) we keep the JWT-seeded macro and the
    // user types their sub-giros from scratch.
    this.hydrateFromServer();
  }

  /**
   * Pulls the current giro snapshot from the backend and merges it into
   * the wizard's signals so a user returning to Step 1 (page refresh,
   * Stripe cancel, manual navigation) sees their previous selection.
   *
   * "Otra" is recovered via sentinel: when the server reports a non-empty
   * `customGiroDescription`, we inject `OTRA_SUB_ID` into the sub-giro
   * set so the UI lights up the chip and reveals the text input.
   */
  private hydrateFromServer(): void {
    this.businessService.getGiro().subscribe({
      next: (snapshot) => {
        if (snapshot.primaryMacroCategoryId !== null) {
          this.selectedMacroId.set(snapshot.primaryMacroCategoryId);
        }

        const hydratedIds: number[] = [...snapshot.subGiroIds];
        const customText = snapshot.customGiroDescription?.trim() ?? '';
        if (customText.length > 0) {
          hydratedIds.push(OTRA_SUB_ID);
          this.customGiroText.set(customText);
        }
        this.selectedSubGiroIds.set(hydratedIds);

        // Push the derived vertical sub-category so the rest of the
        // app can react (POS layout, cart slots, member selectors).
        this.tenantContext.setSubCategory(deriveSubCategory(snapshot.subGiroIds));
      },
      error: () => { /* best-effort — the wizard still works without prior state */ },
    });
  }

  //#endregion

  //#region Step 1 — Interaction

  /** Radio behavior: click on the same macro only toggles expand (no-op). */
  selectMacro(id: MacroCategoryType): void {
    if (this.selectedMacroId() === id) return;
    this.selectedMacroId.set(id);
    // Clear sub-giros + custom text when the active macro changes.
    this.selectedSubGiroIds.set([]);
    this.customGiroText.set('');
  }

  hoverMacro(id: MacroCategoryType | null): void {
    this.hoveredMacroId.set(id);
  }

  /** Toggles a sub-giro chip (real id or the `OTRA_SUB_ID` sentinel). */
  toggleSubGiro(id: number): void {
    this.selectedSubGiroIds.update(current =>
      current.includes(id) ? current.filter(x => x !== id) : [...current, id],
    );
    // Clean free text when "Otra" is un-checked so stale input doesn't persist.
    if (id === OTRA_SUB_ID && !this.isOtraChecked()) {
      this.customGiroText.set('');
    }
  }

  /** Returns true when the given sub-giro chip is checked (template helper). */
  isSubGiroChecked(id: number): boolean {
    return this.selectedSubGiroIds().includes(id);
  }

  /** Resolves a sub-giro's chip id — real id when present, sentinel for "Otra". */
  chipIdOf(sub: SubGiroOption): number {
    return sub.id === null ? OTRA_SUB_ID : sub.id;
  }

  /** Human-readable label for the macro currently selected — used in Step 1's hint. */
  readonly selectedMacroLabel = computed(() => {
    const id = this.selectedMacroId();
    if (id === null) return '';
    return MACRO_CATEGORY_LABELS[id];
  });

  /** Whether Step 1's "Continuar" button should be enabled. */
  canContinueFromStep1(): boolean {
    if (this.selectedMacroId() === null) return false;
    // If the user checked "Otra", require free-text before allowing continue.
    if (this.isOtraChecked() && !this.customGiroText().trim()) return false;
    return true;
  }

  /**
   * Persists the Step 1 selection to the backend BEFORE advancing the
   * wizard. If the PUT succeeds the wizard moves to Step 2; on failure
   * we keep the user where they are and surface a toast.
   */
  async goToStep2(): Promise<void> {
    if (!this.canContinueFromStep1() || this.isSavingGiro()) return;

    const macro = this.selectedMacroId();
    if (macro === null) return;

    this.isSavingGiro.set(true);

    const subGiroIds = this.selectedSubGiroIds()
      .filter((id): id is BusinessTypeId => id !== OTRA_SUB_ID);
    const payload: UpdateBusinessGiroRequest = {
      primaryMacroCategoryId: macro,
      subGiroIds,
    };
    if (this.isOtraChecked()) {
      payload.customGiroDescription = this.customGiroText().trim();
    }

    try {
      await firstValueFrom(this.businessService.updateGiro(payload));
      // Mirror the derived sub-category into the tenant context as
      // soon as the wizard's selection is committed server-side, so
      // downstream consumers (POS layout, cart) react without waiting
      // for the next JWT refresh.
      this.tenantContext.setSubCategory(deriveSubCategory(subGiroIds));
      this.currentStep.set(2);
      // Fire-and-forget sync of the step pointer for session resume.
      this.businessService.syncOnboardingStep(2, 2).subscribe({ error: () => {} });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'No pudimos guardar tu giro',
        detail: 'Verifica tu conexión e inténtalo de nuevo.',
        life: 5000,
      });
    } finally {
      this.isSavingGiro.set(false);
    }
  }

  //#endregion

  //#region Step 2 — Interaction

  toggleBillingCycle(cycle: BillingCycle): void {
    this.billingCycle.set(cycle);
  }

  selectPlan(slug: PlanSlug): void {
    const card = this.planCards().find(c => c.slug === slug);
    if (!card || card.isLocked) return;
    this.selectedPlan.set(slug);
    this.checkoutError.set('');
  }

  /** Returns to Step 1 without clearing the selection — lets the user refine their giro. */
  goBackToStep1(): void {
    this.currentStep.set(1);
    this.businessService.syncOnboardingStep(2, 1).subscribe({ error: () => {} });
  }

  /** Primary CTA dispatch: paid plans go to Stripe, Free goes to trial completion. */
  async activatePlan(): Promise<void> {
    if (this.isCheckoutPlan()) {
      await this.startCheckout();
    } else {
      await this.continueWithTrial();
    }
  }

  /**
   * Finalizes the onboarding BEFORE redirecting to Stripe so the JWT is
   * fresh when the user returns via `/admin?checkout=success`. Without
   * this pre-flight, `authGuard` rebounds the user to /onboarding on the
   * success redirect.
   */
  async startCheckout(): Promise<void> {
    const plan = this.selectedPlan();
    if (!plan || plan === 'free') return;

    this.checkoutLoading.set(true);
    this.checkoutError.set('');

    const tier = this.catalogService.planCatalog().find(t => t.slug === plan);
    const priceId = tier?.stripePriceIds?.[this.billingCycle()][this.pricingGroup()];
    if (!priceId) {
      this.checkoutError.set('No se pudo resolver el plan seleccionado.');
      this.checkoutLoading.set(false);
      return;
    }
    const origin = window.location.origin;

    try {
      await this.finalizeOnboarding();

      const response = await firstValueFrom(
        this.http.post<{ url: string }>(`${environment.apiUrl}/subscription/checkout`, {
          priceId,
          successUrl: `${origin}/admin?checkout=success`,
          cancelUrl:  `${origin}/admin?checkout=canceled`,
        }),
      );
      window.location.href = response.url;
    } catch {
      this.checkoutError.set('No se pudo iniciar el pago. Intenta de nuevo.');
      this.checkoutLoading.set(false);
    }
  }

  /** Completes onboarding without Stripe — used by the Free plan CTA. */
  async continueWithTrial(): Promise<void> {
    await this.completeOnboarding();
  }

  //#endregion

  //#region Completion

  /**
   * Closes the onboarding wizard and lands the Owner on /admin. Used by
   * the Free plan path — Stripe flow calls `finalizeOnboarding()` directly
   * to avoid navigating before the external redirect.
   */
  async completeOnboarding(): Promise<void> {
    this.isSubmitting.set(true);

    await this.finalizeOnboarding();

    this.isSubmitting.set(false);

    const roleId = this.authService.currentUser()?.roleId;
    const resolved = roleId ? this.deviceRoutingService.getPostLoginRoute(roleId) : null;
    const dest = resolved?.kind === 'route' ? resolved.route : '/admin';

    this.router.navigateByUrl(dest);
  }

  /**
   * Persists "onboarding complete" state without navigating. Calls
   * `POST /business/complete-onboarding`, absorbs the fresh JWT via
   * `handleLoginSuccess`, and writes a local fallback flag. The backend
   * call is best-effort — the localStorage flag lets `isOnboardingComplete`
   * return true on the next guard pass even if the API is briefly down.
   */
  private async finalizeOnboarding(): Promise<void> {
    const branchId = this.authService.branchId;

    try {
      const response = await firstValueFrom(this.businessService.completeOnboarding());
      this.authService.handleLoginSuccess(response);
    } catch { /* best-effort — localStorage fallback below */ }

    localStorage.setItem(`${ONBOARDING_KEY_PREFIX}${branchId}`, 'true');
    localStorage.removeItem(`pending-plan-${branchId}`);
  }

  //#endregion

  //#region Private helpers

  /** Reads the pending plan slug written by the register handshake. */
  private readPendingPlan(): PlanSlug | null {
    const branchId = this.authService.branchId;
    const raw = localStorage.getItem(`pending-plan-${branchId}`);
    if (!raw) return null;
    return PLAN_ORDER.includes(raw as PlanSlug) ? (raw as PlanSlug) : null;
  }

  /** Formats a price amount in MXN pesos for display. Returns 'Gratis' when 0. */
  formatPrice(pesos: number): string {
    if (!pesos) return 'Gratis';
    return '$' + pesos.toLocaleString('es-MX', { minimumFractionDigits: 0 });
  }

  //#endregion

}
