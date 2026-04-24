import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';

import {
  AppConfig,
  AVAILABLE_PLAN_TYPES_BY_MACRO,
  DEFAULT_APP_CONFIG,
  FEATURE_LABELS,
  PLAN_DISPLAY_NAME,
  PLAN_HIERARCHY,
  pricingGroupForMacro,
  REGIMEN_FISCAL_OPTIONS,
  RFC_REGEX,
} from '../../../../core/models';
import {
  FeatureKey,
  GIRO_FEATURE_MAP,
  MACRO_CATEGORY_LABELS,
  MacroCategoryType,
  PlanTypeId,
} from '../../../../core/enums';
import { ApiService } from '../../../../core/services/api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CatalogService } from '../../../../core/services/catalog.service';
import { ConfigService } from '../../../../core/services/config.service';
import { PrinterService } from '../../../../core/services/printer.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { AdminPrinterSettingsComponent } from './printer-settings/admin-printer-settings.component';

/**
 * Tab ids rendered by the settings screen.
 *
 * Trimmed from 8 → 5 in FDD-016:
 *   - `device`  removed: fleet + mode live under `/admin/devices` (FDD-015).
 *   - `branches` removed: extracted to the top-level `/admin/branches` route.
 *   - `peripherals` + `printers` merged into `hardware`.
 */
type TabId = 'business' | 'hardware' | 'fiscal' | 'billing';

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
}

/**
 * Back Office Settings — Negocio · Hardware · Seguridad · Fiscal · Facturación.
 *
 * Every feature-specific surface is gated via `TenantContextService.hasFeature`
 * or macro predicates so a tenant only sees options their plan × giro
 * actually unlock (FDD-016 FR-005).
 */
@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    TableModule,
    AdminPrinterSettingsComponent,
  ],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent implements OnInit, OnDestroy {

  //#region Injections

  private readonly api = inject(ApiService);
  readonly authService = inject(AuthService);
  private readonly catalogService = inject(CatalogService);
  private readonly configService = inject(ConfigService);
  private readonly messageService = inject(MessageService);
  readonly printerService = inject(PrinterService);
  readonly scannerService = inject(ScannerService);
  private readonly tenantContext = inject(TenantContextService);
  private readonly router = inject(Router);

  //#endregion

  //#region Tab state

  /**
   * All tab definitions in rendering order. Visibility is filtered by
   * `visibleTabs` — a hidden tab does NOT leave a gap in the bar.
   */
  private readonly allTabs: readonly TabDef[] = [
    { id: 'business', label: 'Negocio',     icon: 'pi pi-building' },
    { id: 'hardware', label: 'Hardware',    icon: 'pi pi-print' },
    { id: 'fiscal',   label: 'Fiscal',      icon: 'pi pi-file-edit' },
    { id: 'billing',  label: 'Facturación', icon: 'pi pi-receipt' },
  ];

  /** Active settings tab */
  readonly activeTab = signal<TabId>('business');

  //#endregion

  //#region Feature-shield computeds

  /** Fiscal tab visible only when the tenant has CFDI invoicing */
  readonly canSeeFiscal = computed(() =>
    this.tenantContext.hasFeature(FeatureKey.CfdiInvoicing),
  );

  /** Scale card visible to Retail tenants with Core hardware */
  readonly canSeeScale = computed(() =>
    this.tenantContext.hasFeature(FeatureKey.CoreHardware)
    && this.authService.primaryMacroCategoryId() === MacroCategoryType.Retail,
  );

  /** Print destinations visible when any kitchen-printing feature is on */
  readonly canSeePrintDestinations = computed(() =>
    this.tenantContext.hasAnyFeature([
      FeatureKey.KdsBasic,
      FeatureKey.RealtimeKds,
      FeatureKey.PrintedTickets,
    ]),
  );

  /** Folio custom format editor gated by custom folios or CFDI */
  readonly canSeeCustomFolio = computed(() =>
    this.tenantContext.hasAnyFeature([
      FeatureKey.CustomFolios,
      FeatureKey.CfdiInvoicing,
    ]),
  );

  /** Tabs currently visible based on the matrix */
  readonly visibleTabs = computed<readonly TabDef[]>(() => {
    const hidden = new Set<TabId>();
    if (!this.canSeeFiscal()) hidden.add('fiscal');
    return this.allTabs.filter(t => !hidden.has(t.id));
  });

  //#endregion

  //#region Business config

  /** Business config — stored in IndexedDB, shared across all devices */
  config = signal<AppConfig>({ ...DEFAULT_APP_CONFIG });

  readonly isSaving        = signal(false);
  readonly saveSuccess     = signal(false);

  // ---- Folio configuration ----
  folioPrefix = '';
  folioFormat = '';
  readonly folioCounter = signal(0);
  readonly isSavingFolio = signal(false);
  readonly saveFolioSuccess = signal(false);

  // ---- Fiscal configuration ----
  fiscalRfc = '';
  fiscalRazonSocial = '';
  fiscalRegimen = '';
  fiscalCodigoPostal = '';
  readonly isSavingFiscal = signal(false);
  readonly saveFiscalSuccess = signal(false);

  // ---- Billing ----
  readonly showCancelDialog = signal(false);
  readonly isCanceling = signal(false);

  //#endregion

  //#region Billing computeds

  /** Display name for the current plan */
  readonly currentPlanName = computed(() =>
    PLAN_DISPLAY_NAME[this.authService.planTypeId()] ?? 'Gratuito',
  );

  /** Badge variant for subscription status */
  readonly subscriptionBadgeVariant = computed<'green' | 'amber' | 'red' | 'gray'>(() => {
    const status = this.authService.subscriptionStatus();
    if (!status) {
      return this.authService.planInfo().isOnTrial ? 'amber' : 'gray';
    }
    switch (status.status) {
      case 'active':   return 'green';
      case 'trialing': return 'amber';
      case 'past_due': return 'red';
      case 'canceled': return 'gray';
      default:         return 'gray';
    }
  });

  /** Badge label for subscription status */
  readonly subscriptionBadgeLabel = computed(() => {
    const status = this.authService.subscriptionStatus();
    if (!status) {
      const info = this.authService.planInfo();
      if (info.isOnTrial) return 'Trial activo';
      if (info.isPaid) return 'Activo';
      return 'Gratuito';
    }
    switch (status.status) {
      case 'active':   return 'Activo';
      case 'trialing': return 'Trial activo';
      case 'past_due': return 'Pago pendiente';
      case 'canceled': return 'Cancelado';
      default:         return status.status;
    }
  });

  /** Detail text below plan name (trial end, next billing, cycle) */
  readonly subscriptionDetail = computed(() => {
    const status = this.authService.subscriptionStatus();
    const info = this.authService.planInfo();

    if (status?.status === 'trialing' && status.trialEndsAt) {
      return `Trial termina el ${this.formatDate(status.trialEndsAt)}`;
    }
    if (info.isOnTrial && info.trialEndsAt) {
      return `Trial termina el ${this.formatDate(info.trialEndsAt)}`;
    }
    if (status?.currentPeriodEnd && (status.status === 'active' || status.status === 'canceled')) {
      const cycle = status.billingCycle === 'Annual' ? 'Anual' : 'Mensual';
      const prefix = status.status === 'canceled' ? 'Activo hasta el' : 'Próximo cobro:';
      return `${prefix} ${this.formatDate(status.currentPeriodEnd)} · ${cycle}`;
    }
    return '';
  });

  /**
   * Upgrade options derived from `catalogService.planCatalog()` — the
   * backend is the SSOT for feature manifests; commercial metadata
   * (prices, badges) is merged in from the local catalog.
   *
   * Only tiers that (a) are strictly higher than the tenant's current plan
   * and (b) are allowed by the macro × plan availability matrix are shown.
   * Feature bullets are the **delta** unlocked by the target tier — i.e.
   * the FeatureKeys the user does NOT yet have at their current tier — so
   * the upgrade pitch focuses on what they actually gain.
   */
  readonly upgradeOptions = computed(() => {
    const catalog = this.catalogService.planCatalog();
    const currentPlan = this.authService.planTypeId();
    const currentLevel = PLAN_HIERARCHY[currentPlan] ?? 0;
    const macro = this.authService.primaryMacroCategoryId();
    const allowed = macro !== null
      ? AVAILABLE_PLAN_TYPES_BY_MACRO[macro]
      : new Set<PlanTypeId>([PlanTypeId.Free, PlanTypeId.Basic, PlanTypeId.Pro, PlanTypeId.Enterprise]);

    const group = pricingGroupForMacro(macro);
    const currentTierFeatures = new Set<FeatureKey>(
      catalog.find(t => t.planTypeId === currentPlan)?.features ?? [],
    );
    // Keeps F&B-only bullets (TableMap, WaiterApp, …) out of Retail/Services cards.
    const applicableFeatures = macro !== null
      ? new Set<FeatureKey>(GIRO_FEATURE_MAP[macro])
      : null;

    return catalog
      .filter(tier =>
        (PLAN_HIERARCHY[tier.planTypeId] ?? 0) > currentLevel
        && allowed.has(tier.planTypeId),
      )
      .map(tier => ({
        name: tier.name,
        price: `$${tier.monthlyPrice[group].toLocaleString('es-MX')}/mes`,
        features: tier.features
          .filter(key => !currentTierFeatures.has(key))
          .filter(key => applicableFeatures === null || applicableFeatures.has(key))
          .map(key => FEATURE_LABELS[key]),
      }));
  });

  /** Whether the cancel button should be shown */
  readonly canCancel = computed(() => {
    const status = this.authService.subscriptionStatus();
    if (!status) return false;
    return (status.status === 'active' || status.status === 'trialing')
      && this.authService.planTypeId() !== PlanTypeId.Free;
  });

  /** Formatted period end for cancel dialog */
  readonly cancelPeriodEnd = computed(() => {
    const status = this.authService.subscriptionStatus();
    if (status?.currentPeriodEnd) return this.formatDate(status.currentPeriodEnd);
    if (status?.trialEndsAt) return this.formatDate(status.trialEndsAt);
    return '—';
  });

  //#endregion

  //#region Negocio tab computeds

  /** Cleanup subject for subscriptions */
  private readonly destroy$ = new Subject<void>();

  /** Cleaned location name — strips auto-generated branch name patterns */
  readonly displayLocationName = computed(() => {
    const loc = this.config().locationName ?? '';
    const biz = this.config().businessName ?? '';
    if (loc === `${biz} Principal` || loc.endsWith(' Principal')) {
      return '';
    }
    return loc;
  });

  /** Whether to show operational config section in Negocio tab */
  readonly showOperationalConfig = computed(() =>
    this.showKitchenToggle() || this.showTablesToggle(),
  );

  /** Kitchen row visible for macros that prep food */
  readonly showKitchenToggle = computed(() => {
    const macro = this.authService.primaryMacroCategoryId();
    if (macro === null) return false;
    return macro === MacroCategoryType.FoodBeverage || macro === MacroCategoryType.QuickService;
  });

  /** Tables row visible only for Food & Beverage */
  readonly showTablesToggle = computed(() => {
    const macro = this.authService.primaryMacroCategoryId();
    return macro === MacroCategoryType.FoodBeverage;
  });

  /** Current macro category info — read-only display from authService */
  readonly currentGiroInfo = computed(() => {
    const macro = this.authService.primaryMacroCategoryId();
    const map: Record<MacroCategoryType, { icon: string; name: string; description: string }> = {
      [MacroCategoryType.FoodBeverage]: { icon: '🍽️', name: MACRO_CATEGORY_LABELS[MacroCategoryType.FoodBeverage], description: 'Mesas, cocina, mesero, kiosko' },
      [MacroCategoryType.QuickService]: { icon: '☕',  name: MACRO_CATEGORY_LABELS[MacroCategoryType.QuickService], description: 'Mostrador, comandas rápidas' },
      [MacroCategoryType.Retail]:       { icon: '🛒',  name: MACRO_CATEGORY_LABELS[MacroCategoryType.Retail],       description: 'Inventario, código de barras, fiado' },
      [MacroCategoryType.Services]:     { icon: '🛠️', name: MACRO_CATEGORY_LABELS[MacroCategoryType.Services],     description: 'Estéticas, consultorios, talleres' },
    };
    if (macro === null) return { icon: '…', name: 'Cargando…', description: '' };
    return map[macro];
  });

  //#endregion

  //#region Constructor

  constructor() {
    // Reactively update folio/fiscal form fields when config loads.
    // `allowSignalWrites` is required because the effect mirrors into
    // `folioCounter` (a signal) to drive the folio preview.
    effect(() => {
      const cfg = this.config();
      this.folioPrefix = cfg.folioPrefix ?? '';
      this.folioFormat = cfg.folioFormat ?? '{PREFIX}-{NUM:4}';
      this.folioCounter.set(cfg.folioCounter ?? 0);

      const fiscal = cfg.fiscalConfig;
      if (fiscal) {
        this.fiscalRfc = fiscal.rfc;
        this.fiscalRazonSocial = fiscal.razonSocial;
        this.fiscalRegimen = fiscal.regimenFiscal;
        this.fiscalCodigoPostal = fiscal.codigoPostal;
      }
    }, { allowSignalWrites: true });

    // If the active tab becomes hidden mid-session (e.g. plan downgrade),
    // gracefully fall back to "business" instead of rendering an empty tab.
    effect(() => {
      const visible = this.visibleTabs();
      const current = this.activeTab();
      if (!visible.some(t => t.id === current)) {
        this.activeTab.set('business');
      }
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const appConfig = await this.configService.load();
    this.config.set(appConfig);

    // Refresh subscription status for billing tab
    this.authService.refreshSubscriptionStatus();
  }

  ngOnDestroy(): void {
    this.scannerService.stopListening();
    this.destroy$.next();
    this.destroy$.complete();
  }

  //#endregion

  //#region Tab Navigation

  /**
   * Switches the active settings tab. Refuses to navigate to a tab that
   * is currently hidden by the feature shield — guards against stale
   * links or keyboard shortcuts.
   */
  setTab(tab: TabId): void {
    if (!this.visibleTabs().some(t => t.id === tab)) return;

    // Stop scanner when leaving hardware tab
    if (this.activeTab() === 'hardware' && tab !== 'hardware') {
      this.scannerService.stopListening();
    }

    this.activeTab.set(tab);

    // Start scanner when entering hardware tab
    if (tab === 'hardware') {
      this.scannerService.startListening();
    }
  }

  /**
   * Fires the ESC/POS drawer-kick sequence for the connected thermal
   * printer. Surfaces a toast on failure so the admin knows the printer
   * is disconnected or the RJ12 cable is unplugged.
   */
  async testCashDrawer(): Promise<void> {
    try {
      await this.printerService.openCashDrawer();
      this.messageService.add({
        severity: 'success',
        summary: 'Cajón abierto',
        life: 2000,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Revisa la conexión de la impresora y el cable RJ12.';
      this.messageService.add({
        severity: 'error',
        summary: 'No se pudo abrir el cajón',
        detail,
        life: 4000,
      });
    }
  }

  //#endregion

  //#region Business config save

  async saveBusinessConfig(): Promise<void> {
    this.isSaving.set(true);
    this.saveSuccess.set(false);
    try {
      await this.configService.save(this.config());
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 3000);
    } catch (error: unknown) {
      const status = this.readStatus(error);
      if (status !== 402) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error al guardar',
          life: 3000,
        });
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Updates a field on the business config signal */
  updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config.update(c => ({ ...c, [key]: value }));
  }

  //#endregion

  //#region Folio Configuration

  /** Returns a live preview of the next folio based on current form values. */
  folioPreview(): string {
    const counter = this.folioCounter() + 1;
    const num = counter.toString().padStart(4, '0');
    const prefix = this.folioPrefix.trim().toUpperCase();

    if (this.folioFormat.trim()) {
      return this.folioFormat
        .replace('{PREFIX}', prefix)
        .replace(/\{NUM:\d+\}/, num);
    }

    return prefix ? `${prefix}-${num}` : num;
  }

  /** Saves folio configuration to the API */
  async saveFolioConfig(): Promise<void> {
    this.isSavingFolio.set(true);
    this.saveFolioSuccess.set(false);

    try {
      await firstValueFrom(
        this.api.post('/branch/folio-config', {
          folioPrefix: this.folioPrefix.trim().toUpperCase() || null,
          folioFormat: this.folioFormat.trim() || null,
        }),
      );
      this.saveFolioSuccess.set(true);
      this.messageService.add({
        severity: 'success',
        summary: 'Configuración de folios guardada',
        life: 3000,
      });
      setTimeout(() => this.saveFolioSuccess.set(false), 3000);
    } catch (error: unknown) {
      const status = this.readStatus(error);
      if (status !== 402) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error al guardar la configuración de folios',
          life: 3000,
        });
      }
    } finally {
      this.isSavingFolio.set(false);
    }
  }

  //#endregion

  //#region Fiscal Config

  /** SAT Regimen Fiscal options for dropdown */
  readonly regimenFiscalOptions = REGIMEN_FISCAL_OPTIONS;

  /** Whether the current fiscal RFC input passes the SAT regex */
  readonly isFiscalRfcValid = computed(() =>
    this.fiscalRfc.length === 0 || RFC_REGEX.test(this.fiscalRfc),
  );

  /** Whether the fiscal C.P. input is valid (5 digits) */
  readonly isFiscalCpValid = computed(() =>
    this.fiscalCodigoPostal.length === 0 || /^\d{5}$/.test(this.fiscalCodigoPostal),
  );

  /** Saves fiscal config to the business config in Dexie + API */
  async saveFiscalConfig(): Promise<void> {
    this.isSavingFiscal.set(true);
    this.saveFiscalSuccess.set(false);

    const fiscalConfig = {
      rfc: this.fiscalRfc.trim().toUpperCase(),
      razonSocial: this.fiscalRazonSocial.trim(),
      regimenFiscal: this.fiscalRegimen,
      codigoPostal: this.fiscalCodigoPostal.trim(),
    };

    this.config.update(c => ({ ...c, fiscalConfig, hasInvoicing: true }));
    await this.configService.save(this.config());

    try {
      await firstValueFrom(
        this.api.post('/branch/fiscal-config', fiscalConfig),
      );
      this.saveFiscalSuccess.set(true);
      this.messageService.add({
        severity: 'success',
        summary: 'Configuración fiscal guardada',
        life: 3000,
      });
      setTimeout(() => this.saveFiscalSuccess.set(false), 3000);
    } catch (error: unknown) {
      const status = this.readStatus(error);
      if (status !== 402) {
        this.messageService.add({
          severity: 'error',
          summary: 'Error al guardar la configuración fiscal',
          life: 3000,
        });
      }
    } finally {
      this.isSavingFiscal.set(false);
    }
  }

  //#endregion

  //#region Billing Methods

  /** Navigates to the internal upgrade flow */
  openUpgrade(): void {
    this.router.navigate(['/admin/upgrade']);
  }

  /** Cancels the subscription after user confirmation */
  async confirmCancel(): Promise<void> {
    this.isCanceling.set(true);
    try {
      await firstValueFrom(this.api.post('/subscription/cancel', {}));
      await this.authService.refreshSubscriptionStatus();
      this.showCancelDialog.set(false);

      const end = this.cancelPeriodEnd();
      this.messageService.add({
        severity: 'success',
        summary: 'Suscripción cancelada',
        detail: `Activa hasta ${end}`,
        life: 5000,
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo cancelar la suscripción',
        life: 3000,
      });
    } finally {
      this.isCanceling.set(false);
    }
  }

  /** Formats an ISO date string to DD/MM/YYYY */
  private formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  //#endregion

  //#region Helpers

  /** Safely reads HTTP status from an unknown error */
  private readStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const candidate = (error as { status?: unknown }).status;
    return typeof candidate === 'number' ? candidate : undefined;
  }

  //#endregion

}
