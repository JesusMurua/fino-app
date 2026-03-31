/**
 * Business-level configuration stored in IndexedDB and shared across all devices.
 * This data belongs to the business — not to a specific device or screen.
 *
 * Operating mode (counter / cashier / kiosk / tables) is intentionally absent:
 * it lives in DeviceConfig (localStorage) because each device can operate
 * in a different mode simultaneously (e.g. one tablet as kiosk, one as cashier).
 */
import { BusinessTypeCatalog } from './catalog.model';

export interface BusinessConfig {
  businessName: string;
  locationName: string;
  /** Whether this business has a kitchen (KDS, kitchen orders) */
  hasKitchen: boolean;
  /** Whether this business uses table management */
  hasTables: boolean;
  /** Cached business type catalog entry — provides posExperience at startup */
  businessTypeCatalog?: BusinessTypeCatalog;
  /** Folio prefix for ticket numbering (e.g. "HMO") */
  folioPrefix?: string;
  /** Folio format template (e.g. "{PREFIX}-{NUM:4}") */
  folioFormat?: string;
  /** Current folio counter value */
  folioCounter?: number;
}

/** Default business config used before the owner sets up the back office */
export const DEFAULT_BUSINESS_CONFIG: BusinessConfig = {
  businessName: '',
  locationName: '',
  hasKitchen: false,
  hasTables: false,
};
