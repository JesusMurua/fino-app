/**
 * Strict TypeScript metadata payloads aligned with the backend Chameleon
 * architecture (BDD-019 + BDD-020). Each interface mirrors a C# owned
 * type persisted as a `jsonb` column via EF Core 9 `OwnsOne(...).ToJson()`.
 *
 * Day-1 fields only — every property is optional because tenants on
 * verticals that do not consume a given key never emit it. Future
 * vertical extensions add new typed properties; tenant-specific dynamic
 * keys live in the parent entity's `extensionData` slot, never here.
 */

/**
 * Vertical-aware metadata attached to a `Product`.
 * Shape mirrors `POS.Domain.Models.ProductMetadata`.
 */
export interface ProductMetadata {
  /** Services / Gym — days the buyer's membership is extended on each sale */
  membershipDurationDays?: number;
  /** Services — appointment-slot duration for booking-aware verticals */
  serviceDurationMinutes?: number;
  /** F&B / Quick Service — kitchen prep estimate for KDS */
  kitchenPrepMinutes?: number;
  /** Bar / Sports Bar — drives age-gate and responsible-service hooks */
  isAlcoholic?: boolean;
  /** Retail Enterprise — flips the POS into scale-capture mode */
  isSoldByWeight?: boolean;
}

/**
 * Vertical-aware metadata attached to an `OrderItem` (cart line).
 * Shape mirrors `POS.Domain.Models.OrderItemMetadata`.
 */
export interface OrderItemMetadata {
  /** Gym — customer who receives the membership extension */
  beneficiaryCustomerId?: number;
  /** Retail Enterprise — captured weight when the product is sold by weight */
  weightGrams?: number;
  /**
   * Services — appointment timestamp for future-scheduled services.
   * ISO string on the wire; `Date` instance only after offline rehydration.
   */
  appointmentAt?: string | Date;
}

/**
 * Vertical-aware metadata attached to an `Order` aggregate.
 * Shape mirrors `POS.Domain.Models.OrderMetadata`.
 */
export interface OrderMetadata {
  /** F&B Restaurant — party size for table-sizing analytics */
  diningPersons?: number;
  /** Aggregator delivery — full address string for the kitchen commanda */
  deliveryAddressLine?: string;
}

/**
 * Vertical-aware metadata attached to a `Customer` aggregate.
 * Shape mirrors `POS.Domain.Models.CustomerMetadata`.
 */
export interface CustomerMetadata {
  /** Universal CRM — date of birth, ISO `YYYY-MM-DD` */
  dateOfBirth?: string;
  /** Compliance — opt-in flag for SMS/email marketing campaigns */
  marketingOptIn?: boolean;
  /** Gym / Wellness — emergency contact for safety regulation */
  emergencyContactPhone?: string;
}

/**
 * Provider-specific payment metadata attached to an `OrderPayment`.
 * Shape mirrors `POS.Domain.Models.PaymentMetadata`.
 */
export interface PaymentMetadata {
  /** Original raw payload returned by the payment provider */
  rawProviderJson?: string;
  /** Authorization code surfaced by the provider on approval */
  authorizationCode?: string;
  /** Last four digits of the card (display only) */
  last4?: string;
  /** Card brand surfaced by the provider (display only) */
  cardBrand?: string;
}
