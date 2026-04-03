import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

import { AppConfig, CashMovement, CashRegisterSession, Category, CartItem, DiscountPreset, InventoryItem, InventoryMovement, Order, Product, Promotion, RestaurantTable } from '../models';

/**
 * IndexedDB wrapper using Dexie.js.
 * Single source of truth for all offline-first storage.
 * Schema version must be incremented whenever stores or indexes change.
 *
 * Version history (consolidated — no production data before v9):
 *   v9  — Base: all tables with full indexes (products, categories, cart,
 *          orders, config, discountPresets, cashSessions, cashMovements,
 *          restaurantTables, inventoryItems, inventoryMovements)
 *   v10 — Added branchId index to orders; migrate businessId → branchId
 *   v11 — Added promotions table; migrated discount fields on orders
 *   v12 — Migrated syncStatus/kitchenStatus from lowercase to PascalCase
 *   v13 — Added hasKitchen/hasTables flags to config
 *   v14 — Initialize retryCount; rescue 'Failed' → 'Pending'
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService extends Dexie {

  //#region Tables
  products!: Table<Product, number>;
  categories!: Table<Category, number>;
  cart!: Table<CartItem, string>;
  orders!: Table<Order, string>;
  config!: Table<AppConfig, string>;
  discountPresets!: Table<DiscountPreset, number>;
  cashSessions!: Table<CashRegisterSession, number>;
  cashMovements!: Table<CashMovement, number>;
  restaurantTables!: Table<RestaurantTable, number>;
  inventoryItems!: Table<InventoryItem & { syncStatus?: string }, number>;
  inventoryMovements!: Table<InventoryMovement, number>;
  promotions!: Table<Promotion, number>;
  //#endregion

  //#region Constructor
  constructor() {
    super('pos-tactil-db');

    // ── Base schema (consolidated from v1–v9, no production users) ──
    this.version(9).stores({
      products:            'id, categoryId, isAvailable',
      categories:          'id, sortOrder',
      cart:                'id',
      orders:              'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus',
      config:              'id',
      discountPresets:     '++id, branchId, isActive',
      cashSessions:        '++id, branchId, status, openedAt',
      cashMovements:       '++id, sessionId, createdAt',
      restaurantTables:    '++id, branchId, status, isActive',
      inventoryItems:      'id, branchId, isActive, currentStock',
      inventoryMovements:  'id, inventoryItemId, type, createdAt',
    });

    // Add branchId index to orders; migrate legacy businessId
    this.version(10).stores({
      orders:              'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus, branchId',
    }).upgrade(async tx => {
      const table = tx.table('orders');
      const orders = await table.toArray();
      for (const order of orders) {
        if ((order as any).businessId && !order.branchId) {
          await table.update(order.id, {
            branchId: (order as any).businessId,
          });
        }
      }
    });

    // Add promotions table; migrate discount fields on orders
    this.version(11).stores({
      promotions:          'id, branchId, type, isActive',
    }).upgrade(tx => {
      return tx.table('orders').toCollection().modify((order: any) => {
        delete order.discountCents;
        delete order.discountLabel;
        delete order.discountReason;
        order.orderDiscountCents = 0;
        order.totalDiscountCents = 0;
      });
    });

    // Migrate syncStatus and kitchenStatus from lowercase to PascalCase
    this.version(12).stores({}).upgrade(tx => {
      const statusMap: Record<string, string> = {
        'pending': 'Pending', 'synced': 'Synced', 'failed': 'Failed',
      };
      const kitchenMap: Record<string, string> = {
        'new': 'Pending', 'done': 'Delivered',
      };
      return tx.table('orders').toCollection().modify((order: any) => {
        if (statusMap[order.syncStatus]) {
          order.syncStatus = statusMap[order.syncStatus];
        }
        if (order.kitchenStatus && kitchenMap[order.kitchenStatus]) {
          order.kitchenStatus = kitchenMap[order.kitchenStatus];
        }
      });
    });

    // Add hasKitchen/hasTables to business config
    this.version(13).stores({}).upgrade(tx => {
      return tx.table('config').toCollection().modify((cfg: any) => {
        if (cfg.hasKitchen === undefined) cfg.hasKitchen = true;
        if (cfg.hasTables === undefined) cfg.hasTables = true;
      });
    });

    // Initialize retryCount on existing orders; rescue 'Failed' → 'Pending'
    this.version(14).stores({}).upgrade(tx => {
      return tx.table('orders').toCollection().modify((order: any) => {
        if (order.retryCount === undefined) order.retryCount = 0;
        if (order.syncStatus === 'Failed') order.syncStatus = 'Pending';
      });
    });
  }
  //#endregion

}
