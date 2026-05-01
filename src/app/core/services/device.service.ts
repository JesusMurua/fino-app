import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import {
  ActivateDeviceResponse,
  DeviceConfig,
  DeviceLimitsDto,
  DeviceListItem,
  GenerateCodePayload,
  GenerateCodeResponse,
  PendingDeviceCodeDto,
  ToggleActiveResponse,
  UpdateDevicePayload,
} from '../models';
import { ApiService } from './api.service';
import { DeviceConfigStore } from './device-config.store';
import { TenantContextService } from './tenant-context.service';

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
  private readonly deviceConfigStore = inject(DeviceConfigStore);
  private readonly tenantContext = inject(TenantContextService);
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

    // Cold-boot recovery for unattended hardware shells (kiosk / kitchen
    // / reception): the user-login path that normally hydrates the
    // tenant context never runs on these devices, so we seed
    // `_activeFeatures` from the persisted device JWT here. Skipped
    // when the token is missing or expired — anything else would
    // populate the UI with stale capabilities.
    if (this.hasValidDeviceToken()) {
      const token = this.getDeviceToken();
      if (token !== null) this.tenantContext.hydrateFromDeviceToken(token);
    }
  }

  ngOnDestroy(): void {
    this.stopHeartbeat();
  }

  //#endregion

  //#region Device Registration

  /**
   * Registers this device with the backend.
   * On success, persists the returned config to `DeviceConfigStore` and —
   * when the backend returned a `deviceToken` — stores it as the
   * long-lived infrastructure JWT used by KDS / Kiosk devices.
   *
   * @param branchId Branch this device belongs to
   * @param mode Operating mode (cashier, kitchen, tables, kiosk, mobile)
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
    this.deviceConfigStore.save(config);

    if (response.deviceToken) {
      this.saveDeviceToken(response.deviceToken);
    }

    return response;
  }

  /**
   * Activates this device with a 6-character alphanumeric pairing code
   * (secure alphabet `[A-HJKMNP-TV-Z2-9]`, ambiguous chars excluded) issued
   * from `/admin/devices`. The endpoint is atomic: a single call validates
   * the code, provisions the device server-side, persists the local
   * config, and stores the long-lived device JWT.
   *
   * @param code 6-character alphanumeric pairing code
   */
  async activateDevice(code: string): Promise<ActivateDeviceResponse> {
    const response = await firstValueFrom(
      this.api.post<ActivateDeviceResponse>('/device/activate', {
        code,
        deviceUuid: this.deviceUuid,
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
    this.deviceConfigStore.save(config);
    this.saveDeviceToken(response.deviceToken);

    return response;
  }

  //#endregion

  //#region Device Validation

  /**
   * Validates this device against the backend.
   * If the backend returns a valid config, overwrites the local
   * `DeviceConfigStore` to stay in sync with the server-side device record.
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
        configuredAt: this.deviceConfigStore.deviceConfig$.getValue().configuredAt || new Date().toISOString(),
      };
      this.deviceConfigStore.save(config);

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

    if (!this.deviceConfigStore.isConfigured()) return;

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
   *
   * Re-hydrates the tenant context immediately so any consumer reading
   * `TenantContextService.activeFeatures()` on the next tick (route
   * guards, computed signals, the modes dropdown) sees the updated
   * capability set without waiting for a user login.
   *
   * @param token Raw JWT string — should have `type: 'device'` claim
   */
  saveDeviceToken(token: string): void {
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
    this.tenantContext.hydrateFromDeviceToken(token);
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

  //#region Fleet Management (Back Office)

  /**
   * Lists every device linked to the current tenant.
   *
   * Maps to `GET /api/devices`, optionally scoped to a single branch via
   * `?branchId={id}` when `params.branchId` is a positive integer.
   * Non-positive or missing branch ids are treated as "no filter" so
   * callers can pass through UI values without extra guards.
   *
   * @param params Optional query parameters (currently only `branchId`).
   */
  getAll(params?: { branchId?: number }): Observable<DeviceListItem[]> {
    const branchId = params?.branchId;
    const path = typeof branchId === 'number' && branchId > 0
      ? `/devices?branchId=${branchId}`
      : '/devices';
    return this.api.get<DeviceListItem[]>(path);
  }

  /**
   * Flips a device's `isActive` flag on the backend. Revoking invalidates
   * the device token at the next request; reactivating restores access.
   *
   * @param id Backend primary key of the device.
   */
  toggleActive(id: number): Observable<ToggleActiveResponse> {
    return this.api.patch<ToggleActiveResponse>(
      `/devices/${id}/toggle-active`,
      {},
    );
  }

  /**
   * Updates a device's human-readable name and/or branch assignment.
   * Transport-only: the caller is responsible for trimming `name` and
   * validating `branchId` before calling.
   *
   * @param id Backend primary key of the device.
   * @param payload New name and branch assignment.
   */
  update(id: number, payload: UpdateDevicePayload): Observable<DeviceListItem> {
    return this.api.patch<DeviceListItem>(`/devices/${id}`, payload);
  }

  //#endregion

  //#region Activation Codes (Back Office)

  /**
   * Generates a 6-character alphanumeric activation code (secure alphabet
   * `[A-HJKMNP-TV-Z2-9]`, ambiguous chars excluded) for the given branch /
   * mode / name.
   * The backend may respond with HTTP 403 when the tenant has hit the
   * device limit on its current plan — callers handle that case explicitly
   * to surface the backend's `message` / `detail` to the user.
   *
   * @param payload Branch, mode and name pre-configured for the new device.
   */
  generateCode(payload: GenerateCodePayload): Observable<GenerateCodeResponse> {
    return this.api.post<GenerateCodeResponse>('/device/generate-code', payload);
  }

  /**
   * Lists every activation code that has been issued but not yet redeemed.
   * Optionally scoped to a single branch via `?branchId={id}` so the Back
   * Office can keep the pending list in sync with the fleet table when the
   * admin filters by branch. Non-positive ids are treated as "no filter".
   *
   * @param branchId Optional branch filter.
   */
  getPendingCodes(branchId?: number): Observable<PendingDeviceCodeDto[]> {
    const path = typeof branchId === 'number' && branchId > 0
      ? `/device/pending-codes?branchId=${branchId}`
      : '/device/pending-codes';
    return this.api.get<PendingDeviceCodeDto[]>(path);
  }

  /**
   * Fetches per-mode device quotas for a given branch. The backend
   * resolves `businessId` from the JWT — passing it client-side would
   * be redundant and a soft attack surface (admin tampering with the
   * id), so the signature only takes the branch.
   *
   * The response is a `{ modes }` envelope where each entry carries
   * `usage`, `effectiveLimit`, `isLimitReached` and `isUnlimited`. The
   * UI looks up the row matching the currently-selected mode via
   * `.find(m => m.mode === selectedMode)` and renders the counter card
   * + lockout banner accordingly.
   *
   * Endpoint path matches the controller registration on the backend
   * (`/api/Devices/limits`, plural-cap). ASP.NET Core is case-insensitive
   * but staying literal avoids any future routing mishap.
   *
   * @param branchId Branch to query — required (limits are per-branch).
   */
  getDeviceLimits(branchId: number): Observable<DeviceLimitsDto> {
    return this.api.get<DeviceLimitsDto>(`/Devices/limits?branchId=${branchId}`);
  }

  //#endregion

}
