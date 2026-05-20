import { firstValueFrom } from 'rxjs';

import { PrinterTransport } from './printer-transport.interface';
import { PrintBridgeService } from './print-bridge.service';

/**
 * `PrinterTransport` implementation that ships ESC/POS bytes through the
 * cloud Hardware bridge instead of talking to the printer directly.
 *
 * HTTP is stateless, so connection lifecycle methods are no-ops and the
 * transport reports `isConnected = true` unconditionally — the actual
 * delivery status of each job is determined per-write by the HTTP call.
 *
 * Errors from the underlying `PrintBridgeService` propagate up to
 * `PrinterService.sendBytes()` so the existing error toast and
 * `lastPrintError` signal continue to work without modification.
 */
export class BridgeHttpTransport implements PrinterTransport {

  //#region Constructor

  /**
   * @param printBridgeService HTTP client wired to `/api/Hardware/print`.
   * @param printerId          Logical printer ID forwarded to the Fino Bridge.
   */
  constructor(
    private readonly printBridgeService: PrintBridgeService,
    private readonly printerId: string,
  ) {
    // Defensive — createTransport always supplies a fallback. Guards against direct instantiation.
    if (!this.printerId) throw new Error('Bridge requires non-empty printerId');
  }

  //#endregion

  //#region PrinterTransport

  /** Always true — HTTP transport is stateless and instantly "available". */
  get isConnected(): boolean { return true; }

  /** Human-readable label surfaced in the Hardware tab. */
  get deviceName(): string { return this.printerId; }

  /** Connection-type label surfaced in the Hardware tab. */
  get portLabel(): string { return 'Bridge HTTP'; }

  /** No physical handshake — resolves immediately. */
  connect(): Promise<void> {
    return Promise.resolve();
  }

  /** No persistent session to restore — resolves immediately. */
  tryAutoConnect(): Promise<void> {
    return Promise.resolve();
  }

  /** No physical session to tear down — resolves immediately. */
  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Posts the ESC/POS byte stream to the cloud bridge as Base64.
   *
   * The byte-by-byte loop avoids `btoa(String.fromCharCode(...data))`,
   * which spreads the Uint8Array into function arguments and throws
   * `Maximum call stack size exceeded` for tickets large enough to span
   * tens of thousands of bytes (graphic logos, long kitchen comandas).
   */
  async write(data: Uint8Array): Promise<void> {
    // 384KB raw expands to ~512KB Base64 — matches backend HardwareController limit.
    if (data.byteLength > 384_000) {
      throw new Error('El ticket excede el tamaño máximo permitido.');
    }

    let binary = '';
    for (let i = 0; i < data.byteLength; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const base64Bytes = btoa(binary);

    await firstValueFrom(
      this.printBridgeService.postPrintJob(this.printerId, base64Bytes),
    );
  }

  //#endregion

}
