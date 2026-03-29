import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

import { AppConfig, CashMovement, CashRegisterSession, Category, CartItem, DiscountPreset, InventoryItem, InventoryMovement, Order, Product, Promotion, RestaurantTable } from '../models';

/**
 * IndexedDB wrapper using Dexie.js.
 * Single source of truth for all offline-first storage.
 * Schema version must be incremented whenever stores or indexes change.
 *
 * Version history:
 *   v1 — products, categories, cart, orders
 *   v2 — added config (business settings + PIN)
 *   v3 — added kitchenStatus index to orders (KDS)
 *   v4 — added deliveryStatus index to orders (order tracking)
 *   v5 — added cancellationStatus index to orders (order cancellation)
 *   v6 — added discountPresets table
 *   v7 — added cashSessions and cashMovements tables
 *   v8 — added restaurantTables table
 *   v9 — added inventoryItems and inventoryMovements tables
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

    this.version(1).stores({
      // Only indexed fields are listed here — all other fields are stored automatically
      products:   'id, categoryId, isAvailable',
      categories: 'id, sortOrder',
      cart:       'id',
      orders:     'id, syncStatus, createdAt',
    });

    this.version(2).stores({
      products:   'id, categoryId, isAvailable',
      categories: 'id, sortOrder',
      cart:       'id',
      orders:     'id, syncStatus, createdAt',
      config:     'id',
    });

    this.version(3).stores({
      products:   'id, categoryId, isAvailable',
      categories: 'id, sortOrder',
      cart:       'id',
      orders:     'id, syncStatus, createdAt, kitchenStatus',
      config:     'id',
    });

    this.version(4).stores({
      products:   'id, categoryId, isAvailable',
      categories: 'id, sortOrder',
      cart:       'id',
      orders:     'id, syncStatus, createdAt, kitchenStatus, deliveryStatus',
      config:     'id',
    });

    this.version(5).stores({
      products:   'id, categoryId, isAvailable',
      categories: 'id, sortOrder',
      cart:       'id',
      orders:     'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus',
      config:     'id',
    }).upgrade(tx => {
      return tx.table('orders').toCollection().modify(order => {
        if (order.cancellationStatus === undefined) {
          order.cancellationStatus = 'none';
        }
      });
    });

    this.version(6).stores({
      products:        'id, categoryId, isAvailable',
      categories:      'id, sortOrder',
      cart:            'id',
      orders:          'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus',
      config:          'id',
      discountPresets: '++id, branchId, isActive',
    });

    this.version(7).stores({
      products:        'id, categoryId, isAvailable',
      categories:      'id, sortOrder',
      cart:            'id',
      orders:          'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus',
      config:          'id',
      discountPresets: '++id, branchId, isActive',
      cashSessions:    '++id, branchId, status, openedAt',
      cashMovements:   '++id, sessionId, createdAt',
    });

    this.version(8).stores({
      products:         'id, categoryId, isAvailable',
      categories:       'id, sortOrder',
      cart:             'id',
      orders:           'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus',
      config:           'id',
      discountPresets:  '++id, branchId, isActive',
      cashSessions:     '++id, branchId, status, openedAt',
      cashMovements:    '++id, sessionId, createdAt',
      restaurantTables: '++id, branchId, status, isActive',
    });

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

    this.version(10).stores({
      orders:              'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus, branchId',
    }).upgrade(async tx => {
      // Migrate legacy orders from businessId to branchId
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

    // Add hasKitchen/hasTables to business config; derive from existing businessType
    this.version(13).stores({}).upgrade(tx => {
      return tx.table('config').toCollection().modify((cfg: any) => {
        if (cfg.hasKitchen === undefined) cfg.hasKitchen = true;
        if (cfg.hasTables === undefined) cfg.hasTables = true;
      });
    });
  }
  //#endregion

}
