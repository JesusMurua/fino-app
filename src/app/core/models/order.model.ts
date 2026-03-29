import { CartItem } from './cart-item.model';

/** Supported payment methods */
export enum PaymentMethod {
  Cash = 'Cash',
  Card = 'Card',
  Transfer = 'Transfer',
  Other = 'Other',
}

/** A single payment applied to an order */
export interface OrderPayment {
  id?: number;
  method: PaymentMethod;
  /** Amount paid in cents */
  amountCents: number;
  /** Optional reference (last 4 digits, auth number, etc.) */
  reference?: string;
}

/** Display metadata for payment method buttons */
export interface PaymentMethodOption {
  method: PaymentMethod;
  label: string;
  icon: string;
}

/** All available payment method options */
export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { method: PaymentMethod.Cash,     label: 'Efectivo',       icon: 'pi-money-bill' },
  { method: PaymentMethod.Card,     label: 'Tarjeta',        icon: 'pi-credit-card' },
  { method: PaymentMethod.Transfer, label: 'Transferencia',  icon: 'pi-arrows-h' },
  { method: PaymentMethod.Other,    label: 'Otro',           icon: 'pi-ellipsis-h' },
];

/** Lifecycle state of an order relative to backend sync — PascalCase to match backend */
export type OrderSyncStatus = 'Pending' | 'Synced' | 'Failed';

/** Kitchen display status — PascalCase to match backend enum */
export type KitchenStatus = 'Pending' | 'Ready' | 'Delivered';

/**
 * A completed order submitted from the POS.
 * Orders are always saved to IndexedDB first, then synced to the API.
 * syncedAt being null means the order is still pending sync.
 */
export interface Order {
  /** UUID generated client-side via crypto.randomUUID() */
  id: string;
  /** Sequential display number shown to staff and customer (e.g. #47) */
  orderNumber: number;
  items: CartItem[];
  /** Order total in cents (after all discounts) */
  totalCents: number;
  /** Payments applied to this order — empty when unpaid (kitchen-only) */
  payments: OrderPayment[];
  /** Sum of all payment amounts in cents */
  paidCents: number;
  /** Change to return to the customer in cents */
  changeCents: number;
  /** Payment terminal provider used — null for direct cash/card without terminal */
  paymentProvider: string | null;
  /** Reference ID returned by the external payment provider, if any */
  externalReference?: string;
  /** Plain-text ticket stored in IndexedDB when no thermal printer is available */
  ticketText?: string;
  createdAt: Date;
  /** Set when the order is successfully persisted in the backend */
  syncedAt?: Date;
  syncStatus: OrderSyncStatus;
  branchId: number;
  /** Kitchen display status — undefined on legacy orders */
  kitchenStatus?: KitchenStatus;
  /** Reason selected when cancelling */
  cancellationReason?: string;
  /** Timestamp when the order was cancelled */
  cancelledAt?: Date;
  /** Sum of item prices before any discounts, in cents */
  subtotalCents?: number;
  /** Order-level promotion discount in cents */
  orderDiscountCents?: number;
  /** Total of all discounts (item-level + order-level) in cents */
  totalDiscountCents?: number;
  /** ID of the order-level promotion that was applied */
  orderPromotionId?: number;
  /** Display name of the order-level promotion */
  orderPromotionName?: string;
  /** Table assigned to this order (tables mode) */
  tableId?: number;
  /** Snapshot of the table name at order creation */
  tableName?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — used across components to derive payment info from Order
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable payment label for display.
 * Joins all payment method labels with " + " for split payments.
 * Returns "Sin cobrar" when no payments exist.
 */
export function getPaymentLabel(order: Order): string {
  if (!order.payments || order.payments.length === 0) return 'Sin cobrar';
  return order.payments
    .map(p => PAYMENT_METHOD_OPTIONS.find(o => o.method === p.method)?.label ?? p.method)
    .join(' + ');
}

/**
 * Returns true if the order has been paid (at least one payment exists).
 */
export function isOrderPaid(order: Order): boolean {
  return (order.payments?.length ?? 0) > 0;
}

/**
 * Returns total cash amount from payments in cents.
 */
export function getCashAmountCents(order: Order): number {
  return (order.payments ?? [])
    .filter(p => p.method === PaymentMethod.Cash)
    .reduce((sum, p) => sum + p.amountCents, 0);
}

/**
 * Returns total card amount from payments in cents.
 */
export function getCardAmountCents(order: Order): number {
  return (order.payments ?? [])
    .filter(p => p.method === PaymentMethod.Card)
    .reduce((sum, p) => sum + p.amountCents, 0);
}
