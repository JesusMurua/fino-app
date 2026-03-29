import { Injectable, OnDestroy, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Order } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

/** Polling interval for kitchen order refresh (milliseconds) */
const KITCHEN_POLL_INTERVAL_MS = 30_000;

/**
 * Manages active kitchen orders for the KDS (Kitchen Display System).
 *
 * - Loads today's orders from Dexie where kitchenStatus != 'done'
 * - Polls every 10 seconds for new orders
 * - Provides markAsDone() to complete an order from the display
 */
@Injectable({ providedIn: 'root' })
export class KitchenService implements OnDestroy {

  //#region Properties
  /** Active orders for the kitchen display (not done, today only) */
  readonly activeOrders = signal<Order[]>([]);

  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  //#endregion

  //#region Constructor & Lifecycle
  constructor(
    private readonly api: ApiService,
    private readonly db: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  ngOnDestroy(): void {
    this.stopPolling();
  }
  //#endregion

  //#region Public Methods

  /**
   * Starts loading orders and polling. Call from the kitchen display component.
   */
  async start(): Promise<void> {
    await this.loadTodayOrders();
    this.startPolling();
  }

  /**
   * Stops polling. Call when leaving the kitchen display.
   */
  stop(): void {
    this.stopPolling();
  }

  /**
   * Marks an order as Ready locally and notifies the backend.
   * The order disappears from the KDS view.
   * Offline-first: Dexie is always updated; the API call is best-effort.
   * @param orderId The order UUID to mark as ready
   */
  async markAsReady(orderId: string): Promise<void> {
    await this.db.orders.update(orderId, { kitchenStatus: 'Ready' });
    this.activeOrders.update(orders => orders.filter(o => o.id !== orderId));

    try {
      await firstValueFrom(
        this.api.patch(`/orders/${orderId}/kitchen-status`, { status: 'Ready' }),
      );
    } catch {
      console.warn('[KitchenService] API unreachable — order marked locally only');
    }
  }

  /**
   * Reloads today's orders. Exposed publicly so NotificationService
   * can trigger an immediate refresh when a push arrives.
   */
  async refreshOrders(): Promise<void> {
    await this.loadTodayOrders();
  }

  //#endregion

  //#region Private Helpers

  /**
   * Loads today's orders for the active branch that are pending or preparing.
   * Filters by branchId so only the current branch's orders are shown.
   * Orders with status Ready or Delivered are not shown in the KDS.
   */
  private async loadTodayOrders(): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const branchId = this.authService.branchId;
    const kdsStatuses = new Set(['Pending']);

    const allToday = await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .filter(o => o.branchId === branchId)
      .toArray();

    const active = allToday
      .filter(o => kdsStatuses.has(o.kitchenStatus ?? 'Pending'))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    this.activeOrders.set(active);
  }

  private startPolling(): void {
    this.pollTimerId = setInterval(() => this.loadTodayOrders(), KITCHEN_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimerId !== null) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }

  //#endregion

}
