import { ProductMetadata } from './metadata.model';

/**
 * Product classification enum mirrored from the backend `ProductType`
 * (commit 20260516024801_AddProductTypeEnum). Drives POS branching:
 * weight-based items take the scale-capture flow, recipes go to KDS,
 * memberships extend customer access, etc. Wire format is PascalCase
 * string via JsonStringEnumConverter on the backend.
 */
export type ProductType =
  | 'Standard'
  | 'TrackedByUnit'
  | 'TrackedByMeasure'
  | 'Recipe'
  | 'Service'
  | 'Membership';

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
 * Always belongs to a ProductModifierGroup.
 */
export interface ProductExtra {
  id: number;
  label: string;
  /** Price of this extra in cents */
  priceCents: number;
}

/**
 * A modifier group wraps a set of extras with selection rules
 * (e.g. "Choose your protein — required, exactly 1" or "Toppings — max 3").
 */
export interface ProductModifierGroup {
  id: number;
  name: string;
  /** Display order within the product detail page */
  sortOrder: number;
  /** When true, the user must pick at least one extra from this group */
  isRequired: boolean;
  /** Minimum number of selections (0 for free pick) */
  minSelectable: number;
  /** Maximum number of selections (0 or undefined for unlimited) */
  maxSelectable: number;
  /** Extras available within the group */
  extras: ProductExtra[];
}

/**
 * An image associated with a product, stored in the backend.
 */
export interface ProductImage {
  id: number;
  productId: number;
  url: string;
  sortOrder: number;
}

/**
 * A product shown in the catalog grid.
 * All monetary values are stored in cents to avoid floating-point errors.
 */
export interface Product {
  id: number;
  name: string;
  /**
   * Strong classification enum (NON-NULLABLE).
   * Drives POS flow branching — scale capture, KDS, membership extension, etc.
   * Backend default is `'Standard'`; backfill migrated existing rows.
   */
  type: ProductType;
  /** Optional product description (ingredients, details, etc.) */
  description?: string;
  /** Optional barcode (EAN-13, UPC-A, etc.) */
  barcode?: string;
  /** Base price in cents (e.g. 4500 = $45.00 MXN) */
  priceCents: number;
  categoryId: number;
  /** Legacy single image URL — kept for backward compatibility */
  imageUrl?: string;
  /** Multiple product images ordered by sortOrder */
  images?: ProductImage[];
  isAvailable: boolean;
  isPopular?: boolean;
  /** Whether this product tracks its own stock (useful for retail/abarrotes) */
  trackStock?: boolean;
  /** Current stock level (only meaningful when trackStock is true) */
  currentStock?: number;
  /** Alert threshold — stock at or below this triggers low-stock warning */
  lowStockThreshold?: number;
  sizes: ProductSize[];
  /** Modifier groups — replaces the legacy flat extras list */
  modifierGroups?: ProductModifierGroup[];
  /** SAT product/service code (c_ClaveProdServ) for CFDI invoicing */
  satProductCode?: string;
  /** SAT unit code (c_ClaveUnidad) for CFDI invoicing (e.g. "H87" = Pieza) */
  satUnitCode?: string;
  /** IVA tax rate as integer percentage (e.g. 16, 8, 0). Default: 16 */
  taxRate?: number;
  /** Whether the product price includes tax. Default: true (Mexican standard) */
  isTaxIncluded?: boolean;
  /** ID of the printer destination for kitchen/station printing. Null = no kitchen printing. */
  printingDestinationId?: number | null;
  /**
   * Strongly-typed vertical metadata persisted as `jsonb` on the backend
   * (`OwnsOne(...).ToJson()` per BDD-020). Day-1 keys cover Gym
   * membership duration, KDS prep estimates, weight-based retail and
   * service appointments — see `ProductMetadata` for the canonical shape.
   */
  metadata?: ProductMetadata;
  /**
   * Tenant-specific dynamic metadata that lives outside the strict
   * `ProductMetadata` schema. Maps to the parent entity's `ExtensionData`
   * jsonb column (BDD-020 §2.6); the frontend treats it as an opaque
   * passthrough.
   */
  extensionData?: Record<string, unknown>;
}
