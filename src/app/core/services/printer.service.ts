import { Injectable, inject, signal } from '@angular/core';

import { ConfigService } from './config.service';

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
 * Thermal printer service using Web Serial API (ESC/POS protocol).
 *
 * Manages connection state, auto-reconnect, and ticket printing.
 * Only works in Chrome/Edge on desktop — gracefully degrades elsewhere.
 */
@Injectable({ providedIn: 'root' })
export class PrinterService {

  //#region Injections
  private readonly configService = inject(ConfigService);
  //#endregion

  //#region Properties
  /** Whether the browser supports Web Serial API */
  readonly isSupported = signal('serial' in navigator);

  /** Whether a printer is currently connected */
  readonly printerConnected = signal(false);

  /** Display name of the connected printer */
  readonly printerName = signal('');

  /** Port description of the connected printer */
  readonly printerPort = signal('');

  /** Internal reference to the open serial port */
  private port: SerialPort | null = null;

  /** Internal reference to the writable stream writer */
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  /** Text encoder for converting strings to bytes */
  private readonly encoder = new TextEncoder();
  //#endregion

  //#region Public API

  /**
   * Requests a serial port from the browser and connects to the printer.
   * Must be called from a user gesture (button click).
   */
  async connect(): Promise<void> {
    if (!this.isSupported()) return;

    try {
      this.port = await navigator.serial!.requestPort();
      await this.openPort();
    } catch (error) {
      console.error('[PrinterService] Failed to connect:', error);
      this.resetState();
    }
  }

  /**
   * Attempts to reconnect using a previously authorized port.
   * Called on app init — silently fails if no port available.
   */
  async tryAutoConnect(): Promise<void> {
    if (!this.isSupported()) return;

    try {
      const ports = await navigator.serial!.getPorts();
      const saved = this.loadPrinterConfig();

      if (ports.length === 0 || !saved) return;

      // Try to match the saved vendor/product ID
      for (const p of ports) {
        const info = p.getInfo();
        if (info.usbVendorId === saved.vendorId && info.usbProductId === saved.productId) {
          this.port = p;
          await this.openPort();
          return;
        }
      }

      // Fallback: use first available port
      if (ports.length > 0) {
        this.port = ports[0];
        await this.openPort();
      }
    } catch {
      // Silent — auto-connect is best-effort
    }
  }

  /**
   * Disconnects the current printer port.
   */
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

  /**
   * Sends ESC/POS paper cut command.
   */
  async cutPaper(): Promise<void> {
    await this.sendBytes(CUT_PAPER);
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

    // Items
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

    // Total
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

  //#endregion

  //#region Private Helpers

  /**
   * Opens the current port and sets up the writer.
   */
  private async openPort(): Promise<void> {
    if (!this.port) return;

    await this.port.open({ baudRate: 9600 });

    if (this.port.writable) {
      this.writer = this.port.writable.getWriter();
    }

    const info = this.port.getInfo();
    const saved = this.loadPrinterConfig();
    const name = saved?.name || `USB ${info.usbVendorId ?? ''}:${info.usbProductId ?? ''}`;

    this.printerConnected.set(true);
    this.printerName.set(name);
    this.printerPort.set(`USB Serial`);

    // Save for auto-reconnect
    if (info.usbVendorId != null && info.usbProductId != null) {
      this.savePrinterConfig(info.usbVendorId, info.usbProductId, name);
    }

    // Send init command
    await this.sendBytes(ESC_INIT);
    console.info('[PrinterService] Printer connected:', name);
  }

  /**
   * Sends a Uint8Array of ESC/POS bytes to the printer port.
   */
  private async sendBytes(data: Uint8Array): Promise<void> {
    if (!this.writer) {
      console.warn('[PrinterService] No writer available — printer not connected');
      return;
    }

    try {
      await this.writer.write(data);
    } catch (error) {
      console.error('[PrinterService] Failed to send bytes:', error);
      this.resetState();
    }
  }

  /**
   * Builds ESC/POS byte array for a ticket from structured lines.
   */
  private buildTicketBytes(lines: TicketLine[]): Uint8Array {
    const chunks: Uint8Array[] = [ESC_INIT];

    for (const line of lines) {
      // Divider
      if (line.divider) {
        chunks.push(ALIGN_LEFT, this.encoder.encode('-'.repeat(PAPER_WIDTH)), LINE_FEED);
        continue;
      }

      // Alignment
      if (line.align === 'center') chunks.push(ALIGN_CENTER);
      else chunks.push(ALIGN_LEFT);

      // Font size
      if (line.large) chunks.push(FONT_LARGE);

      // Bold
      if (line.bold) chunks.push(BOLD_ON);

      // Text content
      chunks.push(this.encoder.encode(line.text), LINE_FEED);

      // Reset
      if (line.bold) chunks.push(BOLD_OFF);
      if (line.large) chunks.push(FONT_NORMAL);
    }

    // Calculate total length
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Saves printer info to DeviceConfig in localStorage.
   */
  private savePrinterConfig(vendorId: number, productId: number, name: string): void {
    const config = this.configService.loadDeviceConfig();
    this.configService.saveDeviceConfig({
      ...config,
      printerVendorId: vendorId,
      printerProductId: productId,
      printerName: name,
    });
  }

  /**
   * Loads printer config from DeviceConfig.
   */
  private loadPrinterConfig(): { vendorId: number; productId: number; name: string } | null {
    const config = this.configService.loadDeviceConfig();
    if (config.printerVendorId != null && config.printerProductId != null) {
      return {
        vendorId: config.printerVendorId,
        productId: config.printerProductId,
        name: config.printerName ?? '',
      };
    }
    return null;
  }

  /**
   * Resets all connection state signals.
   */
  private resetState(): void {
    this.printerConnected.set(false);
    this.printerName.set('');
    this.printerPort.set('');
    this.writer = null;
    this.port = null;
  }

  //#endregion

}
