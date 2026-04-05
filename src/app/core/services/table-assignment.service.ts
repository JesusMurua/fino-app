import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

import { DatabaseService } from './database.service';
import { OrderContextService } from './order-context.service';
import { SyncService } from './sync.service';

/**
 * Handles optimistic Dexie mutations for assigning a table to an order.
 *
 * Combines writes to both `orders` and `restaurantTables` in a single
 * Dexie transaction for atomicity. Provides rollback when the backend
 * returns a 409 Conflict (table already taken by another device).
 */
@Injectable({ providedIn: 'root' })
export class TableAssignmentService {

  private readonly db = inject(DatabaseService);
  private readonly syncService = inject(SyncService);
  private readonly orderContext = inject(OrderContextService);
  private readonly messageService = inject(MessageService);

  //#region Public Methods

  /**
   * Assigns a table to an existing order via optimistic Dexie update.
   *
   * 1. Validates order exists and has no table, table exists and is available
   * 2. Atomic Dexie transaction: update order + table status
   * 3. Patches in-memory OrderContextService signal
   * 4. Triggers background sync (fire-and-forget)
   *
   * @returns true if local write succeeded, false on validation or Dexie error
   */
  async assignTable(orderId: string, tableId: number, tableName: string): Promise<boolean> {
    // Pre-validation
    const order = await this.db.orders.get(orderId);
    if (!order) {
      this.messageService.add({ severity: 'warn', summary: 'Orden no encontrada', life: 3000 });
      return false;
    }
    if (order.tableId != null) {
      this.messageService.add({ severity: 'warn', summary: 'La orden ya tiene mesa asignada', life: 3000 });
      return false;
    }

    const table = await this.db.restaurantTables.get(tableId);
    if (!table || table.status !== 'available') {
      this.messageService.add({ severity: 'warn', summary: 'Mesa no disponible', life: 3000 });
      return false;
    }

    try {
      // Atomic Dexie transaction — both writes succeed or neither does
      await this.db.transaction('rw', this.db.orders, this.db.restaurantTables, async () => {
        await this.db.orders.update(orderId, {
          tableId,
          tableName,
          syncStatus: 'Pending',
          lastSyncAttempt: undefined,
          retryCount: 0,
        });
        await this.db.restaurantTables.update(tableId, {
          status: 'occupied' as const,
          orderId,
        });
      });

      // Patch in-memory signal
      this.orderContext.updateTableAssignment(tableId, tableName);

      // Fire-and-forget background sync
      this.syncService.syncPendingOrders();

      return true;
    } catch (err) {
      console.error('[TableAssignmentService] Dexie transaction failed:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'Error al asignar mesa',
        detail: 'Intenta de nuevo.',
        life: 4000,
      });
      return false;
    }
  }

  /**
   * Reverts an optimistic table assignment after a 409 Conflict.
   *
   * Called by SyncService when the backend rejects the order because
   * another device already claimed the table.
   *
   * 1. Atomic Dexie transaction: clear order tableId + restore table status
   * 2. Patches in-memory signal (if active order matches)
   * 3. Shows error toast to the cashier
   */
  async revertTableAssignment(orderId: string, tableId: number): Promise<void> {
    try {
      await this.db.transaction('rw', this.db.orders, this.db.restaurantTables, async () => {
        await this.db.orders.update(orderId, {
          tableId: undefined,
          tableName: undefined,
          syncStatus: 'Pending',
          retryCount: 0,
        });
        await this.db.restaurantTables.update(tableId, {
          status: 'available' as const,
          orderId: undefined,
        });
      });

      // Patch in-memory signal if the reverted order is the active one
      const active = this.orderContext.activeOrder();
      if (active?.id === orderId) {
        this.orderContext.updateTableAssignment(null, null);
      }

      this.messageService.add({
        severity: 'error',
        summary: 'Mesa ya ocupada',
        detail: 'Otra orden ya tomó esta mesa. Se revirtió la asignación.',
        life: 5000,
      });
    } catch (err) {
      console.error('[TableAssignmentService] Revert failed:', err);
    }
  }

  //#endregion

}
