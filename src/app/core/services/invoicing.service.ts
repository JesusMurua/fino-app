import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  CustomerFiscalData,
  InvoiceRequest,
  InvoiceResult,
  PAYMENT_METHOD_SAT_MAP,
} from '../models/invoice.model';
import { PaymentMethod } from '../models/order.model';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

/**
 * Handles CFDI invoice requests for completed orders.
 *
 * Flow:
 *   1. Save InvoiceRequest to Dexie (optimistic, offline-safe)
 *   2. POST to backend /invoicing/individual
 *   3. Backend timbra via PAC and returns cfdiUuid
 *   4. Update Dexie with result
 */
@Injectable({ providedIn: 'root' })
export class InvoicingService {

  //#region Properties
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly db = inject(DatabaseService);

  /** True while a request is in-flight */
  readonly isSubmitting = signal(false);

  /** Result of the last invoice request */
  readonly lastResult = signal<InvoiceResult | null>(null);
  //#endregion

  //#region Public Methods

  /**
   * Requests a CFDI invoice for an order.
   * Saves to Dexie first (offline-safe), then calls the backend.
   * @param orderId UUID of the order to invoice
   * @param fiscalData Customer fiscal data from the modal
   */
  async requestInvoice(orderId: string, fiscalData: CustomerFiscalData): Promise<InvoiceResult> {
    this.isSubmitting.set(true);
    this.lastResult.set(null);

    // Step 1 — Save pending request to Dexie
    const invoiceRequest: InvoiceRequest = {
      fiscalData,
      status: 'pending',
      requestedAt: new Date(),
    };
    await this.db.orders.update(orderId, { invoiceRequest });

    // Step 2 — POST to backend
    try {
      const response = await firstValueFrom(
        this.api.post<{ invoiceId: string; cfdiUuid: string }>('/invoicing/individual', {
          orderId,
          ...fiscalData,
        }),
      );

      // Step 3 — Update Dexie with success
      const completed: InvoiceRequest = {
        ...invoiceRequest,
        status: 'completed',
        invoiceId: response.invoiceId,
        cfdiUuid: response.cfdiUuid,
        completedAt: new Date(),
      };
      await this.db.orders.update(orderId, { invoiceRequest: completed });

      const result: InvoiceResult = {
        success: true,
        invoiceId: response.invoiceId,
        cfdiUuid: response.cfdiUuid,
      };
      this.lastResult.set(result);
      return result;
    } catch (error: any) {
      // Step 4 — Update Dexie with failure
      const errorMessage = error?.error?.message ?? error?.message ?? 'Error al generar factura';
      const failed: InvoiceRequest = {
        ...invoiceRequest,
        status: 'failed',
        errorMessage,
      };
      await this.db.orders.update(orderId, { invoiceRequest: failed });

      const result: InvoiceResult = { success: false, errorMessage };
      this.lastResult.set(result);
      return result;
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /**
   * Requests a global CFDI invoice for all uninvoiced orders in a date range.
   * Used from the Backoffice invoicing panel.
   *
   * Body fields are full UTC `DateTime` strings — the C# DTO is `DateTime`
   * (not `DateOnly`), per the audited contract for `POST /invoicing/global`.
   *
   * @param startDate Start of the date range
   * @param endDate End of the date range
   */
  async createGlobalInvoice(startDate: Date, endDate: Date): Promise<InvoiceResult> {
    this.isSubmitting.set(true);
    this.lastResult.set(null);

    try {
      const response = await firstValueFrom(
        this.api.post<{ invoiceId: string; cfdiUuid: string }>('/invoicing/global', {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      );

      const result: InvoiceResult = {
        success: true,
        invoiceId: response.invoiceId,
        cfdiUuid: response.cfdiUuid,
      };
      this.lastResult.set(result);
      return result;
    } catch (error: any) {
      const errorMessage = error?.error?.message ?? error?.message ?? 'Error al generar factura global';
      const result: InvoiceResult = { success: false, errorMessage };
      this.lastResult.set(result);
      return result;
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /**
   * Gets a download URL for an invoice file (PDF or XML).
   * @param invoiceId UUID of the invoice
   * @param format File format to download
   */
  async getDownloadUrl(invoiceId: string, format: 'pdf' | 'xml'): Promise<string> {
    return firstValueFrom(
      this.api.get<string>(`/invoicing/${invoiceId}/download/${format}`),
    );
  }

  /**
   * Cancels a CFDI invoice in SAT.
   * Uses HttpClient directly because ApiService.delete() does not support a request body.
   * @param invoiceId UUID of the invoice to cancel
   * @param motive SAT cancellation motive code (01-04)
   */
  async cancelInvoice(invoiceId: string, motive: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${environment.apiUrl}/invoicing/${invoiceId}`, {
        body: { motive },
      }),
    );
  }

  /**
   * Builds the auto-factura URL printed on the ticket.
   * The customer visits this URL to self-invoice.
   * @param orderId UUID of the order
   */
  getAutoFacturaUrl(orderId: string): string {
    const branchId = this.authService.branchId;
    return `${environment.landingUrl}/factura?orderId=${orderId}&branchId=${branchId}`;
  }

  /**
   * Maps a PaymentMethod to its SAT c_FormaPago code.
   * @param method The POS payment method
   */
  mapPaymentMethodToSat(method: PaymentMethod): string {
    return PAYMENT_METHOD_SAT_MAP[method] ?? '99';
  }

  //#endregion

}
