import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { DEFAULT_DEVICE_CONFIG, DEVICE_CONFIG_KEY, DeviceConfig } from '../models';

/**
 * Lightweight, dependency-free store for the per-device configuration
 * (mode, branch/business linkage, printer prefs, linked cash register).
 *
 * Owns the `DEVICE_CONFIG_KEY` localStorage entry and the Base64
 * obfuscation envelope around it. Extracted from `ConfigService` so
 * that `DeviceService` — which only ever needed the device-config
 * surface — can read and write without depending on ConfigService.
 *
 * `ConfigService` keeps the `deviceConfig$` / `loadDeviceConfig()` /
 * `saveDeviceConfig()` / `isDeviceConfigured()` API surface as thin
 * proxies over this store, so the ~17 external callsites
 * (guards, components, services) keep working unchanged.
 */
@Injectable({ providedIn: 'root' })
export class DeviceConfigStore {

  /**
   * Reactive device config stream — emits on every `load()` / `save()`.
   * `ConfigService.deviceConfig$` re-exports this same subject so
   * `toSignal()` consumers and `.getValue()` callers retain identity.
   */
  readonly deviceConfig$ = new BehaviorSubject<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  constructor() {
    // Hydrate from localStorage on construction so subscribers get the
    // real value immediately on first emission.
    this.load();
  }

  /**
   * Reads the device config from localStorage and emits to `deviceConfig$`.
   * Falls back to `DEFAULT_DEVICE_CONFIG` if no value has been saved yet.
   *
   * Storage format: Base64-encoded JSON (obfuscated to prevent casual
   * DevTools edits). Includes a backward-compatible fallback for legacy
   * raw JSON entries — those are migrated to the obfuscated format on
   * the next save.
   */
  load(): DeviceConfig {
    try {
      const raw = localStorage.getItem(DEVICE_CONFIG_KEY);
      if (!raw) {
        this.deviceConfig$.next({ ...DEFAULT_DEVICE_CONFIG });
        return { ...DEFAULT_DEVICE_CONFIG };
      }

      let config: DeviceConfig;

      try {
        // Primary: decode Base64-obfuscated value
        config = JSON.parse(decodeURIComponent(atob(raw)));
      } catch {
        // Fallback: legacy raw JSON — migrate to obfuscated format
        config = JSON.parse(raw);
        this.save(config);
      }

      // Migrate deprecated modes
      const mode = config.mode as string;
      if (mode === 'counter') config.mode = 'cashier';
      if (mode === 'waiter') config.mode = 'tables';
      if (mode !== config.mode) this.save(config);

      this.deviceConfig$.next(config);
      return config;
    } catch {
      this.deviceConfig$.next({ ...DEFAULT_DEVICE_CONFIG });
      return { ...DEFAULT_DEVICE_CONFIG };
    }
  }

  /**
   * Persists the device config to localStorage and emits to `deviceConfig$`.
   * Only affects this physical device — other devices are unchanged.
   *
   * Stored as Base64-encoded JSON to prevent casual DevTools manipulation.
   */
  save(config: DeviceConfig): void {
    const encoded = btoa(encodeURIComponent(JSON.stringify(config)));
    localStorage.setItem(DEVICE_CONFIG_KEY, encoded);
    this.deviceConfig$.next(config);
  }

  /**
   * Returns true if the device has been configured with a valid
   * businessId and branchId (set during the /setup flow).
   */
  isConfigured(): boolean {
    const config = this.deviceConfig$.getValue();
    return config.businessId > 0 && config.branchId > 0;
  }

}
