import { Injectable, computed, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

import { FeatureKey } from '../enums';
import { AccessResultDto, LiveAccessEvent } from '../models/access-event.model';
import { SIGNALR_BASE_URL } from '../utils/signalr.utils';
import { DeviceService } from './device.service';
import { TenantContextService } from './tenant-context.service';

/** Connection health surfaced to the UI. `unauthorized` is distinct from
 *  `disconnected` — it signals a feature-gate denial (the tenant's plan
 *  does not include `RealtimeAccessControl`) and suppresses the retry
 *  loop so the dashboard can render an upsell banner instead of churning. */
export type AccessDashboardConnectionState =
  | 'disconnected'
  | 'connected'
  | 'reconnecting'
  | 'unauthorized';

/** Retry cadence after a failed `.start()` — mirrors KDS fallback (60 s). */
const RETRY_INTERVAL_MS = 60_000;

/** Maximum number of attempts kept in the live feed buffer. */
const MAX_FEED_BUFFER = 50;

/**
 * SignalR client for the gym Reception Dashboard live feed.
 *
 * Connects to `BridgeHub` at `/hubs/bridge` and listens for the
 * `AccessAttempted` event. The backend auto-joins the connection to the
 * `bridge-branch-{branchId}` group based on the `branchId` claim in the
 * JWT — there is NO client-side `invoke('Join', ...)` call to make.
 *
 * Two defensive guards prevent infinite retry loops:
 *   1. Feature gate (`RealtimeAccessControl`) — if the tenant's plan
 *      lacks the feature the backend would `Context.Abort()` every
 *      reconnect attempt; we short-circuit to state `'unauthorized'`.
 *   2. Token presence — if the `DeviceService` has no token the handshake
 *      would 401 every reconnect attempt; we short-circuit to state
 *      `'disconnected'` and stop.
 *
 * Mirror of `KitchenService` (KDS) for connection lifecycle patterns:
 * `withAutomaticReconnect`, retry timer on hard failure, handler
 * registration BEFORE `.start()`, and clean teardown in `stopConnection`.
 */
@Injectable({ providedIn: 'root' })
export class AccessDashboardSignalrService {

  //#region Properties

  private readonly deviceService = inject(DeviceService);
  private readonly tenantContext = inject(TenantContextService);

  /** Live connection state for the dashboard header indicator. */
  readonly connectionState = signal<AccessDashboardConnectionState>('disconnected');

  /** Rolling buffer of the last `MAX_FEED_BUFFER` access attempts, newest first. */
  readonly recentAttempts = signal<LiveAccessEvent[]>([]);

  /** True when the tenant's plan exposes `RealtimeAccessControl`. */
  readonly hasFeature = computed(
    () => this.tenantContext.hasFeature(FeatureKey.RealtimeAccessControl),
  );

  private hubConnection: HubConnection | null = null;
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;

  //#endregion

  //#region Public API

  /**
   * Builds the SignalR connection and starts the hub. Idempotent: a
   * follow-up call replaces any existing connection. Defensive guards
   * short-circuit when the feature is locked or no token is available
   * to prevent a 60 s retry loop against a permanently-rejecting hub.
   */
  async startConnection(): Promise<void> {
    // GUARD 1 — feature gate. The backend BridgeHub aborts the connection
    // when the tenant's plan does not include RealtimeAccessControl, so
    // attempting to connect would just churn the retry timer forever.
    if (!this.hasFeature()) {
      this.connectionState.set('unauthorized');
      console.warn('[AccessDashboard] RealtimeAccessControl not in plan — connection skipped');
      return;
    }

    // GUARD 2 — token presence. Without a device token the handshake
    // 401s every retry. Stops the loop cleanly until a token is restored
    // (e.g., the device gets activated, then the user reopens the dashboard).
    const token = this.deviceService.getDeviceToken();
    if (!token) {
      this.connectionState.set('disconnected');
      console.warn('[AccessDashboard] No device token available — connection skipped');
      return;
    }

    // Replace any previous connection (defensive against double-start).
    if (this.hubConnection) {
      await this.hubConnection.stop().catch(() => undefined);
      this.hubConnection = null;
    }

    const hubUrl = `${SIGNALR_BASE_URL}/hubs/bridge`;
    this.hubConnection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: () => this.deviceService.getDeviceToken() ?? '',
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    // CRITICAL — register the event handler BEFORE start(). SignalR
    // discards broadcasts that arrive between connection and handler
    // registration.
    this.hubConnection.on('AccessAttempted', (result: AccessResultDto) => {
      const liveEvent: LiveAccessEvent = {
        ...result,
        receivedAt: new Date(),
        localId: crypto.randomUUID(),
      };
      this.recentAttempts.update(prev => [liveEvent, ...prev].slice(0, MAX_FEED_BUFFER));
    });

    this.hubConnection.onreconnecting(() => {
      this.connectionState.set('reconnecting');
    });

    this.hubConnection.onreconnected(() => {
      this.connectionState.set('connected');
    });

    this.hubConnection.onclose(() => {
      this.connectionState.set('disconnected');
    });

    try {
      await this.hubConnection.start();
      this.connectionState.set('connected');
    } catch (error) {
      console.warn('[AccessDashboard] SignalR connection failed:', error);
      this.connectionState.set('disconnected');
      this.retryTimerId = setTimeout(() => this.startConnection(), RETRY_INTERVAL_MS);
    }
  }

  /** Stops the hub connection and clears any pending retry timer. */
  async stopConnection(): Promise<void> {
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
    if (this.hubConnection) {
      await this.hubConnection.stop().catch(() => undefined);
      this.hubConnection = null;
    }
    this.connectionState.set('disconnected');
  }

  //#endregion

}
