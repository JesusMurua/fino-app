import { PaymentCategory } from '../enums/payment-category.enum';

/**
 * A payment method the **logged-in tenant** may use, returned by
 * `GET /api/payment-methods/available` after plan-matrix + per-business
 * override + country gating.
 *
 * Wire shape verbatim — see `docs/payment-method-catalog-api.md` §2.1.
 *
 * Important notes from the contract:
 *   - Nullable fields (`providerKey`, `icon`) are **omitted** from the JSON
 *     when null, not sent as `null`. TS optional `?` mirrors that semantics.
 *   - `id` is DB-assigned and must not be hardcoded; resolve by `code`
 *     across sessions.
 *   - `category` is PascalCase verbatim — never lowercase-compare.
 */
export interface AvailablePaymentMethod {
  /** DB id, session-scoped. Do not persist across sessions; resolve by `code`. */
  id: number;
  /** Stable freeze key (e.g. `"Cash"`, `"Card"`). Match against this. */
  code: string;
  /**
   * Display label. Already localized server-side and may carry the tenant's
   * `customLabel` when a per-business override sets one.
   */
  name: string;
  /** Behavior driver. See {@link PaymentCategory}. */
  category: PaymentCategory;
  /**
   * `true` only for cash today. Means the cashier may tender more than the
   * total and the system produces change. Read this from the catalog instead
   * of hardcoding the cash check — when admin adds a new method, the FE
   * stays correct without code changes.
   */
  supportsOverpay: boolean;
  /** When `true`, the FE must collect a reference (folio / auth / last 4) before sale. */
  requiresReference: boolean;
  /** When `true`, the FE must attach a customer before the method is selectable. */
  requiresCustomer: boolean;
  /** Provider integration key (e.g. `"clip"`, `"mercadopago"`). Absent when null. */
  providerKey?: string;
  /** PrimeIcon / CSS class for the method tab. Absent when null. */
  icon?: string;
  /** Display order. Tabs render sorted by this then `code`. */
  sortOrder: number;
}
