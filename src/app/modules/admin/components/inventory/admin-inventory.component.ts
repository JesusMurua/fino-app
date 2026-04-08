import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, firstValueFrom, takeUntil } from 'rxjs';
import { MessageService } from 'primeng/api';
import { CalendarModule } from 'primeng/calendar';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TableModule } from 'primeng/table';
import { TabViewModule } from 'primeng/tabview';
import { TooltipModule } from 'primeng/tooltip';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { HttpClient } from '@angular/common/http';

import {
  CreateStockReceiptItemRequest,
  CreateSupplierRequest,
  InventoryItem,
  InventoryMovement,
  Product,
  StockReceipt,
  Supplier,
  UpdateSupplierRequest,
} from '../../../../core/models';
import { InventoryMovementType, INVENTORY_MOVEMENT_TYPE_LABELS, INVENTORY_MOVEMENT_TYPE_CLASSES } from '../../../../core/enums';
import { AuthService } from '../../../../core/services/auth.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { ProductService } from '../../../../core/services/product.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { StockReceiptService } from '../../../../core/services/stock-receipt.service';
import { SupplierService } from '../../../../core/services/supplier.service';
import { environment } from '../../../../../environments/environment';

/** Shape of the item form used in create/edit dialog */
interface ItemForm {
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPesos: number;
}

/** Shape of the movement form */
interface MovementForm {
  quantity: number;
  reason: string;
}

/** Shape of the supplier form */
interface SupplierForm {
  name: string;
  contactName: string;
  phone: string;
  notes: string;
  isActive: boolean;
}

/** A line item in the new receipt form */
interface NewReceiptLine {
  inventoryItemId?: number;
  productId?: number;
  name: string;
  quantity: number;
  costPesos: number;
}

@Component({
  selector: 'app-admin-inventory',
  standalone: true,
  imports: [
    FormsModule,
    CalendarModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    InputSwitchModule,
    TableModule,
    TabViewModule,
    DatePipe,
    ButtonModule,
    TooltipModule,
  ],
  templateUrl: './admin-inventory.component.html',
  styleUrl: './admin-inventory.component.scss',
})
export class AdminInventoryComponent implements OnInit, OnDestroy {

  private readonly route = inject(ActivatedRoute);
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);
  private readonly productService = inject(ProductService);
  private readonly scannerService = inject(ScannerService);
  private readonly supplierService = inject(SupplierService);
  private readonly stockReceiptService = inject(StockReceiptService);
  private readonly http = inject(HttpClient);

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.inventoryService.loadFromApi();
    }, { allowSignalWrites: true });
  }

  //#region Properties — Tabs

  readonly activeTab = signal(0);

  //#endregion

  //#region Properties — Inventory (Tab 1)

  private readonly destroy$ = new Subject<void>();
  private scanSubscription?: Subscription;

  readonly items = this.inventoryService.items;
  readonly isLoading = this.inventoryService.isLoading;

  readonly scannedProduct = signal<Product | null>(null);
  readonly showQuickStockDialog = signal(false);
  readonly quickStockAmount = signal(1);

  readonly showItemDialog = signal(false);
  readonly editingItem = signal<InventoryItem | null>(null);
  form: ItemForm = this.emptyItemForm();

  readonly showHistoryDialog = signal(false);
  readonly historyItem = signal<InventoryItem | null>(null);
  readonly movements = signal<InventoryMovement[]>([]);
  readonly loadingMovements = signal(false);

  readonly showMovementDialog = signal(false);
  readonly movementItemId = signal(0);
  readonly movementType = signal<InventoryMovementType>(InventoryMovementType.In);
  movementForm: MovementForm = { quantity: 0, reason: '' };

  readonly unitOptions = [
    { label: 'Pieza', value: 'pza' },
    { label: 'Kilogramo', value: 'kg' },
    { label: 'Litro', value: 'lt' },
    { label: 'Caja', value: 'caja' },
    { label: 'Gramo', value: 'g' },
    { label: 'Mililitro', value: 'ml' },
  ];

  //#endregion

  //#region Properties — Suppliers (Tab 2)

  readonly suppliers = signal<Supplier[]>([]);
  readonly suppliersLoading = signal(false);
  readonly supplierSearch = signal('');
  readonly filteredSuppliers = computed(() => {
    const term = this.supplierSearch().toLowerCase().trim();
    const list = this.suppliers();
    if (!term) return list;
    return list.filter(s => s.name.toLowerCase().includes(term));
  });
  readonly showSupplierDialog = signal(false);
  readonly editingSupplier = signal<Supplier | null>(null);
  supplierForm: SupplierForm = this.emptySupplierForm();

  //#endregion

  //#region Properties — Stock Receipts (Tab 3)

  readonly receipts = signal<StockReceipt[]>([]);
  readonly receiptsLoading = signal(false);
  readonly receiptSupplierFilter = signal<number | null>(null);
  readonly receiptDateRange = signal<Date[] | null>(null);
  readonly showReceiptDetail = signal(false);
  readonly selectedReceipt = signal<StockReceipt | null>(null);

  //#endregion

  //#region Properties — New Receipt Dialog

  readonly showNewReceipt = signal(false);
  readonly newReceiptSupplier = signal<number | null>(null);
  readonly newReceiptNotes = signal('');
  readonly newReceiptItems = signal<NewReceiptLine[]>([]);
  readonly newReceiptTotal = computed(() =>
    this.newReceiptItems().reduce((sum, line) =>
      sum + Math.round(line.costPesos * 100) * line.quantity, 0),
  );
  readonly newReceiptSaving = signal(false);
  readonly showItemPicker = signal(false);

  /** Scanner input in the new receipt dialog */
  readonly scanInput = signal('');
  private readonly scanInput$ = new Subject<string>();

  /** Item picker dropdown options */
  readonly stockItemOptions = computed(() => {
    const invItems = this.inventoryService.items()
      .filter(i => i.isActive)
      .map(i => ({ label: `${i.name} (insumo)`, value: `inv:${i.id}`, name: i.name }));
    const prodItems = this.productService.products()
      .filter(p => p.trackStock)
      .map(p => ({ label: `${p.name} (producto)`, value: `prod:${p.id}`, name: p.name }));
    return [...invItems, ...prodItems];
  });

  /** Selected item in the item picker */
  pickerSelectedItem: string | null = null;
  pickerQuantity = 1;
  pickerCostPesos = 0;

  /** Supplier dropdown options for filters and receipt form */
  readonly supplierOptions = computed(() =>
    this.suppliers().filter(s => s.isActive).map(s => ({ label: s.name, value: s.id })),
  );

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.inventoryService.loadFromApi();
    this.startScannerListener();
    this.setupReceiptScanDebounce();
    this.handleQueryParams();
  }

  /** Reads query params to navigate to a specific tab */
  private handleQueryParams(): void {
    const params = this.route.snapshot.queryParams;
    const tab = Number(params['tab']);
    if (!isNaN(tab) && tab >= 0 && tab <= 2) {
      this.activeTab.set(tab);
      this.onTabChange(tab);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.scannerService.stopListening();
  }

  //#endregion

  //#region Tab Change

  /** Loads data when a tab becomes active */
  onTabChange(index: number): void {
    if (index === 1 && this.suppliers().length === 0) {
      this.loadSuppliers();
    }
    if (index === 2) {
      if (this.suppliers().length === 0) this.loadSuppliers();
      if (this.receipts().length === 0) this.loadReceipts();
    }
  }

  //#endregion

  //#region Item Dialog

  openNewItemDialog(): void {
    this.editingItem.set(null);
    this.form = this.emptyItemForm();
    this.showItemDialog.set(true);
  }

  openEditItemDialog(item: InventoryItem): void {
    this.editingItem.set(item);
    this.form = {
      name: item.name,
      unit: item.unit,
      currentStock: item.currentStock,
      lowStockThreshold: item.lowStockThreshold,
      costPesos: item.costCents / 100,
    };
    this.showItemDialog.set(true);
  }

  async saveItem(): Promise<void> {
    if (!this.form.name.trim()) return;

    const payload = {
      name: this.form.name.trim(),
      unit: this.form.unit as InventoryItem['unit'],
      currentStock: this.form.currentStock,
      lowStockThreshold: this.form.lowStockThreshold,
      costCents: Math.round(this.form.costPesos * 100),
      isActive: true,
    };

    try {
      if (this.editingItem()) {
        await this.inventoryService.update(this.editingItem()!.id, payload);
        this.messageService.add({ severity: 'success', summary: 'Insumo actualizado', life: 3000 });
      } else {
        await this.inventoryService.create(payload);
        this.messageService.add({ severity: 'success', summary: 'Insumo creado', life: 3000 });
      }
      this.showItemDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al guardar', life: 3000 });
    }
  }

  //#endregion

  //#region Movement Dialog

  openEntryDialog(item: InventoryItem): void {
    this.movementItemId.set(item.id);
    this.movementType.set(InventoryMovementType.In);
    this.movementForm = { quantity: 0, reason: '' };
    this.showMovementDialog.set(true);
  }

  openExitDialog(item: InventoryItem): void {
    this.movementItemId.set(item.id);
    this.movementType.set(InventoryMovementType.Out);
    this.movementForm = { quantity: 0, reason: '' };
    this.showMovementDialog.set(true);
  }

  async saveMovement(): Promise<void> {
    if (this.movementForm.quantity <= 0) return;

    try {
      await this.inventoryService.addMovement(
        this.movementItemId(),
        this.movementType(),
        this.movementForm.quantity,
        this.movementForm.reason.trim() || undefined,
      );
      const label = this.movementType() === InventoryMovementType.In ? 'Entrada' : 'Salida';
      this.messageService.add({ severity: 'success', summary: `${label} registrada`, life: 3000 });
      this.showMovementDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al registrar movimiento', life: 3000 });
    }
  }

  //#endregion

  //#region History Dialog

  async openHistoryDialog(item: InventoryItem): Promise<void> {
    this.historyItem.set(item);
    this.movements.set([]);
    this.showHistoryDialog.set(true);
    this.loadingMovements.set(true);
    try {
      const data = await firstValueFrom(
        this.http.get<InventoryMovement[]>(
          `${environment.apiUrl}/inventory/${item.id}/movements`
        )
      );
      this.movements.set(data);
    } catch {
      this.movements.set([]);
    } finally {
      this.loadingMovements.set(false);
    }
  }

  movementTypeLabel(type: number): string {
    return INVENTORY_MOVEMENT_TYPE_LABELS[type as InventoryMovementType] ?? String(type);
  }

  movementTypeSeverity(type: number): string {
    return INVENTORY_MOVEMENT_TYPE_CLASSES[type as InventoryMovementType] ?? '';
  }

  //#endregion

  //#region Scanner Integration

  private startScannerListener(): void {
    this.scanSubscription = this.scannerService.onScan()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => this.handleBarcodeScan(code));

    this.scannerService.startListening();
  }

  private handleBarcodeScan(code: string): void {
    this.productService.findByBarcode(code).subscribe({
      next: (product) => {
        if (product) {
          this.scannedProduct.set(product);
          this.quickStockAmount.set(1);
          this.showQuickStockDialog.set(true);
        } else {
          this.messageService.add({
            severity: 'warn',
            summary: 'Código no registrado',
            detail: `"${code}" — asígnalo a un producto en el catálogo`,
            life: 5000,
          });
        }
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudo buscar el producto',
          life: 3000,
        });
      },
    });
  }

  async confirmQuickStock(): Promise<void> {
    const product = this.scannedProduct();
    if (!product) return;

    if (!product.trackStock) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Sin control de stock',
        detail: 'Este producto no maneja stock por unidad',
        life: 4000,
      });
      this.showQuickStockDialog.set(false);
      this.scannedProduct.set(null);
      return;
    }

    try {
      await firstValueFrom(
        this.http.post(
          `${environment.apiUrl}/products/${product.id}/movements`,
          { type: 'in', quantity: this.quickStockAmount(), reason: 'Recepción rápida por escaneo' },
        ),
      );
      this.messageService.add({
        severity: 'success',
        summary: 'Stock actualizado',
        detail: `+${this.quickStockAmount()} unidades a ${product.name}`,
        life: 3000,
      });
      this.showQuickStockDialog.set(false);
      this.scannedProduct.set(null);
      await this.inventoryService.loadFromApi();
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo actualizar el stock',
      });
    }
  }

  cancelQuickStock(): void {
    this.showQuickStockDialog.set(false);
    this.scannedProduct.set(null);
  }

  //#endregion

  //#region Suppliers

  /** Loads all suppliers from API */
  loadSuppliers(): void {
    this.suppliersLoading.set(true);
    this.supplierService.getAll().subscribe({
      next: (data) => {
        this.suppliers.set(data);
        this.suppliersLoading.set(false);
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al cargar proveedores', life: 3000 });
        this.suppliersLoading.set(false);
      },
    });
  }

  openNewSupplierDialog(): void {
    this.editingSupplier.set(null);
    this.supplierForm = this.emptySupplierForm();
    this.showSupplierDialog.set(true);
  }

  openEditSupplierDialog(supplier: Supplier): void {
    this.editingSupplier.set(supplier);
    this.supplierForm = {
      name: supplier.name,
      contactName: supplier.contactName ?? '',
      phone: supplier.phone ?? '',
      notes: supplier.notes ?? '',
      isActive: supplier.isActive,
    };
    this.showSupplierDialog.set(true);
  }

  saveSupplier(): void {
    if (!this.supplierForm.name.trim()) return;

    const editing = this.editingSupplier();

    if (editing) {
      const payload: UpdateSupplierRequest = {
        name: this.supplierForm.name.trim(),
        contactName: this.supplierForm.contactName.trim() || undefined,
        phone: this.supplierForm.phone.trim() || undefined,
        notes: this.supplierForm.notes.trim() || undefined,
        isActive: this.supplierForm.isActive,
      };
      this.supplierService.update(editing.id, payload).subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Proveedor actualizado', life: 3000 });
          this.showSupplierDialog.set(false);
          this.loadSuppliers();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error al guardar', life: 3000 });
        },
      });
    } else {
      const payload: CreateSupplierRequest = {
        name: this.supplierForm.name.trim(),
        contactName: this.supplierForm.contactName.trim() || undefined,
        phone: this.supplierForm.phone.trim() || undefined,
        notes: this.supplierForm.notes.trim() || undefined,
      };
      this.supplierService.create(payload).subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Proveedor creado', life: 3000 });
          this.showSupplierDialog.set(false);
          this.loadSuppliers();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error al guardar', life: 3000 });
        },
      });
    }
  }

  /** Toggles supplier active/inactive status */
  toggleSupplierActive(supplier: Supplier): void {
    const payload: UpdateSupplierRequest = {
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      notes: supplier.notes,
      isActive: !supplier.isActive,
    };
    this.supplierService.update(supplier.id, payload).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: supplier.isActive ? 'Proveedor desactivado' : 'Proveedor activado',
          life: 3000,
        });
        this.loadSuppliers();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al actualizar', life: 3000 });
      },
    });
  }

  //#endregion

  //#region Stock Receipts

  /** Loads stock receipts with current filters */
  loadReceipts(): void {
    this.receiptsLoading.set(true);
    const supplierId = this.receiptSupplierFilter() ?? undefined;
    const range = this.receiptDateRange();
    const from = range?.[0] ? range[0].toISOString() : undefined;
    const to = range?.[1] ? range[1].toISOString() : undefined;

    this.stockReceiptService.getAll(supplierId, from, to).subscribe({
      next: (data) => {
        this.receipts.set(data);
        this.receiptsLoading.set(false);
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al cargar entradas', life: 3000 });
        this.receiptsLoading.set(false);
      },
    });
  }

  /** Applies receipt filters and reloads */
  applyReceiptFilters(): void {
    this.loadReceipts();
  }

  /** Opens receipt detail dialog */
  openReceiptDetail(receipt: StockReceipt): void {
    this.selectedReceipt.set(receipt);
    this.showReceiptDetail.set(true);
  }

  //#endregion

  //#region New Receipt

  /** Opens the new receipt dialog */
  openNewReceiptDialog(): void {
    this.newReceiptSupplier.set(null);
    this.newReceiptNotes.set('');
    this.newReceiptItems.set([]);
    this.scanInput.set('');
    this.newReceiptSaving.set(false);
    this.showNewReceipt.set(true);
  }

  /** Sets up debounce for scanner input in receipt dialog */
  private setupReceiptScanDebounce(): void {
    this.scanInput$
      .pipe(debounceTime(150), takeUntil(this.destroy$))
      .subscribe(code => this.handleReceiptScan(code));
  }

  /** Called on input event from the scanner field */
  onScanInputChange(value: string): void {
    this.scanInput.set(value);
    if (value.trim()) {
      this.scanInput$.next(value.trim());
    }
  }

  /** Handles a scanned barcode in new receipt context */
  private handleReceiptScan(code: string): void {
    const items = this.newReceiptItems();
    const options = this.stockItemOptions();

    // Search by name match (case-insensitive)
    const match = options.find(o =>
      o.name.toLowerCase() === code.toLowerCase()
    );

    if (match) {
      this.addOrIncrementLine(match.value, match.name);
      this.scanInput.set('');
      return;
    }

    // Try barcode lookup via product service
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

  /** Adds a new line or increments quantity if item already exists */
  private addOrIncrementLine(itemKey: string, name: string): void {
    const items = [...this.newReceiptItems()];
    const [type, idStr] = itemKey.split(':');
    const id = Number(idStr);

    const existing = items.find(line =>
      (type === 'inv' && line.inventoryItemId === id) ||
      (type === 'prod' && line.productId === id),
    );

    if (existing) {
      existing.quantity += 1;
      this.newReceiptItems.set([...items]);
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
      this.newReceiptItems.set(items);
    }
  }

  /** Opens the manual item picker dialog */
  openItemPicker(): void {
    this.pickerSelectedItem = null;
    this.pickerQuantity = 1;
    this.pickerCostPesos = 0;
    this.showItemPicker.set(true);
  }

  /** Adds the selected item from the picker to the receipt */
  addFromPicker(): void {
    if (!this.pickerSelectedItem || this.pickerQuantity <= 0) return;

    const option = this.stockItemOptions().find(o => o.value === this.pickerSelectedItem);
    if (!option) return;

    const [type, idStr] = this.pickerSelectedItem.split(':');
    const id = Number(idStr);
    const items = [...this.newReceiptItems()];

    items.push({
      inventoryItemId: type === 'inv' ? id : undefined,
      productId: type === 'prod' ? id : undefined,
      name: option.name,
      quantity: this.pickerQuantity,
      costPesos: this.pickerCostPesos,
    });
    this.newReceiptItems.set(items);
    this.showItemPicker.set(false);
  }

  /** Removes a line from the new receipt */
  removeReceiptLine(index: number): void {
    const items = [...this.newReceiptItems()];
    items.splice(index, 1);
    this.newReceiptItems.set(items);
  }

  /** Updates a line and triggers reactivity */
  updateReceiptLine(): void {
    this.newReceiptItems.set([...this.newReceiptItems()]);
  }

  /** Confirms and submits the new stock receipt */
  async confirmNewReceipt(): Promise<void> {
    const items = this.newReceiptItems();
    if (items.length === 0) return;

    this.newReceiptSaving.set(true);

    const requestItems: CreateStockReceiptItemRequest[] = items.map(line => ({
      inventoryItemId: line.inventoryItemId,
      productId: line.productId,
      quantity: line.quantity,
      costCents: Math.round(line.costPesos * 100),
    }));

    const payload = {
      supplierId: this.newReceiptSupplier() ?? undefined,
      notes: this.newReceiptNotes().trim() || undefined,
      items: requestItems,
    };

    this.stockReceiptService.create(payload).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Entrada registrada', life: 3000 });
        this.showNewReceipt.set(false);
        this.loadReceipts();
        this.inventoryService.loadFromApi();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al registrar entrada', life: 3000 });
      },
      complete: () => {
        this.newReceiptSaving.set(false);
      },
    });
  }

  /** Computes line total in cents */
  lineTotalCents(line: NewReceiptLine): number {
    return Math.round(line.costPesos * 100) * line.quantity;
  }

  //#endregion

  //#region Helpers

  isLowStock(item: InventoryItem): boolean {
    return item.currentStock <= item.lowStockThreshold;
  }

  private emptyItemForm(): ItemForm {
    return { name: '', unit: 'pza', currentStock: 0, lowStockThreshold: 5, costPesos: 0 };
  }

  private emptySupplierForm(): SupplierForm {
    return { name: '', contactName: '', phone: '', notes: '', isActive: true };
  }

  //#endregion
}
