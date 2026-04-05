import { Injectable, inject } from '@angular/core';

import { CartItem } from '../models/cart-item.model';
import { Order, getPaymentLabel } from '../models';
import { DatabaseService } from './database.service';
import { InvoicingService } from './invoicing.service';
import { PrinterDestination } from '../models/printer.model';
import { PrinterDestinationService } from './printer-destination.service';
import { PrinterService, PrintableOrder } from './printer.service';
import { ConfigService } from './config.service';

/**
 * High-level print orchestrator for the POS application.
 *
 * Routes print jobs to the correct destination:
 *   - If a thermal printer is connected → ESC/POS via PrinterService
 *   - If no printer → generates ticket text and saves to IndexedDB
 *
 * All POS components call this service (never PrinterService directly).
 */
@Injectable({ providedIn: 'root' })
export class PrintService {

  private readonly db = inject(DatabaseService);
  private readonly invoicingService = inject(InvoicingService);
  private readonly printerService = inject(PrinterService);
  private readonly configService = inject(ConfigService);
  private readonly printerDestinationService = inject(PrinterDestinationService);

  //#region Public API

  /**
   * Returns true if a thermal printer is physically connected and ready.
   * Reads the live connection state from PrinterService.
   */
  hasThermalPrinter(): boolean {
    return this.printerService.printerConnected();
  }

  /**
   * Prints the receipt ticket for a completed order.
   *
   * If a thermal printer is connected → sends ESC/POS commands.
   * If not → saves plain-text ticket to IndexedDB as fallback.
   *
   * Throws on thermal printer failure so callers can show error UI.
   * @param order The completed order to print
   */
  async printTicket(order: Order): Promise<void> {
    if (this.hasThermalPrinter()) {
      const printable = this.mapOrderToPrintable(order);
      await this.printerService.printOrderTicket(printable);
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
   * Prints a kitchen comanda (items + qty + table, no prices).
   *
   * If a thermal printer is connected → sends ESC/POS comanda.
   * If not → falls back to window.print() with styled HTML.
   *
   * Throws on thermal printer failure so callers can show error UI.
   * @param order The order to print as a kitchen comanda
   */
  async printKitchenComanda(order: Order): Promise<void> {
    if (this.hasThermalPrinter()) {
      await this.printerService.printKitchenComanda({
        orderNumber: order.orderNumber,
        tableName: order.tableName,
        createdAt: new Date(order.createdAt),
        items: order.items,
      });
      return;
    }

    // Fallback: browser print dialog (blocking but functional)
    this.fallbackBrowserPrintComanda(order);
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
      const discountRow = (item.discountCents ?? 0) > 0
        ? `<table style="width:100%;border-collapse:collapse;font-size:11px;color:#15803D">
            <tr>
              <td style="padding:1px 0;padding-left:20px">${item.promotionName ?? 'Promoción'}</td>
              <td style="padding:1px 0;text-align:right;white-space:nowrap">-$${(item.discountCents! / 100).toFixed(2)}</td>
            </tr>
          </table>`
        : '';
      return `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr>
            <td style="padding:2px 0">${item.quantity}x ${item.product.name}${sizeLabel}</td>
            <td style="padding:2px 0;text-align:right;white-space:nowrap">${price}</td>
          </tr>
        </table>
        ${extras ? `<div style="font-size:11px;color:#6B7280;padding-left:20px">+ ${extras}</div>` : ''}
        ${item.notes ? `<div style="font-size:11px;color:#92400E;padding-left:20px">⚠ ${item.notes}</div>` : ''}
        ${discountRow}
      `;
    }).join('');

    const total = `$${(order.totalCents / 100).toFixed(2)}`;
    const payments = order.payments ?? [];
    const methodLabel = payments.length > 0
      ? payments.map(p => {
          const labels: Record<string, string> = { Cash: 'Efectivo', Card: 'Tarjeta', Transfer: 'Transferencia', Other: 'Otro' };
          return labels[p.method] ?? p.method;
        }).join(' + ')
      : 'Sin cobrar';

    let changeHtml = '';
    if (payments.length > 0) {
      const paidTotal = `$${(order.paidCents / 100).toFixed(2)}`;
      const paymentRows = payments.map(p => {
        const labels: Record<string, string> = { Cash: 'Efectivo', Card: 'Tarjeta', Transfer: 'Transferencia', Other: 'Otro' };
        const label = labels[p.method] ?? p.method;
        return `<tr><td style="padding:2px 0">${label}</td><td style="padding:2px 0;text-align:right">$${(p.amountCents / 100).toFixed(2)}</td></tr>`;
      }).join('');

      changeHtml = `
        <table style="width:100%;font-size:12px;color:#374151;border-collapse:collapse">
          ${payments.length > 1 ? paymentRows : `<tr><td style="padding:2px 0">Pago</td><td style="padding:2px 0;text-align:right">${paidTotal}</td></tr>`}
          ${order.changeCents > 0 ? `<tr><td style="padding:2px 0">Cambio</td><td style="padding:2px 0;text-align:right">$${(order.changeCents / 100).toFixed(2)}</td></tr>` : ''}
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
        ${order.totalDiscountCents && order.subtotalCents ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;color:#374151">
          <tr>
            <td style="padding:2px 0">Subtotal</td>
            <td style="padding:2px 0;text-align:right">$${(order.subtotalCents / 100).toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding:2px 0">Descuento${order.orderPromotionName ? ' (' + order.orderPromotionName + ')' : ''}</td>
            <td style="padding:2px 0;text-align:right">-$${(order.totalDiscountCents / 100).toFixed(2)}</td>
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
        ${order.totalDiscountCents ? `
        ${sep}
        <div style="text-align:center;font-size:13px;font-weight:700;color:#15803D;padding:4px 0">Ahorraste: $${(order.totalDiscountCents / 100).toFixed(2)}</div>
        ` : ''}
        ${this.getAutoFacturaBlock(order)}
        ${sep}
        <div style="text-align:center;font-size:12px;color:#6B7280;margin-top:4px">¡Gracias por su visita!</div>
      </div>
    `;
  }

  //#endregion

  //#region Private Helpers

  /**
   * Returns the auto-factura HTML block for the ticket footer.
   * Only shown when invoicing is enabled and the order is NOT already invoiced.
   */
  private getAutoFacturaBlock(order: Order): string {
    if (!this.configService.hasInvoicing()) return '';
    if (order.invoiceRequest?.status === 'completed') return '';

    const url = this.invoicingService.getAutoFacturaUrl(order.id);
    const sep = '<div style="text-align:center;color:#9CA3AF;letter-spacing:-1px">─────────────────────</div>';
    return `
      ${sep}
      <div style="text-align:center;font-size:11px;color:#6B7280;padding:4px 0">
        <div style="font-weight:600;margin-bottom:2px">Factura tu compra en:</div>
        <div style="word-break:break-all">${url}</div>
        <div style="margin-top:2px">Folio: ${order.id.substring(0, 8)}</div>
      </div>
    `;
  }

  /**
   * Maps a Dexie Order to the flat PrintableOrder shape the ESC/POS driver expects.
   */
  private mapOrderToPrintable(order: Order): PrintableOrder {
    const deviceConfig = this.configService.loadDeviceConfig();
    return {
      orderNumber: String(order.orderNumber),
      items: order.items.map(item => ({
        name: item.product.name + (item.size ? ` (${item.size.label})` : ''),
        qty: item.quantity,
        priceCents: item.totalPriceCents,
      })),
      totalCents: order.totalCents,
      paymentLabel: getPaymentLabel(order),
      businessName: deviceConfig.businessName || 'Mi Negocio',
      branchName: deviceConfig.branchName || '',
      date: new Date(order.createdAt),
    };
  }

  /**
   * Fallback: generates kitchen comanda HTML and uses window.print().
   * Only used when no thermal printer is connected.
   */
  private fallbackBrowserPrintComanda(order: Order): void {
    const time = new Date(order.createdAt);
    const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

    let html = `
      <div class="print-comanda">
        <div class="print-comanda__separator">────────────────────</div>
        <div class="print-comanda__title">COMANDA</div>
        <div class="print-comanda__order">Orden #${order.orderNumber}</div>
        <div class="print-comanda__time">${timeStr} hrs</div>
        ${order.tableName ? `<div class="print-comanda__table">Mesa: ${order.tableName}</div>` : ''}
        <div class="print-comanda__separator">────────────────────</div>`;

    for (const item of order.items) {
      html += `<div class="print-comanda__item">${item.quantity}x  ${item.product.name}</div>`;
      if (item.size) {
        html += `<div class="print-comanda__meta">    Tamaño: ${item.size.label}</div>`;
      }
      for (const extra of item.extras) {
        html += `<div class="print-comanda__meta">    + ${extra.label}</div>`;
      }
      if (item.notes) {
        html += `<div class="print-comanda__notes">    ⚠ ${item.notes}</div>`;
      }
    }

    html += `<div class="print-comanda__separator">────────────────────</div></div>`;

    const printEl = document.createElement('div');
    printEl.id = 'print-comanda-area';
    printEl.innerHTML = html;
    document.body.appendChild(printEl);
    window.print();
    document.body.removeChild(printEl);
  }

  /**
   * Generates a plain-text representation of the order ticket.
   * @param order The completed order
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

    const itemLines: string[] = [];
    for (const item of order.items) {
      const sizeLabel = item.size ? ` (${item.size.label})` : '';
      const price = (item.totalPriceCents / 100).toFixed(2);
      itemLines.push(`${item.quantity}x ${item.product.name}${sizeLabel}`.padEnd(24) + `$${price}`);
      if ((item.discountCents ?? 0) > 0) {
        const discLabel = (item.promotionName ?? 'Promoción').substring(0, 22);
        const discPrice = `-$${(item.discountCents! / 100).toFixed(2)}`;
        itemLines.push(`  ${discLabel}`.padEnd(24) + discPrice);
      }
    }

    const total = (order.totalCents / 100).toFixed(2);
    const payments = order.payments ?? [];
    const labels: Record<string, string> = { Cash: 'Efectivo', Card: 'Tarjeta', Transfer: 'Transferencia', Other: 'Otro' };
    const methodLabel = payments.length > 0
      ? payments.map(p => labels[p.method] ?? p.method).join(' + ')
      : 'Sin cobrar';

    let changeSection = '';
    if (payments.length > 1) {
      changeSection = '\n' + payments.map(p =>
        `${(labels[p.method] ?? p.method)}:`.padEnd(10) + `$${(p.amountCents / 100).toFixed(2)}`
      ).join('\n');
    } else if (payments.length === 1) {
      changeSection = `\nPago:   $${(order.paidCents / 100).toFixed(2)}`;
    }
    if (order.changeCents > 0) {
      changeSection += `\nCambio: $${(order.changeCents / 100).toFixed(2)}`;
    }

    const discountSection = order.totalDiscountCents && order.subtotalCents
      ? `\nSubtotal:${''.padEnd(15)}$${(order.subtotalCents / 100).toFixed(2)}\nDescuento:${''.padEnd(14)}-$${(order.totalDiscountCents / 100).toFixed(2)}\n${line}`
      : '';

    const savingsLine = order.totalDiscountCents
      ? `\nAhorraste: $${(order.totalDiscountCents / 100).toFixed(2)}`
      : '';

    return [
      'MI NEGOCIO',
      date,
      `Orden #${order.orderNumber}`,
      line,
      ...itemLines,
      line,
      discountSection,
      `TOTAL: $${total}`,
      `Pago: ${methodLabel}`,
      changeSection,
      savingsLine,
      line,
      '¡Gracias por su visita!',
    ].filter(Boolean).join('\n');
  }

  //#endregion

  //#region Destination-Based Printing (Phase 19)

  /**
   * Main entry point for destination-aware printing.
   * Groups order items by their product's printingDestinationId and dispatches
   * one kitchen ticket per destination in parallel. Always prints the customer receipt.
   * @param order Completed order with items and payment data
   */
  async printOrder(order: Order): Promise<void> {
    const groups = this.groupItemsByDestination(order.items);

    const context = {
      orderNumber: order.orderNumber.toString().padStart(4, '0'),
      tableLabel:  order.tableName,
      createdAt:   new Date(order.createdAt),
    };

    // Kitchen tickets — dispatched in parallel
    const kitchenJobs: Promise<void>[] = [];
    for (const [destinationId, items] of groups) {
      const dest = this.printerDestinationService.destinations().find(d => d.id === destinationId);
      if (dest) {
        kitchenJobs.push(this.dispatchDestinationKitchenTicket(items, dest, context));
      }
    }
    await Promise.all(kitchenJobs);

    // Customer receipt — always dispatched after kitchen tickets
    const defaultDest = this.printerDestinationService.defaultDestination();
    await this.dispatchDestinationReceipt(order, defaultDest);
  }

  /**
   * Groups cart items by product.printingDestinationId.
   * Items with null or undefined printingDestinationId are excluded (no kitchen printing).
   */
  private groupItemsByDestination(items: CartItem[]): Map<number, CartItem[]> {
    const groups = new Map<number, CartItem[]>();
    for (const item of items) {
      const destId = item.product.printingDestinationId;
      if (destId == null) continue;
      if (!groups.has(destId)) groups.set(destId, []);
      groups.get(destId)!.push(item);
    }
    return groups;
  }

  /**
   * Dispatches a kitchen ticket to a named printer destination.
   * Phase 19: only 'none' (window.print()) is functional. Other types log a stub warning.
   */
  private async dispatchDestinationKitchenTicket(
    items: CartItem[],
    destination: PrinterDestination,
    context: { orderNumber: string; tableLabel?: string; createdAt: Date },
  ): Promise<void> {
    switch (destination.connectionType) {
      case 'none':
        this.openDestinationKitchenPrintWindow(items, destination.name, context);
        break;
      case 'network':
        console.warn(`[PrintService] Network printing not yet implemented. Destination: ${destination.name} (${destination.address})`);
        break;
      case 'usb':
        console.warn(`[PrintService] USB printing not yet implemented. Destination: ${destination.name}`);
        break;
      case 'bluetooth':
        console.warn(`[PrintService] Bluetooth printing not yet implemented. Destination: ${destination.name}`);
        break;
    }
  }

  /**
   * Dispatches the customer receipt to the default destination.
   * Phase 19: non-'none' types log a warning and fall back to window.print().
   */
  private async dispatchDestinationReceipt(order: Order, destination: PrinterDestination | null): Promise<void> {
    if (!destination || destination.connectionType === 'none') {
      this.openDestinationReceiptWindow(order);
      return;
    }
    console.warn(`[PrintService] ${destination.connectionType} receipt printing not yet implemented. Falling back to window.print().`);
    this.openDestinationReceiptWindow(order);
  }

  /** Opens a popup window with the kitchen ticket HTML and triggers window.print() */
  private openDestinationKitchenPrintWindow(
    items: CartItem[],
    destinationName: string,
    context: { orderNumber: string; tableLabel?: string; createdAt: Date },
  ): void {
    const time      = context.createdAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const tableInfo = context.tableLabel ? `• ${context.tableLabel} ` : '';

    const itemRows = items.map(item => {
      const sizeRow   = item.size   ? `<div class="item-detail">${item.size.label}</div>` : '';
      const extrasRow = item.extras.length ? `<div class="item-detail">${item.extras.map(e => e.label).join(', ')}</div>` : '';
      const notesRow  = item.notes  ? `<div class="item-note">nota: ${item.notes}</div>` : '';
      return `
        <div class="item-row">
          <span class="item-qty">${item.quantity}x</span>
          <div class="item-desc"><span>${item.product.name}</span>${sizeRow}${extrasRow}${notesRow}</div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Ticket Cocina</title>
<style>
  @media print{body{margin:0}}
  body{font-family:monospace;font-size:12pt;width:72mm;margin:0 auto;padding:8px}
  .header{text-align:center;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:8px}
  .dest{font-size:15pt;font-weight:bold;text-transform:uppercase}
  .meta{font-size:9pt;color:#333}
  .item-row{display:flex;gap:6px;margin-bottom:6px}
  .item-qty{font-size:14pt;font-weight:bold;min-width:24px}
  .item-desc{font-size:11pt}
  .item-detail,.item-note{font-size:9pt;color:#555}
</style></head><body>
  <div class="header"><div class="dest">${destinationName}</div><div class="meta">${tableInfo}${time} &bull; #${context.orderNumber}</div></div>
  ${itemRows}
</body></html>`;

    const win = window.open('', '_blank', 'width=320,height=480');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 250);
  }

  /** Opens a popup window with the customer receipt HTML and triggers window.print() */
  private openDestinationReceiptWindow(order: Order): void {
    const time  = new Date(order.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const total = (order.totalCents / 100).toFixed(2);

    const itemRows = order.items.map(item => {
      const unitPrice = (item.unitPriceCents / 100).toFixed(2);
      const lineTotal = (item.totalPriceCents / 100).toFixed(2);
      return `<tr><td>${item.quantity}x ${item.product.name}</td><td class="price">${unitPrice}</td><td class="price">${lineTotal}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Ticket</title>
<style>
  @media print{body{margin:0}}
  body{font-family:monospace;font-size:11pt;width:72mm;margin:0 auto;padding:8px}
  .header{text-align:center;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse}
  td{padding:2px 0;vertical-align:top}
  .price{text-align:right;white-space:nowrap}
  .total-row{border-top:1px dashed #000;font-weight:bold}
  .footer{text-align:center;font-size:9pt;margin-top:8px}
</style></head><body>
  <div class="header"><div style="font-weight:bold;font-size:13pt">TICKET</div><div style="font-size:9pt">#${order.orderNumber} &bull; ${time}</div></div>
  <table><tbody>${itemRows}</tbody><tfoot><tr class="total-row"><td colspan="2">TOTAL</td><td class="price">$${total}</td></tr></tfoot></table>
  <div class="footer">¡Gracias por su compra!</div>
</body></html>`;

    const win = window.open('', '_blank', 'width=320,height=540');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 250);
  }

  //#endregion

}
