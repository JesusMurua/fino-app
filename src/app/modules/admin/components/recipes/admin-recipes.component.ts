import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import { Product, ProductConsumption } from '../../../../core/models';
import { InventoryConsumptionService } from '../../../../core/services/inventory-consumption.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { ProductService } from '../../../../core/services/product.service';

@Component({
  selector: 'app-admin-recipes',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    SkeletonModule,
    TableModule,
    TooltipModule,
  ],
  templateUrl: './admin-recipes.component.html',
  styleUrl: './admin-recipes.component.scss',
  providers: [ConfirmationService],
})
export class AdminRecipesComponent implements OnInit {

  private readonly inventoryService = inject(InventoryService);
  private readonly consumptionService = inject(InventoryConsumptionService);
  private readonly productService = inject(ProductService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  //#region Signals — Master (Product List)

  /** All products from the catalog (shared signal from ProductService) */
  readonly products = this.productService.products;

  /** Text filter for the master product list */
  readonly productSearch = signal('');

  /** Products filtered by name search — recomputes reactively */
  readonly filteredProducts = computed(() => {
    const term = this.productSearch().toLowerCase().trim();
    if (!term) return this.products();
    return this.products().filter(p =>
      p.name.toLowerCase().includes(term)
    );
  });

  /** Currently selected product in the Master panel */
  readonly selectedProduct = signal<Product | null>(null);

  //#endregion

  //#region Signals — Detail (Recipe Lines)

  /** Consumption records for the selected product */
  readonly consumptions = signal<ProductConsumption[]>([]);

  /** Whether the consumption list is being fetched */
  readonly isLoadingDetail = signal(false);

  /** Whether an add-line save is in progress */
  readonly isSaving = signal(false);

  /** ID of the line currently being saved/deleted inline (shows spinner) */
  readonly savingLineId = signal<number | null>(null);

  //#endregion

  //#region Signals — Add Line Form

  /** Selected inventory item ID for the new consumption line */
  readonly newLineItemId = signal<number | null>(null);

  /** Quantity per sale for the new consumption line */
  readonly newLineQty = signal<number>(1);

  /** Controls visibility of the inline add-line form */
  readonly showAddForm = signal(false);

  //#endregion

  //#region Signals — Inline Edit Tracking

  /**
   * Tracks in-progress edits for quantityPerSale per line ID.
   * Keys are consumption line IDs; values are the current input value.
   * Separate from the consumptions signal to avoid noisy updates on every keystroke.
   */
  readonly editQuantities = signal<Record<number, number>>({});

  //#endregion

  //#region Computed

  /**
   * Calculates the total production cost of the selected product in cents.
   * Crosses consumption lines with InventoryService.items() (already in memory).
   * Purely synchronous — triggers no HTTP calls.
   */
  readonly totalCostCents = computed(() => {
    const lines = this.consumptions();
    const allItems = this.inventoryService.items();
    return lines.reduce((sum, line) => {
      const item = allItems.find(i => i.id === line.inventoryItemId);
      if (!item) return sum;
      return sum + Math.round(item.costCents * line.quantityPerSale);
    }, 0);
  });

  /**
   * Inventory items that can be added: active items not already in the recipe.
   * Recomputes whenever consumptions or inventoryService.items() changes.
   */
  readonly availableItems = computed(() => {
    const usedIds = new Set(this.consumptions().map(c => c.inventoryItemId));
    return this.inventoryService.items()
      .filter(i => i.isActive && !usedIds.has(i.id))
      .map(i => ({ label: `${i.name} (${i.unit})`, value: i.id }));
  });

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    // Ensure inventory items are in memory for cost calculations and dropdowns.
    // AdminShellComponent loads them on init, so this is a safety net.
    if (this.inventoryService.items().length === 0) {
      await this.inventoryService.loadFromApi();
    }
  }

  //#endregion

  //#region Master — Product Selection

  /**
   * Selects a product and loads its consumption rules.
   * Resets the add-form and clears previous lines on every selection.
   * @param product The product to view/edit recipe for
   */
  async selectProduct(product: Product): Promise<void> {
    if (this.selectedProduct()?.id === product.id) return;
    this.selectedProduct.set(product);
    this.showAddForm.set(false);
    this.editQuantities.set({});
    await this.loadConsumptions(product.id);
  }

  //#endregion

  //#region Detail — Load Consumptions

  /**
   * Fetches consumption rules for the given product ID.
   * @param productId Target product
   */
  private async loadConsumptions(productId: number): Promise<void> {
    this.isLoadingDetail.set(true);
    this.consumptions.set([]);
    try {
      const data = await this.consumptionService.getByProduct(productId);
      this.consumptions.set(data);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo cargar la ficha técnica',
        life: 3000,
      });
    } finally {
      this.isLoadingDetail.set(false);
    }
  }

  //#endregion

  //#region Detail — Inline Edit (quantityPerSale)

  /**
   * Captures a keystroke change in the quantity input, storing it locally
   * without immediately saving to the API.
   * @param lineId The consumption line ID
   * @param value  The new value from the input
   */
  onQtyChange(lineId: number, value: number): void {
    this.editQuantities.update(q => ({ ...q, [lineId]: value }));
  }

  /**
   * Returns the quantity to display for a line — falls back to persisted value
   * from the signal if the user hasn't started editing.
   * @param lineId    Consumption line ID
   * @param savedQty  The persisted quantityPerSale from the signal
   */
  getEditQty(lineId: number, savedQty: number): number {
    return this.editQuantities()[lineId] ?? savedQty;
  }

  /**
   * Saves the draft quantity to the API on input blur.
   * Skips if unchanged or invalid.
   * @param line The consumption line being updated
   */
  async saveLineQty(line: ProductConsumption): Promise<void> {
    const newQty = this.editQuantities()[line.id];
    if (newQty === undefined || newQty <= 0 || newQty === line.quantityPerSale) return;

    this.savingLineId.set(line.id);
    try {
      const updated = await this.consumptionService.update(line.id, newQty);
      // Update the stored line in place; also clear the draft edit
      this.consumptions.update(lines =>
        lines.map(l => l.id === line.id ? { ...l, quantityPerSale: updated.quantityPerSale } : l)
      );
      this.editQuantities.update(q => {
        const copy = { ...q };
        delete copy[line.id];
        return copy;
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo actualizar la cantidad',
        life: 3000,
      });
    } finally {
      this.savingLineId.set(null);
    }
  }

  //#endregion

  //#region Detail — Add Line

  /** Opens the inline add-line form and resets its fields */
  openAddForm(): void {
    this.newLineItemId.set(null);
    this.newLineQty.set(1);
    this.showAddForm.set(true);
  }

  /** Cancels the add-line form without saving */
  cancelAddForm(): void {
    this.showAddForm.set(false);
  }

  /** Validates and submits a new consumption line for the selected product */
  async addLine(): Promise<void> {
    const product = this.selectedProduct();
    const itemId = this.newLineItemId();
    const qty = this.newLineQty();

    if (!product || !itemId || qty <= 0) return;

    // Guard against duplicates (availableItems already excludes them, but double-check)
    if (this.consumptions().some(c => c.inventoryItemId === itemId)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Insumo duplicado',
        detail: 'Este insumo ya está en la ficha técnica',
        life: 3000,
      });
      return;
    }

    this.isSaving.set(true);
    try {
      const created = await this.consumptionService.create(product.id, itemId, qty);
      // Enrich with inventoryItem reference for the helper methods
      const invItem = this.inventoryService.items().find(i => i.id === itemId);
      this.consumptions.update(lines => [...lines, { ...created, inventoryItem: invItem }]);
      this.showAddForm.set(false);
      this.messageService.add({ severity: 'success', summary: 'Insumo agregado', life: 3000 });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo agregar el insumo',
        life: 3000,
      });
    } finally {
      this.isSaving.set(false);
    }
  }

  //#endregion

  //#region Detail — Delete Line

  /**
   * Shows a confirmation dialog before deleting a consumption line.
   * @param line The consumption line to remove
   */
  confirmDeleteLine(line: ProductConsumption): void {
    const name = this.getItemName(line);
    this.confirmationService.confirm({
      message: `¿Quitar <b>${name}</b> de la ficha técnica?`,
      header: 'Confirmar eliminación',
      icon: 'pi pi-trash',
      acceptLabel: 'Quitar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.deleteLine(line.id),
    });
  }

  /**
   * Deletes a consumption line via API and removes it from the local signal.
   * @param id The consumption rule ID
   */
  private async deleteLine(id: number): Promise<void> {
    this.savingLineId.set(id);
    try {
      await this.consumptionService.delete(id);
      this.consumptions.update(lines => lines.filter(l => l.id !== id));
      this.messageService.add({ severity: 'success', summary: 'Insumo eliminado', life: 3000 });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo eliminar el insumo',
        life: 3000,
      });
    } finally {
      this.savingLineId.set(null);
    }
  }

  //#endregion

  //#region Helpers

  /**
   * Returns the display name of the inventory item for a consumption line.
   * Looks up via the in-memory items signal first; falls back to the embedded ref.
   * @param line The consumption line
   */
  getItemName(line: ProductConsumption): string {
    const item = this.inventoryService.items().find(i => i.id === line.inventoryItemId);
    return item?.name ?? line.inventoryItem?.name ?? '—';
  }

  /**
   * Returns the unit of measure for a consumption line's inventory item.
   * @param line The consumption line
   */
  getItemUnit(line: ProductConsumption): string {
    const item = this.inventoryService.items().find(i => i.id === line.inventoryItemId);
    return item?.unit ?? line.inventoryItem?.unit ?? '';
  }

  /**
   * Returns the costCents per unit for a consumption line's inventory item.
   * Returns 0 if the item is not found or has no cost registered.
   * @param line The consumption line
   */
  getItemCostCents(line: ProductConsumption): number {
    const item = this.inventoryService.items().find(i => i.id === line.inventoryItemId);
    return item?.costCents ?? 0;
  }

  /**
   * Returns the subtotal in cents for a single consumption line:
   * costCents per unit × quantityPerSale.
   * @param line The consumption line
   */
  getLineSubtotalCents(line: ProductConsumption): number {
    return Math.round(this.getItemCostCents(line) * line.quantityPerSale);
  }

  /** Whether a product is the currently selected one */
  isSelected(product: Product): boolean {
    return this.selectedProduct()?.id === product.id;
  }

  //#endregion
}
