import {
  MockJwtClaims,
  TEST_FEATURE_KEYS,
  TEST_PLAN_TYPE,
} from './jwt-mock';

/**
 * Pre-canned tenant scenarios for Playwright specs.
 *
 * Each entry describes a realistic combination of macro / features /
 * plan that a real tenant on the platform would have. New scenarios
 * should be added here rather than constructed inline in tests —
 * keeps `seedJwtClaims()` invocations terse and centralises the
 * "what does a Gym Pro tenant look like?" knowledge.
 *
 * Naming: `<MACRO>_<PLAN>` for full-tier coverage, descriptive name
 * for niche combinations (e.g. FREE_TIER, MINIMAL).
 */
export const TEST_TENANT_SCENARIOS = {

  /** Restaurant Pro — full F&B feature set, drives card-fb preview. */
  RESTAURANT_PRO: {
    macroCategory: 'FoodBeverage',
    features: [
      TEST_FEATURE_KEYS.CoreHardware,
      TEST_FEATURE_KEYS.TableMap,
      TEST_FEATURE_KEYS.WaiterApp,
      TEST_FEATURE_KEYS.MaxKdsScreens,
      TEST_FEATURE_KEYS.RealtimeKds,
      TEST_FEATURE_KEYS.PrintedTickets,
      TEST_FEATURE_KEYS.MaxCashRegisters,
      TEST_FEATURE_KEYS.CustomerDatabase,
      TEST_FEATURE_KEYS.CfdiInvoicing,
    ],
    planType: TEST_PLAN_TYPE.Pro,
  },

  /** Quick-service taquería — counter POS, kitchen, no tables. */
  QUICK_SERVICE_PRO: {
    macroCategory: 'QuickService',
    features: [
      TEST_FEATURE_KEYS.CoreHardware,
      TEST_FEATURE_KEYS.MaxKdsScreens,
      TEST_FEATURE_KEYS.PrintedTickets,
      TEST_FEATURE_KEYS.MaxKiosks,
      TEST_FEATURE_KEYS.LoyaltyCrm,
      TEST_FEATURE_KEYS.CustomerDatabase,
    ],
    planType: TEST_PLAN_TYPE.Pro,
  },

  /** Retail Basic — barcode, stock alerts, no F&B features. */
  RETAIL_BASIC: {
    macroCategory: 'Retail',
    features: [
      TEST_FEATURE_KEYS.CoreHardware,
      TEST_FEATURE_KEYS.StockAlerts,
      TEST_FEATURE_KEYS.MultiWarehouseInventory,
      TEST_FEATURE_KEYS.CustomerDatabase,
    ],
    planType: TEST_PLAN_TYPE.Basic,
  },

  /** Gym Pro — access control + memberships, drives service-tile preview. */
  GYM_PRO: {
    macroCategory: 'Services',
    features: [
      TEST_FEATURE_KEYS.CoreHardware,
      TEST_FEATURE_KEYS.RealtimeAccessControl,
      TEST_FEATURE_KEYS.MaxReceptionsPerBranch,
      TEST_FEATURE_KEYS.CustomerHistory,
      TEST_FEATURE_KEYS.CustomerDatabase,
      TEST_FEATURE_KEYS.Reminders,
      TEST_FEATURE_KEYS.SimpleFolios,
    ],
    planType: TEST_PLAN_TYPE.Pro,
    subCategory: 'Gym',
  },

  /**
   * Free tier — minimal features, drives the upgrade-banner flows.
   * Useful for testing locked features and upsell CTAs.
   */
  FREE_TIER: {
    macroCategory: 'FoodBeverage',
    features: [
      TEST_FEATURE_KEYS.CoreHardware,
    ],
    planType: TEST_PLAN_TYPE.Free,
  },

} as const satisfies Record<string, MockJwtClaims>;

/** Type-safe scenario key for test selection. */
export type TestScenarioKey = keyof typeof TEST_TENANT_SCENARIOS;
