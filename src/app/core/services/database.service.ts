import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

import { AppConfig, CashMovement, CashRegister, CashRegisterSession, Category, CartItem, Customer, CustomerMembership, DiscountPreset, EmployeeHash, InventoryItem, InventoryMovement, Order, PrinterDestination, PrintJobDto, PrintJobUpdateRecord, Product, Promotion, RestaurantTable, Tax } from '../models';
import { CatalogCacheRow } from '../models/catalog-cache.model';

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
 *   v15 — Added employeeHashes table for offline PIN authentication
 *   v16 — Added customers table for CRM (phone, name, isActive indexes)
 *   v17 — Added printerDestinations table (Phase 19)
 *   v18 — Added pendingPrintJobs table for KDS offline-first (Phase 20c)
 *   v19 — Added cashRegisters table for multi-till
 *   v20 — Migrated cashSessions/cashMovements status strings → numeric IDs
 *   v21 — Migrated orders/restaurantTables/inventoryMovements to numeric IDs
 *   v22 — Added sortOrder index to printerDestinations
 *   v23 — Re-keyed pendingPrintJobs as numeric, added pendingPrintJobUpdates
 *   v24 — Symbolic bump for CashRegister `deviceId` addition (no schema change)
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
  employeeHashes!: Table<EmployeeHash, number>;
  customers!: Table<Customer, number>;
  printerDestinations!: Table<PrinterDestination, number>;
  pendingPrintJobs!: Table<PrintJobDto, number>;
  pendingPrintJobUpdates!: Table<PrintJobUpdateRecord, number>;
  cashRegisters!: Table<CashRegister, number>;
  taxes!: Table<Tax, number>;
  customerMemberships!: Table<CustomerMembership, number>;
  catalogCache!: Table<CatalogCacheRow, string>;
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

    // Add employeeHashes table for offline PIN authentication
    this.version(15).stores({
      employeeHashes: 'userId, branchId, pinHash',
    });

    // Add customers table for CRM
    this.version(16).stores({
      customers: '++id, branchId, phone, name, isActive',
    });

    // Add printerDestinations table for printing destination config (Phase 19)
    this.version(17).stores({
      printerDestinations: '++id, isDefault, isActive',
    });

    // Add pendingPrintJobs table for KDS offline-first support (Phase 20c)
    this.version(18).stores({
      pendingPrintJobs: 'id, destinationId, status',
    });

    // Add cashRegisters table for multi-till support (Phase: multi-till)
    this.version(19).stores({
      cashRegisters: 'id, branchId, isActive, deviceUuid',
    });

    // Migrate cashSessions status string → cashRegisterStatusId (int FK)
    // Migrate cashMovements type string → cashMovementTypeId (int FK)
    this.version(20).stores({
      cashSessions:  '++id, branchId, cashRegisterStatusId, openedAt',
      cashMovements: '++id, sessionId, cashMovementTypeId, createdAt',
    }).upgrade(tx => {
      const statusMap: Record<string, number> = { 'open': 1, 'closed': 2 };
      const typeMap: Record<string, number> = { 'withdrawal': 1, 'expense': 2, 'adjustment': 3 };

      return Promise.all([
        tx.table('cashSessions').toCollection().modify((s: any) => {
          if (s.status && !s.cashRegisterStatusId) {
            s.cashRegisterStatusId = statusMap[s.status] ?? 1;
          }
          delete s.status;
        }),
        tx.table('cashMovements').toCollection().modify((m: any) => {
          if (m.type && !m.cashMovementTypeId) {
            m.cashMovementTypeId = typeMap[m.type] ?? 1;
          }
          delete m.type;
        }),
      ]);
    });

    // Migrate orders syncStatus/kitchenStatus strings → numeric IDs
    // Migrate restaurantTables status string → tableStatusId (int FK)
    // Migrate inventoryMovements type string → inventoryMovementTypeId (int FK)
    this.version(21).stores({
      orders:             'id, syncStatusId, createdAt, kitchenStatusId, deliveryStatus, cancellationStatus, branchId',
      restaurantTables:   '++id, branchId, tableStatusId, isActive',
      inventoryMovements: 'id, inventoryItemId, inventoryMovementTypeId, createdAt',
    }).upgrade(tx => {
      const syncMap: Record<string, number> = { 'Pending': 1, 'Synced': 2, 'Failed': 3, 'PermanentlyFailed': 4 };
      const kitchenMap: Record<string, number> = { 'Pending': 1, 'Ready': 2, 'Delivered': 3 };
      const tableMap: Record<string, number> = { 'available': 1, 'occupied': 2 };
      const invTypeMap: Record<string, number> = { 'in': 1, 'out': 2, 'adjustment': 3 };

      return Promise.all([
        tx.table('orders').toCollection().modify((o: any) => {
          if (o.syncStatus && !o.syncStatusId) {
            o.syncStatusId = syncMap[o.syncStatus] ?? 1;
          }
          delete o.syncStatus;
          if (o.kitchenStatus && !o.kitchenStatusId) {
            o.kitchenStatusId = kitchenMap[o.kitchenStatus] ?? 1;
          }
          delete o.kitchenStatus;
        }),
        tx.table('restaurantTables').toCollection().modify((t: any) => {
          if (t.status && !t.tableStatusId) {
            t.tableStatusId = tableMap[t.status] ?? 1;
          }
          delete t.status;
        }),
        tx.table('inventoryMovements').toCollection().modify((m: any) => {
          if (m.type && !m.inventoryMovementTypeId) {
            m.inventoryMovementTypeId = invTypeMap[m.type] ?? 1;
          }
          delete m.type;
        }),
      ]);
    });

    // Add sortOrder index to printerDestinations (fixes SchemaError on KeyPath sortOrder)
    this.version(22).stores({
      printerDestinations: '++id, isDefault, isActive, sortOrder',
    });

    // Phase 12.1: Re-key pendingPrintJobs as numeric (backend uses int PK),
    // add offline sync queue for KDS status transitions.
    this.version(23).stores({
      pendingPrintJobs:       'id, destinationId, status',
      pendingPrintJobUpdates: '++id, printJobId, status',
    }).upgrade(tx => {
      // Clear stale string-keyed rows — they'll be re-fetched from the API
      return tx.table('pendingPrintJobs').clear();
    });

    // v24 — Symbolic bump for the CashRegister `deviceId` addition.
    //
    // The change is runtime-compatible (an optional property — Dexie
    // auto-stores any property on `put()` regardless of schema) so no
    // index update is needed. We still bump the version so the
    // transition is recorded in Dexie's internal log alongside the
    // backend modernization (DeviceUuid → DeviceId resolution server-side).
    // Records persisted before this version simply load with `deviceId`
    // undefined; subsequent writes will carry the field.
    this.version(24).stores({}).upgrade(() => Promise.resolve());

    // v25 — Tax catalog cache for offline-first dropdowns.
    //
    // Stores the response of `GET /api/taxes` so the product-form and
    // admin-settings dropdowns survive cold-boot offline. Indexed by
    // `code` (stable backend identifier) and `isDefault` (so the country
    // default is queryable in O(1)).
    this.version(25).stores({
      taxes: 'id, code, isDefault',
    });

    // ─── v26 ── Customer model split (FDD-026)
    // The legacy `name` index is incompatible with the new `firstName` /
    // `lastName` shape. We drop the cached customers and let
    // `CustomerService.loadCustomers()` rehydrate from the API on next
    // mount. No in-place migration — the structural mismatch with the
    // backend means cached rows would be invalid in either schema.
    this.version(26).stores({
      customers: '++id, branchId, phone, firstName, isActive',
    }).upgrade(tx => tx.table('customers').clear());

    // ─── v27 ── Customer scope correction (branchId → businessId)
    // The backend returns customers business-wide (the `businessId`
    // field), not branch-scoped. The previous `branchId` index never
    // matched any record because the API never sent that field. We
    // swap the index to `businessId` so Dexie queries finally hit.
    // No `clear()` is required — every record currently in the store
    // came from the API after v26 cleared, so they all already carry
    // `businessId` and only need re-indexing under the new schema.
    this.version(27).stores({
      customers: '++id, businessId, phone, firstName, isActive',
    });

    // ─── v28 ── Customer memberships cache (P2 of FDD-027)
    // Mirrors the `CustomerMembership` aggregate introduced by BDD-019.
    // PK is the BE-assigned `id` (no auto-increment) so `bulkPut`
    // upserts naturally on refresh-always loads. The `[customerId+status]`
    // composite index is reserved for P5/P6 reception "active-only"
    // lookups; P2 itself only filters by `customerId`.
    this.version(28).stores({
      customerMemberships: 'id, customerId, [customerId+status], validUntil',
    });

    // ─── v29 ── Catalog response cache (F1 of FDD-028)
    // Persists every `GET /api/Catalog/*` (and `/api/Taxes`) body +
    // ETag so cold-boot reads hit Dexie (≤ 20 ms) instead of network.
    // PK is the canonical lowercase route string
    // (e.g. `/catalog/kitchen-statuses`); secondary index on
    // `fetchedAt` supports future TTL-based eviction sweeps. Hard
    // freshness cap of 24h enforced in code (see CATALOG_CACHE_MAX_AGE_MS).
    this.version(29).stores({
      catalogCache: 'route, fetchedAt',
    });
  }
  //#endregion

}
