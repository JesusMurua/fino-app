import { computed, inject, Injectable, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * Minimal typing for the beforeinstallprompt event.
 * Not part of the standard lib.dom.d.ts.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'pos_install_dismissed';

/**
 * Manages PWA install prompt and Service Worker update state.
 *
 * - Captures the browser's `beforeinstallprompt` event (Android / Desktop).
 * - Detects iOS devices where the prompt must be shown manually.
 * - Listens for SW version updates via SwUpdate.
 * - Exposes signals consumed by InstallBannerComponent and UpdateBannerComponent.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {

  private readonly swUpdate = inject(SwUpdate);

  //#region Private Signals

  private readonly deferredPrompt = signal<BeforeInstallPromptEvent | null>(null);

  private readonly isInstalled = signal(
    window.matchMedia('(display-mode: standalone)').matches,
  );

  private readonly isDismissed = signal(
    localStorage.getItem(DISMISSED_KEY) === 'true',
  );

  //#endregion

  //#region Public Signals

  /** True when running on an iOS device (manual install instructions needed) */
  readonly isIos = signal(/iPad|iPhone|iPod/.test(navigator.userAgent));

  /** Current Notification permission state ('default' | 'granted' | 'denied') */
  readonly notificationStatus = signal<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );

  /**
   * True when the install banner should be visible:
   * - App is not already installed
   * - User hasn't dismissed the banner
   * - A native prompt is available (Android/Desktop) OR device is iOS
   */
  readonly canShowBanner = computed(() =>
    !this.isInstalled() &&
    !this.isDismissed() &&
    (this.deferredPrompt() !== null || this.isIos()),
  );

  /** True when a new SW version has been downloaded and is ready to activate */
  readonly updateAvailable = signal(false);

  //#endregion

  //#region Constructor

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt.set(e as BeforeInstallPromptEvent);
    });

    window.addEventListener('appinstalled', () => {
      this.isInstalled.set(true);
      this.deferredPrompt.set(null);
    });

    // Listen for SW version updates
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
      ).subscribe(() => this.updateAvailable.set(true));
    }
  }

  //#endregion

  //#region Public Methods

  /** Triggers the native install prompt (Android / Desktop only) */
  async showInstallPrompt(): Promise<void> {
    const prompt = this.deferredPrompt();
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    this.deferredPrompt.set(null);
  }

  /** Activates the new SW version and reloads the page */
  async applyUpdate(): Promise<void> {
    if (!this.swUpdate.isEnabled) return;
    await this.swUpdate.activateUpdate();
    document.location.reload();
  }

  /** Hides the banner and persists the dismissal */
  dismissBanner(): void {
    this.isDismissed.set(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  }

  //#endregion
}
