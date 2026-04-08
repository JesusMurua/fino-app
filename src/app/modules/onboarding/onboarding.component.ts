import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';

import { environment } from '../../../environments/environment';
import { BusinessType, DeviceConfig, LoginResponse, ZoneType } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
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

const GIRO_INFO_MAP: Record<string, GiroInfo> = {
  [BusinessType.Restaurant]: { icon: '🍽️', label: 'Restaurante',   description: 'Mesas, cocina, mesero, kiosko' },
  [BusinessType.Cafe]:       { icon: '☕',  label: 'Café / Barra',  description: 'Comandas rápidas, barra' },
  [BusinessType.Bar]:        { icon: '🍺',  label: 'Bar / Cantina', description: 'Mesas + barra, consumo corrido' },
  [BusinessType.Retail]:     { icon: '🛒',  label: 'Abarrotes / Tienda', description: 'Escáner, códigos de barras' },
  [BusinessType.FoodTruck]:  { icon: '🚚',  label: 'Food Truck',    description: 'Cobro rápido, sin mesas' },
  [BusinessType.General]:    { icon: '⚙️',  label: 'General',       description: 'Cualquier negocio' },
  [BusinessType.Taqueria]:   { icon: '🌮',  label: 'Taquería',      description: 'Cobro rápido, con cocina' },
  [BusinessType.Abarrotes]:  { icon: '🛒',  label: 'Abarrotes',     description: 'Tiendita de barrio' },
  [BusinessType.Ferreteria]: { icon: '🔧',  label: 'Ferretería',    description: 'Materiales y herramientas' },
  [BusinessType.Papeleria]:  { icon: '📝',  label: 'Papelería',     description: 'Útiles y copias' },
  [BusinessType.Farmacia]:   { icon: '💊',  label: 'Farmacia',      description: 'Medicinas y salud' },
  [BusinessType.Servicios]:  { icon: '🏪',  label: 'Servicios',     description: 'Salones, talleres, oficios' },
};

/** Main giro options displayed in step 1 grid (no JWT pre-selection) */
const GIRO_OPTIONS: { value: BusinessType; icon: string; label: string; description: string }[] = [
  { value: BusinessType.Restaurant, ...GIRO_INFO_MAP[BusinessType.Restaurant] },
  { value: BusinessType.Cafe,       ...GIRO_INFO_MAP[BusinessType.Cafe] },
  { value: BusinessType.Bar,        ...GIRO_INFO_MAP[BusinessType.Bar] },
  { value: BusinessType.Retail,     ...GIRO_INFO_MAP[BusinessType.Retail] },
  { value: BusinessType.FoodTruck,  ...GIRO_INFO_MAP[BusinessType.FoodTruck] },
  { value: BusinessType.General,    ...GIRO_INFO_MAP[BusinessType.General] },
];

/** BusinessTypes in the retail group — show sub-options */
const RETAIL_GROUP: BusinessType[] = [
  BusinessType.Retail, BusinessType.Abarrotes, BusinessType.Ferreteria,
  BusinessType.Papeleria, BusinessType.Farmacia,
];

/** Sub-options shown when giro is in RETAIL_GROUP */
const RETAIL_SUB_OPTIONS: { value: BusinessType; icon: string; label: string }[] = [
  { value: BusinessType.Abarrotes,  icon: '🛒', label: 'Abarrotes' },
  { value: BusinessType.Ferreteria, icon: '🔧', label: 'Ferretería' },
  { value: BusinessType.Papeleria,  icon: '📝', label: 'Papelería' },
  { value: BusinessType.Farmacia,   icon: '💊', label: 'Farmacia' },
  { value: BusinessType.Retail,     icon: '🏪', label: 'Otra tienda' },
];

/** Device mode options */
const MODE_OPTIONS: { value: string; icon: string; label: string; description: string }[] = [
  { value: 'cashier', icon: '💳', label: 'Cajero',  description: 'POS estándar de cobro' },
  { value: 'tables',  icon: '🪑', label: 'Mesas',   description: 'Vista de mesas para meseros' },
  { value: 'kitchen', icon: '👨‍🍳', label: 'Cocina',  description: 'Pantalla de cocina KDS' },
  { value: 'kiosk',   icon: '📱', label: 'Kiosko',  description: 'Autoservicio para clientes' },
];

/** Zone suggestions per giro */
const ZONE_SUGGESTIONS: Record<string, ZoneDraft[]> = {
  [BusinessType.Restaurant]: [
    { name: 'Salón', type: ZoneType.Salon, checked: true },
    { name: 'Terraza', type: ZoneType.Other, checked: true },
  ],
  [BusinessType.Bar]: [
    { name: 'Salón', type: ZoneType.Salon, checked: true },
    { name: 'Barra', type: ZoneType.BarSeats, checked: true },
    { name: 'Terraza', type: ZoneType.Other, checked: false },
  ],
  [BusinessType.Cafe]: [
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
const PRICING_GROUP_MAP: Record<string, PricingGroup> = {
  [BusinessType.Restaurant]: 'restaurant',
  [BusinessType.Bar]:        'restaurant',
  [BusinessType.Cafe]:       'standard',
  [BusinessType.FoodTruck]:  'standard',
  [BusinessType.Taqueria]:   'standard',
  [BusinessType.Retail]:     'general',
  [BusinessType.General]:    'general',
  [BusinessType.Abarrotes]:  'standard',
  [BusinessType.Ferreteria]: 'standard',
  [BusinessType.Papeleria]:  'standard',
  [BusinessType.Farmacia]:   'standard',
  [BusinessType.Servicios]:  'general',
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
const MODES_BY_GIRO: Record<string, string[]> = {
  [BusinessType.Restaurant]: ['cashier', 'tables', 'kitchen', 'kiosk'],
  [BusinessType.Bar]:        ['cashier', 'tables', 'kitchen', 'kiosk'],
  [BusinessType.Cafe]:       ['cashier', 'kitchen', 'kiosk'],
  [BusinessType.Retail]:     ['cashier'],
  [BusinessType.FoodTruck]:  ['cashier', 'kiosk'],
  [BusinessType.General]:    ['cashier'],
  [BusinessType.Taqueria]:   ['cashier', 'kiosk'],
  [BusinessType.Abarrotes]:  ['cashier'],
  [BusinessType.Ferreteria]: ['cashier'],
  [BusinessType.Papeleria]:  ['cashier'],
  [BusinessType.Farmacia]:   ['cashier'],
  [BusinessType.Servicios]:  ['cashier'],
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
  private readonly configService = inject(ConfigService);
  private readonly router = inject(Router);

  readonly currentStep = signal(1);
  readonly isSubmitting = signal(false);

  /** True when the current user is an Owner or Manager (cloud-only role) */
  readonly isOwnerOrManager = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'Owner' || role === 'Manager';
  });

  /** Owners skip step 4 (device mode) — it's auto-configured as 'admin' */
  readonly totalSteps = computed(() => this.isOwnerOrManager() ? 3 : 4);

  readonly giroOptions = GIRO_OPTIONS;
  readonly retailSubOptions = RETAIL_SUB_OPTIONS;

  // Step 1 — Giro
  readonly selectedGiro = signal<BusinessType>(BusinessType.Restaurant);

  /** Business type from JWT — null if not pre-selected */
  readonly jwtGiro = signal<BusinessType | null>(null);

  /** True when the JWT giro is in the retail group */
  readonly isRetailGroup = computed(() =>
    RETAIL_GROUP.includes(this.jwtGiro() as BusinessType)
  );

  /** True when giro grid should be shown (no JWT pre-selection) */
  readonly showGiroGrid = computed(() => !this.jwtGiro());

  /** Badge info for the pre-selected giro */
  readonly giroBadge = computed(() => {
    const giro = this.jwtGiro();
    if (!giro) return null;
    // For retail group, always show the group badge
    if (RETAIL_GROUP.includes(giro)) {
      return GIRO_INFO_MAP[BusinessType.Retail];
    }
    return GIRO_INFO_MAP[giro] ?? null;
  });

  // Step 2 — Zones or Folio
  zones: ZoneDraft[] = [];
  newZoneName = '';
  folioPrefix = '';
  readonly isZoneStep = computed(() => {
    const g = this.selectedGiro();
    return g === BusinessType.Restaurant || g === BusinessType.Bar || g === BusinessType.Cafe;
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

  /** Device modes filtered by selected giro */
  readonly filteredModes = computed(() => {
    const allowed = MODES_BY_GIRO[this.selectedGiro()] ?? ['cashier'];
    return MODE_OPTIONS.filter(m => allowed.includes(m.value));
  });

  // Step 4 — Plan activation
  readonly billingCycle = signal<BillingCycle>('monthly');
  readonly checkoutLoading = signal(false);
  readonly checkoutError = signal('');

  /** Pricing group derived from selected business type */
  readonly pricingGroup = computed<PricingGroup>(() =>
    PRICING_GROUP_MAP[this.selectedGiro()] ?? 'general'
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
    // Pre-fill giro from JWT
    const jwtGiro = this.authService.businessType();
    if (jwtGiro) {
      this.selectedGiro.set(jwtGiro);
      this.jwtGiro.set(jwtGiro);
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
    }
  }

  /** Goes back to the previous step */
  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
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
        if (!this.selectedGiro()) return false;
        // Retail group with JWT pre-selection: must pick a sub-option
        if (this.isRetailGroup() && this.selectedGiro() === this.jwtGiro()) return false;
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

  /** Selects a business type */
  selectGiro(giro: BusinessType): void {
    this.selectedGiro.set(giro);
  }

  /**
   * Selects a retail sub-option and updates the backend business type.
   * Called when user picks from the retail sub-options grid.
   */
  async selectRetailSub(giro: BusinessType): Promise<void> {
    this.selectedGiro.set(giro);
    try {
      await firstValueFrom(
        this.http.put(`${environment.apiUrl}/business/type`, { businessType: giro }),
      );
    } catch { /* best-effort */ }
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

  /** Refreshes zone suggestions when giro changes */
  private refreshZoneSuggestions(): void {
    const giro = this.selectedGiro();
    this.zones = (ZONE_SUGGESTIONS[giro] ?? []).map(z => ({ ...z }));
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

    // 1. Update business type if changed
    const jwtGiro = this.authService.businessType();
    if (this.selectedGiro() !== jwtGiro) {
      try {
        await firstValueFrom(
          this.http.put(`${environment.apiUrl}/business/type`, {
            businessType: this.selectedGiro(),
          }),
        );
      } catch { /* best-effort */ }
    }

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
        this.http.post<LoginResponse>(
          `${environment.apiUrl}/business/complete-onboarding`,
          {},
        ),
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
