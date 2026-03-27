import { Injectable, OnDestroy, signal } from '@angular/core';

import { Order } from '../models';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

/** Polling interval for kitchen order refresh (milliseconds) */
const KITCHEN_POLL_INTERVAL_MS = 10_000;

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
   * Marks an order as done in Dexie and removes it from the active list.
   * @param orderId The order UUID to mark as completed
   */
  async markAsDone(orderId: string): Promise<void> {
    await this.db.orders.update(orderId, { kitchenStatus: 'done' });
    this.activeOrders.update(orders => orders.filter(o => o.id !== orderId));
  }

  //#endregion

  //#region Private Helpers

  /**
   * Loads today's orders for the active branch that are not marked as done.
   * Filters by branchId so only the current branch's orders are shown.
   * Treats undefined kitchenStatus as 'new' (legacy orders).
   */
  private async loadTodayOrders(): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const branchId = this.authService.branchId;

    const allToday = await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .filter(o => o.branchId === branchId)
      .toArray();

    const active = allToday
      .filter(o => (o.kitchenStatus ?? 'new') !== 'done')
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
