import { Component, Input, computed, inject } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { KitchenAudioService } from '../../../core/services/kitchen-audio.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';

/** Visual variant of the notification toggle */
type ToggleVariant = 'compact' | 'pill' | 'banner';

/**
 * Reusable button to request Web Push notification permission.
 *
 * - Renders only when permission is `'default'` (browser hasn't decided yet).
 * - On click: requests Push subscription AND unlocks the KDS audio context
 *   so the browser will allow `playNewOrderBeep()` afterwards.
 * - Variant `'compact'` is icon-only (44×44px) for dense headers like the KDS.
 * - Variant `'pill'` shows icon + label, ideal for the POS toolbar.
 * - Variant `'banner'` is a full-width CTA row for empty/landing states like
 *   the WaiterPos table picker.
 */
@Component({
  selector: 'app-notification-toggle',
  standalone: true,
  imports: [TooltipModule],
  templateUrl: './notification-toggle.component.html',
  styleUrl: './notification-toggle.component.scss',
})
export class NotificationToggleComponent {

  //#region Injections

  readonly pwaService = inject(PwaService);
  private readonly notificationService = inject(NotificationService);
  private readonly kitchenAudio = inject(KitchenAudioService);

  //#endregion

  //#region Inputs

  /** Visual style: 'compact' (icon only), 'pill' (icon + label), 'banner' (full-width CTA) */
  @Input() variant: ToggleVariant = 'pill';

  //#endregion

  //#region Computed

  /** True when the toggle should be visible (permission undecided) */
  readonly shouldRender = computed(() =>
    this.pwaService.notificationStatus() === 'default',
  );

  //#endregion

  //#region Actions

  /**
   * Requests notification permission and unlocks the audio context.
   * Both operations must run inside the same user gesture so the browser
   * allows the audio resume. We unlock first (synchronous) then await the
   * push subscription request.
   */
  async enable(): Promise<void> {
    // 1. Unlock audio context within the user gesture
    this.kitchenAudio.unlock();

    // 2. Request push subscription
    await this.notificationService.requestPermission();

    // 3. Sync the PwaService signal so the button hides immediately
    if (typeof Notification !== 'undefined') {
      this.pwaService.notificationStatus.set(Notification.permission);
    }
  }

  //#endregion
}
