/**
 * Tax calculation utilities for the POS application.
 *
 * All amounts are in integer cents to avoid floating-point errors.
 * Matches the backend Universal Tax Engine rounding behavior.
 *
 * Mexico standard: prices are tax-included (IVA 16%).
 */

/** Default IVA rate in Mexico (16%) */
export const DEFAULT_TAX_RATE = 16;

/**
 * Extracts the tax amount from a tax-inclusive total.
 * Formula: total - round(total / (1 + rate/100))
 *
 * @param totalCents Total amount in cents (tax included)
 * @param taxRatePercent Tax rate as integer percentage (e.g. 16 for 16%)
 * @returns Tax amount in cents
 */
export function calculateInclusiveTax(totalCents: number, taxRatePercent: number): number {
  if (taxRatePercent <= 0) return 0;
  return Math.round(totalCents - (totalCents / (1 + taxRatePercent / 100)));
}

/**
 * Calculates the tax to add on top of a tax-exclusive base.
 * Formula: round(base * rate/100)
 *
 * @param baseCents Base amount in cents (before tax)
 * @param taxRatePercent Tax rate as integer percentage (e.g. 16 for 16%)
 * @returns Tax amount in cents
 */
export function calculateExclusiveTax(baseCents: number, taxRatePercent: number): number {
  if (taxRatePercent <= 0) return 0;
  return Math.round(baseCents * taxRatePercent / 100);
}

/**
 * Calculates the tax for a single cart item, considering its effective
 * price after discounts and whether the price is tax-inclusive or exclusive.
 *
 * @param totalPriceCents Item total before discount (unitPrice * qty)
 * @param discountCents Discount applied to this item
 * @param taxRatePercent Tax rate as integer percentage (e.g. 16)
 * @param isTaxIncluded Whether the price already includes tax (default: true)
 * @returns Tax amount in cents
 */
export function calculateItemTax(
  totalPriceCents: number,
  discountCents: number,
  taxRatePercent: number,
  isTaxIncluded: boolean = true,
): number {
  const effectivePrice = Math.max(0, totalPriceCents - discountCents);
  return isTaxIncluded
    ? calculateInclusiveTax(effectivePrice, taxRatePercent)
    : calculateExclusiveTax(effectivePrice, taxRatePercent);
}

/**
 * Calculates total tax from a frozen snapshot of cart items.
 * Use this instead of CartService signals when the cart may be cleared
 * (e.g. Kiosk ticket screen, order confirmation).
 *
 * @param items Frozen array of cart items (from CartService.getSnapshot())
 * @param defaultRatePercent Fallback tax rate if item has none (default: 16)
 * @returns Total tax in cents
 */
export function calculateOrderTaxFromSnapshot(
  items: { totalPriceCents: number; discountCents: number; taxRate?: number; product: { isTaxIncluded?: boolean } }[],
  defaultRatePercent: number = DEFAULT_TAX_RATE,
): number {
  return items.reduce((sum, item) => {
    const rate = item.taxRate ?? defaultRatePercent;
    const isTaxIncluded = item.product?.isTaxIncluded !== false;
    return sum + calculateItemTax(item.totalPriceCents, item.discountCents || 0, rate, isTaxIncluded);
  }, 0);
}
