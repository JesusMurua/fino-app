import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { RestaurantTable } from '../models';
import { DatabaseService } from './database.service';

@Injectable({ providedIn: 'root' })
export class TableService {

  private readonly http = inject(HttpClient);
  private readonly db = inject(DatabaseService);
  private readonly baseUrl = environment.apiUrl;

  //#region Public Methods

  /**
   * Loads tables from API and caches in Dexie
   */
  async loadTables(branchId: number): Promise<void> {
    try {
      const tables = await firstValueFrom(
        this.http.get<RestaurantTable[]>(`${this.baseUrl}/table?branchId=${branchId}`)
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
          `${this.baseUrl}/table?branchId=${branchId}&includeInactive=true`
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
        `${this.baseUrl}/table?branchId=${branchId}`,
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

  //#endregion
}
