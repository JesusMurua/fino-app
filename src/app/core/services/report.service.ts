import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { DashboardChartsDto, ReportPeriod, ReportSummary } from '../models';
import { toLocalIsoDate } from '../utils/date.utils';
import { ApiService } from './api.service';

/**
 * Handles report generation and export.
 *
 * Summary data is fetched from the API.
 * Excel/PDF exports are downloaded as blobs via HttpClient directly
 * (ApiService does not support responseType: 'blob').
 *
 * All `from`/`to` query params are serialized as `yyyy-MM-dd` (local) so
 * the C# `DateOnly` model binders accept them. The backend resolves
 * timezone via `Branch.TimeZoneId` and uses a half-open interval
 * `[startUtc, endUtc)` where `endUtc = midnight of the day after `to`,
 * so `to` is inclusive at the local calendar-day level.
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
      this.api.get<ReportSummary>('/report/summary', this.dateRangeParams(from, to)),
    );
  }

  /**
   * Downloads Excel report and triggers browser download.
   * @param branchId Branch to query
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async downloadExcel(branchId: number, from: Date, to: Date): Promise<void> {
    const blob = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/report/export/excel`, {
        responseType: 'blob',
        params: this.dateRangeHttpParams(from, to),
      }),
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
    const blob = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/report/export/pdf`, {
        responseType: 'blob',
        params: this.dateRangeHttpParams(from, to),
      }),
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
    const blob = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/report/export/fiscal-csv`, {
        responseType: 'blob',
        params: this.dateRangeHttpParams(from, to),
      }),
    );
    this.triggerDownload(blob, `fiscal-${this.formatDateRange(from, to)}.csv`);
  }

  /**
   * Fetches all BI chart datasets for the dashboard in a single request.
   * @param from Start date (inclusive, time set to 00:00:00)
   * @param to End date (inclusive, time set to 23:59:59)
   */
  async getDashboardCharts(from: Date, to: Date): Promise<DashboardChartsDto> {
    return firstValueFrom(
      this.api.get<DashboardChartsDto>('/report/charts', this.dateRangeParams(from, to)),
    );
  }

  /**
   * Downloads simplified sales detail CSV (not SAT-compatible).
   * Columns: Order ID, Date, Time, Customer, Items, Subtotal, Discount, Total, Payment Method.
   * @param from Start date (inclusive)
   * @param to End date (inclusive)
   */
  async downloadDetailedCsv(from: Date, to: Date): Promise<void> {
    const blob = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/report/export/sales-csv`, {
        responseType: 'blob',
        params: this.dateRangeHttpParams(from, to),
      }),
    );
    this.triggerDownload(blob, `ventas-detalle-${this.formatDateRange(from, to)}.csv`);
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
   * Builds the `from`/`to` params object for ApiService consumers.
   */
  private dateRangeParams(from: Date, to: Date): { from: string; to: string } {
    return { from: toLocalIsoDate(from), to: toLocalIsoDate(to) };
  }

  /**
   * Builds an `HttpParams` instance for blob download requests that go
   * through `HttpClient` directly (ApiService does not support
   * `responseType: 'blob'`).
   */
  private dateRangeHttpParams(from: Date, to: Date): HttpParams {
    return new HttpParams()
      .set('from', toLocalIsoDate(from))
      .set('to', toLocalIsoDate(to));
  }

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
    return `${toLocalIsoDate(from)}_${toLocalIsoDate(to)}`;
  }

  //#endregion

}
