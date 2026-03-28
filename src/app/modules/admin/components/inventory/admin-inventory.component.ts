import { Component, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, firstValueFrom, takeUntil } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { InventoryItem, InventoryMovement, Product } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { ProductService } from '../../../../core/services/product.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

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

@Component({
  selector: 'app-admin-inventory',
  standalone: true,
  imports: [
    FormsModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    TableModule,
    DatePipe,
    ButtonModule,
    TooltipModule,
  ],
  templateUrl: './admin-inventory.component.html',
  styleUrl: './admin-inventory.component.scss',
})
export class AdminInventoryComponent implements OnInit, OnDestroy {

  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);
  private readonly productService = inject(ProductService);
  private readonly scannerService = inject(ScannerService);
  private readonly http = inject(HttpClient);

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.inventoryService.loadFromApi();
    }, { allowSignalWrites: true });
  }

  //#region Properties

  private readonly destroy$ = new Subject<void>();
  private scanSubscription?: Subscription;

  readonly items = this.inventoryService.items;
  readonly isLoading = this.inventoryService.isLoading;

  // ---- Quick stock dialog (barcode scan) ----
  readonly scannedProduct = signal<Product | null>(null);
  readonly showQuickStockDialog = signal(false);
  readonly quickStockAmount = signal(1);

  // ---- Item dialog ----
  readonly showItemDialog = signal(false);
  readonly editingItem = signal<InventoryItem | null>(null);
  form: ItemForm = this.emptyItemForm();

  // ---- History dialog ----
  readonly showHistoryDialog = signal(false);
  readonly historyItem = signal<InventoryItem | null>(null);
  readonly movements = signal<InventoryMovement[]>([]);
  readonly loadingMovements = signal(false);

  // ---- Movement dialog ----
  readonly showMovementDialog = signal(false);
  readonly movementItemId = signal(0);
  readonly movementType = signal<'in' | 'out'>('in');
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

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.inventoryService.loadFromApi();
    this.startScannerListener();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.scannerService.stopListening();
  }

  //#endregion

  //#region Item Dialog

  /** Opens dialog to create new item */
  openNewItemDialog(): void {
    this.editingItem.set(null);
    this.form = this.emptyItemForm();
    this.showItemDialog.set(true);
  }

  /** Opens dialog to edit existing item */
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

  /** Saves item (create or update) */
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

  /** Opens movement dialog for stock entry */
  openEntryDialog(item: InventoryItem): void {
    this.movementItemId.set(item.id);
    this.movementType.set('in');
    this.movementForm = { quantity: 0, reason: '' };
    this.showMovementDialog.set(true);
  }

  /** Opens movement dialog for stock withdrawal */
  openExitDialog(item: InventoryItem): void {
    this.movementItemId.set(item.id);
    this.movementType.set('out');
    this.movementForm = { quantity: 0, reason: '' };
    this.showMovementDialog.set(true);
  }

  /** Saves the stock movement */
  async saveMovement(): Promise<void> {
    if (this.movementForm.quantity <= 0) return;

    try {
      await this.inventoryService.addMovement(
        this.movementItemId(),
        this.movementType(),
        this.movementForm.quantity,
        this.movementForm.reason.trim() || undefined,
      );
      const label = this.movementType() === 'in' ? 'Entrada' : 'Salida';
      this.messageService.add({ severity: 'success', summary: `${label} registrada`, life: 3000 });
      this.showMovementDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al registrar movimiento', life: 3000 });
    }
  }

  //#endregion

  //#region History Dialog

  /** Opens movement history dialog for an inventory item */
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

  /** Returns display label for movement type */
  movementTypeLabel(type: string): string {
    switch (type) {
      case 'in':         return 'Entrada';
      case 'out':        return 'Salida';
      case 'adjustment': return 'Ajuste';
      default:           return type;
    }
  }

  /** Returns CSS class for movement type badge */
  movementTypeSeverity(type: string): string {
    switch (type) {
      case 'in':         return 'movement-badge--in';
      case 'out':        return 'movement-badge--out';
      case 'adjustment': return 'movement-badge--adj';
      default:           return '';
    }
  }

  //#endregion

  //#region Scanner Integration

  /**
   * Starts scanner listener for inventory screen.
   * On scan: finds product and opens quick stock reception dialog.
   */
  private startScannerListener(): void {
    this.scanSubscription = this.scannerService.onScan()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => this.handleBarcodeScan(code));

    this.scannerService.startListening();
  }

  /**
   * Handles a scanned barcode in inventory context.
   * Opens quick stock dialog for the found product.
   * @param code The scanned barcode string
   */
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

  /**
   * Confirms quick stock reception for the scanned product.
   * Adds quickStockAmount units to current stock via product movements.
   */
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

  /** Cancels quick stock dialog */
  cancelQuickStock(): void {
    this.showQuickStockDialog.set(false);
    this.scannedProduct.set(null);
  }

  //#endregion

  //#region Helpers

  /** Returns true if item is at or below low-stock threshold */
  isLowStock(item: InventoryItem): boolean {
    return item.currentStock <= item.lowStockThreshold;
  }

  private emptyItemForm(): ItemForm {
    return { name: '', unit: 'pza', currentStock: 0, lowStockThreshold: 5, costPesos: 0 };
  }

  //#endregion
}
