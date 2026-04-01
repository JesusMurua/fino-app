import { Injectable, OnDestroy, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Order } from '../models';
import { OrderSource } from '../enums';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

/** Polling interval for pending order sync (milliseconds) */
const SYNC_POLL_INTERVAL_MS = 30_000;

/** Polling interval for pulling orders from other devices (milliseconds) */
const PULL_POLL_INTERVAL_MS = 5_000;

/**
 * Handles background synchronization of offline orders to the backend API.
 *
 * Flow (CLAUDE.md offline-first architecture):
 *   1. Orders are saved to IndexedDB with syncStatus = 'Pending'
 *   2. If online, attempt immediate POST /orders/sync
 *   3. If offline, queue stays in Dexie
 *   4. On 'online' event or every 30s (when pending + online) → retry
 *   5. On success: syncStatus = 'Synced', syncedAt = now
 *   6. On failure: syncStatus = 'Failed' (retried next cycle)
 */
@Injectable({ providedIn: 'root' })
export class SyncService implements OnDestroy {

  //#region Properties
  /** True while a sync cycle is in progress */
  readonly isSyncing = signal(false);

  /** Number of orders pending sync */
  readonly pendingCount = signal(0);

  /** Next order number — centralized so all components read the same value */
  readonly nextOrderNumber = signal(0);

  private readonly onlineHandler = () => this.syncPendingOrders();
  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  private pullTimerId: ReturnType<typeof setInterval> | null = null;

  /** ISO timestamp of last successful pull — null means first pull */
  private lastPullAt: string | null = null;

  /** Prevents double initialization */
  private isInitialized = false;

  /** Controls whether pull sync is active — disabled on non-POS routes */
  private readonly isPullEnabled = signal(false);
  //#endregion

  //#region Constructor & Lifecycle
  constructor(
    private readonly db: DatabaseService,
    private readonly api: ApiService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Starts all background sync operations.
   * Must be called explicitly when the user is authenticated.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    window.addEventListener('online', this.onlineHandler);
    this.refreshPendingCount();
    this.initNextOrderNumber();
    this.startPolling();
    this.startPullPolling();
  }

  /** Enables pull sync — call when navigating to POS routes */
  enablePull(): void {
    this.isPullEnabled.set(true);
  }

  /** Disables pull sync — call when navigating away from POS routes */
  disablePull(): void {
    this.isPullEnabled.set(false);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onlineHandler);
    this.stopPolling();
    this.stopPullPolling();
  }
  //#endregion

  //#region Sync Methods

  /**
   * Returns the current nextOrderNumber and increments it for the next call.
   */
  consumeOrderNumber(): number {
    const num = this.nextOrderNumber();
    this.nextOrderNumber.set(num + 1);
    return num;
  }

  /**
   * Saves a new order to IndexedDB as pending sync.
   * Always call this instead of writing to the DB directly from a component.
   * @param order The completed order to persist
   */
  async saveOrder(order: Order): Promise<void> {
    await this.db.orders.put({ ...order, syncStatus: 'Pending' });
    this.pendingCount.update(n => n + 1);

    if (navigator.onLine) {
      await this.syncPendingOrders();
    }
  }

  /**
   * Fetches all pending orders and attempts to sync them with the API.
   * Runs automatically when the browser goes online or on polling interval.
   */
  async syncPendingOrders(): Promise<void> {
    if (this.isSyncing() || !navigator.onLine) return;

    const pending = await this.db.orders
      .where('syncStatus')
      .equals('Pending')
      .toArray();

    if (pending.length === 0) return;

    this.isSyncing.set(true);

    for (const order of pending) {
      await this.syncOrder(order);
    }

    this.isSyncing.set(false);
    await this.refreshPendingCount();

    // After pushing, pull latest from server to get updates from other devices
    await this.pullOrders();
  }
  //#endregion

  //#region Pull Sync

  /**
   * Pulls orders from the backend that were created or updated
   * by other devices since the last pull.
   * Merges into local Dexie without overwriting orders that
   * have pending local changes (syncStatus === 'pending').
   */
  async pullOrders(): Promise<void> {
    if (!this.isPullEnabled() || !navigator.onLine) return;

    try {
      const params = this.lastPullAt ? `?since=${this.lastPullAt}` : '';
      const remoteDtos = await firstValueFrom(
        this.api.get<any[]>(`/orders/pull${params}`),
      );

      for (const dto of remoteDtos) {
        const local = await this.db.orders.get(dto.id);
        if (local?.syncStatus === 'Pending') continue;

        const order = this.mapPullDto(dto);
        await this.db.orders.put(order);
      }

      this.lastPullAt = new Date().toISOString();
    } catch {
      // Silent fail — pull is best-effort, will retry on next interval
    }
  }

  /**
   * Maps a flat order DTO from GET /api/orders/pull into the
   * local Order/CartItem shape that Dexie and templates expect.
   *
   * API response shape (confirmed from network):
   *   { id, branchId, tableId, tableName, kitchenStatus, isPaid,
   *     totalCents, subtotalCents, paidCents, changeCents,
   *     createdAt (ISO string), orderNumber,
   *     items: [{ id, productName, quantity, unitPriceCents }],
   *     payments: [] }
   */
  private mapPullDto(dto: any): Order {
    return {
      id: dto.id,
      orderNumber: dto.orderNumber,
      branchId: dto.branchId,
      totalCents: dto.totalCents,
      subtotalCents: dto.subtotalCents,
      paidCents: dto.paidCents,
      changeCents: dto.changeCents,
      paymentProvider: null,
      createdAt: new Date(dto.createdAt),
      syncStatus: 'Synced',
      syncedAt: new Date(),
      kitchenStatus: dto.kitchenStatus,
      cancellationReason: dto.cancellationReason,
      cancelledAt: dto.cancelledAt ? new Date(dto.cancelledAt) : undefined,
      tableId: dto.tableId,
      tableName: dto.tableName,
      orderSource: dto.orderSource ?? OrderSource.Direct,
      externalOrderId: dto.externalOrderId,
      deliveryStatus: dto.deliveryStatus,
      deliveryCustomerName: dto.deliveryCustomerName,
      estimatedPickupAt: dto.estimatedPickupAt,
      orderDiscountCents: dto.orderDiscountCents ?? 0,
      totalDiscountCents: dto.totalDiscountCents ?? 0,
      orderPromotionId: dto.orderPromotionId,
      orderPromotionName: dto.orderPromotionName,
      payments: dto.payments ?? [],
      items: (dto.items ?? []).map((item: any) => ({
        id: String(item.id),
        product: { id: item.productId ?? 0, name: item.productName, price: 0, categoryId: 0, isAvailable: true, priceCents: item.unitPriceCents },
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: item.unitPriceCents * item.quantity,
        discountCents: item.discountCents ?? 0,
        promotionId: item.promotionId,
        promotionName: item.promotionName,
        size: item.sizeName ? { label: item.sizeName, priceDeltaCents: 0 } : undefined,
        extras: (item.extras ?? []).map((name: string) => ({ id: 0, name, priceCents: 0 })),
        notes: item.notes ?? undefined,
      })),
    };
  }

  //#endregion

  //#region Private Helpers

  /**
   * Attempts to POST a single order to the backend API.
   * Maps the Dexie Order to the DTO the API expects, wrapped in an array.
   * Updates IndexedDB with the result regardless of outcome.
   * @param order The pending order to sync
   */
  private async syncOrder(order: Order): Promise<void> {
    try {
      const dto = this.mapOrderToDto(order);
      await firstValueFrom(
        this.api.post<void>('/orders/sync', [dto]),
      );
      await this.db.orders.update(order.id, {
        syncStatus: 'Synced',
        syncedAt: new Date(),
      });
    } catch (error) {
      console.error(`[SyncService] Failed to sync order ${order.id}:`, error);
      await this.db.orders.update(order.id, { syncStatus: 'Failed' });
    }
  }

  /**
   * Maps a Dexie Order + CartItems into the flat DTO the API expects.
   * Flattens nested product/size/extras into plain fields.
   */
  private mapOrderToDto(order: Order): Record<string, unknown> {
    return {
      id: order.id,
      branchId: this.authService.branchId,
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      isPaid: (order.payments?.length ?? 0) > 0,
      paidCents: order.paidCents ?? 0,
      changeCents: order.changeCents ?? 0,
      payments: (order.payments ?? []).map(p => ({
        method: p.method,
        amountCents: p.amountCents,
        reference: p.reference ?? null,
      })),
      createdAt: order.createdAt,
      tableId: order.tableId ?? null,
      tableName: order.tableName ?? null,
      subtotalCents: order.subtotalCents ?? null,
      orderDiscountCents: order.orderDiscountCents ?? 0,
      totalDiscountCents: order.totalDiscountCents ?? 0,
      orderPromotionId: order.orderPromotionId ?? null,
      orderPromotionName: order.orderPromotionName ?? null,
      kitchenStatus: order.kitchenStatus ?? 'Pending',
      cancellationReason: order.cancellationReason ?? null,
      cancelledAt: order.cancelledAt ?? null,
      items: order.items.map(item => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents ?? 0,
        promotionId: item.promotionId ?? null,
        promotionName: item.promotionName ?? null,
        sizeName: item.size?.label ?? null,
        extrasJson: item.extras.length > 0 ? JSON.stringify(item.extras) : null,
        notes: item.notes ?? null,
      })),
    };
  }

  /**
   * Initializes nextOrderNumber from the higher of local Dexie count
   * or the API's last order number. Runs once on service creation.
   */
  private async initNextOrderNumber(): Promise<void> {
    const localCount = await this.db.orders.count();
    let next = localCount + 1;

    try {
      const result = await firstValueFrom(
        this.api.get<{ lastOrderNumber: number }>('/orders/last-number'),
      );
      if (result.lastOrderNumber >= next) {
        next = result.lastOrderNumber + 1;
      }
    } catch (error) {
      console.warn('[SyncService] Could not fetch last order number from API — using local counter:', error);
    }

    this.nextOrderNumber.set(next);
  }

  /**
   * Updates the pendingCount signal from the current IndexedDB state.
   */
  private async refreshPendingCount(): Promise<void> {
    const count = await this.db.orders
      .where('syncStatus')
      .equals('Pending')
      .count();
    this.pendingCount.set(count);
  }

  /**
   * Starts a 30-second polling interval.
   * Only syncs when there are pending orders AND the browser is online.
   */
  private startPolling(): void {
    this.pollTimerId = setInterval(async () => {
      if (navigator.onLine && this.pendingCount() > 0) {
        await this.syncPendingOrders();
      }
    }, SYNC_POLL_INTERVAL_MS);
  }

  /** Stops the push polling interval */
  private stopPolling(): void {
    if (this.pollTimerId !== null) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }

  /** Starts pull polling every 5 seconds when online */
  private startPullPolling(): void {
    this.pullTimerId = setInterval(() => {
      if (navigator.onLine) {
        this.pullOrders();
      }
    }, PULL_POLL_INTERVAL_MS);
  }

  /** Stops the pull polling interval */
  private stopPullPolling(): void {
    if (this.pullTimerId !== null) {
      clearInterval(this.pullTimerId);
      this.pullTimerId = null;
    }
  }
  //#endregion

}
