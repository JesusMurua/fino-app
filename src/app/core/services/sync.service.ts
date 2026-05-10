import { Injectable, Injector, OnDestroy, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Customer, Order, OrderItemMetadata, OrderPayment, PaymentMetadata, PaymentMethod, PaymentTransactionStatus } from '../models';
import { DeliveryStatus, KitchenStatusId, OrderSource, PaymentStatus, SyncStatusId } from '../enums';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { CustomerMembershipsService } from './customer-memberships.service';
import { CustomerService } from './customer.service';
import { DatabaseService } from './database.service';

// ---------------------------------------------------------------------------
// Pull DTOs — wire format of GET /api/orders/pull and GET /api/orders/:id
// Shared with CheckoutComponent.loadOrderFromApi so the HTTP layer is typed.
// ---------------------------------------------------------------------------

/**
 * Safe generic parser for metadata fields whose wire shape is
 * heterogeneous (BE may emit JSON-encoded string OR object). Returns
 * the typed payload, or `undefined` for null/empty/malformed input.
 *
 * Centralised here so every pull mapping can drop in a single call
 * and never crash the sync cycle on a malformed BE response.
 */
function safeParseMetadata<T>(raw: unknown): T | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn('[SyncService] Malformed metadata in pull payload — dropping field');
    return undefined;
  }
}

/** Shape of a single order payment as returned by the backend pull endpoint */
export interface OrderPaymentPullDto {
  id?: number;
  method: PaymentMethod;
  amountCents: number;
  reference?: string | null;
  paymentProvider?: string | null;
  externalTransactionId?: string | null;
  transactionStatus?: PaymentTransactionStatus;
  authorizedAt?: string | null;
  paymentMetadata?: PaymentMetadata;
}

/** Shape of a single order line as returned by the backend pull endpoint */
export interface OrderItemPullDto {
  id: string | number;
  productId?: number;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
  promotionId?: number;
  promotionName?: string;
  sizeName?: string;
  extras?: string[];
  notes?: string | null;
  /**
   * Strongly-typed line metadata mirrored from `CartItem.metadata`.
   * Persisted by the backend as `jsonb`; the FE round-trips it
   * verbatim for cross-device merges.
   */
  metadata?: OrderItemMetadata;
}

/**
 * Flat order DTO as returned by the backend pull endpoint.
 * Accepted by mapPullDto() and used to type HTTP responses in checkout.
 */
export interface OrderPullDto {
  id: string;
  orderNumber: number;
  branchId: number;
  totalCents: number;
  subtotalCents: number;
  paidCents: number;
  changeCents: number;
  createdAt: string;
  kitchenStatusId?: KitchenStatusId;
  cancellationReason?: string;
  cancelledAt?: string | null;
  tableId?: number;
  tableName?: string;
  cashRegisterSessionId?: number | null;
  orderSource?: OrderSource;
  externalOrderId?: string;
  deliveryStatus?: DeliveryStatus;
  deliveryCustomerName?: string;
  estimatedPickupAt?: string;
  orderDiscountCents?: number;
  totalDiscountCents?: number;
  orderPromotionId?: number;
  orderPromotionName?: string;
  payments?: OrderPaymentPullDto[];
  items?: OrderItemPullDto[];
}

/** Maximum retries before an order is marked PermanentlyFailed */
const MAX_RETRIES = 10;

/** Base delay for exponential backoff in milliseconds (30 seconds) */
const BACKOFF_BASE_MS = 30_000;

/** Maximum backoff delay cap (5 minutes) */
const BACKOFF_CAP_MS = 300_000;

/** Polling interval for pending order sync (milliseconds) */
const SYNC_POLL_INTERVAL_MS = 30_000;

/** Pull polling tiers — adaptive based on activity */
const PULL_INTERVAL_DEFAULT_MS = 15_000;
const PULL_INTERVAL_SLOW_MS = 30_000;
const PULL_INTERVAL_IDLE_MS = 60_000;

/** Number of consecutive empty pulls before slowing down */
const PULL_IDLE_THRESHOLD = 3;

/**
 * Handles background synchronization of offline orders to the backend API.
 *
 * Flow (CLAUDE.md offline-first architecture):
 *   1. Orders are saved to IndexedDB with syncStatus = 'Pending'
 *   2. If online, attempt immediate POST /orders/sync
 *   3. If offline, queue stays in Dexie
 *   4. On 'online' event or every 30s (when pending/failed + online) → retry
 *   5. On success: syncStatus = 'Synced', syncedAt = now
 *   6. On transient failure (5xx/network): syncStatus = 'Failed', retryCount++
 *   7. On permanent failure (4xx except 429): syncStatus = 'PermanentlyFailed'
 *   8. After MAX_RETRIES transient failures → 'PermanentlyFailed'
 */
@Injectable({ providedIn: 'root' })
export class SyncService implements OnDestroy {

  //#region Properties
  /** True while a sync cycle is in progress */
  readonly isSyncing = signal(false);

  /** Number of orders pending sync (Pending + Failed) */
  readonly pendingCount = signal(0);

  /** Number of orders that have permanently failed — UI should warn */
  readonly permanentlyFailedCount = signal(0);

  /** Next order number — centralized so all components read the same value */
  readonly nextOrderNumber = signal(0);

  private readonly onlineHandler = () => this.syncPendingOrders();
  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  private pullTimerId: ReturnType<typeof setTimeout> | null = null;

  /** ISO timestamp of last successful pull — null means first pull */
  private lastPullAt: string | null = null;

  /** Prevents double initialization */
  private isInitialized = false;

  /** Re-entrancy guard for pull operations */
  private isPulling = false;

  /** Consecutive pulls with no new data — drives adaptive interval */
  private emptyPullStreak = 0;

  /** Controls whether pull sync is active — disabled on non-POS routes */
  private readonly isPullEnabled = signal(false);
  //#endregion

  //#region Constructor & Lifecycle
  constructor(
    private readonly db: DatabaseService,
    private readonly api: ApiService,
    private readonly authService: AuthService,
    private readonly injector: Injector,
    private readonly customerMembershipsService: CustomerMembershipsService,
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
    this.refreshPermanentlyFailedCount();
    this.initNextOrderNumber();
    this.startPolling();
    this.schedulePull();
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
    // Money rule: kitchen-only orders (kiosk, send-to-kitchen) ship with
    // payments: [] and may have no session. Only block when actual money
    // changes hands without an open cash register session.
    const hasPayments = (order.payments?.length ?? 0) > 0;
    if (hasPayments && order.cashRegisterSessionId == null) {
      throw new Error('No se puede guardar una orden con pagos registrados sin una sesión de caja activa');
    }
    await this.db.orders.put({ ...order, syncStatusId: SyncStatusId.Pending, retryCount: 0 });

    this.pendingCount.update(n => n + 1);

    if (navigator.onLine) {
      await this.syncPendingOrders();
    }
  }

  /**
   * Fetches all retryable orders (Pending + Failed) and attempts to sync them.
   * Respects per-order exponential backoff — skips orders whose backoff
   * window has not elapsed yet.
   * Runs automatically when the browser goes online or on polling interval.
   */
  async syncPendingOrders(): Promise<void> {
    if (this.isSyncing() || !navigator.onLine) return;

    const retryable = await this.db.orders
      .where('syncStatusId')
      .anyOf(SyncStatusId.Pending, SyncStatusId.Failed)
      .toArray();

    if (retryable.length === 0) return;

    this.isSyncing.set(true);

    const now = Date.now();

    for (const order of retryable) {
      // Respect exponential backoff for previously failed orders
      if (order.syncStatusId === SyncStatusId.Failed && order.lastSyncAttempt) {
        const retries = order.retryCount ?? 0;
        const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, retries), BACKOFF_CAP_MS);
        const elapsed = now - new Date(order.lastSyncAttempt).getTime();
        if (elapsed < backoffMs) continue;
      }

      await this.syncOrder(order);
    }

    this.isSyncing.set(false);
    await this.refreshPendingCount();
    await this.refreshPermanentlyFailedCount();

    // Re-fetch authoritative customer state for any beneficiary that
    // appeared in a sale that synced in this cycle. Picks up server-side
    // CRM stat updates (totals, points, credit) AND pulls the new
    // membership rows the BE created for the synced orders.
    await this.refreshCustomersAndMembershipsAfterSync(retryable);

    // After pushing, pull latest from server to get updates from other devices
    await this.pullOrders();
  }

  /**
   * Pulls fresh customer profiles to update CRM aggregates (points,
   * credit) AND delegates to `CustomerMembershipsService` to pull
   * newly created membership records after an offline sale syncs.
   *
   * Two parallel-purpose fetches per beneficiary:
   *   1. `GET /customers/{id}` — refreshes points, credit balance,
   *      total spent, last visit, etc. Failure is logged but never
   *      aborts the loop (best-effort, FDD-027 §3.2).
   *   2. `customerMembershipsService.loadFor(id)` — refreshes the
   *      Dexie `customerMemberships` cache so reception's offline
   *      gate can validate the new membership window. The service
   *      handles its own errors internally; no outer try/catch
   *      needed here.
   *
   * Beneficiaries are extracted from `OrderItemMetadata.beneficiaryCustomerId`
   * across every item in every order that successfully transitioned
   * to `Synced` during the current sync cycle.
   */
  private async refreshCustomersAndMembershipsAfterSync(candidates: Order[]): Promise<void> {
    if (candidates.length === 0) return;

    const candidateIds = candidates.map(o => o.id);
    const refreshed = await this.db.orders.where('id').anyOf(candidateIds).toArray();

    const beneficiaryIds = new Set<number>();
    for (const order of refreshed) {
      if (order.syncStatusId !== SyncStatusId.Synced) continue;
      for (const item of order.items) {
        const beneficiaryId = item.metadata?.beneficiaryCustomerId;
        if (typeof beneficiaryId === 'number') {
          beneficiaryIds.add(beneficiaryId);
        }
      }
    }

    if (beneficiaryIds.size === 0) return;

    const customerService = this.injector.get(CustomerService);
    for (const id of beneficiaryIds) {
      try {
        const fresh = await firstValueFrom(this.api.get<Customer>(`/customers/${id}`));
        await this.db.customers.put(fresh);
        await customerService.refreshFromDb(id);
      } catch (err) {
        console.warn(`[SyncService] Customer reconciliation failed for ${id}:`, err);
      }
      await this.customerMembershipsService.loadFor(id);
    }
  }
  //#endregion

  //#region Pull Sync

  /**
   * Pulls today's orders from the API into Dexie.
   * Intended to be called on login (fire-and-forget) so that
   * new sessions/devices have orders available immediately.
   */
  async pullTodayOrders(): Promise<void> {
    if (!navigator.onLine) return;

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const since = todayStart.toISOString();

      const remoteDtos = await firstValueFrom(
        this.api.get<OrderPullDto[]>(`/orders/pull?since=${since}`),
      );

      await this.mergeRemoteOrders(remoteDtos);

      this.lastPullAt = new Date().toISOString();
    } catch (err) {
      console.warn('[SyncService] pullTodayOrders failed:', err);
    }
  }

  /**
   * Pulls orders from the backend that were created or updated
   * by other devices since the last pull.
   * Uses a Dexie transaction to prevent TOCTOU races.
   * Guarded against re-entrancy — concurrent calls are no-ops.
   */
  async pullOrders(): Promise<void> {
    if (!this.isPullEnabled() || !navigator.onLine || this.isPulling) return;

    this.isPulling = true;
    try {
      const params = this.lastPullAt ? `?since=${this.lastPullAt}` : '';
      const remoteDtos = await firstValueFrom(
        this.api.get<OrderPullDto[]>(`/orders/pull${params}`),
      );

      const mergedCount = await this.mergeRemoteOrders(remoteDtos);

      this.lastPullAt = new Date().toISOString();

      // Adaptive pull: track empty responses to slow down polling
      if (mergedCount === 0) {
        this.emptyPullStreak++;
      } else {
        this.emptyPullStreak = 0;
      }
    } catch {
      // Silent fail — pull is best-effort, will retry on next interval
    } finally {
      this.isPulling = false;
    }
  }

  /**
   * Merges remote order DTOs into Dexie inside a single transaction.
   * Skips orders with local pending changes to avoid overwriting unsynced data.
   * @param remoteDtos Array of order DTOs from GET /api/orders/pull
   * @returns Number of orders actually written to Dexie
   */
  private async mergeRemoteOrders(remoteDtos: OrderPullDto[]): Promise<number> {
    if (remoteDtos.length === 0) return 0;

    let mergedCount = 0;

    await this.db.transaction('rw', this.db.orders, async () => {
      // Read all local IDs we need to check in a single batch
      const remoteIds = remoteDtos.map(dto => dto.id);
      const locals = await this.db.orders.where('id').anyOf(remoteIds).toArray();
      const pendingIds = new Set(
        locals
          .filter(o => o.syncStatusId === SyncStatusId.Pending || o.syncStatusId === SyncStatusId.Failed)
          .map(o => o.id),
      );

      const toWrite: Order[] = [];
      for (const dto of remoteDtos) {
        if (pendingIds.has(dto.id)) continue;
        toWrite.push(this.mapPullDto(dto));
      }

      if (toWrite.length > 0) {
        await this.db.orders.bulkPut(toWrite);
        mergedCount = toWrite.length;
      }
    });

    return mergedCount;
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
  mapPullDto(dto: OrderPullDto): Order {
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
      syncStatusId: SyncStatusId.Synced,
      syncedAt: new Date(),
      retryCount: 0,
      kitchenStatusId: dto.kitchenStatusId,
      cancellationReason: dto.cancellationReason,
      cancelledAt: dto.cancelledAt ? new Date(dto.cancelledAt) : undefined,
      tableId: dto.tableId,
      tableName: dto.tableName,
      cashRegisterSessionId: dto.cashRegisterSessionId ?? undefined,
      orderSource: dto.orderSource ?? OrderSource.Direct,
      externalOrderId: dto.externalOrderId,
      deliveryStatus: dto.deliveryStatus,
      deliveryCustomerName: dto.deliveryCustomerName,
      estimatedPickupAt: dto.estimatedPickupAt,
      orderDiscountCents: dto.orderDiscountCents ?? 0,
      totalDiscountCents: dto.totalDiscountCents ?? 0,
      orderPromotionId: dto.orderPromotionId,
      orderPromotionName: dto.orderPromotionName,
      payments: (dto.payments ?? []).map<OrderPayment>(p => ({
        id: p.id,
        method: p.method,
        paymentStatusId: PaymentStatus.Completed,
        amountCents: p.amountCents,
        reference: p.reference ?? undefined,
        paymentProvider: p.paymentProvider ?? undefined,
        externalTransactionId: p.externalTransactionId ?? undefined,
        transactionStatus: p.transactionStatus ?? undefined,
        authorizedAt: p.authorizedAt ? new Date(p.authorizedAt) : undefined,
        paymentMetadata: safeParseMetadata<PaymentMetadata>(p.paymentMetadata as unknown),
      })),
      items: (dto.items ?? []).map(item => ({
        id: String(item.id),
        product: {
          id: item.productId ?? 0,
          name: item.productName,
          priceCents: item.unitPriceCents,
          categoryId: 0,
          isAvailable: true,
          sizes: [],
          modifierGroups: [],
        },
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: item.unitPriceCents * item.quantity,
        discountCents: item.discountCents ?? 0,
        promotionId: item.promotionId,
        promotionName: item.promotionName,
        size: item.sizeName ? { id: 0, label: item.sizeName, priceDeltaCents: 0 } : undefined,
        extras: (item.extras ?? []).map(name => ({ id: 0, label: name, priceCents: 0 })),
        notes: item.notes ?? undefined,
        metadata: safeParseMetadata<OrderItemMetadata>(item.metadata as unknown),
      })),
    };
  }

  //#endregion

  //#region Private Helpers

  /**
   * Attempts to POST a single order to the backend API.
   * Classifies errors by HTTP status to determine retry strategy:
   *   - 2xx: success → mark 'Synced'
   *   - 409: table conflict → revert table assignment, retry without table
   *   - 4xx (except 408/409/429): permanent failure → mark 'PermanentlyFailed'
   *   - 429: transient → backoff using Retry-After header
   *   - 5xx / network / timeout: transient → increment retryCount with backoff
   *   - After MAX_RETRIES transient failures → 'PermanentlyFailed'
   * @param order The pending/failed order to sync
   */
  private async syncOrder(order: Order): Promise<void> {
    const retryCount = order.retryCount ?? 0;

    try {
      const dto = this.mapOrderToDto(order);
      await firstValueFrom(
        this.api.post<void>('/orders/sync', [dto]),
      );
      await this.db.orders.update(order.id, {
        syncStatusId: SyncStatusId.Synced,
        syncedAt: new Date(),
        lastSyncAttempt: new Date(),
      });
    } catch (error: any) {
      const status = error?.status ?? 0;

      // 409 Conflict — table already taken by another device (FDD-001)
      if (status === 409 && order.tableId != null) {
        console.warn(`[SyncService] Order ${order.id} got 409 — table ${order.tableId} conflict, reverting`);
        await this.handleTableConflict(order);
      } else if (this.isPermanentError(status)) {
        // 4xx (except 408 timeout, 409 conflict, 429 rate limit) — data is malformed, will never sync
        console.error(`[SyncService] Order ${order.id} permanently failed (HTTP ${status}):`, error);
        await this.db.orders.update(order.id, {
          syncStatusId: SyncStatusId.PermanentlyFailed,
          lastSyncAttempt: new Date(),
          retryCount: retryCount + 1,
        });
      } else if (retryCount + 1 >= MAX_RETRIES) {
        // Exceeded maximum retries — give up
        console.error(`[SyncService] Order ${order.id} exceeded ${MAX_RETRIES} retries — marking permanently failed`);
        await this.db.orders.update(order.id, {
          syncStatusId: SyncStatusId.PermanentlyFailed,
          lastSyncAttempt: new Date(),
          retryCount: retryCount + 1,
        });
      } else {
        // Transient failure (5xx, network, timeout, 429) — retry with backoff
        console.warn(`[SyncService] Order ${order.id} failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
        await this.db.orders.update(order.id, {
          syncStatusId: SyncStatusId.Failed,
          lastSyncAttempt: new Date(),
          retryCount: retryCount + 1,
        });
      }
    }
  }

  /**
   * Handles a 409 Conflict when the table is already taken.
   * Reverts the optimistic Dexie state and re-queues the order without tableId.
   * Uses lazy injection to break circular dependency with TableAssignmentService.
   */
  private async handleTableConflict(order: Order): Promise<void> {
    try {
      // Lazy-resolve to avoid circular dependency (TableAssignmentService → SyncService)
      const { TableAssignmentService } = await import('./table-assignment.service');
      const tableAssignment = this.injector.get(TableAssignmentService);
      await tableAssignment.revertTableAssignment(order.id, order.tableId!);
    } catch (err) {
      console.error('[SyncService] Failed to revert table assignment:', err);
    }
  }

  /**
   * Returns true for HTTP status codes that indicate the request
   * is fundamentally invalid and will never succeed on retry.
   * Excludes 408 (timeout), 409 (conflict — handled separately), and 429 (rate limit).
   */
  private isPermanentError(status: number): boolean {
    return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
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
        status: this.mapStatusIdToString(p.paymentStatusId),
        paymentStatusId: p.paymentStatusId,
        amountCents: p.amountCents,
        reference: p.reference ?? null,
        paymentProvider: p.paymentProvider ?? null,
        externalTransactionId: p.externalTransactionId ?? null,
        transactionStatus: p.transactionStatus ?? null,
        authorizedAt: p.authorizedAt ?? null,
        paymentMetadata: p.paymentMetadata ? JSON.stringify(p.paymentMetadata) : null,
      })),
      createdAt: order.createdAt,
      tableId: order.tableId ?? null,
      tableName: order.tableName ?? null,
      cashRegisterSessionId: order.cashRegisterSessionId,
      subtotalCents: order.subtotalCents ?? null,
      orderDiscountCents: order.orderDiscountCents ?? 0,
      totalDiscountCents: order.totalDiscountCents ?? 0,
      orderPromotionId: order.orderPromotionId ?? null,
      orderPromotionName: order.orderPromotionName ?? null,
      kitchenStatusId: order.kitchenStatusId ?? KitchenStatusId.Pending,
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
        metadata: item.metadata ? JSON.stringify(item.metadata) : null,
      })),
    };
  }

  /**
   * Maps a numeric PaymentStatus enum to the lowercase string token expected
   * by the backend (matched against `ToLowerInvariant()` on the API side).
   * The `status` string is required by the C# DTO contract; `paymentStatusId`
   * is preserved alongside as redundant metadata.
   */
  private mapStatusIdToString(statusId: PaymentStatus): string {
    switch (statusId) {
      case PaymentStatus.Pending:   return 'pending';
      case PaymentStatus.Completed: return 'completed';
      case PaymentStatus.Failed:    return 'failed';
      case PaymentStatus.Refunded:  return 'refunded';
      default:                      return 'pending';
    }
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
   * Refreshes all sync count signals from IndexedDB.
   * Call after manual retry/discard from the Sync Center UI.
   */
  async refreshCounts(): Promise<void> {
    await this.refreshPendingCount();
    await this.refreshPermanentlyFailedCount();
  }

  /**
   * Updates the pendingCount signal from the current IndexedDB state.
   * Counts both 'Pending' and 'Failed' (retryable) orders.
   */
  private async refreshPendingCount(): Promise<void> {
    const count = await this.db.orders
      .where('syncStatusId')
      .anyOf(SyncStatusId.Pending, SyncStatusId.Failed)
      .count();
    this.pendingCount.set(count);
  }

  /**
   * Updates the permanentlyFailedCount signal from IndexedDB.
   */
  private async refreshPermanentlyFailedCount(): Promise<void> {
    const count = await this.db.orders
      .where('syncStatusId')
      .equals(SyncStatusId.PermanentlyFailed)
      .count();
    this.permanentlyFailedCount.set(count);
  }

  /**
   * Starts a 30-second polling interval for push sync.
   * Only syncs when there are retryable orders AND the browser is online.
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

  /**
   * Schedules the next pull using adaptive intervals.
   * Uses setTimeout (not setInterval) to avoid re-entrancy overlap
   * and to allow dynamic interval adjustment based on activity.
   *
   * Tiers:
   *   - Active (recent changes):  15s
   *   - Moderate (3+ empty pulls): 30s
   *   - Idle (6+ empty pulls):     60s
   */
  private schedulePull(): void {
    const interval = this.getAdaptivePullInterval();

    this.pullTimerId = setTimeout(async () => {
      if (navigator.onLine) {
        await this.pullOrders();
      }
      // Schedule the next pull regardless — the interval adapts
      this.schedulePull();
    }, interval);
  }

  /** Returns the current pull interval based on recent activity */
  private getAdaptivePullInterval(): number {
    if (this.emptyPullStreak >= PULL_IDLE_THRESHOLD * 2) return PULL_INTERVAL_IDLE_MS;
    if (this.emptyPullStreak >= PULL_IDLE_THRESHOLD) return PULL_INTERVAL_SLOW_MS;
    return PULL_INTERVAL_DEFAULT_MS;
  }

  /** Stops the pull polling timeout */
  private stopPullPolling(): void {
    if (this.pullTimerId !== null) {
      clearTimeout(this.pullTimerId);
      this.pullTimerId = null;
    }
  }
  //#endregion

}
