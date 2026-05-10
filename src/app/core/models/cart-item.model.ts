import { OrderItemMetadata } from './metadata.model';
import { Product, ProductExtra, ProductSize } from './product.model';

/**
 * An item added to the active order cart.
 *
 * Pricing rules (all values in cents — CLAUDE.md):
 *   unitPriceCents = product.priceCents + size.priceDeltaCents + sum(extras.priceCents)
 *   totalPriceCents = unitPriceCents × quantity
 */
export interface CartItem {
  /** UUID generated client-side via crypto.randomUUID() */
  id: string;
  product: Product;
  quantity: number;
  /** Selected size variant, if the product has sizes */
  size?: ProductSize;
  /** Selected extras (zero or more) */
  extras: ProductExtra[];
  /** Computed: base + size delta + extras, in cents */
  unitPriceCents: number;
  /** Computed: unitPriceCents × quantity, in cents */
  totalPriceCents: number;
  notes?: string;
  /** IVA tax rate as integer percentage (e.g. 16, 8, 0). Copied from product at add-time. */
  taxRate?: number;
  /** Computed tax amount in cents for this item (after discounts) */
  taxAmountCents?: number;
  /** Discount applied by promotion engine (default 0) */
  discountCents: number;
  /** Promotion that generated the discount */
  promotionId?: number;
  /** Display name of the applied promotion */
  promotionName?: string;
  /**
   * Strongly-typed line-level metadata persisted by the backend as a
   * `jsonb` column (`OwnsOne(...).ToJson()` per BDD-020). Carries the
   * Gym beneficiary id, retail weight capture and service appointment
   * timestamps; the server is the authoritative source for any state
   * derived from these fields (e.g. membership extension).
   */
  metadata?: OrderItemMetadata;
  /**
   * Tenant-specific dynamic metadata that lives outside the strict
   * `OrderItemMetadata` schema. Maps to the parent entity's
   * `ExtensionData` jsonb column (BDD-020 §2.6).
   */
  extensionData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure helper — keeps pricing logic out of components and services
// ---------------------------------------------------------------------------

/**
 * Calculates unitPriceCents for a cart item configuration.
 * Use cents throughout to avoid floating-point errors.
 */
export function calcUnitPriceCents(
  product: Product,
  size?: ProductSize,
  extras: ProductExtra[] = [],
): number {
  const sizeDelta = size?.priceDeltaCents ?? 0;
  const extraTotal = extras.reduce((sum, e) => sum + e.priceCents, 0);
  return product.priceCents + sizeDelta + extraTotal;
}

/**
 * Returns the membership duration in days when the catalog tagged
 * the product with `metadata.membershipDurationDays`, or null when
 * the line is not a membership.
 *
 * Pure helper shared by `CartService` (auto-assignment effect),
 * `CartPanelComponent`, and `CheckoutComponent`. Centralised so a
 * single source of truth governs membership-item recognition.
 */
export function getMembershipDays(item: CartItem): number | null {
  const days = item.product.metadata?.membershipDurationDays;
  return typeof days === 'number' && days > 0 ? days : null;
}

/**
 * True when the line carries a membership intent and therefore
 * needs a beneficiary customer assigned.
 */
export function isMembershipItem(item: CartItem): boolean {
  return getMembershipDays(item) !== null;
}

/**
 * Beneficiary customer id stored on the cart item, or null when not
 * yet assigned (manually or via the auto-assignment effect).
 */
export function getBeneficiaryId(item: CartItem): number | null {
  const id = item.metadata?.beneficiaryCustomerId;
  return typeof id === 'number' ? id : null;
}
