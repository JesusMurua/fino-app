import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CalendarModule } from 'primeng/calendar';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { MessageService } from 'primeng/api';

import { GlobalInvoiceRecord, GlobalInvoiceSummary } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { InvoicingService } from '../../../../core/services/invoicing.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-admin-invoicing',
  standalone: true,
  imports: [DatePipe, FormsModule, CalendarModule, TableModule, PricePipe],
  templateUrl: './admin-invoicing.component.html',
  styleUrl: './admin-invoicing.component.scss',
})
export class AdminInvoicingComponent implements OnInit {

  //#region Properties
  private readonly invoicingService = inject(InvoicingService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);

  /** Date range for the period selector (two-way bound to p-calendar) */
  dateRange: Date[] = this.defaultRange();

  /** Summary of uninvoiced orders for selected range */
  readonly summary = signal<GlobalInvoiceSummary>({
    uninvoicedCount: 0,
    uninvoicedTotalCents: 0,
    publicoGeneralTotalCents: 0,
  });

  /** History of global invoices */
  readonly history = signal<GlobalInvoiceRecord[]>([]);

  /** Loading state for summary fetch */
  readonly loading = signal(false);

  /** Generating global invoice in progress */
  readonly isGenerating = signal(false);

  /** Whether the summary has data */
  readonly hasSummary = computed(() => this.summary().uninvoicedCount > 0);

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  //#endregion

  //#region Methods

  /** Loads summary and history for the current date range */
  async loadData(): Promise<void> {
    if (this.dateRange.length < 2 || !this.dateRange[0] || !this.dateRange[1]) return;

    this.loading.set(true);
    const [from, to] = this.normalizeRange();

    const [summary, history] = await Promise.all([
      this.invoicingService.getUninvoicedSummary(from, to),
      this.invoicingService.getGlobalInvoiceHistory(from, to),
    ]);

    this.summary.set(summary);
    this.history.set(history);
    this.loading.set(false);
  }

  /** Called when the date range picker changes */
  async onDateChange(): Promise<void> {
    if (this.dateRange.length === 2 && this.dateRange[0] && this.dateRange[1]) {
      await this.loadData();
    }
  }

  /** Generates a global invoice for the selected period */
  async onGenerateGlobal(): Promise<void> {
    if (this.isGenerating()) return;

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
      await this.loadData();
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

  /** Returns a status label for display */
  getStatusLabel(status: string): string {
    switch (status) {
      case 'completed': return 'Timbrada';
      case 'failed':    return 'Error';
      case 'cancelled': return 'Cancelada';
      default:          return status;
    }
  }

  /** Returns a severity class for the status badge */
  getStatusClass(status: string): string {
    switch (status) {
      case 'completed': return 'status-badge--success';
      case 'failed':    return 'status-badge--error';
      case 'cancelled': return 'status-badge--cancelled';
      default:          return '';
    }
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
