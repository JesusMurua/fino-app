import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { RestaurantTable, TableStatusDto } from '../models';
import { DatabaseService } from './database.service';

/** Lightweight order summary returned by the by-table endpoint */
export interface OrderSummary {
  id: string;
  orderNumber: number;
  totalCents: number;
  kitchenStatus: string | null;
  deliveryStatus: string | null;
  createdAt: string;
  items: { id: number; productName: string; quantity: number }[];
}

/** Result of moving items between orders */
export interface MoveItemsResult {
  sourceOrder: { id: string; totalCents: number; itemCount: number };
  targetOrder: { id: string; totalCents: number; itemCount: number };
  sourceTableFreed: boolean;
}

/** Result of merging two orders (all items from source → target) */
export interface MergeOrdersResult {
  targetOrder: { id: string; totalCents: number; itemCount: number };
  sourceTableFreed: boolean;
  sourceTableName: string;
}

@Injectable({ providedIn: 'root' })
export class TableService {

  private readonly http = inject(HttpClient);
  private readonly db = inject(DatabaseService);
  private readonly baseUrl = environment.apiUrl;

  //#region Public Methods

  /**
   * Returns enriched table statuses from the backend.
   * Single endpoint replaces N+1 table + order queries.
   * @returns Observable of pre-computed TableStatusDto array
   */
  getTableStatuses(): Observable<TableStatusDto[]> {
    return this.http.get<TableStatusDto[]>(`${this.baseUrl}/table/status`);
  }

  /**
   * Moves selected items from one order to another.
   * @param sourceOrderId Source order UUID
   * @param targetOrderId Target order UUID
   * @param itemIds OrderItem IDs to move
   * @returns Result with updated order summaries and whether source table was freed
   */
  moveItems(
    sourceOrderId: string,
    targetOrderId: string,
    itemIds: number[],
  ): Observable<MoveItemsResult> {
    return this.http.post<MoveItemsResult>(
      `${this.baseUrl}/orders/${sourceOrderId}/move-items`,
      { targetOrderId, itemIds },
    );
  }

  /**
   * Merges source order into target order.
   * All items from source move to target. Source table is freed automatically.
   * @param targetOrderId The order that survives
   * @param sourceOrderId The order to absorb
   */
  mergeOrders(
    targetOrderId: string,
    sourceOrderId: string,
  ): Observable<MergeOrdersResult> {
    return this.http.post<MergeOrdersResult>(
      `${this.baseUrl}/orders/${targetOrderId}/merge`,
      { sourceOrderId },
    );
  }

  /**
   * Loads tables from API and caches in Dexie
   */
  async loadTables(branchId: number): Promise<void> {
    try {
      const tables = await firstValueFrom(
        this.http.get<RestaurantTable[]>(`${this.baseUrl}/table`)
      );
      await this.db.restaurantTables.clear();
      await this.db.restaurantTables.bulkPut(tables);
    } catch {
      console.warn('[TableService] API unavailable, using Dexie cache');
    }
  }

  /**
   * Gets all active tables from local Dexie cache
   */
  async getTables(branchId: number): Promise<RestaurantTable[]> {
    return this.db.restaurantTables
      .where('branchId').equals(branchId)
      .filter(t => t.isActive === true)
      .sortBy('name');
  }

  /**
   * Gets all tables including inactive (for admin)
   */
  async getAllTables(branchId: number): Promise<RestaurantTable[]> {
    try {
      return await firstValueFrom(
        this.http.get<RestaurantTable[]>(
          `${this.baseUrl}/table?includeInactive=true`
        )
      );
    } catch {
      return this.db.restaurantTables
        .where('branchId').equals(branchId)
        .sortBy('name');
    }
  }

  /**
   * Creates a new table
   */
  async createTable(
    branchId: number,
    table: Partial<RestaurantTable>,
  ): Promise<RestaurantTable> {
    const created = await firstValueFrom(
      this.http.post<RestaurantTable>(
        `${this.baseUrl}/table`,
        table,
      )
    );
    await this.db.restaurantTables.put(created);
    return created;
  }

  /**
   * Updates an existing table
   */
  async updateTable(
    id: number,
    table: Partial<RestaurantTable>,
  ): Promise<RestaurantTable> {
    const updated = await firstValueFrom(
      this.http.put<RestaurantTable>(`${this.baseUrl}/table/${id}`, table)
    );
    await this.db.restaurantTables.put(updated);
    return updated;
  }

  /**
   * Toggles table active status
   */
  async toggleTable(id: number): Promise<boolean> {
    const result = await firstValueFrom(
      this.http.patch<{ isActive: boolean }>(`${this.baseUrl}/table/${id}/toggle`, {})
    );
    await this.db.restaurantTables.update(id, { isActive: result.isActive });
    return result.isActive;
  }

  /**
   * Updates table occupancy status
   * Called when order is created or delivered
   */
  async updateTableStatus(
    id: number,
    status: 'available' | 'occupied',
  ): Promise<RestaurantTable> {
    const updated = await firstValueFrom(
      this.http.patch<RestaurantTable>(
        `${this.baseUrl}/table/${id}/status`,
        { status },
      )
    );
    await this.db.restaurantTables.update(id, { status });
    return updated;
  }

  /**
   * Gets active (unpaid) orders for a specific table
   * @param tableId The table to look up
   */
  async getActiveOrdersByTable(tableId: number): Promise<OrderSummary[]> {
    try {
      return await firstValueFrom(
        this.http.get<OrderSummary[]>(`${this.baseUrl}/orders/by-table/${tableId}`)
      );
    } catch {
      return [];
    }
  }

  //#endregion
}
