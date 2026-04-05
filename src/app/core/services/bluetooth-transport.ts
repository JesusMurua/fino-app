import { PrinterTransport } from './printer-transport.interface';

/** Common Bluetooth SPP/printer service UUIDs */
const BT_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '00001101-0000-1000-8000-00805f9b34fb',
];

/** Optional services to discover */
const BT_OPTIONAL_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

/** Characteristic UUIDs commonly used by BT thermal printers */
const BT_CHARACTERISTIC_UUIDS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
];

/** Maximum bytes per BLE write — most printers limit to 20 */
const CHUNK_SIZE = 20;

/** Delay between chunks in ms to avoid buffer overflow */
const CHUNK_DELAY_MS = 20;

/**
 * Web Bluetooth transport for Bluetooth thermal printers.
 *
 * Handles device discovery, GATT connection, and chunked writes.
 * Uses `any` types for Web Bluetooth API since @types/web-bluetooth
 * is not installed — the API is accessed via navigator at runtime.
 */
export class BluetoothTransport implements PrinterTransport {

  //#region Properties

  /** The paired Bluetooth device */
  private device: any = null;

  /** The GATT characteristic used for writing */
  private characteristic: any = null;

  private _isConnected = false;
  private _deviceName = '';

  /** Callback to persist BT device info after successful connection */
  onConnected?: (deviceId: string, deviceName: string) => void;

  /** Saved device ID for auto-reconnect */
  savedDeviceId?: string;

  //#endregion

  //#region PrinterTransport

  get isConnected(): boolean { return this._isConnected; }
  get deviceName(): string { return this._deviceName || 'Impresora Bluetooth'; }
  get portLabel(): string { return 'Bluetooth'; }

  /** Whether this browser supports Web Bluetooth */
  static get isSupported(): boolean {
    return 'bluetooth' in navigator;
  }

  /**
   * Opens the Bluetooth device picker and connects to the printer.
   * Must be called from a user gesture.
   */
  async connect(): Promise<void> {
    if (!BluetoothTransport.isSupported) return;

    const nav = navigator as any;

    this.device = await nav.bluetooth.requestDevice({
      filters: BT_SERVICE_UUIDS.map(uuid => ({ services: [uuid] })),
      optionalServices: BT_OPTIONAL_SERVICES,
    });

    await this.connectToGatt();
  }

  /**
   * Attempts to reconnect to a previously paired device.
   * Uses navigator.bluetooth.getDevices() if available.
   */
  async tryAutoConnect(): Promise<void> {
    if (!BluetoothTransport.isSupported || !this.savedDeviceId) return;

    try {
      const nav = navigator as any;
      if (!nav.bluetooth.getDevices) return;

      const devices: any[] = await nav.bluetooth.getDevices();
      const saved = devices.find((d: any) => d.id === this.savedDeviceId);
      if (!saved) return;

      this.device = saved;
      await this.connectToGatt();
    } catch {
      // Silent — auto-connect is best-effort
    }
  }

  /** Disconnects from the Bluetooth device */
  async disconnect(): Promise<void> {
    try {
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    } catch (error) {
      console.error('[BluetoothTransport] Failed to disconnect:', error);
    } finally {
      this._isConnected = false;
      this._deviceName = '';
      this.characteristic = null;
      this.device = null;
    }
  }

  /**
   * Sends raw bytes to the printer in 20-byte chunks.
   * BLE has a limited MTU — sending in bursts prevents data loss.
   */
  async write(data: Uint8Array): Promise<void> {
    if (!this.characteristic) return;

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, Math.min(i + CHUNK_SIZE, data.length));
      await this.characteristic.writeValueWithoutResponse(chunk);
      if (i + CHUNK_SIZE < data.length) {
        await this.delay(CHUNK_DELAY_MS);
      }
    }
  }

  //#endregion

  //#region Private Helpers

  /** Connects to GATT server and finds the writable characteristic */
  private async connectToGatt(): Promise<void> {
    if (!this.device?.gatt) throw new Error('No GATT server on device');

    const server = await this.device.gatt.connect();

    // Try each service UUID until we find a writable characteristic
    for (const serviceUuid of [...BT_SERVICE_UUIDS, ...BT_OPTIONAL_SERVICES]) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        for (const charUuid of BT_CHARACTERISTIC_UUIDS) {
          try {
            this.characteristic = await service.getCharacteristic(charUuid);
            break;
          } catch { /* try next characteristic */ }
        }
        if (this.characteristic) break;

        // Fallback: try all characteristics on this service
        if (!this.characteristic) {
          const chars = await service.getCharacteristics();
          const writable = chars.find((c: any) =>
            c.properties.writeWithoutResponse || c.properties.write,
          );
          if (writable) {
            this.characteristic = writable;
            break;
          }
        }
      } catch { /* try next service */ }
    }

    if (!this.characteristic) {
      throw new Error('No writable characteristic found on printer');
    }

    this._isConnected = true;
    this._deviceName = this.device.name ?? 'Impresora Bluetooth';

    this.onConnected?.(this.device.id, this._deviceName);
    console.info('[BluetoothTransport] Connected:', this._deviceName);
  }

  /** Promise-based delay */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  //#endregion

}
