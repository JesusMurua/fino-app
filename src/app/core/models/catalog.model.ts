/** Kitchen status catalog entry from the system catalog API */
export interface KitchenStatusCatalog {
  id: number;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

/** Display status catalog entry (table floor map statuses) */
export interface DisplayStatusCatalog {
  id: number;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

/** Payment method catalog entry */
export interface PaymentMethodCatalog {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
}

/** Device mode catalog entry */
export interface DeviceModeCatalog {
  id: number;
  code: string;
  name: string;
  description: string;
}

/**
 * POS experience variant — determines which POS UI is loaded.
 *
 * `'Services'` is accepted from the backend as the canonical value for
 * Services-macro tenants (gym, barbería, taller, consultorio). The
 * frontend treats it as a synonym of `'Quick'` in routing — both land
 * on `/pos/quick` — so backend can roll out the new value without
 * waiting on a coordinated frontend deploy. The internal catalog
 * (offline fallback) still emits `'Quick'` for backwards compatibility;
 * a future migration may unify these to `'Services'`.
 */
export type PosExperience = 'Restaurant' | 'Counter' | 'Retail' | 'Quick' | 'Services';

/**
 * Business type catalog entry.
 *
 * **FDD-028 F3 reshape (BDD-021 Cohort B)**: the backend `BusinessTypeDto`
 * ships `{ id, primaryMacroCategoryId, name }` only. The legacy fields
 * `code` / `hasKitchen` / `hasTables` / `posExperience` / `sortOrder`
 * remain **optional** on the interface — wire responses from BDD-021
 * never carry them, but consumer code that touches these fields still
 * compiles. A future cleanup can tighten the interface to drop the
 * optionals entirely (the hardcoded `BUSINESS_TYPES` fallback that
 * once required them was deleted in F6; seed JSONs under
 * `src/assets/catalog-seed/business-types.json` now ship only the
 * three required fields).
 *
 * Macro-derived attributes (`hasKitchen`, `hasTables`, `posExperience`)
 * are now sourced from the joined `MacroCategoryDto` via
 * `catalogService.resolveMacro(primaryMacroCategoryId)`. Consumers
 * should prefer the `MacroCategoryDto` join over reading these fields
 * directly from `BusinessTypeCatalog`.
 */
export interface BusinessTypeCatalog {
  id: number;
  /** FK to `MacroCategoryDto.id`. Required after F3 — backend always ships it. */
  primaryMacroCategoryId: number;
  name: string;
  /**
   * Stable slug grouping Macro 4 (Services) sub-giros into a cluster
   * (`'beauty'`, `'health'`, …). Omitted by the backend (`WhenWritingNull`)
   * for sub-giros that do not belong to any cluster — Macros 1-3 today.
   * See `src/app/core/models/cluster.model.ts` for the canonical 10
   * cluster slugs and their Spanish labels.
   */
  clusterCode?: string;
  /** @deprecated Legacy field — removed from backend wire in BDD-021. Resolve macro instead. */
  code?: string;
  /** @deprecated Now lives on `MacroCategoryDto`. Use `resolveMacro().hasKitchen`. */
  hasKitchen?: boolean;
  /** @deprecated Now lives on `MacroCategoryDto`. Use `resolveMacro().hasTables`. */
  hasTables?: boolean;
  /** @deprecated Now lives on `MacroCategoryDto`. Use `resolveMacro().posExperience`. */
  posExperience?: PosExperience;
  /** @deprecated Removed from backend wire in BDD-021. */
  sortOrder?: number;
}

/** Zone type catalog entry */
export interface ZoneTypeCatalog {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
}

// ─────────────────────────────────────────────────────────────────────
// FDD-028 F4 — Cohort C (NEW DTOs from BDD-021)
// ─────────────────────────────────────────────────────────────────────

/**
 * Macro category catalog entry — wire shape of `GET /api/Catalog/macro-categories`
 * (NEW endpoint, BDD-021 §5.1.1).
 *
 * Carries the typed metadata signals that drive vertical-aware
 * rendering (`posExperience`, `hasKitchen`, `hasTables`). Replaces the
 * frontend's hardcoded `macroOfBusinessType()` ID-range helper — see
 * FDD-028 D6 and AUDIT-058 §1.2.
 */
export interface MacroCategoryDto {
  id:            number;
  /** Kebab-case stable identifier (`'food-beverage'`, `'quick-service'`, …). */
  internalCode:  string;
  publicName:    string;
  description:   string | null;
  posExperience: PosExperience;
  hasKitchen:    boolean;
  hasTables:     boolean;
}

/**
 * Plan type catalog entry — wire shape of `GET /api/Catalog/plan-types`
 * (NEW frontend consumer surface).
 *
 * Distinct from `PlanCatalogDto` (the feature manifest at `/plans`) —
 * this is the commercial tier catalog. Available for future onboarding
 * flows that need monthly price + currency without the full feature
 * matrix.
 */
export interface PlanTypeDto {
  id:           number;
  code:         string;
  name:         string;
  sortOrder:    number;
  monthlyPrice: number | null;
  /** ISO 4217 currency code (e.g. `'MXN'`). */
  currency:     string;
}

/**
 * Access method catalog entry — wire shape of `GET /api/Catalog/access-methods`
 * (NEW frontend consumer surface).
 *
 * Mirrors the shape of `AccessReasonCatalog`. Used by future reception
 * UIs that need to display the method by which an access attempt was
 * authenticated (QR, manual, PIN, etc.).
 */
export interface AccessMethodCatalog {
  id:        number;
  code:      string;
  name:      string;
  sortOrder: number;
}
