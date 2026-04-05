/**
 * Abstract transport layer for thermal printer communication.
 * Implementations handle the physical connection (USB Serial, Bluetooth).
 * The PrinterService delegates all I/O through this interface.
 */
export interface PrinterTransport {
  /** Connects to the printer. Must be called from a user gesture. */
  connect(): Promise<void>;

  /** Attempts reconnection without user gesture. Silently fails if unavailable. */
  tryAutoConnect(): Promise<void>;

  /** Disconnects and releases resources. */
  disconnect(): Promise<void>;

  /** Sends raw bytes to the printer. Handles chunking internally if needed. */
  write(data: Uint8Array): Promise<void>;

  /** Whether currently connected. */
  readonly isConnected: boolean;

  /** Human-readable device name. */
  readonly deviceName: string;

  /** Connection type label for display (e.g. "USB Serial", "Bluetooth"). */
  readonly portLabel: string;
}
