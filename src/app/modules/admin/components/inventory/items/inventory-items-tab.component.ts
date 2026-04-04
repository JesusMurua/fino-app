import { Component, effect, inject, OnInit } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { InventoryItem } from '../../../../../core/models';
import { AuthService } from '../../../../../core/services/auth.service';
import { InventoryService } from '../../../../../core/services/inventory.service';
import { InventoryItemsTableComponent } from './inventory-items-table.component';

/**
 * Smart container for the Inventory Items tab.
 * Owns the data loading lifecycle and delegates rendering to the table component.
 */
@Component({
  selector: 'app-inventory-items-tab',
  standalone: true,
  imports: [ButtonModule, InventoryItemsTableComponent],
  template: `
    <!-- Toolbar -->
    <div class="flex align-items-center justify-content-between mb-4">
      <span class="text-500 text-sm">
        {{ items().length }} item(s)
      </span>
      <p-button
        label="New Item"
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
  `,
})
export class InventoryItemsTabComponent implements OnInit {

  //#region Injections

  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);

  //#endregion

  //#region Signals

  readonly items = this.inventoryService.items;
  readonly isLoading = this.inventoryService.isLoading;

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

  //#region Actions (Phase 2 will connect these to dialog components)

  onNewItem(): void {
    // TODO: Phase 2 — open InventoryItemFormDialogComponent in create mode
  }

  onEdit(item: InventoryItem): void {
    // TODO: Phase 2 — open InventoryItemFormDialogComponent in edit mode
    console.log('[InventoryItemsTab] Edit:', item.name);
  }

  onAddStock(item: InventoryItem): void {
    // TODO: Phase 2 — open InventoryMovementDialogComponent with type 'in'
    console.log('[InventoryItemsTab] Add stock:', item.name);
  }

  onRemoveStock(item: InventoryItem): void {
    // TODO: Phase 2 — open InventoryMovementDialogComponent with type 'out'
    console.log('[InventoryItemsTab] Remove stock:', item.name);
  }

  onViewHistory(item: InventoryItem): void {
    // TODO: Phase 2 — open movement history
    console.log('[InventoryItemsTab] View history:', item.name);
  }

  //#endregion
}
