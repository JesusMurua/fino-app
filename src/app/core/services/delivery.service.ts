import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Order } from '../models';
import { DeliveryStatus } from '../enums';

@Injectable({ providedIn: 'root' })
export class DeliveryService {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/delivery`;

  //#region State

  private readonly _orders = signal<Order[]>([]);
  private readonly _isOpen = signal(false);
  private readonly _loading = signal(false);

  readonly orders = this._orders.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly pendingCount = computed(() =>
    this._orders().filter(o =>
      o.deliveryStatus === DeliveryStatus.PendingAcceptance
    ).length
  );

  readonly pendingOrders = computed(() =>
    this._orders().filter(o =>
      o.deliveryStatus === DeliveryStatus.PendingAcceptance
    )
  );

  readonly acceptedOrders = computed(() =>
    this._orders().filter(o =>
      o.deliveryStatus === DeliveryStatus.Accepted
    )
  );

  readonly readyOrders = computed(() =>
    this._orders().filter(o =>
      o.deliveryStatus === DeliveryStatus.Ready
    )
  );

  //#endregion

  //#region Polling

  private pollingId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      if (this._isOpen()) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollingId = setInterval(() => this.loadActiveOrders(), 30_000);
  }

  private stopPolling(): void {
    if (this.pollingId !== null) {
      clearInterval(this.pollingId);
      this.pollingId = null;
    }
  }

  //#endregion

  //#region Panel Control

  toggle(): void {
    this._isOpen.update(v => !v);
  }

  close(): void {
    this._isOpen.set(false);
  }

  //#endregion

  //#region API Methods

  /** Loads active delivery orders from the API */
  loadActiveOrders(): void {
    this._loading.set(true);
    this.http.get<Order[]>(`${this.baseUrl}/active`).subscribe({
      next: (data) => {
        this._orders.set(data);
        this._loading.set(false);
      },
      error: () => {
        this._loading.set(false);
      },
    });
  }

  /** Accepts a pending delivery order */
  acceptOrder(orderId: string): Observable<Order> {
    return this.http.post<Order>(`${this.baseUrl}/${orderId}/accept`, {}).pipe(
      tap(updated => this.replaceOrder(updated)),
    );
  }

  /** Rejects a pending delivery order with a reason */
  rejectOrder(orderId: string, reason: string): Observable<Order> {
    return this.http.post<Order>(`${this.baseUrl}/${orderId}/reject`, { reason }).pipe(
      tap(updated => this.removeOrder(updated.id)),
    );
  }

  /** Marks an accepted delivery order as ready for pickup */
  markReady(orderId: string): Observable<Order> {
    return this.http.post<Order>(`${this.baseUrl}/${orderId}/ready`, {}).pipe(
      tap(updated => this.replaceOrder(updated)),
    );
  }

  /** Marks a ready order as picked up by the driver */
  markPickedUp(orderId: string): Observable<Order> {
    return this.http.post<Order>(`${this.baseUrl}/${orderId}/picked-up`, {}).pipe(
      tap(updated => this.removeOrder(updated.id)),
    );
  }

  //#endregion

  //#region Helpers

  private replaceOrder(updated: Order): void {
    this._orders.update(orders =>
      orders.map(o => o.id === updated.id ? updated : o),
    );
  }

  private removeOrder(orderId: string): void {
    this._orders.update(orders =>
      orders.filter(o => o.id !== orderId),
    );
  }

  //#endregion
}
