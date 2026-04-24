import { Injectable, inject, signal } from '@angular/core';

import { ConfigService } from './config.service';
import { PrinterTransport } from './printer-transport.interface';
import { SerialTransport } from './serial-transport';
import { BluetoothTransport } from './bluetooth-transport';

// ============================================================================
// ESC/POS Command Constants
// ============================================================================
const ESC_INIT     = new Uint8Array([0x1B, 0x40]);
const ALIGN_CENTER = new Uint8Array([0x1B, 0x61, 0x01]);
const ALIGN_LEFT   = new Uint8Array([0x1B, 0x61, 0x00]);
const BOLD_ON      = new Uint8Array([0x1B, 0x45, 0x01]);
const BOLD_OFF     = new Uint8Array([0x1B, 0x45, 0x00]);
const FONT_LARGE   = new Uint8Array([0x1D, 0x21, 0x11]);
const FONT_NORMAL  = new Uint8Array([0x1D, 0x21, 0x00]);
const CUT_PAPER    = new Uint8Array([0x1D, 0x56, 0x41, 0x10]);
const LINE_FEED    = new Uint8Array([0x0A]);
// Cash drawer kick commands (ESC p m t1 t2). Pin 2 and pin 5 cover the two
// common RJ12 wirings — we send both so the right one fires regardless of
// how the drawer is cabled to the printer.
const DRAWER_KICK_PIN2 = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]);
const DRAWER_KICK_PIN5 = new Uint8Array([0x1B, 0x70, 0x01, 0x19, 0xFA]);

/** Paper width in characters for 80mm roll */
const PAPER_WIDTH = 48;

/** Printable order data for ticket generation */
export interface PrintableOrder {
  orderNumber: string;
  items: { name: string; qty: number; priceCents: number }[];
  totalCents: number;
  paymentLabel: string;
  businessName: string;
  branchName: string;
  date: Date;
}

/** Single line in a ticket layout */
interface TicketLine {
  text: string;
  align: 'center' | 'left' | 'right';
  bold?: boolean;
  large?: boolean;
  divider?: boolean;
}

/**
 * Thermal printer service supporting Web Serial and Web Bluetooth.
 *
 * Manages connection state, auto-reconnect, and ticket printing.
 * Delegates all I/O to a PrinterTransport implementation.
 */
@Injectable({ providedIn: 'root' })
export class PrinterService {

  //#region Injections
  private readonly configService = inject(ConfigService);
  //#endregion

  //#region Properties

  /** Whether any printer transport is available in this browser */
  readonly isSupported = signal(
    'serial' in navigator || 'bluetooth' in navigator,
  );

  /** Whether Web Bluetooth is available */
  readonly bluetoothSupported = signal('bluetooth' in navigator);

  /** Whether Web Serial is available */
  readonly serialSupported = signal('serial' in navigator);

  /** Current connection type */
  readonly printerType = signal<'serial' | 'bluetooth'>(
    this.configService.loadDeviceConfig().printerType ?? 'serial',
  );

  /** Whether a printer is currently connected */
  readonly printerConnected = signal(false);

  /** Display name of the connected printer */
  readonly printerName = signal('');

  /** Port/connection description */
  readonly printerPort = signal('');

  /** Last print error message — components can display this reactively */
  readonly lastPrintError = signal<string | null>(null);

  /** Active transport instance */
  private transport: PrinterTransport | null = null;

  /** Text encoder for converting strings to bytes */
  private readonly encoder = new TextEncoder();

  //#endregion

  //#region Public API

  /**
   * Connects to a printer using the specified or current transport type.
   * Must be called from a user gesture (button click).
   * @param type Optional transport type override
   */
  async connect(type?: 'serial' | 'bluetooth'): Promise<void> {
    if (type) this.printerType.set(type);

    try {
      // Disconnect existing transport first
      if (this.transport) {
        await this.transport.disconnect();
      }

      this.transport = this.createTransport(this.printerType());
      await this.transport.connect();
      this.syncStateFromTransport();

      // Send ESC/POS init command
      await this.sendBytes(ESC_INIT);

      // Persist printer type
      this.savePrinterType(this.printerType());
    } catch (error) {
      console.error('[PrinterService] Failed to connect:', error);
      this.resetState();
    }
  }

  /**
   * Attempts to reconnect using previously saved configuration.
   * Tries serial first, then bluetooth if serial fails.
   * Called on app init — silently fails if no device available.
   */
  async tryAutoConnect(): Promise<void> {
    // Try serial first (most common)
    if ('serial' in navigator) {
      try {
        const serial = this.createTransport('serial');
        await serial.tryAutoConnect();
        if (serial.isConnected) {
          this.transport = serial;
          this.printerType.set('serial');
          this.syncStateFromTransport();
          await this.sendBytes(ESC_INIT);
          return;
        }
      } catch { /* try bluetooth next */ }
    }

    // Try bluetooth if serial failed and BT device was saved
    const config = this.configService.loadDeviceConfig();
    if ('bluetooth' in navigator && config.bluetoothDeviceId) {
      try {
        const bt = this.createTransport('bluetooth');
        await bt.tryAutoConnect();
        if (bt.isConnected) {
          this.transport = bt;
          this.printerType.set('bluetooth');
          this.syncStateFromTransport();
          await this.sendBytes(ESC_INIT);
          return;
        }
      } catch { /* silent */ }
    }
  }

  /**
   * Disconnects the current printer.
   */
  async disconnect(): Promise<void> {
    try {
      if (this.transport) {
        await this.transport.disconnect();
      }
    } catch (error) {
      console.error('[PrinterService] Failed to disconnect:', error);
    } finally {
      this.resetState();
    }
  }

  /**
   * Prints a test ticket with business name, date/time, and "PRUEBA DE IMPRESIÓN".
   */
  async printTestTicket(): Promise<void> {
    const deviceConfig = this.configService.loadDeviceConfig();
    const businessName = deviceConfig.businessName || 'Mi Negocio';
    const now = new Date();
    const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const lines: TicketLine[] = [
      { text: businessName, align: 'center', bold: true, large: true },
      { text: '', align: 'center' },
      { text: '', align: 'center', divider: true },
      { text: 'PRUEBA DE IMPRESIÓN', align: 'center', bold: true },
      { text: '', align: 'center', divider: true },
      { text: '', align: 'center' },
      { text: `Fecha: ${dateStr}`, align: 'left' },
      { text: `Hora:  ${timeStr}`, align: 'left' },
      { text: '', align: 'center' },
      { text: 'Si puedes leer esto,', align: 'center' },
      { text: 'la impresora funciona correctamente.', align: 'center' },
      { text: '', align: 'center' },
      { text: '', align: 'center' },
    ];

    await this.sendBytes(this.buildTicketBytes(lines));
    await this.cutPaper();
  }

  /** Sends ESC/POS paper cut command */
  async cutPaper(): Promise<void> {
    await this.sendBytes(CUT_PAPER);
  }

  /**
   * Sends the ESC/POS kick command to open a cash drawer wired into the
   * printer's RJ12 port. Fires both pin-2 and pin-5 variants so it works
   * regardless of how the drawer is cabled.
   */
  async openCashDrawer(): Promise<void> {
    await this.sendBytes(DRAWER_KICK_PIN2);
    // Small delay to prevent buffer lock between back-to-back kicks.
    await new Promise(resolve => setTimeout(resolve, 50));
    await this.sendBytes(DRAWER_KICK_PIN5);
  }

  /**
   * Prints a full order ticket.
   * @param order The order data to print
   */
  async printOrderTicket(order: PrintableOrder): Promise<void> {
    const dateStr = order.date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = order.date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const lines: TicketLine[] = [
      { text: order.businessName, align: 'center', bold: true, large: true },
      { text: order.branchName, align: 'center' },
      { text: '', align: 'center' },
      { text: '', align: 'center', divider: true },
      { text: `Orden #${order.orderNumber}`, align: 'center', bold: true },
      { text: `${dateStr}  ${timeStr}`, align: 'center' },
      { text: '', align: 'center', divider: true },
      { text: '', align: 'center' },
    ];

    for (const item of order.items) {
      const price = `$${(item.priceCents / 100).toFixed(2)}`;
      const itemText = `${item.qty}x ${item.name}`;
      const padding = PAPER_WIDTH - itemText.length - price.length;
      const paddedLine = itemText + ' '.repeat(Math.max(1, padding)) + price;
      lines.push({ text: paddedLine, align: 'left' });
    }

    lines.push(
      { text: '', align: 'center' },
      { text: '', align: 'center', divider: true },
    );

    const totalStr = `$${(order.totalCents / 100).toFixed(2)}`;
    const totalLine = 'TOTAL' + ' '.repeat(PAPER_WIDTH - 5 - totalStr.length) + totalStr;
    lines.push(
      { text: totalLine, align: 'left', bold: true },
      { text: '', align: 'center', divider: true },
      { text: '', align: 'center' },
      { text: `Pago: ${order.paymentLabel}`, align: 'left' },
      { text: '', align: 'center' },
      { text: '¡Gracias por su compra!', align: 'center' },
      { text: '', align: 'center' },
      { text: '', align: 'center' },
    );

    await this.sendBytes(this.buildTicketBytes(lines));
    await this.cutPaper();
  }

  /**
   * Prints a kitchen comanda via ESC/POS — items + qty + table, NO prices.
   * @param order The order data for the comanda
   */
  async printKitchenComanda(order: {
    orderNumber: number;
    tableName?: string;
    createdAt: Date;
    items: { quantity: number; product: { name: string }; size?: { label: string }; extras: { label: string }[]; notes?: string }[];
  }): Promise<void> {
    const time = new Date(order.createdAt);
    const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

    const lines: TicketLine[] = [
      { text: 'COMANDA', align: 'center', bold: true, large: true },
      { text: '', align: 'center' },
      { text: '', align: 'center', divider: true },
      { text: `Orden #${order.orderNumber}`, align: 'center', bold: true },
      { text: timeStr + ' hrs', align: 'center' },
    ];

    if (order.tableName) {
      lines.push({ text: `Mesa: ${order.tableName}`, align: 'center', bold: true });
    }

    lines.push(
      { text: '', align: 'center', divider: true },
      { text: '', align: 'center' },
    );

    for (const item of order.items) {
      lines.push({ text: `${item.quantity}x  ${item.product.name}`, align: 'left', bold: true });
      if (item.size) {
        lines.push({ text: `    Tamaño: ${item.size.label}`, align: 'left' });
      }
      for (const extra of item.extras) {
        lines.push({ text: `    + ${extra.label}`, align: 'left' });
      }
      if (item.notes) {
        lines.push({ text: `    * ${item.notes}`, align: 'left' });
      }
    }

    lines.push(
      { text: '', align: 'center' },
      { text: '', align: 'center', divider: true },
      { text: '', align: 'center' },
      { text: '', align: 'center' },
    );

    await this.sendBytes(this.buildTicketBytes(lines));
    await this.cutPaper();
  }

  //#endregion

  //#region Private Helpers

  /**
   * Creates a transport instance based on type.
   * Wires up callbacks for config persistence.
   */
  private createTransport(type: 'serial' | 'bluetooth'): PrinterTransport {
    if (type === 'bluetooth') {
      const bt = new BluetoothTransport();
      const config = this.configService.loadDeviceConfig();
      bt.savedDeviceId = config.bluetoothDeviceId;
      bt.onConnected = (deviceId, deviceName) => {
        const cfg = this.configService.loadDeviceConfig();
        this.configService.saveDeviceConfig({
          ...cfg,
          printerType: 'bluetooth',
          bluetoothDeviceId: deviceId,
          bluetoothDeviceName: deviceName,
        });
      };
      return bt;
    }

    const serial = new SerialTransport();
    serial.loadConfig = () => {
      const cfg = this.configService.loadDeviceConfig();
      if (cfg.printerVendorId != null && cfg.printerProductId != null) {
        return { vendorId: cfg.printerVendorId, productId: cfg.printerProductId, name: cfg.printerName ?? '' };
      }
      return null;
    };
    serial.onConnected = (vendorId, productId, name) => {
      const cfg = this.configService.loadDeviceConfig();
      this.configService.saveDeviceConfig({
        ...cfg,
        printerType: 'serial',
        printerVendorId: vendorId,
        printerProductId: productId,
        printerName: name,
      });
    };
    return serial;
  }

  /**
   * Sends raw bytes through the active transport.
   * Throws on failure so callers can handle errors (toast, retry).
   */
  private async sendBytes(data: Uint8Array): Promise<void> {
    if (!this.transport?.isConnected) {
      throw new Error('Impresora no conectada');
    }

    try {
      await this.transport.write(data);
      this.lastPrintError.set(null);
    } catch (error) {
      console.error('[PrinterService] Failed to send bytes:', error);
      this.resetState();
      const message = error instanceof Error ? error.message : 'Error de comunicación con la impresora';
      this.lastPrintError.set(message);
      throw new Error(message);
    }
  }

  /** Syncs component signals from the active transport state */
  private syncStateFromTransport(): void {
    if (!this.transport) return;
    this.printerConnected.set(this.transport.isConnected);
    this.printerName.set(this.transport.deviceName);
    this.printerPort.set(this.transport.portLabel);
  }

  /** Persists printer type to DeviceConfig */
  private savePrinterType(type: 'serial' | 'bluetooth'): void {
    const config = this.configService.loadDeviceConfig();
    this.configService.saveDeviceConfig({ ...config, printerType: type });
  }

  /** Builds ESC/POS byte array for a ticket from structured lines */
  private buildTicketBytes(lines: TicketLine[]): Uint8Array {
    const chunks: Uint8Array[] = [ESC_INIT];

    for (const line of lines) {
      if (line.divider) {
        chunks.push(ALIGN_LEFT, this.encoder.encode('-'.repeat(PAPER_WIDTH)), LINE_FEED);
        continue;
      }

      if (line.align === 'center') chunks.push(ALIGN_CENTER);
      else chunks.push(ALIGN_LEFT);

      if (line.large) chunks.push(FONT_LARGE);
      if (line.bold) chunks.push(BOLD_ON);

      chunks.push(this.encoder.encode(line.text), LINE_FEED);

      if (line.bold) chunks.push(BOLD_OFF);
      if (line.large) chunks.push(FONT_NORMAL);
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /** Resets all connection state signals */
  private resetState(): void {
    this.printerConnected.set(false);
    this.printerName.set('');
    this.printerPort.set('');
    this.transport = null;
  }

  //#endregion

}
