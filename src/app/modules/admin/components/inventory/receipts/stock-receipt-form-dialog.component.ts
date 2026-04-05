import {
  Component,
  computed,
  DestroyRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  signal,
  SimpleChanges,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, concatMap, EMPTY, merge, of, Subject, Subscription } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import {
  CreateStockReceiptItemRequest,
  CreateStockReceiptRequest,
  InventoryItem,
  Product,
  Supplier,
} from '../../../../../core/models';
import { InventoryService } from '../../../../../core/services/inventory.service';
import { ProductService } from '../../../../../core/services/product.service';
import { ScannerService } from '../../../../../core/services/scanner.service';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A line item in the receipt form (editable) */
interface ReceiptLine {
  inventoryItemId?: number;
  productId?: number;
  name: string;
  quantity: number;
  costPesos: number;
}

/** Result of resolving a scan code to an item */
interface ResolvedItem {
  inventoryItemId?: number;
  productId?: number;
  name: string;
}

/** Dropdown option for the combined item picker */
interface StockItemOption {
  label: string;
  value: string;
  name: string;
}

/**
 * Smart dialog for creating a new stock receipt.
 *
 * Scanner architecture:
 *   - Hardware scans (ScannerService.onScan()) and manual text-input Enter events
 *     are merged into a single RxJS stream.
 *   - The stream uses `concatMap` to queue scans sequentially so no barcode is
 *     lost or cancelled while an API lookup is in flight.
 *   - Inner errors (404, timeout) are caught individually to keep the stream alive.
 */
@Component({
  selector: 'app-stock-receipt-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    TableModule,
    TooltipModule,
  ],
  templateUrl: './stock-receipt-form-dialog.component.html',
  styleUrl: './stock-receipt-form-dialog.component.scss',
})
export class StockReceiptFormDialogComponent implements OnChanges, OnDestroy {

  //#region Injections

  private readonly inventoryService = inject(InventoryService);
  private readonly productService = inject(ProductService);
  private readonly scannerService = inject(ScannerService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  //#endregion

  //#region Inputs / Outputs

  @Input() visible = false;
  @Input() suppliers: Supplier[] = [];

  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly save = new EventEmitter<CreateStockReceiptRequest>();

  //#endregion

  //#region State — Form Header

  selectedSupplierId = signal<number | null>(null);
  notes = signal('');

  //#endregion

  //#region State — Lines

  readonly lines = signal<ReceiptLine[]>([]);

  /** Grand total in cents — computed reactively from lines */
  readonly totalCents = computed(() =>
    this.lines().reduce(
      (sum, line) => sum + Math.round(line.costPesos * 100) * line.quantity,
      0,
    ),
  );

  readonly isSaving = signal(false);

  //#endregion

  //#region State — Scanner

  readonly scanInput = signal('');

  //#endregion

  //#region State — Item Picker

  readonly showItemPicker = signal(false);
  pickerSelectedItem: string | null = null;
  pickerQuantity = 1;
  pickerCostPesos = 0;

  /** Combined dropdown options: inventory items + products with trackStock */
  readonly stockItemOptions = computed<StockItemOption[]>(() => {
    const invItems = this.inventoryService.items()
      .filter((i) => i.isActive)
      .map((i) => ({ label: `${i.name} (insumo)`, value: `inv:${i.id}`, name: i.name }));
    const prodItems = this.productService.products()
      .filter((p) => p.trackStock)
      .map((p) => ({ label: `${p.name} (producto)`, value: `prod:${p.id}`, name: p.name }));
    return [...invItems, ...prodItems];
  });

  /** Supplier options for the form dropdown */
  readonly supplierOptions = computed(() =>
    this.suppliers.filter((s) => s.isActive).map((s) => ({ label: s.name, value: s.id })),
  );

  //#endregion

  //#region Scanner Queue

  /** Manual input subject — emits when user presses Enter in the scan field */
  private readonly manualScan$ = new Subject<string>();

  /** Subscription to the merged scanner stream */
  private scanQueueSub: Subscription | null = null;

  //#endregion

  //#region Lifecycle

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      if (this.visible) {
        this.resetForm();
        this.startScannerQueue();
      } else {
        this.stopScannerQueue();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopScannerQueue();
  }

  //#endregion

  //#region Scanner Queue Setup

  /**
   * Merges hardware scanner events and manual text-input events into
   * a single sequential queue using concatMap.
   */
  private startScannerQueue(): void {
    this.scannerService.startListening();

    const hardware$ = this.scannerService.onScan();

    this.scanQueueSub = merge(hardware$, this.manualScan$)
      .pipe(
        concatMap((code) => this.resolveAndAddItem(code)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private stopScannerQueue(): void {
    this.scanQueueSub?.unsubscribe();
    this.scanQueueSub = null;
    this.scannerService.stopListening();
  }

  //#endregion

  //#region Scanner Resolution

  /**
   * Resolves a scanned code to an item using a two-step strategy:
   *   1. Local lookup by name (case-insensitive) in the combined options.
   *   2. API fallback via ProductService.findByBarcode().
   *
   * Returns an Observable that always completes (errors are caught internally).
   */
  private resolveAndAddItem(code: string) {
    const localMatch = this.findLocalByNameOrBarcode(code);
    if (localMatch) {
      this.addOrIncrementLine(localMatch);
      return of(null);
    }

    // API fallback — barcode lookup
    return this.productService.findByBarcode(code).pipe(
      concatMap((product) => {
        if (!product) {
          this.messageService.add({
            severity: 'warn',
            summary: 'No encontrado',
            detail: `"${code}" no corresponde a ningún producto o insumo`,
            life: 4000,
          });
          return EMPTY;
        }

        if (!product.trackStock) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Sin control de stock',
            detail: `"${product.name}" no tiene control de inventario activado`,
            life: 4000,
          });
          return EMPTY;
        }

        this.addOrIncrementLine({
          productId: product.id,
          name: product.name,
        });
        return of(null);
      }),
      catchError(() => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error de búsqueda',
          detail: `No se pudo buscar "${code}"`,
          life: 4000,
        });
        return EMPTY;
      }),
    );
  }

  /**
   * Attempts to find an item locally by exact name match (case-insensitive)
   * or by barcode match in the products signal.
   */
  private findLocalByNameOrBarcode(code: string): ResolvedItem | null {
    const lowerCode = code.toLowerCase();

    // Check inventory items by name
    const invItem = this.inventoryService.items().find(
      (i) => i.isActive && i.name.toLowerCase() === lowerCode,
    );
    if (invItem) {
      return { inventoryItemId: invItem.id, name: invItem.name };
    }

    // Check products by name or barcode
    const product = this.productService.products().find(
      (p) =>
        p.trackStock &&
        (p.name.toLowerCase() === lowerCode || (p.barcode && p.barcode === code)),
    );
    if (product) {
      return { productId: product.id, name: product.name };
    }

    return null;
  }

  //#endregion

  //#region Line Management

  /**
   * Adds a new line or increments quantity if the item already exists.
   * Shows a success toast.
   */
  private addOrIncrementLine(item: ResolvedItem): void {
    const current = this.lines();
    const existingIndex = current.findIndex(
      (l) =>
        (item.inventoryItemId && l.inventoryItemId === item.inventoryItemId) ||
        (item.productId && l.productId === item.productId),
    );

    if (existingIndex >= 0) {
      const updated = [...current];
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: updated[existingIndex].quantity + 1,
      };
      this.lines.set(updated);
      this.messageService.add({
        severity: 'info',
        summary: item.name,
        detail: `Cantidad: ${updated[existingIndex].quantity}`,
        life: 2000,
      });
    } else {
      this.lines.set([
        ...current,
        {
          inventoryItemId: item.inventoryItemId,
          productId: item.productId,
          name: item.name,
          quantity: 1,
          costPesos: 0,
        },
      ]);
      this.messageService.add({
        severity: 'success',
        summary: 'Agregado',
        detail: item.name,
        life: 2000,
      });
    }
  }

  /** Removes a line by index */
  removeLine(index: number): void {
    const updated = [...this.lines()];
    updated.splice(index, 1);
    this.lines.set(updated);
  }

  /** Triggers reactivity after inline edit of quantity/cost */
  onLineChange(): void {
    this.lines.set([...this.lines()]);
  }

  /** Computes a single line total in cents */
  lineTotalCents(line: ReceiptLine): number {
    return Math.round(line.costPesos * 100) * line.quantity;
  }

  //#endregion

  //#region Manual Scan Input

  /** Fires the manual scan subject when user presses Enter in the input */
  onScanKeyEnter(): void {
    const code = this.scanInput().trim();
    if (code) {
      this.manualScan$.next(code);
      this.scanInput.set('');
    }
  }

  //#endregion

  //#region Item Picker

  openItemPicker(): void {
    this.pickerSelectedItem = null;
    this.pickerQuantity = 1;
    this.pickerCostPesos = 0;
    this.showItemPicker.set(true);
  }

  addFromPicker(): void {
    if (!this.pickerSelectedItem || this.pickerQuantity <= 0) return;

    const option = this.stockItemOptions().find((o) => o.value === this.pickerSelectedItem);
    if (!option) return;

    const [type, idStr] = this.pickerSelectedItem.split(':');
    const id = Number(idStr);

    const current = this.lines();
    current.push({
      inventoryItemId: type === 'inv' ? id : undefined,
      productId: type === 'prod' ? id : undefined,
      name: option.name,
      quantity: this.pickerQuantity,
      costPesos: this.pickerCostPesos,
    });
    this.lines.set([...current]);

    this.messageService.add({
      severity: 'success',
      summary: 'Agregado',
      detail: option.name,
      life: 2000,
    });
    this.showItemPicker.set(false);
  }

  //#endregion

  //#region Form Actions

  /** Builds the CreateStockReceiptRequest and emits it */
  onConfirm(): void {
    const currentLines = this.lines();
    if (currentLines.length === 0) return;

    const items: CreateStockReceiptItemRequest[] = currentLines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      productId: line.productId,
      quantity: line.quantity,
      costCents: Math.round(line.costPesos * 100),
    }));

    const payload: CreateStockReceiptRequest = {
      supplierId: this.selectedSupplierId() ?? undefined,
      notes: this.notes().trim() || undefined,
      items,
    };

    this.save.emit(payload);
  }

  //#endregion

  //#region Helpers

  private resetForm(): void {
    this.selectedSupplierId.set(null);
    this.notes.set('');
    this.lines.set([]);
    this.scanInput.set('');
    this.isSaving.set(false);
    this.pickerSelectedItem = null;
    this.pickerQuantity = 1;
    this.pickerCostPesos = 0;
    this.showItemPicker.set(false);
  }

  //#endregion
}
