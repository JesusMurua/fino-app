import { BusinessTypeId, PlanTypeId } from '../enums';

/**
 * Parses the query-param handshake between the Landing Page and the
 * restaurant-app. The Landing always emits slugs as strings; this module
 * is the single source of truth that maps those slugs to the numeric
 * enum values the backend expects.
 *
 * Keep the slug→enum maps aligned with `.claude/business-rules-matrix.md`.
 */

// ---------------------------------------------------------------------------
// Slug dictionaries
// ---------------------------------------------------------------------------

/**
 * Maps every accepted giro slug (canonical + common aliases) to its
 * `BusinessTypeId`. The landing contract emits a single giro per
 * registration, so this is a simple lookup table.
 */
const GIRO_SLUG_MAP: Record<string, BusinessTypeId> = {
  // Food & Beverage
  restaurant:  BusinessTypeId.Restaurant,
  bar:         BusinessTypeId.Bar,
  cafe:        BusinessTypeId.Cafe,

  // Quick service
  'food-truck': BusinessTypeId.FoodTruck,
  foodtruck:    BusinessTypeId.FoodTruck,
  taqueria:     BusinessTypeId.Taqueria,

  // Retail
  retail:            BusinessTypeId.Retail,
  'abarrotes-retail': BusinessTypeId.Retail,
  abarrotes:         BusinessTypeId.Abarrotes,
  ferreteria:        BusinessTypeId.Ferreteria,
  papeleria:         BusinessTypeId.Papeleria,
  farmacia:          BusinessTypeId.Farmacia,

  // Services — canonical + sub-giro aliases from the landing
  services:                  BusinessTypeId.Servicios,
  servicios:                 BusinessTypeId.Servicios,
  'servicios-especializados': BusinessTypeId.Servicios,
  'specialized-services':    BusinessTypeId.Servicios,
  estetica:                  BusinessTypeId.Servicios,
  consultorio:               BusinessTypeId.Servicios,
  taller:                    BusinessTypeId.Servicios,

  // Generic fallback
  general: BusinessTypeId.General,
};

/**
 * Maps accepted plan slugs to their `PlanTypeId`. Unknown slugs fall back
 * to `Free` so no user ever gets blocked at the register screen.
 */
const PLAN_SLUG_MAP: Record<string, PlanTypeId> = {
  free:       PlanTypeId.Free,
  basic:      PlanTypeId.Basic,
  pro:        PlanTypeId.Pro,
  enterprise: PlanTypeId.Enterprise,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Value object produced by `parseRegistrationIntent` — everything the
 * Register component needs to build a `RegisterRequest` and to remember
 * the user's intent across the onboarding wizard.
 */
export interface RegistrationIntent {
  /** Resolved business type FK */
  businessTypeId: BusinessTypeId;
  /** Resolved plan FK */
  planTypeId: PlanTypeId;
  /** Normalized ISO country code, upper-case — defaults to 'MX' */
  countryCode: string;
  /**
   * The original plan slug from the URL, preserved for the onboarding
   * wizard step 4 (Stripe checkout). `null` when the URL had no plan.
   */
  planSlug: string | null;
  /**
   * The original giro slug from the URL, normalized to lowercase.
   * Used only for the UI badge — the source of truth for gating is
   * `businessTypeId`. `null` when the URL had no giro.
   */
  giroSlug: string | null;
}

/**
 * Resolves a giro slug from the landing URL to a `BusinessTypeId`.
 * Unknown slugs fall back to `General` with a console warning so the
 * user can still register but the mismatch is visible during debugging.
 *
 * @param slug Raw query-param value (may be null or mixed-case)
 * @returns The matched `BusinessTypeId`, or `General` as the safe fallback
 */
export function resolveBusinessTypeSlug(slug: string | null | undefined): BusinessTypeId {
  if (!slug) return BusinessTypeId.General;
  const key = slug.trim().toLowerCase();
  const mapped = GIRO_SLUG_MAP[key];
  if (mapped !== undefined) return mapped;
  console.warn(
    `[registration.utils] Unknown giro slug "${slug}" — falling back to General.`,
  );
  return BusinessTypeId.General;
}

/**
 * Resolves a plan slug from the landing URL to a `PlanTypeId`.
 * Unknown slugs fall back to `Free` with a console warning.
 *
 * @param slug Raw query-param value (may be null or mixed-case)
 * @returns The matched `PlanTypeId`, or `Free` as the safe fallback
 */
export function resolvePlanSlug(slug: string | null | undefined): PlanTypeId {
  if (!slug) return PlanTypeId.Free;
  const key = slug.trim().toLowerCase();
  const mapped = PLAN_SLUG_MAP[key];
  if (mapped !== undefined) return mapped;
  console.warn(
    `[registration.utils] Unknown plan slug "${slug}" — falling back to Free.`,
  );
  return PlanTypeId.Free;
}

/**
 * Parses the full `?giro=&plan=&country=` handshake from the landing page
 * into a `RegistrationIntent`. Accepts either an Angular `Params` dict or
 * any plain object with string values — tests can call it directly.
 *
 * @param params Raw query-param dictionary (from `route.snapshot.queryParams`)
 */
export function parseRegistrationIntent(
  params: Readonly<Record<string, string | undefined | null>>,
): RegistrationIntent {
  const giroRaw = params['giro'] ?? null;
  const planRaw = params['plan'] ?? null;
  const countryRaw = params['country'] ?? null;

  return {
    businessTypeId: resolveBusinessTypeSlug(giroRaw),
    planTypeId: resolvePlanSlug(planRaw),
    countryCode: (countryRaw?.trim().toUpperCase()) || 'MX',
    planSlug: planRaw ? planRaw.trim().toLowerCase() : null,
    giroSlug: giroRaw ? giroRaw.trim().toLowerCase() : null,
  };
}
