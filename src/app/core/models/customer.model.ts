/**
 * A customer in the CRM database.
 * Synced from API and cached in Dexie for offline search.
 */
export interface Customer {
  id: number;
  branchId: number;
  /** Full name */
  name: string;
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
  /** Record creation date */
  createdAt: Date;
  /** Soft delete flag */
  isActive: boolean;
}

/** Payload for creating a new customer */
export interface CreateCustomerRequest {
  name: string;
  phone: string;
  email?: string;
  rfc?: string;
  notes?: string;
  creditLimitCents?: number;
}
