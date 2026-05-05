/**
 * A customer in the CRM database.
 * Synced from API and cached in Dexie for offline search.
 */
export interface Customer {
  id: number;
  branchId: number;
  /** First name — required. Matches the backend `firstName` field. */
  firstName: string;
  /** Last name — optional. Empty when the customer registered with a single name. */
  lastName?: string;
  /** Phone number — primary search key (unique per branch) */
  phone: string;
  /** Email address (optional) */
  email?: string;
  /** Mexican RFC for invoicing (optional, pre-fills fiscal modal) */
  rfc?: string;
  /** Internal notes from the business */
  notes?: string;
  /** Accumulated loyalty points */
  pointsBalance: number;
  /** Store credit balance in cents */
  creditBalanceCents: number;
  /** Maximum credit limit in cents (0 = no credit allowed) */
  creditLimitCents: number;
  /** Total number of orders placed */
  totalOrderCount: number;
  /** Total amount spent in cents */
  totalSpentCents: number;
  /** Last purchase date */
  lastVisitAt?: Date;
  /**
   * Vertical-specific: end of the current membership window for Gym
   * (and similar service verticals). Accepts Date or ISO string —
   * server emits ISO, offline side-effects may write Date instances.
   */
  membershipValidUntil?: string | Date;
  /**
   * Vertical-specific: timestamp of the last paid transaction tied to
   * this customer. Updated by the offline membership-extension hook
   * the moment a membership item lands in `saveOrder()`.
   */
  lastPaymentAt?: string | Date;
  /** Record creation date */
  createdAt: Date;
  /** Soft delete flag */
  isActive: boolean;
}

/** Payload for creating a new customer */
export interface CreateCustomerRequest {
  /** First name — required by the backend. */
  firstName: string;
  /** Last name — optional. */
  lastName?: string;
  phone: string;
  email?: string;
  rfc?: string;
  notes?: string;
  creditLimitCents?: number;
}
