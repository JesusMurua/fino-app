import { CartItem } from '../models/cart-item.model';
import { Product, ProductType } from '../models/product.model';

/**
 * Canonical predicate for measure-based items (weight, volume, length, area).
 * Accepts three shapes:
 *
 *   1. `CartItem` (cart line) — looks up via `.product.type`.
 *   2. `Product` (catalog row) — reads top-level `.type`.
 *   3. Flattened DTO `{ productType?: ProductType }` — covers
 *      `DeliveryOrderItemDto`, `OrderItemPullDto`, `PrintJobItem`, and
 *      the inline `OrderSummary.items` shape, where the backend freezes
 *      the classification at sale time (BE Phase 4.5) instead of carrying
 *      the full nested `Product`.
 *
 * Single source of truth for the `TrackedByMeasure` branch.
 *
 * Lives in `core/utils/` to avoid a circular import between
 * `product.model.ts` and `cart-item.model.ts`.
 */
export function isMeasureItem(
  item: Product | CartItem | { productType?: ProductType },
): boolean {
  if ('product' in item) return item.product.type === 'TrackedByMeasure';
  if ('type' in item) return item.type === 'TrackedByMeasure';
  if ('productType' in item) return item.productType === 'TrackedByMeasure';
  return false;
}

/**
 * SAT unit code → human-friendly symbol mapping. Mirrors the backend
 * `SatUnitSymbols` dictionary (BE Phase 4.8) so the wire `satUnitCode`
 * renders consistently on POS screens (digital) and thermal tickets.
 *
 * 19 measure codes (peso/volumen/longitud/área) + 7 discrete codes.
 * Unknown codes echo the raw SAT code as-is.
 */
const SatUnitSymbols: Record<string, string> = {
  'KGM': 'kg', 'GRM': 'g', 'LBR': 'lb', 'OZA': 'oz', 'TNE': 't',
  'LTR': 'L', 'MLT': 'ml', 'GLI': 'gal', 'GLL': 'gal', 'MTQ': 'm3', 'CMQ': 'cm3',
  'MTR': 'm', 'CMT': 'cm', 'MMT': 'mm', 'INH': 'in', 'FOT': 'ft', 'YRD': 'yd',
  'MTK': 'm2', 'CMK': 'cm2',
  'H87': 'pza', 'EA': 'pza', 'C62': 'pza', 'XBX': 'caja', 'XPK': 'paq', 'PR': 'par', 'E48': 'serv',
};

/**
 * Resolves a SAT unit code to its display symbol. Case-insensitive
 * lookup; unknown codes echo the raw SAT code so the cashier still
 * sees something meaningful instead of a silent fallback.
 *
 * Fallback when `satUnitCode` is missing:
 *   - `isMeasure: true`  → `'kg'` (legacy weight default)
 *   - `isMeasure: false` → `'x'`  (legacy unit multiplier)
 */
export function formatMeasureUnit(satUnitCode?: string, isMeasure: boolean = false): string {
  if (satUnitCode) return SatUnitSymbols[satUnitCode.toUpperCase()] || satUnitCode;
  return isMeasure ? 'kg' : 'x';
}
