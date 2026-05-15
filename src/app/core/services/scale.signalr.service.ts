import { Injectable, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

import { WeightPayloadDto } from '../models/weight-payload.dto';
import { SIGNALR_BASE_URL } from '../utils/signalr.utils';
import { DeviceService } from './device.service';

/** Connection health surfaced to the UI. */
export type ScaleConnectionState = 'disconnected' | 'connected' | 'reconnecting';

/** Retry cadence after a failed `.start()` — mirrors KDS / Access Dashboard. */
const RETRY_INTERVAL_MS = 60_000;

/**
 * SignalR client for physical scale weight readings.
 *
 * Connects to `BridgeHub` at `/hubs/bridge` (shared with the access-control
 * dashboard) and listens for the `OnWeightUpdated` event. The backend
 * auto-joins the connection to the `bridge-branch-{branchId}` group based
 * on the `branchId` claim in the JWT — there is NO client-side
 * `invoke('Join', ...)` call to make.
 *
 * Cross-talk prevention: multiple POS devices in the same branch each
 * have their own scale and all receive every `OnWeightUpdated` broadcast.
 * The handler filters by `payload.deviceUuid === this.deviceService.deviceUuid`
 * so each device sees only its own scale's readings.
 *
 * Defensive guards mirror `AccessDashboardSignalrService`:
 *   - GUARD 1 (Token): short-circuit when no device token is available
 *   - GUARD 2 (Double-Start): replace any existing connection before
 *     building a new one
 *   - `.start()` failure: schedule a 60s retry via `setTimeout` recursion
 *   - Handler + lifecycle registered BEFORE `.start()` so no broadcast is
 *     dropped during the connect window
 */
@Injectable({ providedIn: 'root' })
export class ScaleSignalrService {

  //#region Properties

  private readonly deviceService = inject(DeviceService);

  /** Live connection state for UI freshness indicators. */
  readonly connectionState = signal<ScaleConnectionState>('disconnected');

  /** Latest weight reading for THIS device's scale; null until the first event. */
  readonly currentWeight = signal<WeightPayloadDto | null>(null);

  private hubConnection: HubConnection | null = null;
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;

  //#endregion

  //#region Public API

  /**
   * Builds the SignalR connection and starts the hub. Idempotent: a
   * follow-up call replaces any existing connection. Defensive guards
   * short-circuit when no token is available to prevent an infinite
   * retry loop against a permanently-rejecting hub.
   */
  async startConnection(): Promise<void> {
    // GUARD 1 — token presence. Without a device token the handshake
    // 401s every retry. Stops the loop cleanly until a token is restored.
    if (!this.deviceService.getDeviceToken()) {
      this.connectionState.set('disconnected');
      console.warn('[ScaleSignalr] No device token available — connection skipped');
      return;
    }

    // GUARD 2 — replace any previous connection (double-start protection).
    if (this.hubConnection) {
      await this.hubConnection.stop().catch(() => undefined);
      this.hubConnection = null;
    }

    this.hubConnection = new HubConnectionBuilder()
      .withUrl(`${SIGNALR_BASE_URL}/hubs/bridge`, {
        accessTokenFactory: () => this.deviceService.getDeviceToken() ?? '',
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    // CRITICAL — register the event handler BEFORE start(). SignalR
    // discards broadcasts that arrive between connection and handler
    // registration. Cross-talk prevention filters by deviceUuid.
    this.hubConnection.on('OnWeightUpdated', (payload: WeightPayloadDto) => {
      if (payload.deviceUuid !== this.deviceService.deviceUuid) return;
      this.currentWeight.set(payload);
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
      console.warn('[ScaleSignalr] SignalR connection failed:', error);
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
