import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';

/**
 * Manages Web Push notification subscriptions.
 *
 * - Requests notification permission and subscribes via SwPush
 * - Sends the PushSubscription to the backend for server-side push
 * - Listens for incoming push messages and notification clicks
 * - Unsubscribes on logout (called from logout-triggering components)
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {

  //#region Properties

  private readonly swPush = inject(SwPush);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  //#endregion

  //#region Constructor

  constructor() {
    if (!this.swPush.isEnabled) return;

    // Push received while app is in foreground
    this.swPush.messages.subscribe((msg) => {
      console.info('[NotificationService] Push received:', msg);
    });

    // User clicked on a notification
    this.swPush.notificationClicks.subscribe(({ notification }) => {
      const orderId = notification?.data?.orderId;
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
   * Called before logout — best-effort, never throws.
   */
  async unsubscribe(): Promise<void> {
    if (!this.swPush.isEnabled) return;

    try {
      await firstValueFrom(this.api.delete('/push/unsubscribe'));
    } catch {
      // Silent — user is logging out anyway
    }
  }

  //#endregion
}
