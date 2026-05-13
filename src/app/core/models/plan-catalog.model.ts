import { FeatureKey, MacroCategoryType, PlanTypeId } from '../enums';

/**
 * Public types, pricing utilities and UI labels for the plan catalog.
 *
 * The authoritative catalog data lives in `catalog.fallback.ts` (offline
 * fallback) and is served by `GET /api/catalog/plans` at runtime;
 * consumers should always read it via `CatalogService.planCatalog()` —
 * not by importing the fallback directly.
 *
 * What this module owns:
 *   - `PricingTier` / `PricingGroup`  shape + pricing lane type
 *   - `PRICING_GROUP_BY_MACRO`        macro → pricing lane mapping
 *   - `pricingGroupForMacro()`        null-safe lookup
 *   - `FEATURE_LABELS`                Spanish display strings per feature
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

/** One tier in the plan catalog. */
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

/**
 * Spanish user-facing labels for every `FeatureKey`. Colocated with the
 * catalog types so "what we promise" and "how we render it" never drift.
 */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  [FeatureKey.CoreHardware]:            'Hardware básico (impresora, scanner, cajón)',
  [FeatureKey.CfdiInvoicing]:           'Facturación CFDI',
  [FeatureKey.UnlimitedProducts]:       'Productos ilimitados',
  [FeatureKey.PrintedTickets]:          'Comandas impresas',
  [FeatureKey.RealtimeKds]:             'KDS en tiempo real',
  [FeatureKey.TableMap]:                'Mapa de mesas',
  [FeatureKey.WaiterApp]:               'App de meseros',
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
  [FeatureKey.CustomerDatabase]:        'Directorio de clientes',
  [FeatureKey.CustomFolios]:            'Folios personalizados',
  [FeatureKey.CustomerHistory]:         'Historial por cliente',
  [FeatureKey.Reminders]:               'Recordatorios de citas',
  [FeatureKey.RealtimeAccessControl]:   'Control de acceso (tiempo real)',
  [FeatureKey.MaxCashRegisters]:        'Cajas registradoras incluidas',
  [FeatureKey.MaxKdsScreens]:           'Pantallas de cocina (KDS)',
  [FeatureKey.MaxKiosks]:               'Kioskos de autoservicio',
  [FeatureKey.MaxReceptionsPerBranch]:  'Pantallas de recepción por sucursal',
  [FeatureKey.AdvancedReports]:         'Reportes avanzados',
};
