import { Injectable, inject } from '@angular/core';

import { Order, getPaymentLabel } from '../models';
import { DatabaseService } from './database.service';
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
  private readonly printerService = inject(PrinterService);
  private readonly configService = inject(ConfigService);

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
        ${sep}
        <div style="text-align:center;font-size:12px;color:#6B7280;margin-top:4px">¡Gracias por su visita!</div>
      </div>
    `;
  }

  //#endregion

  //#region Private Helpers

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

}
