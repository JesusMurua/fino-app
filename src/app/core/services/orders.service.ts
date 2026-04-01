import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';

import { Order } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';
import { SyncService } from './sync.service';

/** Polling interval for order list refresh (milliseconds) */
const ORDERS_POLL_INTERVAL_MS = 10_000;

/** Display status computed from order fields */
export interface OrderDisplayStatus {
  label: string;
  color: string;
  bgColor: string;
}

/**
 * Pure function — computes the visual display status of an order.
 *
 * Priority (highest first):
 *   cancelledAt → Cancelada (gray)
 *   Delivered   → Entregado (blue)
 *   Ready       → Listo (green)
 *   Pending     → En cocina (amber)
 *   undefined   → Nueva (gray)
 */
export function getDisplayStatus(order: Order): OrderDisplayStatus {
  if (order.cancelledAt) {
    return { label: 'Cancelada', color: '#6B7280', bgColor: 'rgba(107, 114, 128, 0.1)' };
  }
  if (order.kitchenStatus === 'Delivered') {
    return { label: 'Entregado', color: '#3B82F6', bgColor: 'rgba(59, 130, 246, 0.1)' };
  }
  if (order.kitchenStatus === 'Ready') {
    return { label: 'Listo', color: '#10B981', bgColor: 'rgba(16, 185, 129, 0.1)' };
  }
  if (order.kitchenStatus === 'Pending') {
    return { label: 'En cocina', color: '#F59E0B', bgColor: 'rgba(245, 158, 11, 0.1)' };
  }
  return { label: 'Nueva', color: '#6B7280', bgColor: 'rgba(107, 114, 128, 0.1)' };
}

/**
 * Manages the full order list for the cashier orders view (/orders).
 *
 * - Loads all of today's orders from Dexie
 * - Polls every 10 seconds for updates
 * - Provides markAsDelivered() for cashiers
 */
@Injectable({ providedIn: 'root' })
export class OrdersService implements OnDestroy {

  //#region Properties
  /** All of today's orders, sorted oldest first */
  readonly todayOrders = signal<Order[]>([]);

  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  //#endregion

  //#region Constructor & Lifecycle
  private readonly syncService = inject(SyncService);

  constructor(
    private readonly db: DatabaseService,
    private readonly api: ApiService,
    private readonly authService: AuthService,
  ) {}

  ngOnDestroy(): void {
    this.stopPolling();
  }
  //#endregion

  //#region Public Methods

  /** Starts loading orders and polling. Call from the orders list component. */
  async start(): Promise<void> {
    await this.loadTodayOrders();
    this.startPolling();
  }

  /** Stops polling. Call when leaving the orders list. */
  stop(): void {
    this.stopPolling();
  }

  /**
   * Marks an order as delivered by updating kitchenStatus to Delivered.
   * @param orderId The order UUID to mark as delivered
   */
  async markAsDelivered(orderId: string): Promise<void> {
    await this.db.orders.update(orderId, { kitchenStatus: 'Delivered' });
    this.todayOrders.update(orders =>
      orders.map(o => o.id === orderId ? { ...o, kitchenStatus: 'Delivered' as const } : o),
    );
  }

  /**
   * Cancels an order locally in Dexie and queues sync to backend.
   * @param orderId UUID of the order to cancel
   * @param reason Selected cancellation reason
   * @param notes Optional additional notes
   */
  async cancelOrder(orderId: string, reason: string, notes?: string): Promise<void> {
    const now = new Date();

    await this.db.orders.update(orderId, {
      cancellationReason: reason,
      cancelledAt: now,
      syncStatus: 'Pending',
    });

    this.todayOrders.update(orders =>
      orders.map(o => o.id === orderId
        ? { ...o, cancellationReason: reason, cancelledAt: now, syncStatus: 'Pending' as const }
        : o,
      ),
    );

    // Fire and forget — sync to backend
    this.api.patch(`/orders/${orderId}/cancel`, { reason, notes }).pipe(
      catchError(error => {
        console.error(`[OrdersService] Failed to sync cancellation for ${orderId}:`, error);
        return EMPTY;
      }),
    ).subscribe();
  }

  //#endregion

  //#region Private Helpers

  /**
   * Loads today's orders for the active branch from Dexie, sorted oldest first.
   * Falls back to API if Dexie returns no orders (new session/device).
   */
  private async loadTodayOrders(): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const branchId = this.authService.branchId;

    let orders = await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .filter(o => o.branchId === branchId)
      .toArray();

    // Fallback: fetch from API if Dexie is empty
    if (orders.length === 0 && navigator.onLine) {
      try {
        const dateParam = todayStart.toISOString().split('T')[0];
        const dtos = await firstValueFrom(
          this.api.get<any[]>(`/orders?date=${dateParam}`),
        );
        if (dtos?.length) {
          const mapped = dtos.map(dto => this.syncService.mapPullDto(dto));
          await this.db.orders.bulkPut(mapped);
          orders = mapped.filter(o => o.branchId === branchId);
        }
      } catch (err) {
        console.warn('[OrdersService] API fallback failed:', err);
      }
    }

    orders.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    this.todayOrders.set(orders);
  }

  private startPolling(): void {
    this.pollTimerId = setInterval(() => this.loadTodayOrders(), ORDERS_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimerId !== null) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }

  //#endregion

}
