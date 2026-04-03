import { PaymentMethod } from './order.model';

/** Supported payment provider identifiers */
export type PaymentProviderId = 'clip' | 'mercadopago';

/** Lifecycle states for an in-progress provider transaction */
export type TransactionStatus =
  | 'idle'
  | 'processing'
  | 'awaiting_reference'
  | 'approved'
  | 'declined'
  | 'timeout'
  | 'cancelled';

/**
 * An in-progress payment transaction managed by PaymentProviderService.
 * Tracks the full lifecycle from initiation to resolution.
 */
export interface PaymentTransaction {
  /** Local UUID (crypto.randomUUID) */
  id: string;
  /** Provider executing this transaction */
  provider: PaymentProviderId;
  /** Original payment method selected by the cashier */
  method: PaymentMethod;
  /** Amount to charge in cents */
  amountCents: number;
  /** Current lifecycle state */
  status: TransactionStatus;
  /** Transaction ID from the provider (populated after backend call) */
  externalTransactionId?: string;
  /** QR code data for MercadoPago (base64 or URL) */
  qrCodeData?: string;
  /** Manual reference entered by cashier (Clip terminal) */
  reference?: string;
  /** When the transaction was initiated */
  startedAt: Date;
  /** When the transaction reached a terminal state */
  resolvedAt?: Date;
  /** Error message from the provider if declined */
  errorMessage?: string;
}

/**
 * Payment provider configuration for a branch.
 * Loaded from GET /branch/{id}/config as part of AppConfig.
 */
export interface PaymentProviderConfig {
  /** Provider identifier */
  provider: PaymentProviderId;
  /** Whether this provider is enabled for the branch */
  isActive: boolean;
  /** Physical terminal ID (Clip) */
  terminalId?: string;
  /** Merchant/store ID (MercadoPago) */
  merchantId?: string;
}
