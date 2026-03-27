/**
 * A size variant for a product (e.g. Small, Medium, Large).
 * priceDeltaCents is the surcharge relative to the base price (can be 0).
 */
export interface ProductSize {
  id: number;
  label: string;
  /** Surcharge in cents relative to product base price */
  priceDeltaCents: number;
}

/**
 * An optional add-on for a product (e.g. extra cheese, extra sauce).
 */
export interface ProductExtra {
  id: number;
  label: string;
  /** Price of this extra in cents */
  priceCents: number;
}

/**
 * A product shown in the catalog grid.
 * All monetary values are stored in cents to avoid floating-point errors.
 */
export interface Product {
  id: number;
  name: string;
  /** Base price in cents (e.g. 4500 = $45.00 MXN) */
  priceCents: number;
  categoryId: number;
  imageUrl?: string;
  isAvailable: boolean;
  isPopular?: boolean;
  /** Whether this product tracks its own stock (useful for retail/abarrotes) */
  trackStock?: boolean;
  /** Current stock level (only meaningful when trackStock is true) */
  currentStock?: number;
  /** Alert threshold — stock at or below this triggers low-stock warning */
  lowStockThreshold?: number;
  sizes: ProductSize[];
  extras: ProductExtra[];
}
