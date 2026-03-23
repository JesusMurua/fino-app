import { Injectable } from '@angular/core';

import { Order } from '../models';
import { DatabaseService } from './database.service';

/**
 * Handles ticket printing for completed orders.
 *
 * Current state: stub implementation.
 * - If a thermal printer is detected (WebUSB / BrowserPrint SDK): TODO ESC/POS driver.
 * - If no printer: generates a plain-text ticket and persists it in IndexedDB
 *   so it can be displayed on screen or retrieved later.
 *
 * Future integration points:
 *   - ESC/POS over WebUSB (Chrome/Edge)
 *   - Zebra BrowserPrint SDK
 *   - Star Micronics WebPRNT
 */
@Injectable({ providedIn: 'root' })
export class PrintService {

  constructor(private readonly db: DatabaseService) {}

  //#region Public API

  /**
   * Returns true if a supported thermal printer interface is available.
   * Currently detects WebUSB and Zebra BrowserPrint presence.
   * ESC/POS driver is not yet implemented — always returns false until then.
   */
  hasThermalPrinter(): boolean {
    const hasWebUsb = 'usb' in navigator;
    const hasBrowserPrint = 'BrowserPrint' in window;
    // Driver not implemented yet — reserved for future use
    void hasWebUsb;
    void hasBrowserPrint;
    return false;
  }

  /**
   * Prints the ticket for a completed order.
   *
   * If a thermal printer is available: sends ESC/POS commands (TODO).
   * If not: generates plain-text ticket and saves it to IndexedDB.
   *
   * @param order The completed order to print
   */
  async printTicket(order: Order): Promise<void> {
    if (this.hasThermalPrinter()) {
      // TODO: implement ESC/POS printing via WebUSB
      // await this.printEscPos(order);
      return;
    }

    // Fallback: save ticket as plain text in IndexedDB
    const ticketText = this.generateTicketText(order);
    try {
      await this.db.orders.update(order.id, { ticketText });
    } catch (error) {
      console.error('[PrintService] Failed to save ticket text:', error);
    }
  }

  /**
   * Generates a styled HTML ticket for preview and printing.
   * Designed for 80mm thermal printer width (280px).
   * @param order The order to generate the ticket for
   * @returns Complete HTML string with inline styles
   */
  getTicketHtml(order: Order): string {
    const date = new Date(order.createdAt).toLocaleString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const sep = '<div style="text-align:center;color:#9CA3AF;letter-spacing:-1px">─────────────────────</div>';

    const itemRows = order.items.map(item => {
      const sizeLabel = item.size ? ` (${item.size.label})` : '';
      const extras = item.extras.length > 0 ? item.extras.map(e => e.label).join(', ') : '';
      const price = `$${(item.totalPriceCents / 100).toFixed(2)}`;
      return `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr>
            <td style="padding:2px 0">${item.quantity}x ${item.product.name}${sizeLabel}</td>
            <td style="padding:2px 0;text-align:right;white-space:nowrap">${price}</td>
          </tr>
        </table>
        ${extras ? `<div style="font-size:11px;color:#6B7280;padding-left:20px">+ ${extras}</div>` : ''}
        ${item.notes ? `<div style="font-size:11px;color:#92400E;padding-left:20px">⚠ ${item.notes}</div>` : ''}
      `;
    }).join('');

    const total = `$${(order.totalCents / 100).toFixed(2)}`;
    const methodLabel = order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta';

    let changeHtml = '';
    if (order.paymentMethod === 'cash' && order.tenderedCents != null) {
      const tendered = `$${(order.tenderedCents / 100).toFixed(2)}`;
      const change = `$${((order.tenderedCents - order.totalCents) / 100).toFixed(2)}`;
      changeHtml = `
        <table style="width:100%;font-size:12px;color:#374151;border-collapse:collapse">
          <tr><td style="padding:2px 0">Pago</td><td style="padding:2px 0;text-align:right">${tendered}</td></tr>
          <tr><td style="padding:2px 0">Cambio</td><td style="padding:2px 0;text-align:right">${change}</td></tr>
        </table>
      `;
    }

    return `
      <div style="width:280px;margin:0 auto;padding:16px;font-family:'Courier New',Courier,monospace;background:white;color:#111827">
        <div style="text-align:center;font-size:16px;font-weight:700;margin-bottom:4px">MI NEGOCIO</div>
        ${sep}
        <div style="font-size:12px;color:#6B7280;text-align:center">${date}</div>
        <div style="font-size:12px;color:#6B7280;text-align:center;margin-bottom:4px">Orden #${order.orderNumber}</div>
        ${order.tableName ? `<div style="font-size:12px;color:#6B7280;text-align:center;margin-bottom:4px">Mesa: ${order.tableName}</div>` : ''}
        ${sep}
        ${itemRows}
        ${sep}
        ${order.discountCents && order.subtotalCents ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;color:#374151">
          <tr>
            <td style="padding:2px 0">Subtotal</td>
            <td style="padding:2px 0;text-align:right">$${(order.subtotalCents / 100).toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding:2px 0">Descuento${order.discountLabel ? ' (' + order.discountLabel + ')' : ''}</td>
            <td style="padding:2px 0;text-align:right">-$${(order.discountCents / 100).toFixed(2)}</td>
          </tr>
        </table>
        ${sep}
        ` : ''}
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="font-size:15px;font-weight:700;padding:4px 0">TOTAL</td>
            <td style="font-size:15px;font-weight:700;padding:4px 0;text-align:right">${total}</td>
          </tr>
        </table>
        <div style="font-size:12px;color:#6B7280">Pago: ${methodLabel}</div>
        ${changeHtml}
        ${sep}
        <div style="text-align:center;font-size:12px;color:#6B7280;margin-top:4px">¡Gracias por su visita!</div>
      </div>
    `;
  }

  //#endregion

  //#region Private Helpers

  /**
   * Generates a plain-text representation of the order ticket.
   * Format is designed to be readable on screen and printable on 58mm/80mm paper.
   *
   * @param order The completed order
   * @returns Formatted ticket string
   */
  private generateTicketText(order: Order): string {
    const line = '─'.repeat(32);
    const date = new Date(order.createdAt).toLocaleString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const itemLines = order.items.map(item => {
      const sizeLabel = item.size ? ` (${item.size.label})` : '';
      const price = (item.totalPriceCents / 100).toFixed(2);
      return `${item.quantity}x ${item.product.name}${sizeLabel}`.padEnd(24) + `$${price}`;
    });

    const total = (order.totalCents / 100).toFixed(2);
    const methodLabel = order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta';

    let changeSection = '';
    if (order.paymentMethod === 'cash' && order.tenderedCents != null) {
      const tendered = (order.tenderedCents / 100).toFixed(2);
      const change = ((order.tenderedCents - order.totalCents) / 100).toFixed(2);
      changeSection = `\nPago:   $${tendered}\nCambio: $${change}`;
    }

    return [
      'MI NEGOCIO',
      date,
      `Orden #${order.orderNumber}`,
      line,
      ...itemLines,
      line,
      `TOTAL: $${total}`,
      `Pago: ${methodLabel}`,
      changeSection,
      line,
      '¡Gracias por su visita!',
    ].join('\n');
  }

  //#endregion

}
