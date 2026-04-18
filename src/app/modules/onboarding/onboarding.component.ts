import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MessageService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { InputTextModule } from 'primeng/inputtext';

import { environment } from '../../../environments/environment';
import { UpdateBusinessGiroRequest } from '../../core/models';
import { BusinessTypeId, MACRO_CATEGORY_LABELS, MacroCategoryType } from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { DeviceRoutingService } from '../../core/services/device-routing.service';
import { BusinessService } from '../../core/services/business.service';
import { BrioMascotComponent, BrioSkin } from './brio-mascot/brio-mascot.component';

const ONBOARDING_KEY_PREFIX = 'onboarding-completed-';

/** Sub-giro descriptor rendered as a chip inside an expanded macro card. */
interface SubGiroOption {
  /** Real BusinessTypeId — null only for the synthetic "Otra" chip */
  id: BusinessTypeId | null;
  label: string;
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

type PricingGroup = 'restaurant' | 'standard' | 'general';

/** Plans ordered from cheapest to most expensive — drives grid layout. */
const PLAN_ORDER: PlanSlug[] = ['free', 'basic', 'pro', 'enterprise'];

/** Plans that require Stripe — Free short-circuits to `continueWithTrial`. */
const PAID_PLANS: PlanSlug[] = ['basic', 'pro', 'enterprise'];

/** Maps macro → pricing group used by the Stripe matrix. */
const PRICING_GROUP_BY_MACRO: Record<MacroCategoryType, PricingGroup> = {
  [MacroCategoryType.FoodBeverage]: 'restaurant',
  [MacroCategoryType.QuickService]: 'standard',
  [MacroCategoryType.Retail]:       'general',
  [MacroCategoryType.Services]:     'general',
};

/**
 * Plans available per macro (feature gating per `.claude/business-rules-matrix.md`):
 *   - FoodBeverage → all 4 tiers
 *   - QuickService → Free / Basic / Pro (Enterprise locked)
 *   - Retail       → Free / Basic / Pro (Enterprise locked)
 *   - Services     → Free / Pro (Basic and Enterprise locked)
 */
const AVAILABLE_PLANS_BY_MACRO: Record<MacroCategoryType, ReadonlySet<PlanSlug>> = {
  [MacroCategoryType.FoodBeverage]: new Set(['free', 'basic', 'pro', 'enterprise']),
  [MacroCategoryType.QuickService]: new Set(['free', 'basic', 'pro']),
  [MacroCategoryType.Retail]:       new Set(['free', 'basic', 'pro']),
  [MacroCategoryType.Services]:     new Set(['free', 'pro']),
};

/** Stripe price IDs keyed by [plan][group][cycle]. */
const STRIPE_PRICE_IDS: Record<Exclude<PlanSlug, 'free'>, Record<PricingGroup, Record<BillingCycle, string>>> = {
  basic: {
    restaurant: { monthly: 'price_1TGjZTGd6oMtnYKNKH4mV0WR', annual: 'price_1TGjaKGd6oMtnYKNMlQbqt1f' },
    standard:   { monthly: 'price_1TGjYIGd6oMtnYKNaWsO5wW9', annual: 'price_1TGjYvGd6oMtnYKNNLJSrXWk' },
    general:    { monthly: 'price_1TGVDNGd6oMtnYKN3mOfuloV', annual: 'price_1TGVGBGd6oMtnYKNOtYdklZ7' },
  },
  pro: {
    restaurant: { monthly: 'price_1TGVDsGd6oMtnYKNGYySti0z', annual: 'price_1TGVFhGd6oMtnYKNJGIXZ3d3' },
    standard:   { monthly: 'price_1TGjjMGd6oMtnYKNnUYsOsmr', annual: 'price_1TGjk0Gd6oMtnYKNbIyJOpr8' },
    general:    { monthly: 'price_1TGjiaGd6oMtnYKNFY6ZbnMS', annual: 'price_1TGjj3Gd6oMtnYKNYX06rZPx' },
  },
  enterprise: {
    restaurant: { monthly: 'price_1TGVEDGd6oMtnYKNC7v50zld', annual: 'price_1TGVErGd6oMtnYKNfEBSfiPS' },
    standard:   { monthly: 'price_1TGjsMGd6oMtnYKNV4ixW9ms', annual: 'price_1TGjtEGd6oMtnYKNMDlACMO2' },
    general:    { monthly: 'price_1TGjrfGd6oMtnYKNaEVHitCF', annual: 'price_1TGjs2Gd6oMtnYKN4BvXPwXw' },
  },
};

/** Display prices in centavos, keyed by [plan][group][cycle]. */
const DISPLAY_PRICES: Record<Exclude<PlanSlug, 'free'>, Record<PricingGroup, Record<BillingCycle, number>>> = {
  basic: {
    general:    { monthly: 9900,   annual: 7900 },
    standard:   { monthly: 14900,  annual: 11900 },
    restaurant: { monthly: 19900,  annual: 15900 },
  },
  pro: {
    general:    { monthly: 24900,  annual: 19900 },
    standard:   { monthly: 34900,  annual: 27900 },
    restaurant: { monthly: 49900,  annual: 39900 },
  },
  enterprise: {
    general:    { monthly: 59900,  annual: 47900 },
    standard:   { monthly: 79900,  annual: 63900 },
    restaurant: { monthly: 99900,  annual: 79900 },
  },
};

const PLAN_NAMES: Record<PlanSlug, string> = {
  free:       'Free',
  basic:      'Basic',
  pro:        'Pro',
  enterprise: 'Enterprise',
};

const PLAN_BADGES: Record<PlanSlug, string> = {
  free:       'Gratis',
  basic:      'Básico',
  pro:        'Más popular',
  enterprise: 'Franquicia',
};

const PLAN_DESCRIPTIONS: Record<PlanSlug, string> = {
  free:       'Para probar sin compromiso',
  basic:      'Para negocios que arrancan',
  pro:        'El favorito de nuestros clientes',
  enterprise: 'Para cadenas y franquicias',
};

const PLAN_FEATURES: Record<PlanSlug, string[]> = {
  free:       ['1 sucursal', 'Hasta 100 ventas/mes', 'Inventario básico', 'App iOS / Android'],
  basic:      ['1 sucursal', 'Ventas ilimitadas', 'Reportes mensuales', 'Soporte prioritario'],
  pro:        ['3 sucursales', 'Multi-dispositivo', 'Reportes avanzados', 'Facturación CFDI', 'Soporte 24/7'],
  enterprise: ['Sucursales ilimitadas', 'API personalizada', 'Dashboard central', 'Gerente dedicado'],
};

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
      { id: BusinessTypeId.Gimnasio,       label: 'Gimnasio / Deportes' },
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
  private readonly deviceRoutingService = inject(DeviceRoutingService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

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
    const group = this.pricingGroup();
    const cycle = this.billingCycle();
    return PLAN_ORDER.map(slug => {
      const isLocked = !allowed.has(slug);
      const priceCents = slug === 'free' ? 0 : DISPLAY_PRICES[slug][group][cycle];
      return {
        slug,
        name: PLAN_NAMES[slug],
        badge: PLAN_BADGES[slug],
        description: PLAN_DESCRIPTIONS[slug],
        features: PLAN_FEATURES[slug],
        priceCents,
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
    return slug ? `Comenzar con ${PLAN_NAMES[slug]}` : 'Elige un plan';
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

    // Restore step from user profile (survives page refresh when the backend
    // updated `currentOnboardingStep` on the last nextStep() sync).
    const user = this.authService.currentUser();
    const savedStep = user?.currentOnboardingStep;
    if (savedStep && savedStep > 1 && savedStep <= this.totalSteps) {
      this.currentStep.set(savedStep);
    }

    // Pre-fill macro from the landing handshake: `primaryMacroCategoryId`
    // is the only vertical info carried by the JWT.
    const macro = this.authService.primaryMacroCategoryId();
    if (macro !== null) {
      this.selectedMacroId.set(macro);
    }
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

    const businessTypeIds = this.selectedSubGiroIds()
      .filter((id): id is BusinessTypeId => id !== OTRA_SUB_ID);
    const payload: UpdateBusinessGiroRequest = {
      primaryMacroCategoryId: macro,
      businessTypeIds,
    };
    if (this.isOtraChecked()) {
      payload.customGiroDescription = this.customGiroText().trim();
    }

    try {
      await firstValueFrom(this.businessService.updateGiro(payload));
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

    const priceId = STRIPE_PRICE_IDS[plan][this.pricingGroup()][this.billingCycle()];
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
    const dest = roleId
      ? this.deviceRoutingService.getPostLoginRoute(roleId)
      : '/admin';
    this.router.navigate([dest]);
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

  /** Formats a price amount in centavos for display. Returns 'Gratis' when 0. */
  formatPrice(cents: number): string {
    if (!cents) return 'Gratis';
    return '$' + (cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 0 });
  }

  //#endregion

}
