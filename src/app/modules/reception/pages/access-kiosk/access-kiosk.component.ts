import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';

import { LiveAccessEvent } from '../../../../core/models/access-event.model';
import { AccessDashboardSignalrService } from '../../../../core/services/access-dashboard.signalr.service';
import { CatalogService } from '../../../../core/services/catalog.service';
import { ConfigService } from '../../../../core/services/config.service';

/**
 * Discrete UI state surfaced by the kiosk. Drives gradient, icon and copy.
 *
 *   - `IDLE`    — no recent event (or auto-clear timer expired). Shows
 *                 brand + clock + invitation copy.
 *   - `GRANTED` — last event was `isGranted: true`. Warm green welcome.
 *   - `DENIED`  — known customer rejected (membership expired/frozen/etc).
 *                 Red, longer dwell so the cashier-less message lands.
 *   - `UNKNOWN` — `customerId === null` (unrecognized QR/biometric).
 *                 Amber short banner pointing the visitor to reception.
 *   - `UPSELL`  — tenant plan lacks `RealtimeAccessControl`; the SignalR
 *                 hub aborts every reconnect, so we render a static
 *                 plan-locked notice instead of churning the retry loop.
 */
type KioskBannerState = 'IDLE' | 'GRANTED' | 'DENIED' | 'UNKNOWN' | 'UPSELL';

/**
 * Display-ready projection of `LiveAccessEvent` enriched with the
 * resolved reason label and a reserved `customerPhotoUrl` slot. The
 * portrait is currently unwired (Phase 5 MVP renders an icon fallback);
 * the slot stays in the contract so a later UX iteration that fetches
 * the photo from Dexie or extends the wire DTO drops in without a
 * template refactor.
 */
interface DisplayedAttempt {
  isGranted: boolean;
  customerId: number | null;
  customerName: string | null;
  /** Reserved for premium UX — populated by Dexie lookup or extended DTO. */
  customerPhotoUrl: string | null;
  reasonLabel: string;
  receivedAt: Date;
}

/**
 * Auto-clear dwell times keyed by banner state, calibrated for the
 * reading affordance each message needs:
 *
 *   - GRANTED 7 s — warm acknowledgement; the client glances and walks in.
 *   - DENIED 10 s — needs reading the specific reason ("vencida 12/05").
 *   - UNKNOWN 3 s — short directive ("acude a recepción") that does not
 *                   need contemplation; clears fast so the next attempt
 *                   surfaces immediately.
 *   - IDLE / UPSELL — no timer (they ARE the rest states).
 */
const DISPLAY_DURATION_MS: Record<KioskBannerState, number> = {
  IDLE: 0,
  GRANTED: 7000,
  DENIED: 10000,
  UNKNOWN: 3000,
  UPSELL: 0,
};

/**
 * Wall-mounted reception kiosk for the Gym vertical.
 *
 * Pure-display component: subscribes to `AccessDashboardSignalrService`
 * and surfaces the latest `AccessAttempted` broadcast as a full-screen
 * billboard. The physical reader (QR / biometric) is the input; this
 * component never accepts manual input — receptionists with edge cases
 * fall back to `/admin/access-dashboard` on a separate device.
 *
 * Device-only context (no user JWT). Reads branch/business display
 * names from `DeviceConfig` (localStorage), so the idle screen renders
 * even before the SignalR socket completes its handshake.
 */
@Component({
  selector: 'app-access-kiosk',
  standalone: true,
  imports: [],
  templateUrl: './access-kiosk.component.html',
  styleUrl: './access-kiosk.component.scss',
})
export class AccessKioskComponent implements OnInit, OnDestroy {

  //#region Injections

  readonly signalrService = inject(AccessDashboardSignalrService);
  private readonly catalogService = inject(CatalogService);
  private readonly configService = inject(ConfigService);

  //#endregion

  //#region State

  /** `accessReasonId` → Spanish label from `/catalog/access-reasons`. */
  private readonly reasonMap = signal<Map<number, string>>(new Map());

  /** Currently surfaced attempt — `null` while the banner is in IDLE. */
  readonly displayedAttempt = signal<DisplayedAttempt | null>(null);

  /** Tick source for the IDLE clock — re-evaluated every second. */
  readonly now = signal(new Date());
  private clockInterval: ReturnType<typeof setInterval> | null = null;

  /** Auto-clear handle — reset on every new event so dwell is per-event. */
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Guards against re-surfacing the same event if the SignalR signal
   * re-emits without a genuinely new arrival (defensive — should not
   * happen in practice since the buffer prepends, but cheap insurance).
   */
  private lastSurfacedLocalId: string | null = null;

  //#endregion

  //#region Computeds

  /** Business name cached at device activation; falls back to a greeting. */
  readonly businessName = computed(() =>
    this.configService.loadDeviceConfig().businessName || 'Bienvenido',
  );

  /** Branch name shown beneath the business name when available. */
  readonly branchName = computed(() =>
    this.configService.loadDeviceConfig().branchName || '',
  );

  /** Wall-clock time in HH:mm (24h, es-MX locale). */
  readonly timeLabel = computed(() => TIME_FORMATTER.format(this.now()));

  /** Date "miércoles 17 de mayo" style label (es-MX). */
  readonly dateLabel = computed(() => DATE_FORMATTER.format(this.now()));

  /** Derived banner state — single source of truth for the template. */
  readonly bannerState = computed<KioskBannerState>(() => {
    if (this.signalrService.connectionState() === 'unauthorized') return 'UPSELL';
    const attempt = this.displayedAttempt();
    if (!attempt) return 'IDLE';
    if (attempt.isGranted) return 'GRANTED';
    if (attempt.customerId === null) return 'UNKNOWN';
    return 'DENIED';
  });

  //#endregion

  //#region Lifecycle

  constructor() {
    // Reactive bridge from the SignalR feed to the kiosk display.
    // The service's `recentAttempts` buffer prepends new events, so
    // index 0 is always the latest. We track `lastSurfacedLocalId`
    // because the effect can fire on initial subscription with an
    // empty array (latest = undefined → no-op) and we never want to
    // re-surface a stale buffer head after a re-render.
    effect(() => {
      const latest = this.signalrService.recentAttempts()[0];
      if (!latest) return;
      if (latest.localId === this.lastSurfacedLocalId) return;
      this.lastSurfacedLocalId = latest.localId;
      this.surface(latest);
    });
  }

  ngOnInit(): void {
    void this.bootstrap();
  }

  ngOnDestroy(): void {
    if (this.clockInterval !== null) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    if (this.clearTimer !== null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    void this.signalrService.stopConnection();
  }

  //#endregion

  //#region Bootstrap

  /**
   * Loads the reason catalog first (so the very first event renders
   * with a human label instead of the raw int id), then opens the
   * SignalR connection. Reason load failures degrade gracefully — the
   * banner just renders "Motivo desconocido" until catalog recovers.
   * Clock tick starts unconditionally so the idle screen is always
   * alive even when the hub never connects (plan upsell / offline).
   */
  private async bootstrap(): Promise<void> {
    try {
      const reasons = await this.catalogService.getAccessReasons();
      this.reasonMap.set(new Map(reasons.map(r => [r.id, r.name])));
    } catch (err) {
      console.warn('[AccessKiosk] Catalog load failed:', err);
    } finally {
      void this.signalrService.startConnection();
    }

    this.clockInterval = setInterval(() => this.now.set(new Date()), 1000);
  }

  //#endregion

  //#region Display state machine

  /**
   * Renders a live event on the billboard and schedules its auto-clear.
   * The previous timer is always reset so dwell timing is per-event,
   * not cumulative — back-to-back arrivals do not extend each other.
   */
  private surface(event: LiveAccessEvent): void {
    const reasonLabel = this.reasonMap().get(event.accessReasonId) ?? 'Motivo desconocido';
    this.displayedAttempt.set({
      isGranted: event.isGranted,
      customerId: event.customerId,
      customerName: event.customerName,
      customerPhotoUrl: null,
      reasonLabel,
      receivedAt: event.receivedAt,
    });

    if (this.clearTimer !== null) clearTimeout(this.clearTimer);
    const duration = DISPLAY_DURATION_MS[this.deriveStateFromEvent(event)];
    this.clearTimer = setTimeout(() => {
      this.displayedAttempt.set(null);
      this.clearTimer = null;
    }, duration);
  }

  /** Same branching as `bannerState`, but resolved directly from the event. */
  private deriveStateFromEvent(event: LiveAccessEvent): KioskBannerState {
    if (event.isGranted) return 'GRANTED';
    if (event.customerId === null) return 'UNKNOWN';
    return 'DENIED';
  }

  //#endregion

}

// Static Intl formatters — instantiated once per module to avoid the
// re-allocation cost of `toLocaleString` on every clock tick. Locked to
// es-MX so the kiosk reads natively for the target market.
const TIME_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
