import { MacroCategoryType } from './config.enum';

/**
 * Feature keys emitted by the backend in the JWT `features` claim.
 *
 * Values MUST match the backend `FeatureKey` enum exactly (case-sensitive),
 * since the `TenantContextService` hydrates an in-memory `Set<FeatureKey>`
 * by string equality against the JWT claim array.
 *
 * Source of truth: `.claude/business-rules-matrix.md`
 */
/**
 * Type guard for the FDD-028 D5 "warn-and-keep" policy.
 *
 * Backend `/catalog/plans` responses may carry feature strings the FE
 * enum doesn't know about yet (a new `FeatureKey` shipped on the API
 * before the FE was redeployed). The cache preserves them verbatim; the
 * render layer uses this guard to narrow `(FeatureKey | string)[]` to
 * `FeatureKey[]` before mapping to `FEATURE_LABELS`. Unknowns silently
 * drop at render time but remain in the signal for the next deploy to
 * pick up.
 */
export function isKnownFeatureKey(value: FeatureKey | string): value is FeatureKey {
  return (Object.values(FeatureKey) as string[]).includes(value);
}

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
  /** Realtime KDS via SignalR sockets — internal toggle layered on top of MaxKdsScreens */
  RealtimeKds = 'RealtimeKds',
  /** Interactive floor/table map */
  TableMap = 'TableMap',
  /** Mobile waiter ordering app */
  WaiterApp = 'WaiterApp',
  /** More than one cash register per branch */
  MultiTill = 'MultiTill',
  /** Multi-branch / franchise support */
  MultiBranch = 'MultiBranch',
  /** Public REST API access */
  PublicApi = 'PublicApi',
  /** Recipes, waste tracking, ingredient-level inventory */
  RecipeInventory = 'RecipeInventory',
  /** Third-party delivery aggregator integrations (UberEats, Rappi, DidiFood). */
  DeliveryPlatforms = 'DeliveryPlatforms',

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
  /** Basic customer directory — matches backend JWT claim `CustomerDatabase`. */
  CustomerDatabase = 'CustomerDatabase',
  /** Custom folio formats / prefixes */
  CustomFolios = 'CustomFolios',
  /** Service history per customer */
  CustomerHistory = 'CustomerHistory',
  /** Appointment reminders */
  Reminders = 'Reminders',
  /** Real-time access-control telemetry via SignalR — drives the reception live feed (gym vertical) */
  RealtimeAccessControl = 'RealtimeAccessControl',

  // --- Hardware quotas (quantitative — backend emits the key on every plan;
  //     the numeric limit lives in the plan catalog and is enforced via 403
  //     on `/device/generate-code`. Frontend treats presence as "this lane
  //     exists" so users can see the upsell path for plans where the cap is
  //     0, e.g. Free tenants discovering the Kiosk option). ------------------
  /** Cashier + Hostess terminals — shared global quota */
  MaxCashRegisters = 'MaxCashRegisters',
  /** Kitchen Display screens — global quota */
  MaxKdsScreens = 'MaxKdsScreens',
  /** Self-service kiosks — global quota */
  MaxKiosks = 'MaxKiosks',
  /** Member check-in / access-control screens — per-branch quota */
  MaxReceptionsPerBranch = 'MaxReceptionsPerBranch',

  // --- Reporting ----------------------------------------------------------
  /** Generic advanced reports module (sales, trends, exports) */
  AdvancedReports = 'AdvancedReports',

  // --- Payments -----------------------------------------------------------
  /** Provider-backed payment integrations (Clip, MercadoPago, etc.) */
  ProviderPayments = 'ProviderPayments',
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
/**
 * Features applicable to ALL four macros after the V2.0 business-rules
 * sync. These show up in every giro's `GIRO_FEATURE_MAP` entry and are
 * unlocked vertically by plan tier rather than horizontally by macro.
 */
const UNIVERSAL_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware,
  FeatureKey.CfdiInvoicing,
  FeatureKey.CustomerCredit,
  FeatureKey.CustomerDatabase,
  FeatureKey.SimpleFolios,
  FeatureKey.StockAlerts,
  FeatureKey.MultiWarehouseInventory,
  FeatureKey.MultiBranch,
  FeatureKey.PublicApi,
  FeatureKey.MaxCashRegisters,
  FeatureKey.ProviderPayments,
];

const FOOD_AND_BEVERAGE_FEATURES: readonly FeatureKey[] = [
  ...UNIVERSAL_FEATURES,
  FeatureKey.UnlimitedProducts,
  FeatureKey.PrintedTickets, FeatureKey.MaxKdsScreens, FeatureKey.RealtimeKds,
  FeatureKey.TableMap, FeatureKey.WaiterApp, FeatureKey.MaxKiosks,
  FeatureKey.MultiTill, FeatureKey.LoyaltyCrm,
  FeatureKey.RecipeInventory, FeatureKey.DeliveryPlatforms, FeatureKey.AdvancedReports,
];

const QUICK_SERVICE_FEATURES: readonly FeatureKey[] = [
  ...UNIVERSAL_FEATURES,
  FeatureKey.UnlimitedProducts,
  FeatureKey.MaxKdsScreens, FeatureKey.RealtimeKds, FeatureKey.MaxKiosks,
  FeatureKey.LoyaltyCrm, FeatureKey.MultiTill,
  FeatureKey.DeliveryPlatforms, FeatureKey.AdvancedReports,
];

const RETAIL_FEATURES: readonly FeatureKey[] = [
  ...UNIVERSAL_FEATURES,
  FeatureKey.UnlimitedProducts,
  FeatureKey.ComparativeReports, FeatureKey.AdvancedReports,
];

const SERVICES_FEATURES: readonly FeatureKey[] = [
  ...UNIVERSAL_FEATURES,
  FeatureKey.CustomFolios, FeatureKey.CustomerHistory, FeatureKey.Reminders,
  FeatureKey.MaxReceptionsPerBranch, FeatureKey.RealtimeAccessControl,
];

/**
 * Feature applicability keyed by macro category (not sub-giro).
 * Drives `TenantContextService.isApplicableToGiro()` — used by the UI to
 * decide hide vs. upsell-lock for each feature.
 */
export const GIRO_FEATURE_MAP: Record<MacroCategoryType, readonly FeatureKey[]> = {
  [MacroCategoryType.FoodBeverage]: FOOD_AND_BEVERAGE_FEATURES,
  [MacroCategoryType.QuickService]: QUICK_SERVICE_FEATURES,
  [MacroCategoryType.Retail]:       RETAIL_FEATURES,
  [MacroCategoryType.Services]:     SERVICES_FEATURES,
};
