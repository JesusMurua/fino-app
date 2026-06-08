import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  OrderPayment,
  PaymentMethod,
  PaymentMethodOption,
  PAYMENT_METHOD_OPTIONS,
  PROVIDER_PAYMENT_OPTIONS,
} from '../models/order.model';
import { PaymentStatus } from '../enums';
import {
  PaymentProviderConfig,
  PaymentProviderId,
  PaymentTransaction,
  TransactionStatus,
} from '../models/payment.model';
import { ApiService } from './api.service';
import { ConfigService } from './config.service';

/** Polling interval for MercadoPago status checks (ms) */
const MP_POLL_INTERVAL_MS = 3_000;

/** Maximum time to wait for MercadoPago payment before timeout (ms) */
const MP_TIMEOUT_MS = 120_000;

/**
 * Orchestrates payment provider interactions for Clip and MercadoPago.
 *
 * Manages the lifecycle of external payment transactions via signals:
 *   1. startTransaction() — initiates a provider transaction
 *   2. confirmClipReference() — completes a Clip transaction with manual ref
 *   3. Polling for MercadoPago — auto-checks status until resolved or timeout
 *   4. cancelTransaction() — aborts an in-progress transaction
 *   5. resolveToPayment() — converts an approved transaction to OrderPayment
 */
@Injectable({ providedIn: 'root' })
export class PaymentProviderService {

  //#region Properties
  private readonly api = inject(ApiService);
  private readonly configService = inject(ConfigService);

  /** The currently active provider transaction (one at a time) */
  readonly activeTransaction = signal<PaymentTransaction | null>(null);

  /** Payment providers enabled for this branch (derived from config) */
  readonly enabledProviders = computed<PaymentProviderConfig[]>(() => {
    const config = this.configService.config$.getValue();
    return (config as any).paymentProviders ?? [];
  });

  /** Whether Clip is enabled for this branch */
  readonly hasClip = computed(() =>
    this.enabledProviders().some(p => p.provider === 'clip' && p.isActive),
  );

  /** Whether MercadoPago is enabled for this branch */
  readonly hasMercadoPago = computed(() =>
    this.enabledProviders().some(p => p.provider === 'mercadopago' && p.isActive),
  );

  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  private pollStartTime = 0;
  //#endregion

  //#region Public Methods

  /**
   * Returns all available payment method options based on branch config.
   * Base options (Cash, Card, Transfer, Other) are always available.
   * Provider options (Clip, MercadoPago) are added when enabled.
   */
  getAvailableOptions(): PaymentMethodOption[] {
    const options = [...PAYMENT_METHOD_OPTIONS];

    if (this.hasClip()) {
      options.push(PROVIDER_PAYMENT_OPTIONS.find(o => o.method === PaymentMethod.Clip)!);
    }
    if (this.hasMercadoPago()) {
      options.push(PROVIDER_PAYMENT_OPTIONS.find(o => o.method === PaymentMethod.MercadoPago)!);
    }

    return options;
  }

  /**
   * Returns true if the given payment method requires async provider processing.
   */
  requiresProcessing(method: PaymentMethod): boolean {
    return method === PaymentMethod.Clip || method === PaymentMethod.MercadoPago;
  }

  /**
   * Initiates a new provider transaction.
   * Creates the transaction locally and calls the backend to start the provider flow.
   * Sets activeTransaction signal to track the lifecycle.
   */
  async startTransaction(method: PaymentMethod, amountCents: number, orderId: string): Promise<PaymentTransaction> {
    // Guard: only one active transaction at a time
    if (this.activeTransaction() !== null) {
      throw new Error('A payment transaction is already in progress');
    }

    const provider = this.resolveProvider(method);
    const transaction: PaymentTransaction = {
      id: crypto.randomUUID(),
      provider,
      method,
      amountCents,
      status: 'processing',
      startedAt: new Date(),
    };

    this.activeTransaction.set(transaction);

    try {
      if (provider === 'clip') {
        await this.initClipTransaction(transaction, orderId);
      } else if (provider === 'mercadopago') {
        await this.initMercadoPagoTransaction(transaction, orderId);
      }
    } catch (err) {
      this.updateTransaction({ status: 'declined', errorMessage: 'No se pudo conectar con el proveedor', resolvedAt: new Date() });
    }

    return this.activeTransaction()!;
  }

  /**
   * Confirms a Clip transaction with the manual reference from the cashier.
   * Transitions the transaction to 'approved'.
   */
  confirmClipReference(reference: string): void {
    const tx = this.activeTransaction();
    if (!tx || tx.provider !== 'clip') return;

    this.updateTransaction({
      status: 'approved',
      reference: reference.trim(),
      resolvedAt: new Date(),
    });
  }

  /**
   * Cancels the active transaction and cleans up polling.
   */
  cancelTransaction(): void {
    this.stopPolling();
    const tx = this.activeTransaction();
    if (tx && tx.status === 'processing') {
      this.updateTransaction({ status: 'cancelled', resolvedAt: new Date() });
    }
    this.activeTransaction.set(null);
  }

  /**
   * Converts the approved active transaction into an OrderPayment
   * suitable for adding to pendingPayments.
   * Clears the active transaction.
   */
  resolveToPayment(): OrderPayment | null {
    const tx = this.activeTransaction();
    if (!tx || tx.status !== 'approved') return null;

    const payment: OrderPayment = {
      method: tx.method,
      paymentStatusId: PaymentStatus.Completed,
      amountCents: tx.amountCents,
      reference: tx.reference,
      paymentProvider: tx.provider,
      externalTransactionId: tx.externalTransactionId,
      transactionStatus: 'approved',
      authorizedAt: tx.resolvedAt,
    };

    this.activeTransaction.set(null);
    return payment;
  }

  //#endregion

  //#region Private Helpers

  /** Maps a PaymentMethod to its provider ID */
  private resolveProvider(method: PaymentMethod): PaymentProviderId {
    switch (method) {
      case PaymentMethod.Clip: return 'clip';
      case PaymentMethod.MercadoPago: return 'mercadopago';
      default: throw new Error(`No provider for method: ${method}`);
    }
  }

  /**
   * Initiates a Clip transaction via backend.
   * Backend creates the transaction in Clip's system and returns the external ID.
   * Frontend transitions to 'awaiting_reference' so the cashier can enter the ref.
   */
  private async initClipTransaction(tx: PaymentTransaction, orderId: string): Promise<void> {
    const clipConfig = this.enabledProviders().find(p => p.provider === 'clip');

    try {
      const result = await firstValueFrom(
        this.api.post<{ externalTransactionId: string }>(`/orders/${orderId}/payments/clip/intent`, {
          amountCents: tx.amountCents,
          terminalId: clipConfig?.terminalId,
        }),
      );
      this.updateTransaction({
        status: 'awaiting_reference',
        externalTransactionId: result.externalTransactionId,
      });
    } catch {
      // If backend is unreachable, allow manual-only mode (no external ID)
      this.updateTransaction({ status: 'awaiting_reference' });
    }
  }

  /**
   * Initiates a MercadoPago QR transaction via backend.
   * Backend generates the QR and returns the QR data + external ID.
   * Frontend starts polling for payment status.
   */
  private async initMercadoPagoTransaction(tx: PaymentTransaction, orderId: string): Promise<void> {
    const mpConfig = this.enabledProviders().find(p => p.provider === 'mercadopago');

    const result = await firstValueFrom(
      this.api.post<{ externalTransactionId: string; qrCodeData: string }>(`/orders/${orderId}/payments/mercadopago/intent`, {
        amountCents: tx.amountCents,
        merchantId: mpConfig?.merchantId,
      }),
    );

    this.updateTransaction({
      externalTransactionId: result.externalTransactionId,
      qrCodeData: result.qrCodeData,
    });

    this.startPolling(result.externalTransactionId);
  }

  /** Starts polling MercadoPago for transaction status */
  private startPolling(transactionId: string): void {
    this.stopPolling();
    this.pollStartTime = Date.now();

    this.pollTimerId = setInterval(async () => {
      // Timeout check
      if (Date.now() - this.pollStartTime >= MP_TIMEOUT_MS) {
        this.stopPolling();
        this.updateTransaction({ status: 'timeout', resolvedAt: new Date() });
        return;
      }

      try {
        const result = await firstValueFrom(
          this.api.get<{ status: string }>(`/payments/mercadopago/${transactionId}/status`),
        );

        if (result.status === 'approved') {
          this.stopPolling();
          this.updateTransaction({ status: 'approved', resolvedAt: new Date() });
        } else if (result.status === 'declined') {
          this.stopPolling();
          this.updateTransaction({ status: 'declined', errorMessage: 'Pago rechazado', resolvedAt: new Date() });
        }
        // 'pending' → continue polling
      } catch {
        // Network error during poll — continue, will retry next interval
      }
    }, MP_POLL_INTERVAL_MS);
  }

  /** Stops the MercadoPago polling timer */
  private stopPolling(): void {
    if (this.pollTimerId !== null) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }

  /** Patches the active transaction signal with partial updates */
  private updateTransaction(patch: Partial<PaymentTransaction>): void {
    const current = this.activeTransaction();
    if (!current) return;
    this.activeTransaction.set({ ...current, ...patch });
  }

  //#endregion

}
