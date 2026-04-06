import { Injectable } from '@angular/core';

/** localStorage key for the stable device UUID */
const DEVICE_UUID_KEY = 'kaja_device_uuid';

/**
 * Manages a stable UUID for the current browser/device.
 *
 * The UUID is generated once via `crypto.randomUUID()` and persisted
 * in localStorage. It survives page refreshes and app updates, and is
 * used to link this physical device to a CashRegister on the backend.
 */
@Injectable({ providedIn: 'root' })
export class DeviceService {

  /** Stable UUID for this device — generated on first access, then reused */
  readonly deviceUuid: string;

  constructor() {
    let uuid = localStorage.getItem(DEVICE_UUID_KEY);
    if (!uuid) {
      uuid = crypto.randomUUID();
      localStorage.setItem(DEVICE_UUID_KEY, uuid);
    }
    this.deviceUuid = uuid;
  }
}
