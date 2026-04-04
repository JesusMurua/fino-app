import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';

import { InventoryItem } from '../../../../../core/models';
import { AuthService } from '../../../../../core/services/auth.service';
import { InventoryService } from '../../../../../core/services/inventory.service';
import { InventoryItemFormDialogComponent, ItemFormPayload } from './inventory-item-form-dialog.component';
import { InventoryMovementDialogComponent, MovementFormPayload } from './inventory-movement-dialog.component';
import { InventoryItemsTableComponent } from './inventory-items-table.component';

/**
 * Smart container for the Inventory Items tab.
 * Owns the data loading lifecycle, dialog state, and delegates rendering
 * to presentational child components.
 */
@Component({
  selector: 'app-inventory-items-tab',
  standalone: true,
  imports: [
    ButtonModule,
    ToastModule,
    InventoryItemsTableComponent,
    InventoryItemFormDialogComponent,
    InventoryMovementDialogComponent,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <!-- Toolbar -->
    <div class="flex align-items-center justify-content-between mb-4">
      <span class="text-500 text-sm">
        {{ items().length }} artículo(s)
      </span>
      <p-button
        label="Nuevo artículo"
        icon="pi pi-plus"
        (onClick)="onNewItem()"
      />
    </div>

    <!-- Table -->
    <div class="border-round-xl shadow-1 surface-card overflow-hidden">
      <app-inventory-items-table
        [items]="items()"
        [isLoading]="isLoading()"
        (edit)="onEdit($event)"
        (addStock)="onAddStock($event)"
        (removeStock)="onRemoveStock($event)"
        (viewHistory)="onViewHistory($event)"
      />
    </div>

    <!-- Item create/edit dialog -->
    <app-inventory-item-form-dialog
      [item]="editingItem()"
      [visible]="showItemDialog()"
      (visibleChange)="showItemDialog.set($event)"
      (save)="saveItem($event)"
    />

    <!-- Movement entry/exit dialog -->
    <app-inventory-movement-dialog
      [item]="movementTarget()"
      [movementType]="movementType()"
      [visible]="showMovementDialog()"
      (visibleChange)="showMovementDialog.set($event)"
      (save)="saveMovement($event)"
    />
  `,
})
export class InventoryItemsTabComponent implements OnInit {

  //#region Injections

  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);

  //#endregion

  //#region Signals — Data

  readonly items = this.inventoryService.items;
  readonly isLoading = this.inventoryService.isLoading;

  //#endregion

  //#region Signals — Item Dialog

  readonly showItemDialog = signal(false);
  readonly editingItem = signal<InventoryItem | null>(null);

  //#endregion

  //#region Signals — Movement Dialog

  readonly showMovementDialog = signal(false);
  readonly movementTarget = signal<InventoryItem | null>(null);
  readonly movementType = signal<'in' | 'out'>('in');

  //#endregion

  //#region Lifecycle

  constructor() {
    /** Reload inventory when the active branch changes */
    effect(() => {
      this.authService.activeBranchId();
      void this.inventoryService.loadFromApi();
    });
  }

  ngOnInit(): void {
    void this.inventoryService.loadFromApi();
  }

  //#endregion

  //#region Item Dialog Actions

  onNewItem(): void {
    this.editingItem.set(null);
    this.showItemDialog.set(true);
  }

  onEdit(item: InventoryItem): void {
    this.editingItem.set(item);
    this.showItemDialog.set(true);
  }

  async saveItem(payload: ItemFormPayload): Promise<void> {
    try {
      const editing = this.editingItem();
      if (editing) {
        await this.inventoryService.update(editing.id, {
          name: payload.name,
          unit: payload.unit,
          lowStockThreshold: payload.lowStockThreshold,
          costCents: payload.costCents,
          isActive: true,
        });
        this.messageService.add({ severity: 'success', summary: 'Artículo actualizado', life: 3000 });
      } else {
        await this.inventoryService.create({
          name: payload.name,
          unit: payload.unit,
          currentStock: payload.currentStock,
          lowStockThreshold: payload.lowStockThreshold,
          costCents: payload.costCents,
          isActive: true,
        });
        this.messageService.add({ severity: 'success', summary: 'Artículo creado', life: 3000 });
      }
      this.showItemDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al guardar artículo', life: 4000 });
    }
  }

  //#endregion

  //#region Movement Dialog Actions

  onAddStock(item: InventoryItem): void {
    this.movementTarget.set(item);
    this.movementType.set('in');
    this.showMovementDialog.set(true);
  }

  onRemoveStock(item: InventoryItem): void {
    this.movementTarget.set(item);
    this.movementType.set('out');
    this.showMovementDialog.set(true);
  }

  async saveMovement(payload: MovementFormPayload): Promise<void> {
    const target = this.movementTarget();
    if (!target) return;

    try {
      await this.inventoryService.addMovement(
        target.id,
        this.movementType(),
        payload.quantity,
        payload.reason || undefined,
      );
      const label = this.movementType() === 'in' ? 'Entrada' : 'Salida';
      this.messageService.add({ severity: 'success', summary: `${label} registrada`, life: 3000 });
      this.showMovementDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al registrar movimiento', life: 4000 });
    }
  }

  //#endregion

  //#region History (placeholder — Phase 2 extension)

  onViewHistory(item: InventoryItem): void {
    // TODO: Phase 2 extension — movement history dialog
    console.log('[InventoryItemsTab] View history:', item.name);
  }

  //#endregion
}
