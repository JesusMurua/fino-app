import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

import { AppConfig, CashMovement, CashRegisterSession, Category, CartItem, DiscountPreset, Order, Product, RestaurantTable } from '../models';

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
  }
  //#endregion

}
