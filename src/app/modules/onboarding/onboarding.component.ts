import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { InputTextModule } from 'primeng/inputtext';

import { environment } from '../../../environments/environment';
import { BusinessTypeId } from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { DeviceRoutingService } from '../../core/services/device-routing.service';
import { BusinessService } from '../../core/services/business.service';

const ONBOARDING_KEY_PREFIX = 'onboarding-completed-';

/** Giro display info for all 12 business types */
interface GiroInfo { icon: string; label: string; description: string }

const GIRO_INFO_MAP: Record<BusinessTypeId, GiroInfo> = {
  // 4 macro categories — these are the official options exposed in the UI grid
  [BusinessTypeId.Restaurant]: { icon: '🍽️', label: 'Restaurantes y Bares',     description: 'Mesas, cocina, mesero, kiosko' },
  [BusinessTypeId.Cafe]:       { icon: '☕',  label: 'Comida Rápida y Cafés',   description: 'Comandas rápidas, barra, food trucks' },
  [BusinessTypeId.Retail]:     { icon: '🛒',  label: 'Tiendas y Comercios',     description: 'Inventario, código de barras, fiado' },
  [BusinessTypeId.Servicios]:  { icon: '🛠️', label: 'Servicios Especializados', description: 'Estéticas, consultorios, talleres' },

  // Sub-types — kept so badges still render when the JWT or the URL
  // handshake resolves to a sub-giro instead of a macro.
  [BusinessTypeId.Bar]:        { icon: '🍺', label: 'Bar / Cantina', description: 'Mesas + barra, consumo corrido' },
  [BusinessTypeId.Taqueria]:   { icon: '🌮', label: 'Taquería',      description: 'Cobro rápido, con cocina' },
  [BusinessTypeId.Abarrotes]:  { icon: '🛒', label: 'Abarrotes',     description: 'Tiendita de barrio' },
  [BusinessTypeId.Ferreteria]: { icon: '🔧', label: 'Ferretería',    description: 'Materiales y herramientas' },
  [BusinessTypeId.Papeleria]:  { icon: '📝', label: 'Papelería',     description: 'Útiles y copias' },
  [BusinessTypeId.Farmacia]:   { icon: '💊', label: 'Farmacia',      description: 'Medicinas y salud' },
};

/**
 * Main giro options displayed in step 2 grid when there is no JWT pre-selection.
 * Strictly the 4 macro categories defined in `.claude/business-rules-matrix.md`.
 */
const GIRO_OPTIONS: { value: BusinessTypeId; icon: string; label: string; description: string }[] = [
  { value: BusinessTypeId.Restaurant, ...GIRO_INFO_MAP[BusinessTypeId.Restaurant] },
  { value: BusinessTypeId.Cafe,       ...GIRO_INFO_MAP[BusinessTypeId.Cafe] },
  { value: BusinessTypeId.Retail,     ...GIRO_INFO_MAP[BusinessTypeId.Retail] },
  { value: BusinessTypeId.Servicios,  ...GIRO_INFO_MAP[BusinessTypeId.Servicios] },
];

/** BusinessTypes in the retail group — show sub-options */
const RETAIL_GROUP: BusinessTypeId[] = [
  BusinessTypeId.Retail, BusinessTypeId.Abarrotes, BusinessTypeId.Ferreteria,
  BusinessTypeId.Papeleria, BusinessTypeId.Farmacia,
];

/** Sub-options shown when giro is in RETAIL_GROUP */
const RETAIL_SUB_OPTIONS: { value: BusinessTypeId; icon: string; label: string }[] = [
  { value: BusinessTypeId.Abarrotes,  icon: '🛒', label: 'Abarrotes' },
  { value: BusinessTypeId.Ferreteria, icon: '🔧', label: 'Ferretería' },
  { value: BusinessTypeId.Papeleria,  icon: '📝', label: 'Papelería' },
  { value: BusinessTypeId.Farmacia,   icon: '💊', label: 'Farmacia' },
  { value: BusinessTypeId.Retail,     icon: '🏪', label: 'Otra tienda' },
];

// ---------------------------------------------------------------------------
// Pricing — real Stripe price IDs
// ---------------------------------------------------------------------------

type PricingGroup = 'restaurant' | 'standard' | 'general';
type BillingCycle = 'monthly' | 'annual';
type PlanSlug = 'free' | 'basic' | 'pro' | 'enterprise';

/** All plan slugs shown in the grid — rendered in this order */
const PLAN_ORDER: PlanSlug[] = ['free', 'basic', 'pro', 'enterprise'];

/** Plans that require a Stripe checkout (Free routes through the trial action) */
const PAID_PLANS: PlanSlug[] = ['basic', 'pro', 'enterprise'];

/** Maps businessType → pricing group (Stripe pricing key, unrelated to BusinessTypeId names) */
const PRICING_GROUP_MAP: Record<BusinessTypeId, PricingGroup> = {
  [BusinessTypeId.Restaurant]: 'restaurant',
  [BusinessTypeId.Bar]:        'restaurant',
  [BusinessTypeId.Cafe]:       'standard',
  [BusinessTypeId.Taqueria]:   'standard',
  [BusinessTypeId.Retail]:     'general',
  [BusinessTypeId.Abarrotes]:  'standard',
  [BusinessTypeId.Ferreteria]: 'standard',
  [BusinessTypeId.Papeleria]:  'standard',
  [BusinessTypeId.Farmacia]:   'standard',
  [BusinessTypeId.Servicios]:  'general',
};

/** Stripe price IDs keyed by [plan][group][cycle] */
const STRIPE_PRICE_IDS: Record<string, Record<PricingGroup, Record<BillingCycle, string>>> = {
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

/** Display prices in MXN (centavos) keyed by [plan][group][cycle] */
const DISPLAY_PRICES: Record<string, Record<PricingGroup, Record<BillingCycle, number>>> = {
  basic: {
    general:    { monthly: 9900,   annual: 99000 },
    standard:   { monthly: 14900,  annual: 149000 },
    restaurant: { monthly: 19900,  annual: 199000 },
  },
  pro: {
    general:    { monthly: 24900,  annual: 249000 },
    standard:   { monthly: 34900,  annual: 349000 },
    restaurant: { monthly: 49900,  annual: 499000 },
  },
  enterprise: {
    general:    { monthly: 59900,  annual: 599000 },
    standard:   { monthly: 79900,  annual: 799000 },
    restaurant: { monthly: 99900,  annual: 999000 },
  },
};

/** Plan display names in Spanish */
const PLAN_NAMES: Record<PlanSlug, string> = {
  free:       'Gratis',
  basic:      'Básico',
  pro:        'Pro',
  enterprise: 'Enterprise',
};

/** Short tagline shown under each plan's header */
const PLAN_TAGLINES: Record<PlanSlug, string> = {
  free:       'Comienza sin tarjeta',
  basic:      'Para negocios que arrancan',
  pro:        'La opción recomendada',
  enterprise: 'Para operaciones de alto volumen',
};

/** Feature bullets surfaced in each plan card */
const PLAN_FEATURES: Record<PlanSlug, string[]> = {
  free:       ['1 sucursal', 'Ventas básicas', 'Reportes simples'],
  basic:      ['1 sucursal', 'Catálogo ilimitado', 'Reportes diarios'],
  pro:        ['Multi-sucursal', 'Inventario avanzado', 'Soporte prioritario'],
  enterprise: ['Sucursales ilimitadas', 'API y roles avanzados', 'Gerente de cuenta'],
};

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, InputTextModule],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent implements OnInit {

  //#region Properties

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly businessService = inject(BusinessService);
  private readonly deviceRoutingService = inject(DeviceRoutingService);
  private readonly router = inject(Router);

  /** Enterprise handoff wizard is fixed at 3 steps: Identity → Business → Plan */
  readonly totalSteps = 3;

  readonly currentStep = signal(1);
  readonly isSubmitting = signal(false);

  readonly giroOptions = GIRO_OPTIONS;
  readonly retailSubOptions = RETAIL_SUB_OPTIONS;

  // Step 1 — Identity
  /** Display name of the authenticated owner (from register handshake) */
  readonly ownerName = computed(() => this.authService.currentUser()?.name ?? '');

  // Step 2 — Giro (multi-select)
  readonly selectedGiros = signal<BusinessTypeId[]>([]);
  readonly customGiroText = signal('');

  /**
   * Primary giro (first selected) — drives pricing group.
   * Null until the user picks at least one giro.
   */
  readonly primaryGiro = computed<BusinessTypeId | null>(() => this.selectedGiros()[0] ?? null);

  /** Whether "Otra tienda" (Retail) is selected, requiring a custom description */
  readonly showCustomGiroInput = computed(() => this.selectedGiros().includes(BusinessTypeId.Retail));

  /** Business type from JWT — null if not pre-selected */
  readonly jwtGiro = signal<BusinessTypeId | null>(null);

  /** True when the JWT giro is in the retail group */
  readonly isRetailGroup = computed(() =>
    RETAIL_GROUP.includes(this.jwtGiro() as BusinessTypeId)
  );

  /** True when giro grid should be shown (no JWT pre-selection) */
  readonly showGiroGrid = computed(() => !this.jwtGiro());

  /** Badge info for the pre-selected giro */
  readonly giroBadge = computed(() => {
    const giro = this.jwtGiro();
    if (!giro) return null;
    // For retail group, always show the group badge
    if (RETAIL_GROUP.includes(giro)) {
      return GIRO_INFO_MAP[BusinessTypeId.Retail];
    }
    return GIRO_INFO_MAP[giro] ?? null;
  });

  // Step 3 — Plan selection + Stripe checkout
  readonly selectedPlan = signal<PlanSlug | null>(null);
  readonly billingCycle = signal<BillingCycle>('monthly');
  readonly checkoutLoading = signal(false);
  readonly checkoutError = signal('');

  /**
   * Pricing group derived from selected business type.
   * Defaults to 'standard' when no giro is picked yet — once the user
   * advances past Step 2 this will always reflect a real group.
   */
  readonly pricingGroup = computed<PricingGroup>(() => {
    const giro = this.primaryGiro();
    return giro !== null ? PRICING_GROUP_MAP[giro] : 'standard';
  });

  /** Plan slugs available for the current pricing group, in display order */
  readonly availablePlans = computed<PlanSlug[]>(() => {
    const group = this.pricingGroup();
    return PLAN_ORDER.filter(slug => {
      // Free is always available and short-circuits Stripe
      if (slug === 'free') return true;
      return Boolean(STRIPE_PRICE_IDS[slug]?.[group]);
    });
  });

  /** Highest-tier plan currently available (fallback when pendingPlan is missing) */
  readonly defaultPlan = computed<PlanSlug>(() => {
    const available = this.availablePlans();
    for (let i = PLAN_ORDER.length - 1; i >= 0; i--) {
      if (available.includes(PLAN_ORDER[i])) return PLAN_ORDER[i];
    }
    return 'free';
  });

  /** Cards rendered in the plan grid with computed copy + price */
  readonly planCards = computed(() => {
    const group = this.pricingGroup();
    const cycle = this.billingCycle();
    return this.availablePlans().map(slug => ({
      slug,
      name: PLAN_NAMES[slug],
      tagline: PLAN_TAGLINES[slug],
      features: PLAN_FEATURES[slug],
      priceCents: slug === 'free' ? 0 : (DISPLAY_PRICES[slug]?.[group]?.[cycle] ?? 0),
      isFree: slug === 'free',
    }));
  });

  /** Formatted price for a card's centavo amount (empty when free) */
  formatPrice(cents: number): string {
    if (!cents) return 'Gratis';
    return '$' + (cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 0 });
  }

  /** Billing cycle label for display */
  readonly cycleLabel = computed(() =>
    this.billingCycle() === 'monthly' ? '/mes' : '/año'
  );

  /** Progress percentage */
  readonly progress = computed(() =>
    Math.round((this.currentStep() / this.totalSteps) * 100),
  );

  /** Whether the primary CTA should fire Stripe checkout (vs. trial completion) */
  readonly isCheckoutPlan = computed(() =>
    PAID_PLANS.includes(this.selectedPlan() as PlanSlug),
  );

  /** CTA label changes between Stripe and trial flows */
  readonly ctaLabel = computed(() =>
    this.isCheckoutPlan() ? 'Activar plan →' : 'Continuar con trial gratis',
  );

  //#endregion

  //#region Constructor & Lifecycle

  constructor() {
    // Reset plan selection whenever the pool of available plans changes
    // (e.g. when giro changes in Step 2). If the current pick is still
    // valid we keep it; otherwise fall back to the pendingPlan or the
    // highest-tier plan available for the new group.
    effect(() => {
      const available = this.availablePlans();
      const current = this.selectedPlan();
      if (current && available.includes(current)) return;
      const pending = this.readPendingPlan();
      if (pending && available.includes(pending)) {
        this.selectedPlan.set(pending);
        return;
      }
      this.selectedPlan.set(this.defaultPlan());
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    // Redirect if not authenticated — guard contract, but keep as safety net
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    // Restore step from user profile (survives page refresh)
    const user = this.authService.currentUser();
    const savedStep = user?.currentOnboardingStep;
    if (savedStep && savedStep > 1 && savedStep <= this.totalSteps) {
      this.currentStep.set(savedStep);
    }

    // Pre-fill giro from JWT
    const jwtGiro = this.authService.businessTypeId();
    if (jwtGiro) {
      this.jwtGiro.set(jwtGiro);
      // Non-retail JWT giros are pre-selected (user just sees a badge)
      // Retail group starts empty — user must pick sub-options
      if (!RETAIL_GROUP.includes(jwtGiro)) {
        this.selectedGiros.set([jwtGiro]);
      }
    }
  }

  //#endregion

  //#region Navigation

  /** Advances to the next step */
  nextStep(): void {
    if (this.currentStep() < this.totalSteps) {
      this.currentStep.update(s => s + 1);
      this.businessService.syncOnboardingStep(2, this.currentStep())
        .subscribe({ error: () => {} });
    }
  }

  /** Goes back to the previous step */
  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
      this.businessService.syncOnboardingStep(2, this.currentStep())
        .subscribe({ error: () => {} });
    } else {
      this.router.navigate(['/login']);
    }
  }

  /** Whether the current step has valid data to proceed */
  canProceed(): boolean {
    switch (this.currentStep()) {
      case 1: return true; // Identity is read-only confirmation
      case 2: {
        const giros = this.selectedGiros();
        if (giros.length === 0) return false;
        if (giros.includes(BusinessTypeId.Retail) && !this.customGiroText().trim()) return false;
        return true;
      }
      case 3: return this.selectedPlan() !== null;
      default: return false;
    }
  }

  //#endregion

  //#region Step 2 — Giro

  /** Whether a giro is currently selected (used in template bindings) */
  hasGiro(giro: BusinessTypeId | number): boolean {
    return this.selectedGiros().includes(giro as BusinessTypeId);
  }

  /** Toggles a business type on/off in the multi-select array */
  toggleGiro(giro: BusinessTypeId): void {
    this.selectedGiros.update(current =>
      current.includes(giro)
        ? current.filter(g => g !== giro)
        : [...current, giro],
    );
    if (giro === BusinessTypeId.Retail && !this.selectedGiros().includes(BusinessTypeId.Retail)) {
      this.customGiroText.set('');
    }
  }

  /** Toggles a retail sub-option on/off in the multi-select array */
  toggleRetailSub(giro: BusinessTypeId): void {
    this.selectedGiros.update(current =>
      current.includes(giro)
        ? current.filter(g => g !== giro)
        : [...current, giro],
    );
    if (giro === BusinessTypeId.Retail && !this.selectedGiros().includes(BusinessTypeId.Retail)) {
      this.customGiroText.set('');
    }
  }

  //#endregion

  //#region Step 3 — Plan + Checkout

  /** Toggles billing cycle between monthly and annual */
  toggleBillingCycle(cycle: BillingCycle): void {
    this.billingCycle.set(cycle);
  }

  /** Marks a card as selected */
  selectPlan(slug: PlanSlug): void {
    this.selectedPlan.set(slug);
    this.checkoutError.set('');
  }

  /**
   * Primary CTA handler — dispatches to Stripe checkout for paid plans
   * or completes onboarding with the trial intact for Free.
   */
  async activatePlan(): Promise<void> {
    if (this.isCheckoutPlan()) {
      await this.startCheckout();
    } else {
      await this.continueWithTrial();
    }
  }

  /**
   * Starts Stripe checkout for the selected paid plan.
   * Calls POST /api/subscription/checkout and redirects to Stripe.
   */
  async startCheckout(): Promise<void> {
    const plan = this.selectedPlan();
    if (!plan || !STRIPE_PRICE_IDS[plan]) return;

    this.checkoutLoading.set(true);
    this.checkoutError.set('');

    const priceId = STRIPE_PRICE_IDS[plan][this.pricingGroup()][this.billingCycle()];
    const origin = window.location.origin;

    try {
      const response = await firstValueFrom(
        this.http.post<{ url: string }>(`${environment.apiUrl}/subscription/checkout`, {
          priceId,
          successUrl: `${origin}/admin?checkout=success`,
          cancelUrl: `${origin}/onboarding`,
        }),
      );
      window.location.href = response.url;
    } catch {
      this.checkoutError.set('No se pudo iniciar el pago. Intenta de nuevo.');
      this.checkoutLoading.set(false);
    }
  }

  /**
   * Completes onboarding on the trial — no Stripe call.
   * Backend already provisioned the trialEndsAt window at registration time.
   */
  async continueWithTrial(): Promise<void> {
    await this.completeOnboarding();
  }

  //#endregion

  //#region Completion

  /**
   * Closes the onboarding wizard with a single call to
   * `POST /business/complete-onboarding` and lands the Owner on /admin.
   *
   * Hardware binding is handled by `terminalGuard` on operational routes,
   * so the Back Office session finishes without persisting any DeviceConfig.
   */
  async completeOnboarding(): Promise<void> {
    this.isSubmitting.set(true);

    const branchId = this.authService.branchId;

    try {
      const response = await firstValueFrom(
        this.businessService.completeOnboarding(),
      );
      this.authService.handleLoginSuccess(response);
    } catch { /* best-effort — localStorage fallback below */ }

    localStorage.setItem(`${ONBOARDING_KEY_PREFIX}${branchId}`, 'true');
    localStorage.removeItem(`pending-plan-${branchId}`);

    this.isSubmitting.set(false);

    const roleId = this.authService.currentUser()?.roleId;
    const dest = roleId
      ? this.deviceRoutingService.getPostLoginRoute(roleId)
      : '/admin';
    this.router.navigate([dest]);
  }

  //#endregion

  //#region Private helpers

  /** Reads the plan slug persisted by the register handshake */
  private readPendingPlan(): PlanSlug | null {
    const branchId = this.authService.branchId;
    const raw = localStorage.getItem(`pending-plan-${branchId}`);
    if (!raw) return null;
    return PLAN_ORDER.includes(raw as PlanSlug) ? (raw as PlanSlug) : null;
  }

  //#endregion

}
