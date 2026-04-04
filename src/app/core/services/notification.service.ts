import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { MessageService } from 'primeng/api';
import { firstValueFrom, timeout, catchError, EMPTY } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';
import { KitchenService } from './kitchen.service';

/**
 * Manages Web Push notification subscriptions.
 *
 * - Requests notification permission and subscribes via SwPush
 * - Sends the PushSubscription to the backend for server-side push
 * - Shows a PrimeNG toast when a push arrives while the app is open
 * - Refreshes KDS orders on notification click
 * - Unsubscribes on logout (called from logout-triggering components)
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {

  //#region Properties

  private readonly swPush = inject(SwPush);
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);
  private readonly kitchenService = inject(KitchenService);

  //#endregion

  //#region Constructor

  constructor() {
    if (!this.swPush.isEnabled) return;

    // Push received while app is in foreground — show toast
    this.swPush.messages.subscribe((msg: Record<string, any>) => {
      this.messageService.add({
        severity: 'info',
        summary: msg['title'] ?? 'Notificación',
        detail: msg['body'] ?? '',
        life: 5000,
      });

      // Refresh KDS if a kitchen-related push arrives
      this.kitchenService.refresh();
    });

    // User clicked on a notification — navigate and refresh
    this.swPush.notificationClicks.subscribe(({ notification }) => {
      const orderId = notification?.data?.orderId;
      this.kitchenService.refresh();
      if (orderId) {
        this.router.navigate(['/orders'], { queryParams: { id: orderId } });
      }
    });
  }

  //#endregion

  //#region Public Methods

  /**
   * Requests notification permission and sends the PushSubscription
   * to the backend. Best-effort — never blocks the UI.
   */
  async requestPermission(): Promise<void> {
    if (!this.swPush.isEnabled) return;

    try {
      const subscription = await this.swPush.requestSubscription({
        serverPublicKey: environment.vapidPublicKey,
      });

      const json = subscription.toJSON();

      await firstValueFrom(
        this.api.post('/push/subscribe', {
          endpoint: json.endpoint,
          p256dh: json.keys?.['p256dh'],
          auth: json.keys?.['auth'],
          deviceInfo: navigator.userAgent,
        }),
      );

      console.info('[NotificationService] Push subscription saved');
    } catch (error) {
      console.warn('[NotificationService] Push subscription failed:', error);
    }
  }

  /**
   * Removes the push subscription from the backend.
   * Called before logout — fire-and-forget, never blocks.
   * Uses HttpClient directly (bypasses authInterceptor) to avoid
   * a 401 → logout loop when the token is already cleared.
   */
  unsubscribe(): void {
    if (!this.swPush.isEnabled) return;

    const token = localStorage.getItem('pos_auth_token');
    if (!token) return;

    this.http.delete(`${environment.apiUrl}/push/unsubscribe`, {
      headers: { Authorization: `Bearer ${token}` },
    }).pipe(
      timeout(3000),
      catchError(() => EMPTY),
    ).subscribe();
  }

  //#endregion
}
