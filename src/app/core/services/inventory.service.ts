import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CartItem, InventoryItem, InventoryLedgerDto, InventoryMovement, PageData, ProductConsumption } from '../models';
import { InventoryMovementType } from '../enums';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {

  private readonly http = inject(HttpClient);
  private readonly db = inject(DatabaseService);
  private readonly authService = inject(AuthService);
  private readonly baseUrl = environment.apiUrl;

  //#region Signals

  /** All inventory items for the current branch */
  readonly items = signal<InventoryItem[]>([]);

  /** Items where current stock is at or below the low-stock threshold */
  readonly lowStockItems = computed(() =>
    this.items().filter(i => i.isActive && i.currentStock <= i.lowStockThreshold)
  );

  readonly isLoading = signal(false);

  //#endregion

  //#region Data Loading

  /**
   * Loads inventory items from the API and caches in Dexie.
   * Falls back to local cache if API is unavailable.
   */
  async loadFromApi(): Promise<void> {
    this.isLoading.set(true);
    try {
      const items = await firstValueFrom(
        this.http.get<InventoryItem[]>(`${this.baseUrl}/inventory`)
      );
      await this.db.inventoryItems.clear();
      await this.db.inventoryItems.bulkPut(items);
      this.items.set(items);
    } catch {
      console.warn('[InventoryService] API unavailable, loading from Dexie');
      await this.loadFromLocal();
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Loads inventory items from local Dexie cache.
   * Used as fallback when offline.
   */
  async loadFromLocal(): Promise<void> {
    const items = await this.db.inventoryItems
      .where('branchId').equals(this.authService.branchId)
      .toArray();
    this.items.set(items);
  }

  /** Returns the items signal */
  getAll() {
    return this.items;
  }

  /** Returns the low-stock computed signal */
  getLowStock() {
    return this.lowStockItems;
  }

  //#endregion

  /**
   * Returns product IDs whose required inventory items have stock <= 0.
   * Used to mark products as unavailable in the POS grid (auto-86).
   */
  async getOutOfStockProductIds(): Promise<number[]> {
    try {
      return await firstValueFrom(
        this.http.get<number[]>(`${this.baseUrl}/inventory/out-of-stock-products`)
      );
    } catch {
      return [];
    }
  }

  //#region Ledger

  /**
   * Fetches a paginated page of the global inventory ledger from the API.
   * @param page 1-indexed page number
   * @param pageSize Number of records per page
   */
  getLedger(page: number, pageSize: number): Observable<PageData<InventoryLedgerDto>> {
    return this.http.get<PageData<InventoryLedgerDto>>(
      `${this.baseUrl}/inventory/ledger`,
      { params: { page: page.toString(), pageSize: pageSize.toString() } },
    );
  }

  //#endregion

  //#region CRUD

  /**
   * Creates a new inventory item via API
   */
  async create(item: Partial<InventoryItem>): Promise<InventoryItem> {
    const created = await firstValueFrom(
      this.http.post<InventoryItem>(`${this.baseUrl}/inventory/create`, {
        ...item,
        branchId: this.authService.branchId,
      })
    );
    await this.db.inventoryItems.put(created);
    await this.loadFromApi();
    return created;
  }

  /**
   * Updates an existing inventory item via API
   */
  async update(id: number, item: Partial<InventoryItem>): Promise<InventoryItem> {
    const updated = await firstValueFrom(
      this.http.put<InventoryItem>(`${this.baseUrl}/inventory/${id}`, item)
    );
    await this.db.inventoryItems.put(updated);
    await this.loadFromApi();
    return updated;
  }

  //#endregion

  //#region Movements

  /**
   * Records a stock movement (in, out, or adjustment) for an inventory item
   * @param itemId The inventory item ID
   * @param inventoryMovementTypeId 1=In, 2=Out, 3=Adjustment
   * @param quantity Amount to move (always positive — direction is determined by type)
   * @param reason Optional description of why the movement was made
   */
  async addMovement(
    itemId: number,
    inventoryMovementTypeId: InventoryMovementType,
    quantity: number,
    reason?: string,
  ): Promise<InventoryMovement> {
    const movement = await firstValueFrom(
      this.http.post<InventoryMovement>(
        `${this.baseUrl}/inventory/${itemId}/movement`,
        { inventoryMovementTypeId, quantity, reason },
      )
    );
    await this.db.inventoryMovements.put(movement);
    await this.loadFromApi();
    return movement;
  }

  /**
   * Deducts inventory based on cart items in a completed order.
   * For each CartItem, looks up ProductConsumption rules and creates
   * 'out' movements for the consumed quantities.
   * @param orderId The order ID for traceability
   * @param cartItems The items sold in the order
   */
  async deductFromSale(orderId: string, cartItems: CartItem[]): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.baseUrl}/inventory/deduct-sale`, {
          orderId,
          branchId: this.authService.branchId,
          items: cartItems.map(item => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
        })
      );
      await this.loadFromApi();
    } catch {
      console.warn('[InventoryService] Failed to deduct inventory for order', orderId);
    }
  }

  //#endregion
}
