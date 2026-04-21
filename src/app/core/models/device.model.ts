import { DeviceConfig } from './device-config.model';

/**
 * Row shape returned by `GET /api/devices` for the Back Office fleet table.
 *
 * `branchName` is denormalized server-side so the UI does not join against
 * the branches signal on every render. `lastSeenAt` is `null` for devices
 * that have never sent a heartbeat since being registered.
 */
export interface DeviceListItem {
  id: number;
  deviceUuid: string;
  name: string;
  mode: DeviceConfig['mode'];
  isActive: boolean;
  branchId: number;
  branchName: string;
  /** ISO date string; `null` when the device has never heartbeated */
  lastSeenAt: string | null;
  /** ISO date string of first registration */
  createdAt: string;
}

/** Payload accepted by `PATCH /api/devices/{id}`. */
export interface UpdateDevicePayload {
  name: string;
  branchId: number;
}

/** Response from `PATCH /api/devices/{id}/toggle-active`. */
export interface ToggleActiveResponse {
  id: number;
  isActive: boolean;
}
