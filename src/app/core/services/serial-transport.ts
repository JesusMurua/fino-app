import { PrinterTransport } from './printer-transport.interface';

/** Saved serial printer identifiers for auto-reconnect */
interface SerialPrinterConfig {
  vendorId: number;
  productId: number;
  name: string;
}

/**
 * Web Serial API transport for USB thermal printers.
 *
 * Extracted from PrinterService — exact same logic.
 * Only works in Chrome/Edge on desktop.
 */
export class SerialTransport implements PrinterTransport {

  //#region Properties

  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private _isConnected = false;
  private _deviceName = '';

  /** Callback to persist printer config after successful connection */
  onConnected?: (vendorId: number, productId: number, name: string) => void;

  /** Callback to load saved printer config for auto-reconnect */
  loadConfig?: () => SerialPrinterConfig | null;

  //#endregion

  //#region PrinterTransport

  get isConnected(): boolean { return this._isConnected; }
  get deviceName(): string { return this._deviceName; }
  get portLabel(): string { return 'USB Serial'; }

  /**
   * Requests a serial port from the browser and connects.
   * Must be called from a user gesture.
   */
  async connect(): Promise<void> {
    if (!('serial' in navigator)) return;

    this.port = await (navigator as any).serial.requestPort();
    await this.openPort();
  }

  /**
   * Attempts to reconnect using a previously authorized port.
   * Silently fails if no port available.
   */
  async tryAutoConnect(): Promise<void> {
    if (!('serial' in navigator)) return;

    try {
      const ports: SerialPort[] = await (navigator as any).serial.getPorts();
      const saved = this.loadConfig?.();

      if (ports.length === 0 || !saved) return;

      // Match saved vendor/product ID
      for (const p of ports) {
        const info = p.getInfo();
        if (info.usbVendorId === saved.vendorId && info.usbProductId === saved.productId) {
          this.port = p;
          await this.openPort();
          return;
        }
      }

      // Fallback: first available port
      if (ports.length > 0) {
        this.port = ports[0];
        await this.openPort();
      }
    } catch {
      // Silent — auto-connect is best-effort
    }
  }

  /** Disconnects the serial port */
  async disconnect(): Promise<void> {
    try {
      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (error) {
      console.error('[SerialTransport] Failed to disconnect:', error);
    } finally {
      this._isConnected = false;
      this._deviceName = '';
      this.writer = null;
      this.port = null;
    }
  }

  /** Sends raw bytes to the serial port */
  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) return;
    await this.writer.write(data);
  }

  //#endregion

  //#region Private Helpers

  /** Opens the current port and sets up the writer */
  private async openPort(): Promise<void> {
    if (!this.port) return;

    await this.port.open({ baudRate: 9600 });

    if (this.port.writable) {
      this.writer = this.port.writable.getWriter();
    }

    const info = this.port.getInfo();
    const saved = this.loadConfig?.();
    const name = saved?.name || `USB ${info.usbVendorId ?? ''}:${info.usbProductId ?? ''}`;

    this._isConnected = true;
    this._deviceName = name;

    // Save for auto-reconnect
    if (info.usbVendorId != null && info.usbProductId != null) {
      this.onConnected?.(info.usbVendorId, info.usbProductId, name);
    }

    console.info('[SerialTransport] Connected:', name);
  }

  //#endregion

}
