import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  AppConfig,
  CreateStockReceiptItemRequest,
  DEFAULT_APP_CONFIG,
  DEFAULT_DEVICE_CONFIG,
  DeviceConfig,
  Order,
  Supplier,
} from '../../../../core/models';
import { UserRoleId, USER_ROLE_LABELS } from '../../../../core/enums';
import { SyncStatusId } from '../../../../core/enums';
import { DatabaseService } from '../../../../core/services/database.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { ConfigService } from '../../../../core/services/config.service';
import { DeliveryService } from '../../../../core/services/delivery.service';
import { DeviceService } from '../../../../core/services/device.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ProductService } from '../../../../core/services/product.service';
import { PwaService } from '../../../../core/services/pwa.service';
import { StockReceiptService } from '../../../../core/services/stock-receipt.service';
import { SupplierService } from '../../../../core/services/supplier.service';
import { SyncService } from '../../../../core/services/sync.service';
import { environment } from '../../../../../environments/environment';

/** PIN numpad key */
type NumpadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'del';

/** A line item in the receipt form */
interface ReceiptLine {
  inventoryItemId?: number;
  productId?: number;
  name: string;
  quantity: number;
  costPesos: number;
}

/** Response shape from verify-pin endpoint */
interface VerifyPinResponse {
  valid: boolean;
  /** @deprecated Use roleId instead */
  role?: string;
  roleId?: UserRoleId;
}

@Component({
  selector: 'app-pos-header',
  standalone: true,
  imports: [
    DatePipe,
    RouterModule,
    FormsModule,
    DialogModule,
    ConfirmDialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    TableModule,
    TooltipModule,
    PricePipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './pos-header.component.html',
  styleUrl: './pos-header.component.scss',
})
export class PosHeaderComponent implements OnInit, OnDestroy {

  private readonly http = inject(HttpClient);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly db = inject(DatabaseService);
  private readonly inventoryService = inject(InventoryService);
  private readonly notificationService = inject(NotificationService);
  private readonly productService = inject(ProductService);
  private readonly messageService = inject(MessageService);
  private readonly supplierService = inject(SupplierService);
  private readonly stockReceiptService = inject(StockReceiptService);
  readonly cashRegisterService = inject(CashRegisterService);
  readonly deliveryService = inject(DeliveryService);
  readonly pwaService = inject(PwaService);
  readonly syncService = inject(SyncService);

  private readonly destroy$ = new Subject<void>();

  readonly isOnline     = signal(true);
  readonly config       = signal<AppConfig>({ ...DEFAULT_APP_CONFIG });
  readonly deviceConfig = signal<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  //#region Header Computed

  readonly showOrdersButton = computed(() => {
    const experience = this.configService.posExperience();
    const roleId = this.authService.currentUser()?.roleId;
    const isRestaurantOrCounter = experience === 'Restaurant' || experience === 'Counter';
    return isRestaurantOrCounter &&
      (roleId === UserRoleId.Cashier || roleId === UserRoleId.Owner || roleId === UserRoleId.Manager);
  });

  readonly showTablesButton = computed(() =>
    this.configService.hasTables() &&
    (this.authService.currentUser()?.roleId === UserRoleId.Cashier ||
     this.authService.currentUser()?.roleId === UserRoleId.Owner ||
     this.authService.currentUser()?.roleId === UserRoleId.Manager)
  );

  readonly branchName = computed(() => {
    const user = this.authService.currentUser();
    const id = this.authService.activeBranchId();
    return user?.branches?.find(b => b.id === id)?.name
      ?? this.config().locationName;
  });

  readonly userName = computed(() =>
    this.authService.currentUser()?.name ?? '',
  );

  readonly userRoleLabel = computed(() => {
    const roleId = this.authService.currentUser()?.roleId;
    return roleId ? (USER_ROLE_LABELS[roleId] ?? String(roleId)) : '';
  });

  //#endregion

  //#region PIN Dialog

  readonly showPinDialog = signal(false);
  readonly pinDigits = signal<string[]>([]);
  readonly pinError = signal(false);
  readonly pinLoading = signal(false);

  readonly pinKeys: (NumpadKey | null)[] = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    null, '0', 'del',
  ];

  //#endregion

  //#region Receipt Modal

  readonly showReceiptModal = signal(false);
  readonly receiptSupplier = signal<number | null>(null);
  readonly receiptNotes = signal('');
  readonly receiptItems = signal<ReceiptLine[]>([]);
  readonly receiptTotal = computed(() =>
    this.receiptItems().reduce((sum, line) =>
      sum + Math.round(line.costPesos * 100) * line.quantity, 0),
  );
  readonly receiptSaving = signal(false);

  readonly scanInput = signal('');
  private readonly scanInput$ = new Subject<string>();

  readonly showPickerDialog = signal(false);
  pickerSelectedItem: string | null = null;
  pickerQuantity = 1;
  pickerCostPesos = 0;

  /** Supplier dropdown options */
  readonly suppliers = signal<Supplier[]>([]);
  readonly supplierOptions = computed(() =>
    this.suppliers().filter(s => s.isActive).map(s => ({ label: s.name, value: s.id })),
  );

  /** Combined inventory items + trackStock products for picker */
  readonly stockItemOptions = computed(() => {
    const invItems = this.inventoryService.items()
      .filter(i => i.isActive)
      .map(i => ({ label: `${i.name} (insumo)`, value: `inv:${i.id}`, name: i.name }));
    const prodItems = this.productService.products()
      .filter(p => p.trackStock)
      .map(p => ({ label: `${p.name} (producto)`, value: `prod:${p.id}`, name: p.name }));
    return [...invItems, ...prodItems];
  });

  //#endregion

  //#region Sync Center

  /** Whether the Sync Center modal is visible */
  readonly showSyncCenter = signal(false);

  /** Orders that have permanently failed sync */
  readonly failedOrders = signal<Order[]>([]);

  /** True while a bulk retry is in progress */
  readonly isRetrying = signal(false);

  /** Total cents at risk across all failed orders */
  readonly failedTotalCents = computed(() =>
    this.failedOrders().reduce((sum, o) => sum + o.totalCents, 0),
  );

  //#endregion

  private readonly onOnline  = (): void => this.isOnline.set(true);
  private readonly onOffline = (): void => this.isOnline.set(false);

  constructor(
    readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    this.configService.config$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.config.set(cfg));

    this.configService.deviceConfig$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.deviceConfig.set(cfg));

    // Reactively load delivery orders when hasDelivery becomes true
    effect(() => {
      if (this.configService.hasDelivery()) {
        this.deliveryService.loadActiveOrders();
      }
    }, { allowSignalWrites: true });
  }

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    this.isOnline.set(navigator.onLine);
    window.addEventListener('online',  this.onOnline);
    window.addEventListener('offline', this.onOffline);

    await this.configService.load();
    this.setupScanDebounce();
  }

  ngOnDestroy(): void {
    window.removeEventListener('online',  this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.destroy$.next();
    this.destroy$.complete();
  }

  //#endregion

  //#region Navigation

  openTables(): void {
    this.router.navigate(['/tables']);
  }

  openOrders(): void {
    this.router.navigate(['/orders']);
  }

  openAdmin(): void {
    this.router.navigate(['/pin']);
  }

  //#endregion

  //#region Notifications

  async enableNotifications(): Promise<void> {
    await this.notificationService.requestPermission();
    this.pwaService.notificationStatus.set(Notification.permission);
  }

  //#endregion

  //#region PIN Flow

  /** Opens the PIN dialog — first step of "Recibir mercancía" */
  openPinDialog(): void {
    this.pinDigits.set([]);
    this.pinError.set(false);
    this.pinLoading.set(false);
    this.showPinDialog.set(true);
  }

  addPinDigit(digit: string): void {
    if (this.pinDigits().length >= 4 || this.pinLoading()) return;
    this.pinDigits.update(d => [...d, digit]);

    if (this.pinDigits().length === 4) {
      this.submitPin();
    }
  }

  removePinDigit(): void {
    this.pinDigits.update(d => d.slice(0, -1));
    this.pinError.set(false);
  }

  onPinKey(key: NumpadKey | null): void {
    if (!key) return;
    if (key === 'del') {
      this.removePinDigit();
    } else {
      this.addPinDigit(key);
    }
  }

  /** Verifies PIN via API — on success opens the receipt modal */
  private submitPin(): void {
    const pin = this.pinDigits().join('');
    const branchId = this.authService.activeBranchId();
    this.pinLoading.set(true);

    this.http.post<VerifyPinResponse>(
      `${environment.apiUrl}/branch/${branchId}/verify-pin`,
      { pin },
    ).subscribe({
      next: (res) => {
        this.pinLoading.set(false);
        if (res.valid && (res.role === 'Owner' || res.role === 'Manager' || res.roleId === UserRoleId.Owner || res.roleId === UserRoleId.Manager)) {
          this.showPinDialog.set(false);
          this.openReceiptModal();
        } else {
          this.showPinError();
        }
      },
      error: () => {
        this.pinLoading.set(false);
        this.showPinError();
      },
    });
  }

  private showPinError(): void {
    this.pinError.set(true);
    setTimeout(() => {
      this.pinDigits.set([]);
      this.pinError.set(false);
    }, 600);
  }

  //#endregion

  //#region Receipt Modal

  /** Opens receipt modal and preloads suppliers + inventory */
  private async openReceiptModal(): Promise<void> {
    this.receiptSupplier.set(null);
    this.receiptNotes.set('');
    this.receiptItems.set([]);
    this.scanInput.set('');
    this.receiptSaving.set(false);

    this.showReceiptModal.set(true);

    // Load suppliers in background
    this.supplierService.getAll().subscribe({
      next: (data) => this.suppliers.set(data),
      error: () => {},
    });

    // Ensure inventory is fresh
    await this.inventoryService.loadFromApi();
  }

  private setupScanDebounce(): void {
    this.scanInput$
      .pipe(debounceTime(150), takeUntil(this.destroy$))
      .subscribe(code => this.handleScan(code));
  }

  onScanInputChange(value: string): void {
    this.scanInput.set(value);
    if (value.trim()) {
      this.scanInput$.next(value.trim());
    }
  }

  private handleScan(code: string): void {
    const options = this.stockItemOptions();

    // Try exact name match first
    const match = options.find(o =>
      o.name.toLowerCase() === code.toLowerCase()
    );

    if (match) {
      this.addOrIncrementLine(match.value, match.name);
      this.scanInput.set('');
      return;
    }

    // Try barcode lookup
    this.productService.findByBarcode(code).subscribe({
      next: (product) => {
        if (product && product.trackStock) {
          this.addOrIncrementLine(`prod:${product.id}`, product.name);
        } else if (product) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Sin control de stock',
            detail: `"${product.name}" no maneja stock`,
            life: 4000,
          });
        } else {
          this.messageService.add({
            severity: 'warn',
            summary: 'No encontrado',
            detail: `"${code}" no se encontró en el catálogo`,
            life: 4000,
          });
        }
        this.scanInput.set('');
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Error al buscar producto',
          life: 3000,
        });
        this.scanInput.set('');
      },
    });
  }

  private addOrIncrementLine(itemKey: string, name: string): void {
    const items = [...this.receiptItems()];
    const [type, idStr] = itemKey.split(':');
    const id = Number(idStr);

    const existing = items.find(line =>
      (type === 'inv' && line.inventoryItemId === id) ||
      (type === 'prod' && line.productId === id),
    );

    if (existing) {
      existing.quantity += 1;
      this.receiptItems.set([...items]);
    } else {
      const invItem = type === 'inv'
        ? this.inventoryService.items().find(i => i.id === id)
        : null;
      const defaultCost = invItem ? invItem.costCents / 100 : 0;

      items.push({
        inventoryItemId: type === 'inv' ? id : undefined,
        productId: type === 'prod' ? id : undefined,
        name,
        quantity: 1,
        costPesos: defaultCost,
      });
      this.receiptItems.set(items);
    }
  }

  openPicker(): void {
    this.pickerSelectedItem = null;
    this.pickerQuantity = 1;
    this.pickerCostPesos = 0;
    this.showPickerDialog.set(true);
  }

  addFromPicker(): void {
    if (!this.pickerSelectedItem || this.pickerQuantity <= 0) return;

    const option = this.stockItemOptions().find(o => o.value === this.pickerSelectedItem);
    if (!option) return;

    const [type, idStr] = this.pickerSelectedItem.split(':');
    const id = Number(idStr);
    const items = [...this.receiptItems()];

    items.push({
      inventoryItemId: type === 'inv' ? id : undefined,
      productId: type === 'prod' ? id : undefined,
      name: option.name,
      quantity: this.pickerQuantity,
      costPesos: this.pickerCostPesos,
    });
    this.receiptItems.set(items);
    this.showPickerDialog.set(false);
  }

  removeReceiptLine(index: number): void {
    const items = [...this.receiptItems()];
    items.splice(index, 1);
    this.receiptItems.set(items);
  }

  updateReceiptLine(): void {
    this.receiptItems.set([...this.receiptItems()]);
  }

  lineTotalCents(line: ReceiptLine): number {
    return Math.round(line.costPesos * 100) * line.quantity;
  }

  confirmReceipt(): void {
    const items = this.receiptItems();
    if (items.length === 0) return;

    this.receiptSaving.set(true);

    const requestItems: CreateStockReceiptItemRequest[] = items.map(line => ({
      inventoryItemId: line.inventoryItemId,
      productId: line.productId,
      quantity: line.quantity,
      costCents: Math.round(line.costPesos * 100),
    }));

    const payload = {
      supplierId: this.receiptSupplier() ?? undefined,
      notes: this.receiptNotes().trim() || undefined,
      items: requestItems,
    };

    this.stockReceiptService.create(payload).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Entrada registrada', life: 3000 });
        this.showReceiptModal.set(false);
        this.inventoryService.loadFromApi();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al registrar entrada', life: 3000 });
      },
      complete: () => {
        this.receiptSaving.set(false);
      },
    });
  }

  //#endregion

  //#region Session Blocker (FDD-002)

  private readonly deviceService = inject(DeviceService);

  /** Physical register linked to this device (null if unlinked) */
  readonly linkedRegister = this.cashRegisterService.linkedRegister;

  /** Controls the full-screen session blocker overlay */
  readonly showSessionBlocker = computed(() => !this.cashRegisterService.hasOpenSession());

  /**
   * Strict state machine for the cash register setup flow inside the blocker.
   * States are mutually exclusive — the template uses @switch on this signal
   * to render exactly one UI block at a time.
   *
   * - 'loading'      → an async action is in flight (linking or opening)
   * - 'needsLinking' → no register linked to this device yet
   * - 'needsOpening' → register linked but no open session
   * - 'isOpen'       → register linked and a session is open (blocker is hidden)
   */
  readonly setupState = computed<'loading' | 'needsLinking' | 'needsOpening' | 'isOpen'>(() => {
    if (this.isLinkingDevice() || this.isOpeningSession()) return 'loading';
    if (this.cashRegisterService.hasOpenSession()) return 'isOpen';
    if (!this.linkedRegister()) return 'needsLinking';
    return 'needsOpening';
  });

  /** Controls visibility of the takeover confirmation dialog */
  readonly takeoverDialogVisible = signal(false);

  /** Name of the register the user attempted to create when 409 was returned */
  readonly pendingTakeoverName = signal('');

  /** ID of the existing register on the backend (returned in the 409 body) */
  readonly pendingExistingRegisterId = signal<number | null>(null);

  /** Whether the existing register has an open session (returned in the 409 body) */
  readonly pendingHasOpenSession = signal(false);

  /** True when the user is an Owner or Manager (can self-link a register) */
  readonly canSelfLink = computed(() => {
    const roleId = this.authService.currentUser()?.roleId;
    return roleId === UserRoleId.Owner || roleId === UserRoleId.Manager;
  });

  /** Opening amount for the new session (in pesos) */
  readonly sessionAmountPesos = signal(0);

  /** True while the session is being opened */
  readonly isOpeningSession = signal(false);

  /** True while the self-link flow is in progress */
  readonly isLinkingDevice = signal(false);

  /** Default name used by the one-click self-link flow */
  private readonly DEFAULT_REGISTER_NAME = 'Caja Principal';

  /**
   * One-click self-link for Owners/Managers: creates a register named
   * "Caja Principal", links it to this device, and resolves it so the
   * session blocker advances to `needsOpening`.
   *
   * If the backend returns 409 `register_name_taken`, the takeover dialog
   * is shown so the user can reclaim the existing register.
   */
  async linkDeviceAsRegister(): Promise<void> {
    if (this.isLinkingDevice()) return;
    this.isLinkingDevice.set(true);

    try {
      await this.createAndLinkRegister(this.DEFAULT_REGISTER_NAME, false);
    } catch (error: unknown) {
      this.handleLinkError(error, this.DEFAULT_REGISTER_NAME);
    } finally {
      this.isLinkingDevice.set(false);
    }
  }

  /**
   * Performs the create + link + resolve sequence and shows the success toast.
   * Throws the original error so callers can branch on HTTP 409.
   */
  private async createAndLinkRegister(name: string, takeover: boolean): Promise<void> {
    const register = await this.cashRegisterService.createRegister(name, true, takeover);
    await this.cashRegisterService.linkDevice(register.id, this.deviceService.deviceUuid);
    await this.cashRegisterService.resolveLinkedRegister();

    // Re-fetch the active session scoped to the new register. If the
    // takeover reclaimed a register that already had an open session
    // (e.g. left running on another iPad), the blocker will dismiss
    // immediately instead of asking for an opening amount.
    await this.cashRegisterService.refreshActiveSession();

    this.messageService.add({
      severity: 'success',
      summary: takeover ? 'Caja reconectada' : 'Caja vinculada',
      detail: `"${register.name}" asignada a este dispositivo.`,
      life: 4000,
    });
  }

  /**
   * Inspects a link error: if it is HTTP 409 with `register_name_taken`,
   * opens the takeover dialog. Otherwise shows a generic error toast.
   */
  private handleLinkError(error: unknown, attemptedName: string): void {
    const httpError = error as { status?: number; error?: { error?: string; existingRegisterId?: number; hasOpenSession?: boolean } };

    if (httpError?.status === 409 && httpError.error?.error === 'register_name_taken') {
      this.pendingTakeoverName.set(attemptedName);
      this.pendingExistingRegisterId.set(httpError.error.existingRegisterId ?? null);
      this.pendingHasOpenSession.set(httpError.error.hasOpenSession ?? false);
      this.takeoverDialogVisible.set(true);
      return;
    }

    this.messageService.add({
      severity: 'error',
      summary: 'Error al vincular',
      detail: 'No se pudo crear la caja. Verifica tu conexión.',
      life: 5000,
    });
  }

  /**
   * User confirmed the takeover from the dialog. Re-runs the create flow
   * with `takeover: true` so the backend reclaims the existing register.
   */
  async confirmTakeover(): Promise<void> {
    if (this.isLinkingDevice()) return;

    const name = this.pendingTakeoverName();
    if (!name) return;

    this.isLinkingDevice.set(true);
    try {
      await this.createAndLinkRegister(name, true);
      this.closeTakeoverDialog();
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'No se pudo reconectar',
        detail: 'Verifica tu conexión e intenta de nuevo.',
        life: 5000,
      });
    } finally {
      this.isLinkingDevice.set(false);
    }
  }

  /** User dismissed the takeover dialog without taking action */
  cancelTakeover(): void {
    this.closeTakeoverDialog();
  }

  /** Resets the takeover dialog state */
  private closeTakeoverDialog(): void {
    this.takeoverDialogVisible.set(false);
    this.pendingTakeoverName.set('');
    this.pendingExistingRegisterId.set(null);
    this.pendingHasOpenSession.set(false);
  }

  /** Opens a new cash register session and dismisses the blocker */
  async openSessionFromBlocker(): Promise<void> {
    if (this.isOpeningSession()) return;

    this.isOpeningSession.set(true);
    try {
      const amountCents = Math.round(this.sessionAmountPesos() * 100);
      const user = this.authService.currentUser();
      await this.cashRegisterService.openSession({
        initialAmountCents: amountCents,
        openedBy: user?.name ?? 'Cajero',
      });
      this.sessionAmountPesos.set(0);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error al abrir turno',
        detail: 'No se pudo abrir la caja. Verifica tu conexión.',
        life: 5000,
      });
    } finally {
      this.isOpeningSession.set(false);
    }
  }

  //#endregion

  //#region Sync Center Methods

  /** Opens the Sync Center modal and loads permanently failed orders from Dexie */
  async openSyncCenter(): Promise<void> {
    const orders = await this.db.orders
      .where('syncStatusId')
      .equals(SyncStatusId.PermanentlyFailed)
      .toArray();
    this.failedOrders.set(orders);
    this.showSyncCenter.set(true);
  }

  /** Resets a single order to Pending and triggers immediate sync */
  async retryOrder(order: Order): Promise<void> {
    await this.db.orders.update(order.id, { syncStatusId: SyncStatusId.Pending, retryCount: 0 });
    this.failedOrders.update(arr => arr.filter(o => o.id !== order.id));
    await this.syncService.refreshCounts();

    if (this.failedOrders().length === 0) {
      this.showSyncCenter.set(false);
    }

    this.syncService.syncPendingOrders();
  }

  /** Resets all failed orders to Pending in a single Dexie transaction */
  async retryAll(): Promise<void> {
    this.isRetrying.set(true);
    try {
      const ids = this.failedOrders().map(o => o.id);
      await this.db.transaction('rw', this.db.orders, async () => {
        for (const id of ids) {
          await this.db.orders.update(id, { syncStatusId: SyncStatusId.Pending, retryCount: 0 });
        }
      });
      this.failedOrders.set([]);
      await this.syncService.refreshCounts();
      this.showSyncCenter.set(false);
      this.syncService.syncPendingOrders();
    } finally {
      this.isRetrying.set(false);
    }
  }

  /** Shows a confirm dialog before permanently deleting a failed order from Dexie */
  discardOrder(order: Order): void {
    this.confirmationService.confirm({
      header: `¿Descartar Orden #${order.orderNumber}?`,
      message: `Esta orden se eliminará permanentemente del dispositivo. Esta acción NO se puede deshacer.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, descartar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        await this.db.orders.delete(order.id);
        this.failedOrders.update(arr => arr.filter(o => o.id !== order.id));
        await this.syncService.refreshCounts();

        if (this.failedOrders().length === 0) {
          this.showSyncCenter.set(false);
        }
      },
    });
  }

  //#endregion
}
