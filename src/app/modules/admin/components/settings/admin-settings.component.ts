import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TableModule } from 'primeng/table';
import { AppConfig, DEFAULT_APP_CONFIG, DEFAULT_DEVICE_CONFIG, DeviceConfig, PlanType } from '../../../../core/models';
import { BusinessType, PLAN_DISPLAY_NAME, PLAN_HIERARCHY } from '../../../../core/models/plan.model';
import { ApiService } from '../../../../core/services/api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Branch, BranchService } from '../../../../core/services/branch.service';
import { ConfigService } from '../../../../core/services/config.service';
import { PrinterService } from '../../../../core/services/printer.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { environment } from '../../../../../environments/environment';

type DeviceMode = DeviceConfig['mode'];

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    PasswordModule,
    RadioButtonModule,
    TableModule,
  ],
  templateUrl: './admin-settings.component.html',
  styleUrl: './admin-settings.component.scss',
})
export class AdminSettingsComponent implements OnInit, OnDestroy {

  //#region Injections

  private readonly api = inject(ApiService);
  readonly authService = inject(AuthService);
  private readonly branchService = inject(BranchService);
  private readonly messageService = inject(MessageService);
  readonly printerService = inject(PrinterService);
  readonly scannerService = inject(ScannerService);

  //#endregion

  //#region Properties

  /** Active settings tab */
  readonly activeTab = signal<'business' | 'device' | 'peripherals' | 'security' | 'branches' | 'billing'>('business');

  /** Business config — stored in IndexedDB, shared across all devices */
  config = signal<AppConfig>({ ...DEFAULT_APP_CONFIG });

  /** Device config — stored in localStorage, local to this screen only */
  deviceConfig = signal<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  /** PIN change fields */
  currentPin = '';
  newPin     = '';
  confirmPin = '';

  readonly isSaving        = signal(false);
  readonly saveSuccess      = signal(false);
  readonly isSavingDevice  = signal(false);
  readonly saveDeviceSuccess = signal(false);
  readonly pinError         = signal('');
  readonly pinSuccess       = signal(false);

  /** Device modes filtered by hasKitchen/hasTables */
  readonly availableModes = computed(() => {
    const hasKitchen = this.configService.hasKitchen();
    const hasTables = this.configService.hasTables();

    return [
      { value: 'cashier' as DeviceMode, icon: '💳', label: 'Cajero',  description: 'POS estándar de cobro',          show: true, badge: '' },
      { value: 'tables'  as DeviceMode, icon: '🪑', label: 'Mesas',   description: 'Vista de mesas para meseros',    show: hasTables, badge: '' },
      { value: 'kitchen' as DeviceMode, icon: '👨‍🍳', label: 'Cocina',  description: 'Pantalla de cocina KDS',         show: hasKitchen, badge: '' },
      { value: 'kiosk'   as DeviceMode, icon: '📱', label: 'Kiosko',  description: 'Autoservicio para clientes',     show: true, badge: 'Beta' },
    ].filter(m => m.show);
  });

  /** All branches for the current business */
  readonly branches = signal<Branch[]>([]);
  readonly loadingBranches = signal(false);
  readonly showBranchDialog = signal(false);
  readonly savingBranch = signal(false);
  readonly editingBranch = signal<Branch | null>(null);
  branchForm: { name: string; locationName: string; hasKitchen: boolean; hasTables: boolean } = { name: '', locationName: '', hasKitchen: true, hasTables: true };

  /** Branch targeted for catalog copy */
  readonly copyTarget = signal<Branch | null>(null);
  readonly showCopyDialog = signal(false);
  readonly copyingCatalog = signal(false);

  /** Activation code generation */
  readonly activationCode = signal('');
  readonly generatingCode = signal(false);
  codeBranchId = 0;
  codeMode: DeviceMode = 'cashier';

  /** Phone field — local only, not persisted yet */
  businessPhone = '';

  // ---- Folio configuration ----
  folioPrefix = '';
  folioFormat = '';
  readonly folioCounter = signal(0);
  readonly isSavingFolio = signal(false);
  readonly saveFolioSuccess = signal(false);

  // ---- Billing ----
  readonly showCancelDialog = signal(false);
  readonly isCanceling = signal(false);

  /** Display name for the current plan */
  readonly currentPlanName = computed(() =>
    PLAN_DISPLAY_NAME[this.authService.planType()] ?? 'Gratuito'
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

  /** Upgrade plan options above current tier */
  readonly upgradeOptions = computed(() => {
    const current = this.authService.planType();
    const currentLevel = PLAN_HIERARCHY[current] ?? 0;
    const options: { name: string; price: string; features: string[] }[] = [];

    if (currentLevel < PLAN_HIERARCHY[PlanType.Basic]) {
      options.push({
        name: 'Básico',
        price: '$199/mes',
        features: ['Impresora térmica', 'Escáner de códigos', 'Promociones'],
      });
    }
    if (currentLevel < PLAN_HIERARCHY[PlanType.Pro]) {
      options.push({
        name: 'Pro',
        price: '$399/mes',
        features: ['Reportes avanzados', 'Facturación CFDI', 'Multi-sucursal'],
      });
    }
    if (currentLevel < PLAN_HIERARCHY[PlanType.Enterprise]) {
      options.push({
        name: 'Enterprise',
        price: 'Contacto',
        features: ['Báscula industrial', 'API de acceso', 'Soporte prioritario'],
      });
    }
    return options;
  });

  /** Whether the cancel button should be shown */
  readonly canCancel = computed(() => {
    const status = this.authService.subscriptionStatus();
    if (!status) return false;
    return (status.status === 'active' || status.status === 'trialing')
      && this.authService.planType() !== PlanType.Free;
  });

  /** Formatted period end for cancel dialog */
  readonly cancelPeriodEnd = computed(() => {
    const status = this.authService.subscriptionStatus();
    if (status?.currentPeriodEnd) return this.formatDate(status.currentPeriodEnd);
    if (status?.trialEndsAt) return this.formatDate(status.trialEndsAt);
    return '—';
  });

  /** Cleanup subject for subscriptions */
  private readonly destroy$ = new Subject<void>();

  /** Whether to show operational config section in Negocio tab */
  readonly showOperationalConfig = computed(() =>
    this.showKitchenToggle() || this.showTablesToggle()
  );

  /** Whether to show kitchen toggle in branch dialog */
  readonly showKitchenToggle = computed(() => {
    const type = this.authService.businessType();
    return [BusinessType.Restaurant, BusinessType.Cafe, BusinessType.Bar,
            BusinessType.FoodTruck, BusinessType.Taqueria].includes(type);
  });

  /** Whether to show tables toggle in branch dialog */
  readonly showTablesToggle = computed(() => {
    const type = this.authService.businessType();
    return [BusinessType.Restaurant, BusinessType.Cafe, BusinessType.Bar].includes(type);
  });

  /** Current business type info — read-only display from authService */
  readonly currentGiroInfo = computed(() => {
    const giro = this.authService.businessType();
    const map: Record<string, { icon: string; name: string; description: string }> = {
      [BusinessType.Restaurant]: { icon: '🍽️', name: 'Restaurante',   description: 'Mesas, cocina, mesero, kiosko' },
      [BusinessType.Cafe]:       { icon: '☕',  name: 'Café / Barra',  description: 'Comandas rápidas, barra' },
      [BusinessType.Bar]:        { icon: '🍺',  name: 'Bar / Cantina', description: 'Mesas + barra, consumo corrido' },
      [BusinessType.Retail]:     { icon: '🛒',  name: 'Abarrotes / Tienda', description: 'Escáner, códigos de barras' },
      [BusinessType.FoodTruck]:  { icon: '🚚',  name: 'Food Truck',    description: 'Cobro rápido, sin mesas' },
      [BusinessType.General]:    { icon: '⚙️',  name: 'General',       description: 'Cualquier negocio' },
      [BusinessType.Taqueria]:   { icon: '🌮',  name: 'Taquería',      description: 'Cobro rápido, con cocina' },
      [BusinessType.Abarrotes]:  { icon: '🛒',  name: 'Abarrotes',     description: 'Tiendita de barrio' },
      [BusinessType.Ferreteria]: { icon: '🔧',  name: 'Ferretería',    description: 'Materiales y herramientas' },
      [BusinessType.Papeleria]:  { icon: '📝',  name: 'Papelería',     description: 'Útiles y copias' },
      [BusinessType.Farmacia]:   { icon: '💊',  name: 'Farmacia',      description: 'Medicinas y salud' },
      [BusinessType.Servicios]:  { icon: '🏪',  name: 'Servicios',     description: 'Salones, talleres, oficios' },
    };
    return map[giro] ?? { icon: '⚙️', name: giro, description: '' };
  });

  //#endregion

  //#region Constructor
  constructor(
    private readonly configService: ConfigService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const [appConfig] = await Promise.all([
      this.configService.load(),
    ]);
    this.config.set(appConfig);
    this.deviceConfig.set(this.configService.loadDeviceConfig());

    // Pre-fill folio form from loaded config
    this.folioPrefix = appConfig.folioPrefix ?? '';
    this.folioFormat = appConfig.folioFormat ?? '';
    this.folioCounter.set(appConfig.folioCounter ?? 0);

    // Refresh subscription status for billing tab
    this.authService.refreshSubscriptionStatus();

    if (this.authService.currentUser()?.role === 'Owner') {
      await this.loadBranches();
      const first = this.branches()[0];
      if (first) this.codeBranchId = first.id;
    }
  }

  ngOnDestroy(): void {
    this.scannerService.stopListening();
    this.destroy$.next();
    this.destroy$.complete();
  }

  //#endregion

  //#region Tab Navigation

  /** Switches the active settings tab */
  setTab(tab: 'business' | 'device' | 'peripherals' | 'security' | 'branches' | 'billing'): void {
    // Stop scanner when leaving peripherals tab
    if (this.activeTab() === 'peripherals' && tab !== 'peripherals') {
      this.scannerService.stopListening();
    }

    this.activeTab.set(tab);

    // Start scanner when entering peripherals tab
    if (tab === 'peripherals') {
      this.scannerService.startListening();
    }
  }

  //#endregion

  //#region Business config save

  async saveBusinessConfig(): Promise<void> {
    this.isSaving.set(true);
    this.saveSuccess.set(false);
    await this.configService.save(this.config());
    this.isSaving.set(false);
    this.saveSuccess.set(true);
    setTimeout(() => this.saveSuccess.set(false), 3000);
  }

  /** Updates a field on the business config signal */
  updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.config.update(c => ({ ...c, [key]: value }));
  }

  //#endregion

  //#region Device config save

  saveAndRedirect(): void {
    this.isSavingDevice.set(true);
    this.configService.saveDeviceConfig(this.deviceConfig());

    const mode = this.deviceConfig().mode;

    switch (mode) {
      case 'tables':
        this.router.navigate(['/tables']);
        break;
      case 'kitchen':
        this.router.navigate(['/kitchen']);
        break;
      case 'kiosk':
        this.router.navigate(['/kiosk/welcome']);
        break;
      default:
        this.router.navigate(['/pos']);
    }
  }

  /** Updates a field on the device config signal */
  updateDeviceConfig<K extends keyof DeviceConfig>(key: K, value: DeviceConfig[K]): void {
    this.deviceConfig.update(c => ({ ...c, [key]: value }));
  }

  //#endregion

  //#region PIN Change

  async changePin(): Promise<void> {
    this.pinError.set('');
    this.pinSuccess.set(false);

    if (!/^\d{4}$/.test(this.newPin)) {
      this.pinError.set('El PIN debe ser de 4 dígitos numéricos.');
      return;
    }

    if (this.newPin !== this.confirmPin) {
      this.pinError.set('Los PINs no coinciden.');
      return;
    }

    const currentValid = await this.configService.verifyPin(this.currentPin);
    if (!currentValid) {
      this.pinError.set('El PIN actual es incorrecto.');
      return;
    }

    await this.configService.updatePin(this.newPin);
    this.currentPin = '';
    this.newPin     = '';
    this.confirmPin = '';
    this.pinSuccess.set(true);
    setTimeout(() => this.pinSuccess.set(false), 3000);
  }

  //#endregion

  //#region Folio Configuration

  /**
   * Returns a live preview of the next folio based on current form values.
   */
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
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error al guardar la configuración de folios',
        life: 3000,
      });
    } finally {
      this.isSavingFolio.set(false);
    }
  }

  //#endregion

  //#region Branch Management

  /**
   * Loads all branches from the API.
   */
  async loadBranches(): Promise<void> {
    this.loadingBranches.set(true);
    try {
      const branches = await this.branchService.getAll();
      this.branches.set(branches);
    } catch (error) {
      console.error('[AdminSettings] Failed to load branches:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las sucursales',
      });
    } finally {
      this.loadingBranches.set(false);
    }
  }

  /** Opens the dialog to create a new branch */
  openNewBranch(): void {
    this.editingBranch.set(null);
    this.branchForm = { name: '', locationName: '', hasKitchen: false, hasTables: false };
    this.showBranchDialog.set(true);
  }

  /**
   * Opens the dialog to edit an existing branch.
   * @param branch Branch to edit
   */
  openEditBranch(branch: Branch): void {
    this.editingBranch.set(branch);
    this.branchForm = {
      name: branch.name,
      locationName: branch.locationName,
      hasKitchen: branch.hasKitchen ?? false,
      hasTables: branch.hasTables ?? false,
    };
    this.showBranchDialog.set(true);
  }

  /**
   * Saves the branch form — creates or updates depending on editingBranch state.
   */
  async saveBranch(): Promise<void> {
    const { name, locationName, hasKitchen, hasTables } = this.branchForm;
    if (!name.trim() || !locationName.trim()) return;

    this.savingBranch.set(true);
    try {
      const editing = this.editingBranch();
      if (editing) {
        await this.branchService.update(editing.id, name.trim(), locationName.trim(), hasKitchen, hasTables);
        this.messageService.add({
          severity: 'success',
          summary: 'Sucursal',
          detail: 'Sucursal actualizada',
        });
      } else {
        await this.branchService.create(name.trim(), locationName.trim());
        this.messageService.add({
          severity: 'success',
          summary: 'Sucursal',
          detail: 'Sucursal creada',
        });
      }
      this.showBranchDialog.set(false);
      await this.loadBranches();
    } catch (error) {
      console.error('[AdminSettings] Failed to save branch:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo guardar la sucursal',
      });
    } finally {
      this.savingBranch.set(false);
    }
  }

  /**
   * Opens the confirmation dialog to copy the matrix catalog to a branch.
   * @param branch Target branch to receive the catalog copy
   */
  openCopyCatalog(branch: Branch): void {
    this.copyTarget.set(branch);
    this.showCopyDialog.set(true);
  }

  /**
   * Copies the catalog from the matrix branch to the selected target branch.
   * Shows a toast on success or error and reloads the branch list.
   */
  async confirmCopyCatalog(): Promise<void> {
    const target = this.copyTarget();
    const matrix = this.branches().find(b => b.isMatrix);
    if (!target || !matrix) return;

    this.copyingCatalog.set(true);
    try {
      await this.branchService.copyCatalog(target.id, matrix.id);
      this.messageService.add({
        severity: 'success',
        summary: 'Catálogo copiado',
        detail: `Catálogo copiado a ${target.name}`,
      });
      this.showCopyDialog.set(false);
      await this.loadBranches();
    } catch (error) {
      console.error('[AdminSettings] Failed to copy catalog:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo copiar el catálogo',
      });
    } finally {
      this.copyingCatalog.set(false);
    }
  }

  //#endregion

  //#region Activation Code Helpers

  /** Display label for the selected branch in the code generator */
  codeBranchLabel(): string {
    return this.branches().find(b => b.id === this.codeBranchId)?.name ?? '';
  }

  /** Display label for the selected mode in the code generator */
  codeModeLabel(): string {
    return this.availableModes().find(m => m.value === this.codeMode)?.label ?? this.codeMode;
  }

  //#endregion

  //#region Activation Code

  /**
   * Generates a 6-digit activation code for configuring another device.
   * The code is valid for 24 hours.
   */
  async generateActivationCode(): Promise<void> {
    this.generatingCode.set(true);
    this.activationCode.set('');

    try {
      const response = await firstValueFrom(
        this.api.post<{ code: string }>('/device/generate-code', {
          branchId: this.codeBranchId,
          mode: this.codeMode,
        }),
      );
      this.activationCode.set(response.code);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo generar el código',
      });
    } finally {
      this.generatingCode.set(false);
    }
  }

  //#endregion

  //#region Billing Methods

  /** Opens the landing page pricing section in a new tab */
  openUpgrade(): void {
    window.open(`${environment.landingUrl}/#precios`, '_blank');
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

}
