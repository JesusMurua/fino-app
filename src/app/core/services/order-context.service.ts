import { Injectable, computed, signal } from '@angular/core';

import { Order } from '../models';

/**
 * Centralized signal-based tracking of the "active order" in the POS.
 *
 * Replaces scattered sessionStorage reads for `addingToOrder` and
 * `activeTable` with reactive signals that the cart-panel and other
 * components can bind to directly.
 *
 * Used by:
 *   - CartPanelComponent  → reads canAssignTable / activeTableName
 *   - TableAssignmentService → patches table assignment in-memory
 *   - SyncService (409 handler) → clears table on conflict revert
 */
@Injectable({ providedIn: 'root' })
export class OrderContextService {

  //#region Properties

  /** The order currently being modified/viewed in cart context */
  readonly activeOrder = signal<Order | null>(null);

  /** True when a table can be assigned (order exists, no table yet, sent to kitchen) */
  readonly canAssignTable = computed(() => {
    const order = this.activeOrder();
    return order !== null
      && order.tableId == null
      && order.kitchenStatusId != null;
  });

  /** Display name of the assigned table — null when no table */
  readonly activeTableName = computed(() =>
    this.activeOrder()?.tableName ?? null,
  );

  //#endregion

  //#region Methods

  /** Sets the active order (called after kitchen send or when loading addingToOrder context) */
  setActiveOrder(order: Order): void {
    this.activeOrder.set(order);
  }

  /** Resets to null (called on cart clear, cancel, or checkout complete) */
  clearActiveOrder(): void {
    this.activeOrder.set(null);
  }

  /**
   * Patches the active order signal in-memory with table data.
   * Does NOT write to Dexie — that is TableAssignmentService's job.
   */
  updateTableAssignment(tableId: number | null, tableName: string | null): void {
    const current = this.activeOrder();
    if (!current) return;

    this.activeOrder.set({
      ...current,
      tableId: tableId ?? undefined,
      tableName: tableName ?? undefined,
    });
  }

  //#endregion

}
