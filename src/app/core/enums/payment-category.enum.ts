/**
 * Behavior category of a payment method, declared by the backend catalog
 * (`PaymentMethodCatalog.Category`). Drives change/overpay logic, customer
 * requirement, reference requirement and report bucket.
 *
 * The wire format is **PascalCase strings**, not lowercase — the global
 * `JsonStringEnumConverter` in the backend emits the enum names verbatim
 * (`"Cash"`, `"Card"`, etc.). Never lowercase-compare the incoming value;
 * always match on these exact tokens. See
 * `docs/payment-method-catalog-api.md` §1.2.
 */
export enum PaymentCategory {
  /** Physical cash. The only category that supports overpay → change. */
  Cash = 'Cash',
  /** Card-present rails: physical card, payment terminals, card-backed wallets. */
  Card = 'Card',
  /** Digital rails: bank transfers, QR / wallets without an underlying card. */
  Digital = 'Digital',
  /** Customer store credit. Requires a customer attached, consumes credit balance. */
  Credit = 'Credit',
  /** Loyalty points. Requires a customer attached, consumes points balance. */
  Points = 'Points',
  /** Vouchers / gift codes with a validation code. */
  Voucher = 'Voucher',
  /** Catch-all for methods that don't fit the above. */
  Other = 'Other',
}
