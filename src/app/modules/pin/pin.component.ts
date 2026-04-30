import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router, RouterModule } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { CartService } from '../../core/services/cart.service';
import { CashRegisterService } from '../../core/services/cash-register.service';
import { ConfigService } from '../../core/services/config.service';
import { DeviceRoutingService } from '../../core/services/device-routing.service';
import { InventoryService } from '../../core/services/inventory.service';
import { DeviceService } from '../../core/services/device.service';
import { NotificationService } from '../../core/services/notification.service';
import { OrderContextService } from '../../core/services/order-context.service';
import { ProductService } from '../../core/services/product.service';
import { PromotionService } from '../../core/services/promotion.service';
import { RouteAccessPolicy } from '../../core/services/route-access-policy.service';
import { SyncService } from '../../core/services/sync.service';
import { TableService } from '../../core/services/table.service';
import {
  HardwareOnlyMode,
  HardwareOnlyScreenDialogComponent,
} from '../../shared/components/hardware-only-screen-dialog/hardware-only-screen-dialog.component';

/** Keys available on the PIN numpad */
type NumpadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'del';

/** Brute force lockout thresholds */
const LOCKOUT_SHORT_ATTEMPTS = 3;
const LOCKOUT_MEDIUM_ATTEMPTS = 6;
const LOCKOUT_PERMANENT_ATTEMPTS = 10;
const LOCKOUT_SHORT_SECONDS = 15;
const LOCKOUT_MEDIUM_SECONDS = 60;

/** sessionStorage keys for brute force state */
const SS_ATTEMPTS = 'pin_failed_attempts';
const SS_LOCK_UNTIL = 'pin_lock_until';

@Component({
  selector: 'app-pin',
  standalone: true,
  imports: [RouterModule, HardwareOnlyScreenDialogComponent],
  templateUrl: './pin.component.html',
  styleUrl: './pin.component.scss',
})
export class PinComponent implements OnInit {

  //#region Properties

  /** Current digits entered (max 4) */
  readonly digits = signal<string[]>([]);

  /** True while showing the shake + error state */
  readonly hasError = signal(false);

  /** True while waiting for API response */
  readonly isLoading = signal(false);

  /** True when the last auth was performed offline */
  readonly isOffline = signal(false);

  /** True when the device has no network connection */
  readonly isDeviceOffline = signal(!navigator.onLine);

  /** True when this device has been provisioned with a device token */
  readonly isDeviceBound = signal(inject(DeviceService).getDeviceToken() !== null);

  /** Number of consecutive failed attempts */
  readonly failedAttempts = signal(0);

  /** True when locked out due to too many failed attempts */
  readonly isLockedOut = signal(false);

  /** Seconds remaining in the lockout cooldown */
  readonly lockoutSeconds = signal(0);

  /** True when permanently locked (10+ attempts) — requires app restart */
  readonly isPermanentLock = signal(false);

  /** Non-null when the last PIN login hit a hardware-only shell (KDS/Kiosk) */
  readonly hardwareShellError = signal<HardwareOnlyMode | null>(null);

  /** Flat key list for the 3x4 grid (last row: empty slot, 0, del) */
  readonly keys: (NumpadKey | null)[] = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    null, '0', 'del',
  ];

  private lockoutTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onOnline = () => this.isDeviceOffline.set(false);
  private readonly onOffline = () => this.isDeviceOffline.set(true);

  //#endregion

  private readonly cartService = inject(CartService);
  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly configService = inject(ConfigService);
  private readonly deviceRoutingService = inject(DeviceRoutingService);
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);
  private readonly notificationService = inject(NotificationService);
  private readonly promotionService = inject(PromotionService);
  private readonly orderContextService = inject(OrderContextService);
  private readonly routeAccessPolicy = inject(RouteAccessPolicy);
  private readonly syncService = inject(SyncService);
  private readonly tableService = inject(TableService);

  //#region Constructor
  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.restoreLockoutState();
  }

  //#endregion

  //#region Numpad Actions

  /** Adds a digit if fewer than 4 have been entered, then auto-submits at 4 */
  addDigit(digit: string): void {
    if (this.digits().length >= 4 || this.isLoading() || this.isLockedOut() || this.isPermanentLock()) return;
    this.digits.update(d => [...d, digit]);

    if (this.digits().length === 4) {
      this.submit();
    }
  }

  /** Removes the last entered digit */
  removeDigit(): void {
    this.digits.update(d => d.slice(0, -1));
    this.hasError.set(false);
  }

  /** Handles a numpad key press */
  onKey(key: NumpadKey | null): void {
    if (!key) return;
    if (key === 'del') {
      this.removeDigit();
    } else {
      this.addDigit(key);
    }
  }

  //#endregion

  //#region Auth

  /**
   * Verifies the entered PIN (online or offline), preloads essential data,
   * and redirects by role. Includes brute force protection.
   */
  async submit(): Promise<void> {
    const pin = this.digits().join('');
    this.isLoading.set(true);
    this.isOffline.set(false);

    const deviceBranchId = this.configService.deviceConfig$.getValue().branchId;
    const branchId = deviceBranchId > 0 ? deviceBranchId : this.authService.branchId;
    const result = await this.authService.pinLogin(branchId, pin);

    this.isLoading.set(false);

    if (result.user) {
      // Success — reset brute force state
      this.resetLockoutState();
      this.isOffline.set(result.offline);

      // Clear previous user's transient state
      await this.cleanupPreviousSession();

      // Preload essential data into Dexie — config must load before navigation
      try {
        await Promise.all([
          this.configService.load(),
          this.productService.loadCatalog(),
          this.inventoryService.loadFromApi(),
          this.tableService.loadTables(this.authService.activeBranchId()),
        ]);
      } catch (error) {
        console.warn('[PinComponent] Preload failed — components will retry on mount:', error);
      }

      // Block navigation on the cash session lookup so the POS shell
      // never flashes the "Caja Cerrada" blocker on cold-boot — the
      // service ordering (`ensureLinkedRegisterResolved` → `getOpenSession`)
      // guarantees the query carries the right `registerId` filter.
      // Fail-open: if the API hiccups (offline, 5xx) we still navigate
      // so the cashier is not trapped on the PIN screen; the polling
      // tick will rehydrate the session as soon as the network recovers.
      try {
        await this.cashRegisterService.loadActiveSession(this.authService.activeBranchId());
      } catch {
        // Intentionally swallowed — see comment above.
      }

      // Other background loads stay fire-and-forget — they do not gate
      // the POS shell rendering.
      this.syncService.pullTodayOrders().catch(() => {});
      this.authService.refreshSubscriptionStatus();

      // Refresh server-side session state (onboarding, role, plan). Skipped
      // automatically for offline sessions by `AuthService.rehydrate`.
      if (!result.offline) {
        try {
          await firstValueFrom(this.authService.rehydrate());
        } catch {
          // Fail-open: the freshly-minted PIN session is already correct.
        }
      }

      // Resolve the role-appropriate destination BEFORE honoring any
      // stored returnUrl, so we can gate the URL behind RouteAccessPolicy.
      const resolved = this.deviceRoutingService.getPostLoginRoute(result.user.roleId);

      if (resolved.kind === 'error') {
        // Human PIN on a hardware-only device. Clear any stored
        // returnUrl so a future legitimate login is not redirected
        // anywhere surprising, and surface the modal.
        this.authService.consumeReturnUrl();
        this.hardwareShellError.set(resolved.mode);
        return;
      }

      const returnUrl = this.authService.consumeReturnUrl();
      const targetUrl = this.routeAccessPolicy.isAllowed(result.user.roleId, returnUrl)
        ? returnUrl!
        : resolved.route;

      this.router.navigateByUrl(targetUrl);

      // Request push notification permission (best-effort, non-blocking)
      this.notificationService.requestPermission();
    } else {
      // Failed — increment brute force counter
      this.incrementAttempts();

      this.hasError.set(true);
      setTimeout(() => {
        this.digits.set([]);
        this.hasError.set(false);
      }, 600);
    }
  }

  //#endregion

  //#region Hardware-Only Shell Dialog

  /** User acknowledged the hardware-shell block — clear PIN and close modal */
  onHardwareShellDismiss(): void {
    this.hardwareShellError.set(null);
    this.digits.set([]);
    this.hasError.set(false);
  }

  /** User asked to re-provision the device as a POS */
  onHardwareShellReprovision(): void {
    this.hardwareShellError.set(null);
    this.router.navigate(['/setup'], { queryParams: { reason: 'reprovision' } });
  }

  //#endregion

  //#region Session Cleanup

  /**
   * Clears transient state from the previous user's session.
   * Ensures the next user starts with a clean slate.
   */
  private async cleanupPreviousSession(): Promise<void> {
    await this.cartService.clearCart();
    this.promotionService.clearCoupon();
    this.orderContextService.clearAllContext();
  }

  //#endregion

  //#region Brute Force Protection

  /** Restores lockout state from sessionStorage on component init */
  private restoreLockoutState(): void {
    const attempts = parseInt(sessionStorage.getItem(SS_ATTEMPTS) ?? '0', 10);
    this.failedAttempts.set(attempts);

    if (attempts >= LOCKOUT_PERMANENT_ATTEMPTS) {
      this.isPermanentLock.set(true);
      return;
    }

    const lockUntil = parseInt(sessionStorage.getItem(SS_LOCK_UNTIL) ?? '0', 10);
    if (lockUntil > Date.now()) {
      this.startLockoutCountdown(lockUntil);
    }
  }

  /** Increments failed attempts and applies lockout if thresholds are met */
  private incrementAttempts(): void {
    const attempts = this.failedAttempts() + 1;
    this.failedAttempts.set(attempts);
    sessionStorage.setItem(SS_ATTEMPTS, attempts.toString());

    if (attempts >= LOCKOUT_PERMANENT_ATTEMPTS) {
      this.isPermanentLock.set(true);
      return;
    }

    let lockSeconds = 0;
    if (attempts >= LOCKOUT_MEDIUM_ATTEMPTS) {
      lockSeconds = LOCKOUT_MEDIUM_SECONDS;
    } else if (attempts >= LOCKOUT_SHORT_ATTEMPTS) {
      lockSeconds = LOCKOUT_SHORT_SECONDS;
    }

    if (lockSeconds > 0) {
      const lockUntil = Date.now() + lockSeconds * 1000;
      sessionStorage.setItem(SS_LOCK_UNTIL, lockUntil.toString());
      this.startLockoutCountdown(lockUntil);
    }
  }

  /** Starts a visible countdown timer for the lockout period */
  private startLockoutCountdown(lockUntil: number): void {
    this.isLockedOut.set(true);
    this.digits.set([]);

    const tick = () => {
      const remaining = Math.ceil((lockUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        this.isLockedOut.set(false);
        this.lockoutSeconds.set(0);
        if (this.lockoutTimer !== null) {
          clearInterval(this.lockoutTimer);
          this.lockoutTimer = null;
        }
      } else {
        this.lockoutSeconds.set(remaining);
      }
    };

    tick();
    this.lockoutTimer = setInterval(tick, 1000);
  }

  /** Resets brute force state on successful login */
  private resetLockoutState(): void {
    this.failedAttempts.set(0);
    this.isLockedOut.set(false);
    this.isPermanentLock.set(false);
    this.lockoutSeconds.set(0);
    sessionStorage.removeItem(SS_ATTEMPTS);
    sessionStorage.removeItem(SS_LOCK_UNTIL);
    if (this.lockoutTimer !== null) {
      clearInterval(this.lockoutTimer);
      this.lockoutTimer = null;
    }
  }

  //#endregion

}
