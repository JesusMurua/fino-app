import { Injectable, OnDestroy, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { DeviceConfig } from '../models';
import { ApiService } from './api.service';
import { ConfigService } from './config.service';

/** localStorage key for the stable device UUID */
const DEVICE_UUID_KEY = 'kaja_device_uuid';

/**
 * localStorage key for the long-lived device JWT emitted by the backend
 * on `POST /api/devices/register`. Represents the machine, not the human
 * behind it — used by infrastructure screens (KDS, Kiosk) to talk to the
 * API and SignalR without requiring a user to enter a PIN.
 */
const DEVICE_TOKEN_KEY = 'pos_device_token';

/** Heartbeat interval: 5 minutes */
const HEARTBEAT_INTERVAL_MS = 300_000;

/** Response from POST /api/devices/register */
interface DeviceRegisterResponse {
  id: number;
  deviceUuid: string;
  branchId: number;
  branchName: string;
  businessId: number;
  businessName: string;
  mode: DeviceConfig['mode'];
  name: string;
  /** Long-lived device JWT — present when the backend supports infra auth */
  deviceToken?: string;
}

/** Response from GET /api/devices/validate/{uuid} */
interface DeviceValidateResponse {
  id: number;
  deviceUuid: string;
  branchId: number;
  branchName: string;
  businessId: number;
  businessName: string;
  mode: DeviceConfig['mode'];
  name: string;
  isActive: boolean;
  /** Refreshed device JWT — rotated periodically by the backend */
  deviceToken?: string;
}

/**
 * Manages a stable UUID for the current browser/device and
 * communicates with the backend Device Provisioning API.
 *
 * The UUID is generated once via `crypto.randomUUID()` and persisted
 * in localStorage. It survives page refreshes and app updates, and is
 * used to link this physical device to a CashRegister on the backend.
 */
@Injectable({ providedIn: 'root' })
export class DeviceService implements OnDestroy {

  //#region Properties

  /** Stable UUID for this device — generated on first access, then reused */
  readonly deviceUuid: string;

  private readonly api = inject(ApiService);
  private readonly configService = inject(ConfigService);
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  //#endregion

  //#region Constructor & Lifecycle

  constructor() {
    let uuid = localStorage.getItem(DEVICE_UUID_KEY);
    if (!uuid) {
      uuid = crypto.randomUUID();
      localStorage.setItem(DEVICE_UUID_KEY, uuid);
    }
    this.deviceUuid = uuid;
  }

  ngOnDestroy(): void {
    this.stopHeartbeat();
  }

  //#endregion

  //#region Device Registration

  /**
   * Registers this device with the backend.
   * On success, persists the returned config to ConfigService and — when
   * the backend returned a `deviceToken` — stores it as the long-lived
   * infrastructure JWT used by KDS / Kiosk devices.
   *
   * @param branchId Branch this device belongs to
   * @param mode Operating mode (cashier, kitchen, tables, kiosk, admin)
   * @param name Human-readable device name
   */
  async registerDevice(branchId: number, mode: string, name: string): Promise<DeviceRegisterResponse> {
    const response = await firstValueFrom(
      this.api.post<DeviceRegisterResponse>('/devices/register', {
        deviceUuid: this.deviceUuid,
        branchId,
        mode,
        name,
      }),
    );

    const config: DeviceConfig = {
      businessId:   response.businessId,
      branchId:     response.branchId,
      businessName: response.businessName,
      branchName:   response.branchName,
      mode:         response.mode,
      deviceName:   response.name,
      configuredAt: new Date().toISOString(),
    };
    this.configService.saveDeviceConfig(config);

    if (response.deviceToken) {
      this.saveDeviceToken(response.deviceToken);
    }

    return response;
  }

  //#endregion

  //#region Device Validation

  /**
   * Validates this device against the backend.
   * If the backend returns a valid config, overwrites local ConfigService
   * to stay in sync with the server-side device record.
   * @returns true if the device is valid and active; false otherwise
   */
  async validateDevice(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.api.get<DeviceValidateResponse>(`/devices/validate/${this.deviceUuid}`),
      );

      if (!response.isActive) return false;

      const config: DeviceConfig = {
        businessId:   response.businessId,
        branchId:     response.branchId,
        businessName: response.businessName,
        branchName:   response.branchName,
        mode:         response.mode,
        deviceName:   response.name,
        configuredAt: this.configService.deviceConfig$.getValue().configuredAt || new Date().toISOString(),
      };
      this.configService.saveDeviceConfig(config);

      if (response.deviceToken) {
        this.saveDeviceToken(response.deviceToken);
      }

      return true;
    } catch {
      console.warn('[DeviceService] Validation failed — using local config');
      return false;
    }
  }

  //#endregion

  //#region Heartbeat

  /**
   * Starts a heartbeat that pings the backend every 5 minutes.
   * Only sends heartbeats if the device is configured.
   */
  startHeartbeat(): void {
    this.stopHeartbeat();

    if (!this.configService.isDeviceConfigured()) return;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Send an initial heartbeat immediately
    this.sendHeartbeat();
  }

  /** Stops the heartbeat interval */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Sends a single heartbeat to the backend (best-effort) */
  private async sendHeartbeat(): Promise<void> {
    try {
      await firstValueFrom(
        this.api.put<void>(`/devices/heartbeat/${this.deviceUuid}`, {}),
      );
    } catch {
      // Best-effort — silently ignore failures
    }
  }

  //#endregion

  //#region Device Token

  /**
   * Persists the long-lived device JWT in localStorage. Called internally
   * after a successful `registerDevice` or `validateDevice` when the
   * backend returned a token. Public so the setup/activation-code flows
   * can also call it directly if needed.
   * @param token Raw JWT string — should have `type: 'device'` claim
   */
  saveDeviceToken(token: string): void {
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }

  /**
   * Returns the stored device token, or `null` if none is set.
   * Does NOT validate the token — use `hasValidDeviceToken()` when a
   * freshness check matters (guards, SignalR reconnect).
   */
  getDeviceToken(): string | null {
    return localStorage.getItem(DEVICE_TOKEN_KEY);
  }

  /**
   * Removes the device token from localStorage. Called when a device is
   * explicitly un-provisioned. User logout does NOT call this — the
   * device token is tied to the physical machine, not to any human.
   */
  clearDeviceToken(): void {
    localStorage.removeItem(DEVICE_TOKEN_KEY);
  }

  /**
   * Returns `true` when a device token is present and its JWT `exp`
   * claim is still in the future. Malformed tokens and tokens without
   * an `exp` are treated as invalid.
   */
  hasValidDeviceToken(): boolean {
    const token = this.getDeviceToken();
    if (!token) return false;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1]));
      if (!payload.exp) return false;
      return Date.now() / 1000 < payload.exp;
    } catch {
      return false;
    }
  }

  //#endregion

}
