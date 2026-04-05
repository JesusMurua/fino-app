import { Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';

import { CartService } from './cart.service';

/** Inactivity threshold before auto-lock (5 minutes) */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** How often to check idle state (every 30 seconds) */
const CHECK_INTERVAL_MS = 30_000;

/** Routes where idle lock should NOT apply */
const EXEMPT_ROUTES = ['/pin', '/login', '/register', '/setup', '/onboarding', '/kiosk'];

/**
 * Global idle-detection service for the POS application.
 *
 * Listens to DOM interactions (touch, pointer, keyboard) and automatically
 * locks the screen to /pin after IDLE_TIMEOUT_MS of inactivity.
 * Clears the cart and sessionStorage so the next user starts fresh.
 *
 * Does NOT wipe Dexie data or the JWT — the same user can re-enter
 * their PIN quickly to resume, and orders/sync are preserved.
 */
@Injectable({ providedIn: 'root' })
export class IdleService implements OnDestroy {

  //#region Properties

  /** True when idle lock has been triggered — UI can react */
  readonly isLocked = signal(false);

  /** Timestamp of the last user interaction */
  private lastActivity = Date.now();

  /** Polling interval handle */
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  /** Bound event handlers for cleanup */
  private readonly onActivity = () => this.resetTimer();

  /** Whether the service has been started */
  private isRunning = false;

  //#endregion

  //#region Constructor

  constructor(
    private readonly router: Router,
    private readonly cartService: CartService,
    private readonly ngZone: NgZone,
  ) {}

  //#endregion

  //#region Public API

  /**
   * Starts idle monitoring. Safe to call multiple times.
   * Runs the check interval outside Angular zone to avoid
   * triggering change detection every 30 seconds.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastActivity = Date.now();

    document.addEventListener('pointerdown', this.onActivity, { passive: true });
    document.addEventListener('keydown', this.onActivity, { passive: true });

    this.ngZone.runOutsideAngular(() => {
      this.checkTimer = setInterval(() => this.checkIdle(), CHECK_INTERVAL_MS);
    });
  }

  /** Resets the idle timer — call on any user interaction */
  resetTimer(): void {
    this.lastActivity = Date.now();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  //#endregion

  //#region Private Helpers

  /** Stops monitoring and removes event listeners */
  private stop(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    document.removeEventListener('pointerdown', this.onActivity);
    document.removeEventListener('keydown', this.onActivity);
    this.isRunning = false;
  }

  /** Checks if idle threshold is exceeded and locks if needed */
  private checkIdle(): void {
    if (Date.now() - this.lastActivity < IDLE_TIMEOUT_MS) return;

    // Don't lock if already on an exempt route
    const url = this.router.url;
    if (EXEMPT_ROUTES.some(r => url.startsWith(r))) return;

    this.ngZone.run(() => this.lock());
  }

  /** Locks the screen: clears session state and navigates to /pin */
  private async lock(): Promise<void> {
    this.isLocked.set(true);

    // Clear transient state so next user starts fresh
    await this.cartService.clearCart();
    sessionStorage.removeItem('activeTable');
    sessionStorage.removeItem('addingToOrder');

    this.router.navigate(['/pin']);

    // Reset after navigation so the flag can be re-used
    this.isLocked.set(false);
    this.lastActivity = Date.now();
  }

  //#endregion

}
