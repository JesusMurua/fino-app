import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import {
  AppConfig,
  CreateStockReceiptItemRequest,
  DEFAULT_APP_CONFIG,
  DEFAULT_DEVICE_CONFIG,
  DeviceConfig,
  Supplier,
  UserRole,
} from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfigService } from '../../../../core/services/config.service';
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
  role?: string;
}

@Component({
  selector: 'app-pos-header',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    TableModule,
    TooltipModule,
  ],
  templateUrl: './pos-header.component.html',
  styleUrl: './pos-header.component.scss',
})
export class PosHeaderComponent implements OnInit, OnDestroy {

  private readonly http = inject(HttpClient);
  private readonly inventoryService = inject(InventoryService);
  private readonly notificationService = inject(NotificationService);
  private readonly productService = inject(ProductService);
  private readonly messageService = inject(MessageService);
  private readonly supplierService = inject(SupplierService);
  private readonly stockReceiptService = inject(StockReceiptService);
  readonly pwaService = inject(PwaService);
  readonly syncService = inject(SyncService);

  private readonly destroy$ = new Subject<void>();

  readonly isOnline     = signal(true);
  readonly config       = signal<AppConfig>({ ...DEFAULT_APP_CONFIG });
  readonly deviceConfig = signal<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  //#region Header Computed

  readonly showOrdersButton = computed(() => {
    const experience = this.configService.posExperience();
    const role = this.authService.currentUser()?.role;
    const isRestaurantOrCounter = experience === 'Restaurant' || experience === 'Counter';
    return isRestaurantOrCounter &&
      (role === 'Cashier' || role === 'Owner' || role === 'Manager');
  });

  readonly showTablesButton = computed(() =>
    this.configService.hasTables() &&
    (this.authService.currentUser()?.role === 'Cashier' ||
     this.authService.currentUser()?.role === 'Owner' ||
     this.authService.currentUser()?.role === 'Manager')
  );

  private readonly roleLabels: Record<UserRole, string> = {
    Owner: 'Dueño', Manager: 'Gerente', Cashier: 'Cajero',
    Waiter: 'Mesero', Kitchen: 'Cocina', Kiosk: 'Kiosko', Host: 'Hostess',
  };

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
    const role = this.authService.currentUser()?.role;
    return role ? (this.roleLabels[role] ?? role) : '';
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

  private readonly onOnline  = (): void => this.isOnline.set(true);
  private readonly onOffline = (): void => this.isOnline.set(false);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    this.configService.config$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.config.set(cfg));

    this.configService.deviceConfig$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.deviceConfig.set(cfg));
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
        if (res.valid && (res.role === 'Owner' || res.role === 'Manager')) {
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
}
