import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';

/**
 * Wire-format payload accepted by `POST /api/Hardware/print` on POS.API.
 * Mirrors `HardwareController.PrintRequestDto` server-side.
 */
interface PrintJobRequest {
  printerId:   string;
  base64Bytes: string;
}

/**
 * HTTP client for the Hybrid Print "bridge" mode.
 *
 * Posts a Base64-encoded ESC/POS payload to the backend's
 * `HardwareController`. The backend authenticates the caller, rate-limits
 * the request (60/min/IP), and broadcasts the bytes over SignalR to the
 * `bridge-hardware-{branchId}` group, where the Fino Bridge Windows
 * service relays them to the physical thermal printer.
 *
 * Tenancy is implicit — `branchId` is read from the JWT on the server;
 * this client never sends it in the body to prevent spoofing.
 */
@Injectable({ providedIn: 'root' })
export class PrintBridgeService {

  //#region Injections

  private readonly api = inject(ApiService);

  //#endregion

  //#region Public API

  /**
   * Enqueues a print job on the cloud bridge.
   *
   * Resolves when the backend accepts the payload (HTTP 2xx) — does NOT
   * await physical paper output, which happens asynchronously on the
   * Fino Bridge Windows service downstream of SignalR.
   *
   * @param printerId   Logical printer identifier known to the Fino Bridge
   *                    (e.g. "DEFAULT_PRINTER" or a configured device name).
   * @param base64Bytes Base64-encoded ESC/POS byte stream. The backend
   *                    rejects empty payloads and payloads larger than 512 KB.
   */
  postPrintJob(printerId: string, base64Bytes: string): Observable<void> {
    const body: PrintJobRequest = { printerId, base64Bytes };
    // FIRE-AND-FORGET: Outbox/retry deferred to a future phase, matching the backend architecture.
    return this.api.post<void>('/Hardware/print', body);
  }

  //#endregion

}
