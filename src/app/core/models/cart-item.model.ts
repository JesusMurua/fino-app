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
