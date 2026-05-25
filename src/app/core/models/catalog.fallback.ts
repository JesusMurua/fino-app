import { FeatureKey, PlanTypeId } from '../enums';
import { PricingTier } from './plan-catalog.model';

/**
 * Commercial metadata for the pricing catalog (prices, badges, Stripe
 * Price IDs) — the **only** catalog data that the backend does NOT
 * serve. The sibling fallback `catalog.constants.ts` was deleted in
 * FDD-028 F6 once the runtime cache pattern (Dexie + ETag + seed JSONs
 * under `src/assets/catalog-seed/`) replaced the in-bundle fallback
 * model; this file survives because its content is frontend-owned
 * commercial data that has no backend equivalent.
 *
 * **This module is intentionally NOT re-exported from `core/models/index.ts`.**
 * The only legitimate consumer is `CatalogService`, which merges this
 * commercial data with the backend's feature manifest fetched from
 * `GET /api/catalog/plans`. UI components must read from
 * `catalogService.planCatalog()` instead of importing `PLAN_CATALOG`
 * directly, so the backend stays the single source of truth for
 * features.
 *
 * Features in each tier are cumulative: Basic extends Free, Pro extends
 * Basic, Enterprise extends Pro. Prices are MXN **pesos** (integers) —
 * no centavo noise for callers.
 */

const FREE_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware,
  FeatureKey.CustomerCredit,
  FeatureKey.SimpleFolios,
  FeatureKey.CustomerDatabase,
  FeatureKey.PrintedTickets,
  FeatureKey.TableMap,
];

const BASIC_FEATURES: readonly FeatureKey[] = [
  ...FREE_FEATURES,
  FeatureKey.StockAlerts,
  FeatureKey.CfdiInvoicing,
  FeatureKey.CustomFolios,
  FeatureKey.MaxKdsScreens,
  FeatureKey.DeliveryPlatforms,
  FeatureKey.RecipeInventory,
];

const PRO_FEATURES: readonly FeatureKey[] = [
  ...BASIC_FEATURES,
  FeatureKey.AdvancedReports,
  FeatureKey.MultiBranch,
  FeatureKey.MultiWarehouseInventory,
  FeatureKey.LoyaltyCrm,
  FeatureKey.MaxKiosks,
  FeatureKey.WaiterApp,
  FeatureKey.Reminders,
];

const ENTERPRISE_FEATURES: readonly FeatureKey[] = [
  ...PRO_FEATURES,
  FeatureKey.PublicApi,
];

/** Ordered from cheapest → most expensive. Consumed only by `CatalogService`. */
export const PLAN_CATALOG: readonly PricingTier[] = [
  {
    planTypeId:   PlanTypeId.Free,
    slug:         'free',
    name:         'Free',
    monthlyPrice: { general: 0, standard: 0, restaurant: 0 },
    annualPrice:  { general: 0, standard: 0, restaurant: 0 },
    features:     [...FREE_FEATURES],
  },
  {
    planTypeId:   PlanTypeId.Basic,
    slug:         'basic',
    name:         'Basic',
    badge:        'Básico',
    monthlyPrice: { general: 99,  standard: 149, restaurant: 199 },
    annualPrice:  { general: 79,  standard: 119, restaurant: 159 },
    features:     [...BASIC_FEATURES],
    stripePriceIds: {
      monthly: {
        general:    'price_1TGVDNGd6oMtnYKN3mOfuloV',
        standard:   'price_1TGjYIGd6oMtnYKNaWsO5wW9',
        restaurant: 'price_1TGjZTGd6oMtnYKNKH4mV0WR',
      },
      annual: {
        general:    'price_1TGVGBGd6oMtnYKNOtYdklZ7',
        standard:   'price_1TGjYvGd6oMtnYKNNLJSrXWk',
        restaurant: 'price_1TGjaKGd6oMtnYKNMlQbqt1f',
      },
    },
  },
  {
    planTypeId:   PlanTypeId.Pro,
    slug:         'pro',
    name:         'Pro',
    badge:        'Más popular',
    monthlyPrice: { general: 249, standard: 349, restaurant: 499 },
    annualPrice:  { general: 199, standard: 279, restaurant: 399 },
    features:     [...PRO_FEATURES],
    stripePriceIds: {
      monthly: {
        general:    'price_1TGjiaGd6oMtnYKNFY6ZbnMS',
        standard:   'price_1TGjjMGd6oMtnYKNnUYsOsmr',
        restaurant: 'price_1TGVDsGd6oMtnYKNGYySti0z',
      },
      annual: {
        general:    'price_1TGjj3Gd6oMtnYKNYX06rZPx',
        standard:   'price_1TGjk0Gd6oMtnYKNbIyJOpr8',
        restaurant: 'price_1TGVFhGd6oMtnYKNJGIXZ3d3',
      },
    },
  },
  {
    planTypeId:   PlanTypeId.Enterprise,
    slug:         'enterprise',
    name:         'Enterprise',
    badge:        'Franquicia',
    monthlyPrice: { general: 599, standard: 799, restaurant: 999 },
    annualPrice:  { general: 479, standard: 639, restaurant: 799 },
    features:     [...ENTERPRISE_FEATURES],
    stripePriceIds: {
      monthly: {
        general:    'price_1TGjrfGd6oMtnYKNaEVHitCF',
        standard:   'price_1TGjsMGd6oMtnYKNV4ixW9ms',
        restaurant: 'price_1TGVEDGd6oMtnYKNC7v50zld',
      },
      annual: {
        general:    'price_1TGjs2Gd6oMtnYKN4BvXPwXw',
        standard:   'price_1TGjtEGd6oMtnYKNMDlACMO2',
        restaurant: 'price_1TGVErGd6oMtnYKNfEBSfiPS',
      },
    },
  },
];
