import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';

import { environment } from '../../../environments/environment';
import { DeviceConfig, ZoneType } from '../../core/models';
import { BusinessTypeId, UserRoleId } from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { BusinessService } from '../../core/services/business.service';
import { ConfigService } from '../../core/services/config.service';

/** Draft zone to be created during onboarding */
interface ZoneDraft {
  name: string;
  type: ZoneType;
  checked: boolean;
}

/** Draft product to be created during onboarding */
interface ProductDraft {
  name: string;
  priceCents: number;
  categoryName: string;
}

const ONBOARDING_KEY_PREFIX = 'onboarding-completed-';

/** Giro display info for all 12 business types */
interface GiroInfo { icon: string; label: string; description: string }

const GIRO_INFO_MAP: Record<BusinessTypeId, GiroInfo> = {
  [BusinessTypeId.Restaurant]: { icon: '🍽️', label: 'Restaurante',   description: 'Mesas, cocina, mesero, kiosko' },
  [BusinessTypeId.Cafe]:       { icon: '☕',  label: 'Café / Barra',  description: 'Comandas rápidas, barra' },
  [BusinessTypeId.Bar]:        { icon: '🍺',  label: 'Bar / Cantina', description: 'Mesas + barra, consumo corrido' },
  [BusinessTypeId.Retail]:     { icon: '🛒',  label: 'Abarrotes / Tienda', description: 'Escáner, códigos de barras' },
  [BusinessTypeId.FoodTruck]:  { icon: '🚚',  label: 'Food Truck',    description: 'Cobro rápido, sin mesas' },
  [BusinessTypeId.General]:    { icon: '⚙️',  label: 'General',       description: 'Cualquier negocio' },
  [BusinessTypeId.Taqueria]:   { icon: '🌮',  label: 'Taquería',      description: 'Cobro rápido, con cocina' },
  [BusinessTypeId.Abarrotes]:  { icon: '🛒',  label: 'Abarrotes',     description: 'Tiendita de barrio' },
  [BusinessTypeId.Ferreteria]: { icon: '🔧',  label: 'Ferretería',    description: 'Materiales y herramientas' },
  [BusinessTypeId.Papeleria]:  { icon: '📝',  label: 'Papelería',     description: 'Útiles y copias' },
  [BusinessTypeId.Farmacia]:   { icon: '💊',  label: 'Farmacia',      description: 'Medicinas y salud' },
  [BusinessTypeId.Servicios]:  { icon: '🏪',  label: 'Servicios',     description: 'Salones, talleres, oficios' },
};

/** Main giro options displayed in step 1 grid (no JWT pre-selection) */
const GIRO_OPTIONS: { value: BusinessTypeId; icon: string; label: string; description: string }[] = [
  { value: BusinessTypeId.Restaurant, ...GIRO_INFO_MAP[BusinessTypeId.Restaurant] },
  { value: BusinessTypeId.Cafe,       ...GIRO_INFO_MAP[BusinessTypeId.Cafe] },
  { value: BusinessTypeId.Bar,        ...GIRO_INFO_MAP[BusinessTypeId.Bar] },
  { value: BusinessTypeId.Retail,     ...GIRO_INFO_MAP[BusinessTypeId.Retail] },
  { value: BusinessTypeId.FoodTruck,  ...GIRO_INFO_MAP[BusinessTypeId.FoodTruck] },
  { value: BusinessTypeId.General,    ...GIRO_INFO_MAP[BusinessTypeId.General] },
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

/** Device mode options */
const MODE_OPTIONS: { value: string; icon: string; label: string; description: string }[] = [
  { value: 'cashier', icon: '💳', label: 'Cajero',  description: 'POS estándar de cobro' },
  { value: 'tables',  icon: '🪑', label: 'Mesas',   description: 'Vista de mesas para meseros' },
  { value: 'kitchen', icon: '👨‍🍳', label: 'Cocina',  description: 'Pantalla de cocina KDS' },
  { value: 'kiosk',   icon: '📱', label: 'Kiosko',  description: 'Autoservicio para clientes' },
];

/** Zone suggestions per giro */
const ZONE_SUGGESTIONS: Record<number, ZoneDraft[]> = {
  [BusinessTypeId.Restaurant]: [
    { name: 'Salón', type: ZoneType.Salon, checked: true },
    { name: 'Terraza', type: ZoneType.Other, checked: true },
  ],
  [BusinessTypeId.Bar]: [
    { name: 'Salón', type: ZoneType.Salon, checked: true },
    { name: 'Barra', type: ZoneType.BarSeats, checked: true },
    { name: 'Terraza', type: ZoneType.Other, checked: false },
  ],
  [BusinessTypeId.Cafe]: [
    { name: 'Salón', type: ZoneType.Salon, checked: true },
    { name: 'Terraza', type: ZoneType.Other, checked: false },
  ],
};

// ---------------------------------------------------------------------------
// Pricing — real Stripe price IDs
// ---------------------------------------------------------------------------

type PricingGroup = 'restaurant' | 'standard' | 'general';
type BillingCycle = 'monthly' | 'annual';

/** Maps businessType → pricing group */
const PRICING_GROUP_MAP: Record<number, PricingGroup> = {
  [BusinessTypeId.Restaurant]: 'restaurant',
  [BusinessTypeId.Bar]:        'restaurant',
  [BusinessTypeId.Cafe]:       'standard',
  [BusinessTypeId.FoodTruck]:  'standard',
  [BusinessTypeId.Taqueria]:   'standard',
  [BusinessTypeId.Retail]:     'general',
  [BusinessTypeId.General]:    'general',
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
const PLAN_NAMES: Record<string, string> = {
  basic: 'Básico',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/** Which device modes are relevant per giro */
const MODES_BY_GIRO: Record<number, string[]> = {
  [BusinessTypeId.Restaurant]: ['cashier', 'tables', 'kitchen', 'kiosk'],
  [BusinessTypeId.Bar]:        ['cashier', 'tables', 'kitchen', 'kiosk'],
  [BusinessTypeId.Cafe]:       ['cashier', 'kitchen', 'kiosk'],
  [BusinessTypeId.Retail]:     ['cashier'],
  [BusinessTypeId.FoodTruck]:  ['cashier', 'kiosk'],
  [BusinessTypeId.General]:    ['cashier'],
  [BusinessTypeId.Taqueria]:   ['cashier', 'kiosk'],
  [BusinessTypeId.Abarrotes]:  ['cashier'],
  [BusinessTypeId.Ferreteria]: ['cashier'],
  [BusinessTypeId.Papeleria]:  ['cashier'],
  [BusinessTypeId.Farmacia]:   ['cashier'],
  [BusinessTypeId.Servicios]:  ['cashier'],
};

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, InputNumberModule, InputTextModule],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent implements OnInit {

  //#region Properties

  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly businessService = inject(BusinessService);
  private readonly configService = inject(ConfigService);
  private readonly router = inject(Router);

  readonly currentStep = signal(1);
  readonly isSubmitting = signal(false);

  /** True when the current user is an Owner or Manager (cloud-only role) */
  readonly isOwnerOrManager = computed(() => {
    const roleId = this.authService.currentUser()?.roleId;
    return roleId === UserRoleId.Owner || roleId === UserRoleId.Manager;
  });

  /** Owners skip step 4 (device mode) — it's auto-configured as 'admin' */
  readonly totalSteps = computed(() => this.isOwnerOrManager() ? 3 : 4);

  readonly giroOptions = GIRO_OPTIONS;
  readonly retailSubOptions = RETAIL_SUB_OPTIONS;

  // Step 1 — Giro (multi-select)
  readonly selectedGiros = signal<BusinessTypeId[]>([]);
  readonly customGiroText = signal('');

  /** Primary giro (first selected) — used for pricing, modes, and zone suggestions */
  readonly primaryGiro = computed(() => this.selectedGiros()[0] ?? BusinessTypeId.General);

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

  // Step 2 — Zones or Folio
  zones: ZoneDraft[] = [];
  newZoneName = '';
  folioPrefix = '';
  /** True if any selected giro supports zones (Restaurant, Bar, Cafe) */
  readonly isZoneStep = computed(() => {
    const zoneGiros: BusinessTypeId[] = [BusinessTypeId.Restaurant, BusinessTypeId.Bar, BusinessTypeId.Cafe];
    return this.selectedGiros().some(g => zoneGiros.includes(g));
  });

  // Step 3 — First product
  readonly productForm = this.fb.group({
    name:         ['', Validators.required],
    pricePesos:   [0, [Validators.required, Validators.min(1)]],
    categoryName: [''],
  });
  readonly skipProduct = signal(false);

  // Step 4 — Device
  readonly deviceName = signal('');
  readonly selectedMode = signal('cashier');
  readonly pendingPlan = signal<string | null>(null);

  /** Device modes: union of all selected giros' allowed modes */
  readonly filteredModes = computed(() => {
    const giros = this.selectedGiros();
    const allowedSet = new Set<string>();
    for (const g of giros) {
      for (const m of MODES_BY_GIRO[g] ?? ['cashier']) allowedSet.add(m);
    }
    if (allowedSet.size === 0) allowedSet.add('cashier');
    return MODE_OPTIONS.filter(m => allowedSet.has(m.value));
  });

  // Step 4 — Plan activation
  readonly billingCycle = signal<BillingCycle>('monthly');
  readonly checkoutLoading = signal(false);
  readonly checkoutError = signal('');

  /** Pricing group derived from selected business type */
  readonly pricingGroup = computed<PricingGroup>(() =>
    PRICING_GROUP_MAP[this.primaryGiro()] ?? 'general'
  );

  /** Display name for the pending plan */
  readonly pendingPlanName = computed(() =>
    PLAN_NAMES[this.pendingPlan() ?? ''] ?? ''
  );

  /** Current display price in centavos based on plan, group, and cycle */
  readonly displayPriceCents = computed(() => {
    const plan = this.pendingPlan();
    if (!plan || !DISPLAY_PRICES[plan]) return 0;
    return DISPLAY_PRICES[plan][this.pricingGroup()][this.billingCycle()];
  });

  /** Formatted price string for display */
  readonly displayPrice = computed(() => {
    const cents = this.displayPriceCents();
    if (!cents) return '';
    return '$' + (cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 0 });
  });

  /** Billing cycle label for display */
  readonly cycleLabel = computed(() =>
    this.billingCycle() === 'monthly' ? '/mes' : '/año'
  );

  /** Progress percentage */
  readonly progress = computed(() =>
    Math.round((this.currentStep() / this.totalSteps()) * 100),
  );

  /** Folio preview for non-zone giros */
  folioPreview(): string {
    const prefix = this.folioPrefix.trim().toUpperCase();
    return prefix ? `${prefix}-0001` : '0001';
  }

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    // Restore step from user profile (survives page refresh)
    const user = this.authService.currentUser();
    const savedStep = user?.currentOnboardingStep;
    if (savedStep && savedStep > 1 && savedStep <= this.totalSteps()) {
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

    // Init zone suggestions
    this.refreshZoneSuggestions();

    // Check for pending plan from registration
    const branchId = this.authService.branchId;
    this.pendingPlan.set(
      localStorage.getItem(`pending-plan-${branchId}`),
    );

    // Redirect if not authenticated
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
    }
  }

  //#endregion

  //#region Navigation

  /** Advances to the next step */
  nextStep(): void {
    if (this.currentStep() < this.totalSteps()) {
      // When leaving step 1, refresh zone suggestions for new giro
      if (this.currentStep() === 1) {
        this.refreshZoneSuggestions();
      }
      this.currentStep.update(s => s + 1);
      // Sync to backend — best-effort, never blocks UI
      this.businessService.syncOnboardingStep(2, this.currentStep())
        .subscribe({ error: () => {} });
    }
  }

  /** Goes back to the previous step */
  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
      // Sync to backend — best-effort, never blocks UI
      this.businessService.syncOnboardingStep(2, this.currentStep())
        .subscribe({ error: () => {} });
    } else {
      this.router.navigate(['/login']);
    }
  }

  /** Skips step 3 (product) */
  skipStep(): void {
    this.skipProduct.set(true);
    this.nextStep();
  }

  /** Whether the current step has valid data to proceed */
  canProceed(): boolean {
    switch (this.currentStep()) {
      case 1: {
        const giros = this.selectedGiros();
        if (giros.length === 0) return false;
        // When "Otra tienda" (Retail) is selected, require a custom description
        if (giros.includes(BusinessTypeId.Retail) && !this.customGiroText().trim()) return false;
        return true;
      }
      case 2: return true; // zones/folio are optional
      case 3: return this.skipProduct() || this.productForm.valid;
      case 4: return true;
      default: return false;
    }
  }

  //#endregion

  //#region Step 1 — Giro

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

  //#region Step 2 — Zones

  /** Toggles a zone draft on/off */
  toggleZone(index: number): void {
    this.zones[index].checked = !this.zones[index].checked;
  }

  /** Adds a custom zone */
  addCustomZone(): void {
    if (!this.newZoneName.trim()) return;
    this.zones.push({
      name: this.newZoneName.trim(),
      type: ZoneType.Other,
      checked: true,
    });
    this.newZoneName = '';
  }

  /** Refreshes zone suggestions — unions suggestions for all selected giros, deduped by name */
  private refreshZoneSuggestions(): void {
    const seen = new Set<string>();
    const merged: ZoneDraft[] = [];
    for (const giro of this.selectedGiros()) {
      for (const z of ZONE_SUGGESTIONS[giro] ?? []) {
        if (!seen.has(z.name)) {
          seen.add(z.name);
          merged.push({ ...z });
        }
      }
    }
    this.zones = merged;
  }

  //#endregion

  //#region Step 4 — Device

  /** Selects a device mode */
  selectMode(mode: string): void {
    this.selectedMode.set(mode);
  }

  /** Toggles billing cycle between monthly and annual */
  toggleBillingCycle(cycle: BillingCycle): void {
    this.billingCycle.set(cycle);
  }

  /**
   * Starts Stripe checkout for the pending plan.
   * Calls POST /api/subscription/checkout and redirects to Stripe.
   */
  async startCheckout(): Promise<void> {
    const plan = this.pendingPlan();
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
   * Skips plan activation and continues with free trial.
   * Clears pendingPlan and completes onboarding normally.
   */
  async continueWithTrial(): Promise<void> {
    const branchId = this.authService.branchId;
    localStorage.removeItem(`pending-plan-${branchId}`);
    this.pendingPlan.set(null);
    await this.completeOnboarding();
  }

  //#endregion

  //#region Completion

  /**
   * Completes the onboarding wizard.
   * All API calls are best-effort — failures don't block navigation.
   */
  async completeOnboarding(): Promise<void> {
    this.isSubmitting.set(true);

    const branchId = this.authService.branchId;

    // 1. Update business types (multi-giro)
    try {
      await firstValueFrom(
        this.businessService.updateBusinessTypes(
          this.selectedGiros(),
          this.customGiroText().trim() || null,
        ),
      );
    } catch { /* best-effort */ }

    // 2a. Create zones (if zone step)
    if (this.isZoneStep()) {
      const checkedZones = this.zones.filter(z => z.checked);
      await Promise.allSettled(
        checkedZones.map((z, i) =>
          firstValueFrom(
            this.http.post(`${environment.apiUrl}/zone`, {
              branchId,
              name: z.name,
              type: z.type,
              sortOrder: i,
              isActive: true,
            }),
          ),
        ),
      );
    }

    // 2b. Save folio prefix (if folio step)
    if (!this.isZoneStep() && this.folioPrefix.trim()) {
      try {
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/branch/folio-config`, {
            folioPrefix: this.folioPrefix.trim().toUpperCase(),
          }),
        );
      } catch { /* best-effort */ }
    }

    // 3. Create first product (if not skipped)
    if (!this.skipProduct() && this.productForm.valid) {
      try {
        const { name, pricePesos, categoryName } = this.productForm.getRawValue();
        let categoryId: number | null = null;

        if (categoryName?.trim()) {
          const cat = await firstValueFrom(
            this.http.post<{ id: number }>(`${environment.apiUrl}/categories`, {
              name: categoryName.trim(),
              branchId,
            }),
          );
          categoryId = cat.id;
        }

        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/products`, {
            name: name?.trim(),
            priceCents: Math.round((pricePesos ?? 0) * 100),
            categoryId,
            branchId,
            isAvailable: true,
          }),
        );
      } catch { /* best-effort */ }
    }

    // 4. Save complete device config (so isDeviceConfigured() passes)
    const user = this.authService.currentUser();
    const activeBranchId = this.authService.activeBranchId();
    const branchEntry = user?.branches?.find(b => b.id === activeBranchId);
    const branchDisplayName = branchEntry?.name ?? '';

    // Owners get a silent 'admin' config — they never select a device mode
    const mode: DeviceConfig['mode'] = this.isOwnerOrManager()
      ? 'admin'
      : this.selectedMode() as DeviceConfig['mode'];
    const defaultName = this.isOwnerOrManager() ? 'Admin' : 'POS Principal';

    const deviceConfig: DeviceConfig = {
      businessId:   user?.businessId ?? 0,
      branchId:     activeBranchId,
      businessName: branchDisplayName,
      branchName:   branchDisplayName,
      mode,
      deviceName:   this.deviceName().trim() || defaultName,
      configuredAt: new Date().toISOString(),
    };
    this.configService.saveDeviceConfig(deviceConfig);

    // 5. Mark onboarding complete via API → get new JWT
    try {
      const response = await firstValueFrom(
        this.businessService.completeOnboarding(),
      );
      this.authService.handleLoginSuccess(response);
    } catch { /* best-effort — localStorage fallback below */ }

    // 6. LocalStorage fallback
    localStorage.setItem(`${ONBOARDING_KEY_PREFIX}${branchId}`, 'true');

    // Cleanup pending plan
    localStorage.removeItem(`pending-plan-${branchId}`);

    this.isSubmitting.set(false);

    // 7. Owners go straight to /admin — floor staff go to /pin
    this.router.navigate([this.isOwnerOrManager() ? '/admin' : '/pin']);
  }

  //#endregion

}
