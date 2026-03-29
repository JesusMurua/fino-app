import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TableModule } from 'primeng/table';
import { AppConfig, DEFAULT_APP_CONFIG, DEFAULT_DEVICE_CONFIG, DeviceConfig } from '../../../../core/models';
import { ApiService } from '../../../../core/services/api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { Branch, BranchService } from '../../../../core/services/branch.service';
import { ConfigService } from '../../../../core/services/config.service';
import { PrinterService } from '../../../../core/services/printer.service';
import { ScannerService } from '../../../../core/services/scanner.service';

type DeviceMode = DeviceConfig['mode'];

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [
    FormsModule,
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

  readonly modes: { value: DeviceMode; label: string; icon: string; description: string; badge?: string }[] = [
    { value: 'cashier', icon: '💳', label: 'Cajero',  description: 'POS estándar de cobro' },
    { value: 'tables',  icon: '🪑', label: 'Mesas',   description: 'Vista de mesas para meseros' },
    { value: 'kitchen', icon: '👨‍🍳', label: 'Cocina',  description: 'Pantalla de cocina KDS' },
    { value: 'kiosk',   icon: '📱', label: 'Kiosko',  description: 'Autoservicio para clientes', badge: 'Beta' },
  ];

  /** All branches for the current business */
  readonly branches = signal<Branch[]>([]);
  readonly loadingBranches = signal(false);
  readonly showBranchDialog = signal(false);
  readonly savingBranch = signal(false);
  readonly editingBranch = signal<Branch | null>(null);
  branchForm: { name: string; locationName: string } = { name: '', locationName: '' };

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

  /** Cleanup subject for subscriptions */
  private readonly destroy$ = new Subject<void>();

  /** Business type selection — UI only, not persisted yet */
  selectedBusinessType = 'restaurant';
  readonly businessTypes: { value: string; icon: string; label: string; description: string }[] = [
    { value: 'restaurant', icon: '🍽️', label: 'Restaurante', description: 'Mesas, cocina, mesero' },
    { value: 'retail',     icon: '🛒', label: 'Retail',       description: 'Báscula, códigos de barras' },
    { value: 'cafe',       icon: '☕',  label: 'Café',         description: 'Barra rápida, comandas' },
    { value: 'custom',     icon: '⚙️', label: 'Personalizado', description: 'Configura tú mismo' },
  ];

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
    this.branchForm = { name: '', locationName: '' };
    this.showBranchDialog.set(true);
  }

  /**
   * Opens the dialog to edit an existing branch.
   * @param branch Branch to edit
   */
  openEditBranch(branch: Branch): void {
    this.editingBranch.set(branch);
    this.branchForm = { name: branch.name, locationName: branch.locationName };
    this.showBranchDialog.set(true);
  }

  /**
   * Saves the branch form — creates or updates depending on editingBranch state.
   */
  async saveBranch(): Promise<void> {
    const { name, locationName } = this.branchForm;
    if (!name.trim() || !locationName.trim()) return;

    this.savingBranch.set(true);
    try {
      const editing = this.editingBranch();
      if (editing) {
        await this.branchService.update(editing.id, name.trim(), locationName.trim());
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
    return this.modes.find(m => m.value === this.codeMode)?.label ?? this.codeMode;
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

}
