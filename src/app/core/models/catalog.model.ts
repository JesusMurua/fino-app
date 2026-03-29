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

/** Business type catalog entry with feature flags */
export interface BusinessTypeCatalog {
  id: number;
  code: string;
  name: string;
  hasKitchen: boolean;
  hasTables: boolean;
  sortOrder: number;
}

/** Zone type catalog entry */
export interface ZoneTypeCatalog {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
}
