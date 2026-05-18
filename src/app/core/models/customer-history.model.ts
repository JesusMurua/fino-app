/**
 * Customer history domain models — memberships, order rows, and stats.
 *
 * Mirrors the Chameleon backend contracts:
 *   - `CustomerMembership` ↔ `POS.Domain.Entities.CustomerMembership`
 *     (BDD-019 §5.3) and the read DTO `CustomerMembershipDto`
 *     (BDD-019 §5.1.2). Both share the same wire shape; we expose a
 *     single TypeScript symbol per FDD-027 §2.4.
 *   - `CustomerOrderRowDto` ↔ projection from `GET /customers/{id}/orders`
 *     (BDD-019 §5.1.1). Read-only.
 *   - `CustomerStatsDto` ↔ aggregate from `GET /customers/{id}/stats`
 *     (BDD-019 §5.1.3). Read-only.
 *
 * Date-typed fields accept `string | Date` so the same interface
 * survives both the wire (ISO strings) and offline rehydration where
 * a caller may have already coerced to `Date` instances.
 */

/**
 * Lifecycle status of a customer membership.
 *
 * Persisted by the backend as a string column via
 * `HasConversion<string>()` (BDD-019 §5.5), so the enum values must
 * match the literal JSON tokens that the API emits.
 */
export enum MembershipStatus {
  Active = 'Active',
  Expired = 'Expired',
  Frozen = 'Frozen',
  Cancelled = 'Cancelled',
}

/**
 * A customer's membership entitlement.
 *
 * The backend's read endpoint `GET /api/customers/{id}/memberships`
 * omits `customerId` from the wire shape because it is implicit in
 * the URL. The frontend stamps it back into each row before caching
 * in Dexie so the secondary index populates correctly — see
 * `CustomerMembershipsService.loadFor`.
 */
export interface CustomerMembership {
  /** Backend-assigned primary key. */
  id: number;
  /**
   * Owning customer. Not present on the API response — populated by
   * the FE from the request path before persisting.
   */
  customerId: number;
  /** Catalog product the membership was sold under (null for legacy backfill). */
  productId?: number;
  /** Display name of the product, joined by the BE for convenience. */
  productName?: string;
  /**
   * Display name of the owning customer. Only populated by the
   * cross-customer expiring-soon endpoint (`GET /memberships/expiring`)
   * — the per-customer endpoint omits it because the customer is
   * implicit in the URL path.
   */
  customerName?: string;
  /** Start of the validity window. */
  validFrom: string | Date;
  /** End of the validity window. */
  validUntil: string | Date;
  /** Lifecycle status — see `MembershipStatus`. */
  status: MembershipStatus;
  /** Order whose sync created or extended this membership (UUID). */
  originatingOrderId?: string;
  /** Audit timestamp. */
  createdAt: string | Date;
  /** Audit timestamp of the last write. */
  updatedAt?: string | Date;
}

/**
 * Single row of a customer's paginated order history. Shape matches
 * the backend projection (`CustomerOrderRowDto`, BDD-019 §5.1.1) —
 * no entity hydration; suitable for table rendering without joins.
 */
export interface CustomerOrderRowDto {
  /** Order UUID. */
  orderId: string;
  /** Sequential display number shown to staff. */
  orderNumber: number;
  /** When the order was placed. */
  createdAt: string | Date;
  /** Order total in cents. */
  totalCents: number;
  /** Number of distinct line items in the order. */
  itemCount: number;
  /** Branch the order was placed at. */
  branchId: number;
  /** Display name of the branch (joined by the BE). */
  branchName: string;
  /** Whether the order has been paid in full. */
  isPaid: boolean;
  /** Reason text when the order was cancelled. */
  cancellationReason?: string;
}

/**
 * Aggregated lifetime stats for a customer. Shape matches the backend
 * `CustomerStatsDto` (BDD-019 §5.1.3) — single GROUP BY query on the
 * paid, non-cancelled orders of the customer.
 */
export interface CustomerStatsDto {
  /** Sum of `Order.TotalCents` across paid, non-cancelled orders. */
  totalSpentCents: number;
  /** Count of paid, non-cancelled orders. */
  orderCount: number;
  /** Timestamp of the most recent paid order. */
  lastOrderAt?: string | Date;
}

/**
 * Pure helper that resolves whether a cached membership is currently
 * valid from the renderer's perspective. Handles offline date drift —
 * a row marked `Active` whose `validUntil` has passed since the last
 * sync is treated as not-currently-valid.
 *
 * Coerces `validUntil` through `new Date(...)` so the helper survives
 * either the ISO string (fresh from API) or a `Date` instance (after
 * an offline rehydration step).
 *
 * @param m Membership to evaluate.
 * @returns `true` when status is `Active` AND `validUntil >= now`.
 */
export function isCurrentlyValid(m: CustomerMembership): boolean {
  return m.status === MembershipStatus.Active
      && new Date(m.validUntil).getTime() >= Date.now();
}
