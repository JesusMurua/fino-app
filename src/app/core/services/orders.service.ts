import { Injectable, OnDestroy, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';

import { Order } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

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
 *   delivered → Lista entregada (blue)
 *   kitchenStatus 'done' → Lista (green)
 *   kitchenStatus 'new'  → En cocina (orange)
 *   kitchenStatus undefined → Nueva (grey)
 */
export function getDisplayStatus(order: Order): OrderDisplayStatus {
  if (order.cancellationStatus === 'cancelled') {
    return { label: 'Cancelada', color: '#6B7280', bgColor: 'rgba(107, 114, 128, 0.1)' };
  }
  if (order.deliveryStatus === 'delivered') {
    return { label: 'Entregada', color: '#2563EB', bgColor: 'rgba(37, 99, 235, 0.1)' };
  }
  if (order.kitchenStatus === 'done') {
    return { label: 'Lista', color: '#16A34A', bgColor: 'rgba(22, 163, 74, 0.1)' };
  }
  if (order.kitchenStatus === 'new') {
    return { label: 'En cocina', color: '#EA580C', bgColor: 'rgba(234, 88, 12, 0.1)' };
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
   * Marks an order as delivered in Dexie and updates the local list.
   * @param orderId The order UUID to mark as delivered
   */
  async markAsDelivered(orderId: string): Promise<void> {
    await this.db.orders.update(orderId, { deliveryStatus: 'delivered' });
    this.todayOrders.update(orders =>
      orders.map(o => o.id === orderId ? { ...o, deliveryStatus: 'delivered' as const } : o),
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
      cancellationStatus: 'cancelled',
      cancellationReason: reason,
      cancelledAt: now,
      syncStatus: 'pending',
    });

    this.todayOrders.update(orders =>
      orders.map(o => o.id === orderId
        ? { ...o, cancellationStatus: 'cancelled' as const, cancellationReason: reason, cancelledAt: now, syncStatus: 'pending' as const }
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
   * Filters by branchId so only the current branch's orders are shown.
   */
  private async loadTodayOrders(): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const branchId = this.authService.branchId;

    const orders = await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .filter(o => o.branchId === branchId)
      .toArray();

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
