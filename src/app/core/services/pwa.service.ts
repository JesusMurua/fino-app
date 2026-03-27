import { computed, Injectable, signal } from '@angular/core';

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
 * Manages PWA install prompt state.
 *
 * - Captures the browser's `beforeinstallprompt` event (Android / Desktop).
 * - Detects iOS devices where the prompt must be shown manually.
 * - Exposes a `canShowBanner` signal consumed by InstallBannerComponent.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {

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

  /** Hides the banner and persists the dismissal */
  dismissBanner(): void {
    this.isDismissed.set(true);
    localStorage.setItem(DISMISSED_KEY, 'true');
  }

  //#endregion
}
