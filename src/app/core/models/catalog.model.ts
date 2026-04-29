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

/** Business type catalog entry with feature flags */
export interface BusinessTypeCatalog {
  id: number;
  code: string;
  name: string;
  hasKitchen: boolean;
  hasTables: boolean;
  posExperience: PosExperience;
  sortOrder: number;
}

/** Zone type catalog entry */
export interface ZoneTypeCatalog {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
}
