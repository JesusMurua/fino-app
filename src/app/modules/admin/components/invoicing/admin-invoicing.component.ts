import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CalendarModule } from 'primeng/calendar';
import { MessageService } from 'primeng/api';

import { InvoicingService } from '../../../../core/services/invoicing.service';

/**
 * Backoffice surface for triggering a Global CFDI invoice over a date range.
 *
 * The previous summary cards and history table were removed (Phase 2 of the
 * date refactor) because their backend endpoints (`/invoicing/uninvoiced-summary`
 * and `/invoicing/global/history`) do not exist. The cancel-invoice flow lived
 * on the history table and was removed alongside it.
 */
@Component({
  selector: 'app-admin-invoicing',
  standalone: true,
  imports: [FormsModule, ButtonModule, CalendarModule],
  templateUrl: './admin-invoicing.component.html',
  styleUrl: './admin-invoicing.component.scss',
})
export class AdminInvoicingComponent {

  //#region Properties
  private readonly invoicingService = inject(InvoicingService);
  private readonly messageService = inject(MessageService);

  /** Date range for the period selector (two-way bound to p-calendar) */
  dateRange: Date[] = this.defaultRange();

  /** Generating global invoice in progress */
  readonly isGenerating = signal(false);
  //#endregion

  //#region Methods

  /** Generates a global invoice for the selected period */
  async onGenerateGlobal(): Promise<void> {
    if (this.isGenerating()) return;
    if (this.dateRange.length < 2 || !this.dateRange[0] || !this.dateRange[1]) return;

    this.isGenerating.set(true);
    const [from, to] = this.normalizeRange();

    const result = await this.invoicingService.createGlobalInvoice(from, to);

    if (result.success) {
      this.messageService.add({
        severity: 'success',
        summary: 'Factura global generada',
        detail: result.cfdiUuid ? `CFDI: ${result.cfdiUuid}` : undefined,
        life: 5000,
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: 'Error al generar factura global',
        detail: result.errorMessage,
        life: 5000,
      });
    }

    this.isGenerating.set(false);
  }

  //#endregion

  //#region Private Helpers

  /** Returns start-of-month to today as default range */
  private defaultRange(): Date[] {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return [from, now];
  }

  /** Normalizes the range to full-day boundaries */
  private normalizeRange(): [Date, Date] {
    const from = new Date(this.dateRange[0]);
    from.setHours(0, 0, 0, 0);
    const to = new Date(this.dateRange[1]);
    to.setHours(23, 59, 59, 999);
    return [from, to];
  }

  //#endregion

}
