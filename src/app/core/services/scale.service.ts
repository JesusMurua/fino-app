import { Injectable, inject, signal } from '@angular/core';

import { DeviceConfig } from '../models';
import { ConfigService } from './config.service';

/**
 * Hybrid scale configuration service.
 *
 * Persists per-device scale preferences (operating mode + wire-level
 * protocol) to the local `DeviceConfig` in localStorage via
 * `ConfigService.saveDeviceConfig`. No backend sync — the choice of
 * scale hardware is local to the physical device, mirroring the
 * `PrinterService` persistence pattern.
 *
 * Operating modes:
 *   - `none`   — scale disabled, POS won't surface weight-entry UX.
 *   - `serial` — USB Serial direct connection; protocol matters.
 *   - `cloud`  — Fino weight module on the LAN, abstracts protocol.
 */
@Injectable({ providedIn: 'root' })
export class ScaleService {

  //#region Injections
  private readonly configService = inject(ConfigService);
  //#endregion

  //#region Signals — hydrated once from localStorage at construction

  /** Current scale operating mode (none / serial / cloud) */
  readonly scaleType = signal<DeviceConfig['scaleType']>(
    this.configService.loadDeviceConfig().scaleType ?? 'none',
  );

  /** Wire-level protocol — only meaningful when `scaleType === 'serial'` */
  readonly scaleProtocol = signal<DeviceConfig['scaleProtocol']>(
    this.configService.loadDeviceConfig().scaleProtocol ?? 'generic',
  );

  //#endregion

  //#region Public API

  /**
   * Persists the scale configuration to the local DeviceConfig and
   * mirrors the change into the reactive signals. Callers should
   * guard against no-op invocations upstream — this method always
   * writes to localStorage when called.
   *
   * @param type     New scale operating mode.
   * @param protocol Optional protocol override; preserved when omitted.
   */
  updateScaleConfig(
    type: 'none' | 'serial' | 'cloud',
    protocol?: 'toledo' | 'epson' | 'generic',
  ): void {
    const cfg = this.configService.loadDeviceConfig();
    this.configService.saveDeviceConfig({
      ...cfg,
      scaleType: type,
      scaleProtocol: protocol ?? this.scaleProtocol(),
    });
    this.scaleType.set(type);
    if (protocol) this.scaleProtocol.set(protocol);
  }

  //#endregion

}
