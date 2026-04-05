import { Injectable, OnDestroy, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Maximum time between keystrokes to consider them part of a scanner burst (ms) */
const SCAN_CHAR_THRESHOLD_MS = 50;

/** Clear buffer if no new chars arrive within this time (ms) */
const BUFFER_TIMEOUT_MS = 500;

/** Minimum barcode length to be considered valid */
const MIN_BARCODE_LENGTH = 4;

/**
 * Captures USB HID barcode scanner input from global keyboard events.
 *
 * Barcode scanners work as keyboard devices — they type characters rapidly
 * (< 50ms between keystrokes) and end with an Enter key.
 * This service distinguishes scanner input from normal human typing using timing.
 */
@Injectable({ providedIn: 'root' })
export class ScannerService implements OnDestroy {

  //#region Properties

  /** Last scanned barcode value */
  readonly lastScannedCode = signal('');

  /** Timestamp of the last successful scan */
  readonly lastScanTime = signal<Date | null>(null);

  /** Whether the scanner listener is active */
  readonly isListening = signal(false);

  /** Internal buffer for accumulating characters */
  private buffer = '';

  /** Timestamp of the last keydown event */
  private lastKeyTime = 0;

  /** Timeout handle for clearing stale buffer */
  private bufferTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Subject that emits scanned barcodes */
  private readonly scanSubject = new Subject<string>();

  /** Bound reference to the keydown handler for cleanup */
  private readonly boundKeyHandler = this.onKeyDown.bind(this);

  //#endregion

  //#region Lifecycle

  ngOnDestroy(): void {
    this.stopListening();
    this.scanSubject.complete();
  }

  //#endregion

  //#region Public API

  /**
   * Starts global keydown listener to capture scanner input.
   * Safe to call multiple times — only one listener will be active.
   */
  startListening(): void {
    if (this.isListening()) return;

    window.addEventListener('keydown', this.boundKeyHandler, true);
    this.isListening.set(true);
    console.info('[ScannerService] Listening for barcode scans');
  }

  /**
   * Stops the global keydown listener.
   */
  stopListening(): void {
    if (!this.isListening()) return;

    window.removeEventListener('keydown', this.boundKeyHandler, true);
    this.isListening.set(false);
    this.clearBuffer();
    console.info('[ScannerService] Stopped listening');
  }

  /**
   * Returns an Observable that emits each time a barcode is scanned.
   */
  onScan(): Observable<string> {
    return this.scanSubject.asObservable();
  }

  //#endregion

  //#region Private Helpers

  /**
   * Global keydown handler. Accumulates fast keystrokes into a buffer
   * and emits as a barcode when Enter is pressed.
   */
  private onKeyDown(event: KeyboardEvent): void {
    const now = Date.now();
    const timeDelta = now - this.lastKeyTime;

    // Enter key — check if buffer is a valid barcode
    if (event.key === 'Enter') {
      if (this.buffer.length >= MIN_BARCODE_LENGTH) {
        event.preventDefault();
        event.stopPropagation();
        this.emitScan(this.buffer);
      }
      this.clearBuffer();
      this.lastKeyTime = now;
      return;
    }

    // Only capture printable single characters
    if (event.key.length !== 1) return;

    // If too much time passed, start a new buffer
    if (timeDelta > SCAN_CHAR_THRESHOLD_MS && this.buffer.length > 0) {
      this.clearBuffer();
    }

    this.buffer += event.key;
    this.lastKeyTime = now;

    // Reset timeout
    if (this.bufferTimeout) clearTimeout(this.bufferTimeout);
    this.bufferTimeout = setTimeout(() => this.clearBuffer(), BUFFER_TIMEOUT_MS);
  }

  /**
   * Emits the scanned barcode and updates signals.
   */
  private emitScan(code: string): void {
    this.lastScannedCode.set(code);
    this.lastScanTime.set(new Date());
    this.scanSubject.next(code);
    console.info('[ScannerService] Barcode scanned:', code);
  }

  /**
   * Clears the character buffer and cancels the timeout.
   */
  private clearBuffer(): void {
    this.buffer = '';
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
      this.bufferTimeout = null;
    }
  }

  //#endregion

}
