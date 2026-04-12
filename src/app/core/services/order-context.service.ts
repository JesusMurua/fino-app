import { Injectable, computed, signal } from '@angular/core';

import { Order } from '../models';

/** Table selection made before/while editing the active order */
export interface ActiveTableContext {
  tableId: number;
  tableName: string;
}

/** Context for adding items to an already-sent kitchen order */
export interface AddingToOrderContext {
  orderId: string;
  orderNumber: number;
}

const SS_ACTIVE_TABLE = 'activeTable';
const SS_ADDING_TO_ORDER = 'addingToOrder';

/**
 * Centralized signal-based tracking of the "active order" in the POS.
 *
 * Single source of truth for:
 *   - activeOrder    → the order being viewed/edited in cart context
 *   - activeTable    → table selected before the order is saved
 *   - addingToOrder  → context when appending items to an existing order
 *
 * All transient state is mirrored in sessionStorage internally so it
 * survives page refreshes. Components must NOT read sessionStorage directly —
 * they read the signals exposed here.
 */
@Injectable({ providedIn: 'root' })
export class OrderContextService {

  //#region Properties — activeOrder

  /** The order currently being modified/viewed in cart context */
  readonly activeOrder = signal<Order | null>(null);

  //#endregion

  //#region Properties — activeTable (sessionStorage-backed)

  private readonly _activeTable = signal<ActiveTableContext | null>(this.loadActiveTable());

  /** Table selected for the current order (from /tables navigation) */
  readonly activeTable = this._activeTable.asReadonly();

  //#endregion

  //#region Properties — addingToOrder (sessionStorage-backed)

  private readonly _addingToOrder = signal<AddingToOrderContext | null>(this.loadAddingToOrder());

  /** Context when appending items to an existing kitchen order */
  readonly addingToOrder = this._addingToOrder.asReadonly();

  //#endregion

  //#region Computed

  /** True when a table can be assigned (order exists, no table yet, sent to kitchen) */
  readonly canAssignTable = computed(() => {
    const order = this.activeOrder();
    return order !== null
      && order.tableId == null
      && order.kitchenStatusId != null;
  });

  /**
   * Display name of the assigned table.
   * Falls back across the three sources so templates can bind a single signal:
   *   1. Saved order's tableName (post-kitchen)
   *   2. Transient activeTable selection (pre-kitchen)
   *   3. null
   */
  readonly activeTableName = computed(() =>
    this.activeOrder()?.tableName
    ?? this._activeTable()?.tableName
    ?? null,
  );

  //#endregion

  //#region Methods — activeOrder

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

  //#region Methods — activeTable

  /** Sets the transient active table and mirrors to sessionStorage */
  setActiveTable(table: ActiveTableContext | null): void {
    this._activeTable.set(table);
    if (table) {
      sessionStorage.setItem(SS_ACTIVE_TABLE, JSON.stringify(table));
    } else {
      sessionStorage.removeItem(SS_ACTIVE_TABLE);
    }
  }

  /** Clears the transient active table (alias for setActiveTable(null)) */
  clearActiveTable(): void {
    this.setActiveTable(null);
  }

  //#endregion

  //#region Methods — addingToOrder

  /** Sets the adding-to-order context and mirrors to sessionStorage */
  setAddingToOrder(ctx: AddingToOrderContext | null): void {
    this._addingToOrder.set(ctx);
    if (ctx) {
      sessionStorage.setItem(SS_ADDING_TO_ORDER, JSON.stringify(ctx));
    } else {
      sessionStorage.removeItem(SS_ADDING_TO_ORDER);
    }
  }

  /** Clears the adding-to-order context */
  clearAddingToOrder(): void {
    this.setAddingToOrder(null);
  }

  //#endregion

  //#region Methods — bulk cleanup

  /**
   * Clears every piece of transient context in a single call.
   * Used by idle lock and PIN re-entry so the next user starts fresh.
   */
  clearAllContext(): void {
    this.clearActiveOrder();
    this.clearActiveTable();
    this.clearAddingToOrder();
  }

  //#endregion

  //#region Private — sessionStorage hydration

  private loadActiveTable(): ActiveTableContext | null {
    try {
      const raw = sessionStorage.getItem(SS_ACTIVE_TABLE);
      return raw ? (JSON.parse(raw) as ActiveTableContext) : null;
    } catch {
      return null;
    }
  }

  private loadAddingToOrder(): AddingToOrderContext | null {
    try {
      const raw = sessionStorage.getItem(SS_ADDING_TO_ORDER);
      return raw ? (JSON.parse(raw) as AddingToOrderContext) : null;
    } catch {
      return null;
    }
  }

  //#endregion

}
