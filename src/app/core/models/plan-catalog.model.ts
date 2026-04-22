import { FeatureKey, MacroCategoryType, PlanTypeId } from '../enums';

/**
 * Single source of truth for pricing, badges and feature promises across
 * the app (onboarding plan grid, settings "upgrade" cards, future landing
 * integrations).
 *
 * Prices are MXN **pesos** (integers, not centavos) because every tier
 * is sold at whole-peso rounding and it removes the /100 noise from
 * catalog consumers. `formatPrice` in the onboarding component prints
 * them directly.
 *
 * `features` is the authoritative set of `FeatureKey`s that each tier
 * promises. The set is cumulative: Basic extends Free, Pro extends Basic,
 * Enterprise extends Pro — so `PLAN_CATALOG[Pro].features` already
 * includes every Basic and Free bullet.
 *
 * Aliases from the product brief normalized to the canonical `FeatureKey`
 * enum (to keep one authoritative identifier across promise + enforcement):
 *   StoreCredit          → FeatureKey.CustomerCredit
 *   CustomerDatabase     → FeatureKey.CustomerBase
 *   MultiWarehouse       → FeatureKey.MultiWarehouseInventory
 *   AppointmentReminders → FeatureKey.Reminders
 */

/** Pricing lanes keyed by macro category (see `PRICING_GROUP_BY_MACRO`). */
export type PricingGroup = 'general' | 'standard' | 'restaurant';

/** Maps every macro to its pricing lane. */
export const PRICING_GROUP_BY_MACRO: Record<MacroCategoryType, PricingGroup> = {
  [MacroCategoryType.FoodBeverage]: 'restaurant',
  [MacroCategoryType.QuickService]: 'standard',
  [MacroCategoryType.Retail]:       'standard',
  [MacroCategoryType.Services]:     'general',
};

/** Resolves the pricing lane for a macro; falls back to `'general'`. */
export function pricingGroupForMacro(macro: MacroCategoryType | null): PricingGroup {
  return macro !== null ? PRICING_GROUP_BY_MACRO[macro] : 'general';
}

/** One tier in the `PLAN_CATALOG` array. */
export interface PricingTier {
  planTypeId: PlanTypeId;
  slug: string;
  name: string;
  /** Optional marketing pill ("Más popular", "Franquicia", …). */
  badge?: string;
  /** MXN pesos per month, keyed by pricing lane. */
  monthlyPrice: Record<PricingGroup, number>;
  /** MXN pesos per month when billed annually. */
  annualPrice: Record<PricingGroup, number>;
  /** Cumulative FeatureKeys unlocked by this tier. */
  features: FeatureKey[];
  /**
   * Stripe Price IDs used by the onboarding checkout, indexed by
   * `[cycle][group]`. Absent for Free (no Stripe call) and for tiers that
   * have not been set up in Stripe yet. Callers MUST null-check before
   * posting to `/subscription/checkout`.
   */
  stripePriceIds?: {
    monthly: Record<PricingGroup, string>;
    annual: Record<PricingGroup, string>;
  };
}

const FREE_FEATURES: readonly FeatureKey[] = [
  FeatureKey.CoreHardware,
  FeatureKey.CustomerCredit,   // aka StoreCredit
  FeatureKey.SimpleFolios,
  FeatureKey.CustomerBase,     // aka CustomerDatabase
  FeatureKey.PrintedTickets,
  FeatureKey.TableMap,
];

const BASIC_FEATURES: readonly FeatureKey[] = [
  ...FREE_FEATURES,
  FeatureKey.StockAlerts,
  FeatureKey.CfdiInvoicing,
  FeatureKey.CustomFolios,
  FeatureKey.KdsBasic,
  FeatureKey.DeliveryPlatforms,
  FeatureKey.RecipeInventory,
];

const PRO_FEATURES: readonly FeatureKey[] = [
  ...BASIC_FEATURES,
  FeatureKey.AdvancedReports,
  FeatureKey.MultiBranch,
  FeatureKey.MultiWarehouseInventory,  // aka MultiWarehouse
  FeatureKey.LoyaltyCrm,
  FeatureKey.KioskMode,
  FeatureKey.WaiterApp,
  FeatureKey.Reminders,                // aka AppointmentReminders
];

const ENTERPRISE_FEATURES: readonly FeatureKey[] = [
  ...PRO_FEATURES,
  FeatureKey.PublicApi,
];

/** Ordered from cheapest → most expensive. Consumers iterate in this order. */
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

/** Lookup by `PlanTypeId`. Returns `undefined` when the id is unknown. */
export function getPricingTier(planTypeId: PlanTypeId): PricingTier | undefined {
  return PLAN_CATALOG.find(t => t.planTypeId === planTypeId);
}

/**
 * Spanish user-facing labels for every `FeatureKey`. Colocated with the
 * catalog so "what we promise" and "how we render it" never drift.
 */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  [FeatureKey.CoreHardware]:            'Hardware básico (impresora, scanner, cajón)',
  [FeatureKey.CfdiInvoicing]:           'Facturación CFDI',
  [FeatureKey.UnlimitedProducts]:       'Productos ilimitados',
  [FeatureKey.PrintedTickets]:          'Comandas impresas',
  [FeatureKey.KdsBasic]:                'KDS básico (auto-refresh)',
  [FeatureKey.RealtimeKds]:             'KDS en tiempo real',
  [FeatureKey.TableMap]:                'Mapa de mesas',
  [FeatureKey.WaiterApp]:               'App de meseros',
  [FeatureKey.KioskMode]:               'Kiosco autoservicio',
  [FeatureKey.MultiTill]:               'Multi-caja por sucursal',
  [FeatureKey.MultiBranch]:             'Multi-sucursal',
  [FeatureKey.PublicApi]:               'API pública',
  [FeatureKey.RecipeInventory]:         'Inventario con recetas',
  [FeatureKey.DeliveryPlatforms]:       'Delivery (UberEats, Rappi, Didi)',
  [FeatureKey.LoyaltyCrm]:              'Programa de lealtad / CRM',
  [FeatureKey.CustomerCredit]:          'Crédito / fiado',
  [FeatureKey.MultiWarehouseInventory]: 'Inventario multi-bodega',
  [FeatureKey.ComparativeReports]:      'Reportes comparativos',
  [FeatureKey.StockAlerts]:             'Alertas de stock',
  [FeatureKey.SimpleFolios]:            'Folios simples',
  [FeatureKey.CustomerBase]:            'Directorio de clientes',
  [FeatureKey.CustomFolios]:            'Folios personalizados',
  [FeatureKey.CustomerHistory]:         'Historial por cliente',
  [FeatureKey.Reminders]:               'Recordatorios de citas',
  [FeatureKey.AdvancedReports]:         'Reportes avanzados',
};
