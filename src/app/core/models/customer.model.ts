import { CustomerMetadata } from './metadata.model';

/**
 * A customer in the CRM database.
 * Synced from API and cached in Dexie for offline search.
 */
export interface Customer {
  id: number;
  /**
   * Business (tenant) the customer belongs to. Customers are
   * business-wide, not branch-scoped — `GET /customers` returns every
   * customer of the authenticated business across all branches.
   */
  businessId: number;
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
  /** Record creation date */
  createdAt: Date;
  /** Soft delete flag */
  isActive: boolean;
  /**
   * Strongly-typed customer-level vertical metadata persisted as
   * `jsonb` on the backend (`OwnsOne(...).ToJson()` per BDD-020).
   * Day-1 keys cover universal CRM fields (date of birth, marketing
   * opt-in) and the gym/wellness emergency contact.
   */
  metadata?: CustomerMetadata;
  /**
   * Tenant-specific dynamic metadata that lives outside the strict
   * `CustomerMetadata` schema. Maps to the parent entity's
   * `ExtensionData` jsonb column (BDD-020 §2.6).
   */
  extensionData?: Record<string, unknown>;
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
