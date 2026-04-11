import { BusinessTypeId } from './config.enum';

/**
 * Feature keys emitted by the backend in the JWT `features` claim.
 *
 * Values MUST match the backend `FeatureKey` enum exactly (case-sensitive),
 * since the `TenantContextService` hydrates an in-memory `Set<FeatureKey>`
 * by string equality against the JWT claim array.
 *
 * Source of truth: `.claude/business-rules-matrix.md`
 */
export enum FeatureKey {
  // --- Core (available on every plan, every giro) -------------------------
  /** Thermal printers, USB/BT scanners, local scales, cash drawer */
  CoreHardware = 'CoreHardware',
  /** CFDI invoicing (Basic for most giros, Pro for Services) */
  CfdiInvoicing = 'CfdiInvoicing',
  /** Lifts the Free-tier product cap */
  UnlimitedProducts = 'UnlimitedProducts',

  // --- Food & Beverage ----------------------------------------------------
  /** Printed kitchen tickets — no screen (Free tier fallback) */
  PrintedTickets = 'PrintedTickets',
  /** KDS with auto-refresh polling, no sockets */
  KdsBasic = 'KdsBasic',
  /** Realtime KDS via SignalR sockets */
  RealtimeKds = 'RealtimeKds',
  /** Interactive floor/table map */
  TableMap = 'TableMap',
  /** Mobile waiter ordering app */
  WaiterApp = 'WaiterApp',
  /** Self-service customer kiosk */
  KioskMode = 'KioskMode',
  /** More than one cash register per branch */
  MultiTill = 'MultiTill',
  /** Multi-branch / franchise support */
  MultiBranch = 'MultiBranch',
  /** Public REST API access */
  PublicApi = 'PublicApi',
  /** Recipes, waste tracking, ingredient-level inventory */
  RecipeInventory = 'RecipeInventory',

  // --- Quick Service ------------------------------------------------------
  /** Loyalty program + customer CRM */
  LoyaltyCrm = 'LoyaltyCrm',

  // --- Retail -------------------------------------------------------------
  /** Store credit / fiado ledger */
  CustomerCredit = 'CustomerCredit',
  /** Stock split across multiple warehouses */
  MultiWarehouseInventory = 'MultiWarehouseInventory',
  /** Period-over-period comparative reports */
  ComparativeReports = 'ComparativeReports',
  /** Low-stock alerts */
  StockAlerts = 'StockAlerts',

  // --- Specialized Services -----------------------------------------------
  /** Simple sequential folios */
  SimpleFolios = 'SimpleFolios',
  /** Basic customer directory */
  CustomerBase = 'CustomerBase',
  /** Custom folio formats / prefixes */
  CustomFolios = 'CustomFolios',
  /** Service history per customer */
  CustomerHistory = 'CustomerHistory',
  /** Appointment reminders */
  Reminders = 'Reminders',

  // --- Reporting ----------------------------------------------------------
  /** Generic advanced reports module (sales, trends, exports) */
  AdvancedReports = 'AdvancedReports',
}

// ---------------------------------------------------------------------------
// Giro applicability map
// ---------------------------------------------------------------------------

/**
 * Which features are RELEVANT to each business vertical, regardless of the
 * current plan tier. Used by `TenantContextService.isApplicableToGiro()` to
 * decide whether a locked feature should be hidden (not applicable) or
 * shown with a padlock (upgrade available).
 *
 * Derived from the plan × giro matrix in `.claude/business-rules-matrix.md`.
 */
const FOOD_AND_BEVERAGE_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware, FeatureKey.CfdiInvoicing, FeatureKey.UnlimitedProducts,
  FeatureKey.PrintedTickets, FeatureKey.KdsBasic, FeatureKey.RealtimeKds,
  FeatureKey.TableMap, FeatureKey.WaiterApp, FeatureKey.KioskMode,
  FeatureKey.MultiTill, FeatureKey.MultiBranch, FeatureKey.PublicApi,
  FeatureKey.RecipeInventory, FeatureKey.AdvancedReports,
];

const QUICK_SERVICE_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware, FeatureKey.CfdiInvoicing, FeatureKey.UnlimitedProducts,
  FeatureKey.KdsBasic, FeatureKey.RealtimeKds, FeatureKey.KioskMode,
  FeatureKey.LoyaltyCrm, FeatureKey.MultiTill, FeatureKey.AdvancedReports,
];

const QUICK_SERVICE_NO_KDS_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware, FeatureKey.CfdiInvoicing, FeatureKey.UnlimitedProducts,
  FeatureKey.KdsBasic, FeatureKey.KioskMode, FeatureKey.MultiTill,
  FeatureKey.AdvancedReports,
];

const RETAIL_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware, FeatureKey.CfdiInvoicing, FeatureKey.UnlimitedProducts,
  FeatureKey.CustomerCredit, FeatureKey.MultiWarehouseInventory,
  FeatureKey.ComparativeReports, FeatureKey.StockAlerts, FeatureKey.AdvancedReports,
];

const SERVICES_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware, FeatureKey.CfdiInvoicing,
  FeatureKey.SimpleFolios, FeatureKey.CustomerBase,
  FeatureKey.CustomFolios, FeatureKey.CustomerHistory, FeatureKey.Reminders,
];

export const GIRO_FEATURE_MAP: Record<BusinessTypeId, readonly FeatureKey[]> = {
  // Full-service Food & Beverage
  [BusinessTypeId.Restaurant]: FOOD_AND_BEVERAGE_FEATURES,
  [BusinessTypeId.Bar]:        FOOD_AND_BEVERAGE_FEATURES,

  // Quick service with full KDS workflow
  [BusinessTypeId.Cafe]:     QUICK_SERVICE_FEATURES,
  [BusinessTypeId.Taqueria]: QUICK_SERVICE_FEATURES,

  // Quick service without full KDS (no real-time coordination)
  [BusinessTypeId.FoodTruck]: QUICK_SERVICE_NO_KDS_FEATURES,

  // Retail verticals
  [BusinessTypeId.Retail]:     RETAIL_FEATURES,
  [BusinessTypeId.Abarrotes]:  RETAIL_FEATURES,
  [BusinessTypeId.Ferreteria]: RETAIL_FEATURES,
  [BusinessTypeId.Papeleria]:  RETAIL_FEATURES,
  [BusinessTypeId.Farmacia]:   RETAIL_FEATURES,

  // Specialized services
  [BusinessTypeId.Servicios]: SERVICES_FEATURES,

  // Generic fallback — treated like a stripped-down retail vertical
  [BusinessTypeId.General]: RETAIL_FEATURES,
};
