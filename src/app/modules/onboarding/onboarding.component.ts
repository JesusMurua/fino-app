import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';

import { environment } from '../../../environments/environment';
import { BusinessType, LoginResponse, ZoneType } from '../../core/models';
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

/** Giro options displayed in step 1 */
const GIRO_OPTIONS: { value: BusinessType; icon: string; label: string; description: string }[] = [
  { value: BusinessType.Restaurant, icon: '🍽️', label: 'Restaurante',  description: 'Mesas, cocina, mesero, kiosko' },
  { value: BusinessType.Cafe,       icon: '☕',  label: 'Café / Barra', description: 'Comandas rápidas, barra' },
  { value: BusinessType.Bar,        icon: '🍺',  label: 'Bar / Cantina', description: 'Mesas + barra, consumo corrido' },
  { value: BusinessType.Retail,     icon: '🛒',  label: 'Abarrotes',    description: 'Escáner, códigos de barras' },
  { value: BusinessType.FoodTruck,  icon: '🚚',  label: 'Food Truck',   description: 'Cobro rápido, sin mesas' },
  { value: BusinessType.General,    icon: '⚙️',  label: 'General',      description: 'Cualquier negocio' },
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

/** Which device modes are relevant per giro */
const MODES_BY_GIRO: Record<string, string[]> = {
  [BusinessType.Restaurant]: ['cashier', 'tables', 'kitchen', 'kiosk'],
  [BusinessType.Bar]:        ['cashier', 'tables', 'kitchen', 'kiosk'],
  [BusinessType.Cafe]:       ['cashier', 'kitchen', 'kiosk'],
  [BusinessType.Retail]:     ['cashier'],
  [BusinessType.FoodTruck]:  ['cashier', 'kiosk'],
  [BusinessType.General]:    ['cashier'],
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
  readonly totalSteps = 4;
  readonly isSubmitting = signal(false);

  readonly giroOptions = GIRO_OPTIONS;

  // Step 1 — Giro
  readonly selectedGiro = signal<BusinessType>(BusinessType.Restaurant);

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

  /** Progress percentage */
  readonly progress = computed(() =>
    Math.round((this.currentStep() / this.totalSteps) * 100),
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
    if (jwtGiro) this.selectedGiro.set(jwtGiro);

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
    if (this.currentStep() < this.totalSteps) {
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
      case 1: return !!this.selectedGiro();
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

    // 4. Save device config
    const deviceConfig = this.configService.loadDeviceConfig();
    deviceConfig.mode = this.selectedMode() as any;
    if (this.deviceName().trim()) {
      (deviceConfig as any).deviceName = this.deviceName().trim();
    }
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

    // 7. Navigate to admin
    this.router.navigate(['/admin']);
  }

  //#endregion

}
