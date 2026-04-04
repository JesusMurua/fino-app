import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ReportPeriod, ReportSummary } from '../models';
import { ApiService } from './api.service';

/**
 * Handles report generation and export.
 *
 * Summary data is fetched from the API.
 * Excel/PDF exports are downloaded as blobs via HttpClient directly
 * (ApiService does not support responseType: 'blob').
 */
@Injectable({ providedIn: 'root' })
export class ReportService {

  //#region Constructor
  constructor(
    private readonly api: ApiService,
    private readonly http: HttpClient,
  ) {}
  //#endregion

  //#region Public Methods

  /**
   * Gets report summary for a date range from API.
   * @param branchId Branch to query
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async getSummary(branchId: number, from: Date, to: Date): Promise<ReportSummary> {
    return firstValueFrom(
      this.api.get<ReportSummary>(
        `/report/summary?from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
    );
  }

  /**
   * Downloads Excel report and triggers browser download.
   * @param branchId Branch to query
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async downloadExcel(branchId: number, from: Date, to: Date): Promise<void> {
    const url = `${environment.apiUrl}/report/export/excel?from=${from.toISOString()}&to=${to.toISOString()}`;
    const blob = await firstValueFrom(
      this.http.get(url, { responseType: 'blob' }),
    );
    this.triggerDownload(blob, `reporte-ventas-${this.formatDateRange(from, to)}.xlsx`);
  }

  /**
   * Downloads PDF report and triggers browser download.
   * @param branchId Branch to query
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async downloadPdf(branchId: number, from: Date, to: Date): Promise<void> {
    const url = `${environment.apiUrl}/report/export/pdf?from=${from.toISOString()}&to=${to.toISOString()}`;
    const blob = await firstValueFrom(
      this.http.get(url, { responseType: 'blob' }),
    );
    this.triggerDownload(blob, `reporte-ventas-${this.formatDateRange(from, to)}.pdf`);
  }

  /**
   * Downloads fiscal CSV export with SAT-compatible fields for accountants.
   * Includes: order number, date, RFC, razón social, payment method (SAT code),
   * subtotal, IVA, total, product SAT codes, and CFDI UUID if invoiced.
   * @param branchId Branch to query
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async downloadFiscalCsv(branchId: number, from: Date, to: Date): Promise<void> {
    const url = `${environment.apiUrl}/report/export/fiscal-csv?from=${from.toISOString()}&to=${to.toISOString()}`;
    const blob = await firstValueFrom(
      this.http.get(url, { responseType: 'blob' }),
    );
    this.triggerDownload(blob, `fiscal-${this.formatDateRange(from, to)}.csv`);
  }

  /**
   * Returns from/to dates for a given period.
   * @param period Predefined period or 'custom'
   */
  getDateRange(period: ReportPeriod): { from: Date; to: Date } {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    switch (period) {
      case 'today': {
        const from = new Date();
        from.setHours(0, 0, 0, 0);
        return { from, to: today };
      }
      case 'week': {
        const from = new Date();
        const day = from.getDay();
        const diffToMonday = day === 0 ? 6 : day - 1;
        from.setDate(from.getDate() - diffToMonday);
        from.setHours(0, 0, 0, 0);
        return { from, to: today };
      }
      case 'month': {
        const from = new Date(today.getFullYear(), today.getMonth(), 1);
        from.setHours(0, 0, 0, 0);
        return { from, to: today };
      }
      case 'custom':
      default:
        return { from: new Date(), to: new Date() };
    }
  }

  /**
   * Formats cents to display currency string.
   * @param cents Amount in cents
   * @returns Formatted string (e.g. "$1,234.00")
   */
  formatCurrency(cents: number): string {
    return (cents / 100).toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    });
  }

  //#endregion

  //#region Private Helpers

  /**
   * Creates a temporary <a> element to trigger a browser download.
   * @param blob File content
   * @param filename Suggested filename for the download
   */
  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Formats a date range as "YYYY-MM-DD_YYYY-MM-DD" for filenames.
   */
  private formatDateRange(from: Date, to: Date): string {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return `${fmt(from)}_${fmt(to)}`;
  }

  //#endregion

}
