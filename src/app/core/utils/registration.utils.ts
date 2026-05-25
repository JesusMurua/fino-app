import { MacroCategoryCode, PlanTypeId } from '../enums';

/**
 * Parses the query-param handshake between the Landing Page and the
 * restaurant-app. The Landing always emits slugs as strings; this module
 * maps those slugs to the canonical macro category code the rest of
 * the app uses for comparisons.
 *
 * Sub-giros (Taquería, Ferretería, etc.) are NOT committed at registration —
 * the onboarding wizard captures them later and persists via
 * `PUT /api/business/giro`.
 *
 * Keep the slug → macro map aligned with `.claude/business-rules-matrix.md`.
 */

// ---------------------------------------------------------------------------
// Slug dictionaries
// ---------------------------------------------------------------------------

/**
 * Maps every accepted giro slug (canonical + common aliases) to its
 * parent `MacroCategoryCode`. Sub-giro slugs resolve to their macro so
 * the registration handshake stays coarse-grained; finer-grained
 * selection happens in the onboarding wizard.
 */
const GIRO_SLUG_MAP: Record<string, MacroCategoryCode> = {
  // Food & Beverage — macro + aliases
  'food-beverage':   MacroCategoryCode.FoodBeverage,
  restaurant:        MacroCategoryCode.FoodBeverage,
  restaurante:       MacroCategoryCode.FoodBeverage,
  bar:               MacroCategoryCode.FoodBeverage,
  'bar-cantina':     MacroCategoryCode.FoodBeverage,
  cantina:           MacroCategoryCode.FoodBeverage,
  'sports-bar':      MacroCategoryCode.FoodBeverage,

  // Quick service — macro + aliases
  'quick-service':   MacroCategoryCode.QuickService,
  cafe:              MacroCategoryCode.QuickService,
  cafeteria:         MacroCategoryCode.QuickService,
  taqueria:          MacroCategoryCode.QuickService,
  dogos:             MacroCategoryCode.QuickService,
  hamburguesas:      MacroCategoryCode.QuickService,
  pizzeria:          MacroCategoryCode.QuickService,
  paleteria:         MacroCategoryCode.QuickService,
  panaderia:         MacroCategoryCode.QuickService,

  // Retail — macro + aliases
  retail:              MacroCategoryCode.Retail,
  'retail-commerce':   MacroCategoryCode.Retail,
  abarrotes:           MacroCategoryCode.Retail,
  'abarrotes-retail':  MacroCategoryCode.Retail,
  expendio:            MacroCategoryCode.Retail,
  refaccionaria:       MacroCategoryCode.Retail,
  ferreteria:          MacroCategoryCode.Retail,
  papeleria:           MacroCategoryCode.Retail,
  farmacia:            MacroCategoryCode.Retail,
  boutique:            MacroCategoryCode.Retail,

  // Services — macro + aliases
  services:                   MacroCategoryCode.Services,
  servicios:                  MacroCategoryCode.Services,
  'servicios-especializados': MacroCategoryCode.Services,
  'specialized-services':     MacroCategoryCode.Services,
  estetica:                   MacroCategoryCode.Services,
  barberia:                   MacroCategoryCode.Services,
  taller:                     MacroCategoryCode.Services,
  'taller-mecanico':          MacroCategoryCode.Services,
  consultorio:                MacroCategoryCode.Services,
  clinica:                    MacroCategoryCode.Services,
  gimnasio:                   MacroCategoryCode.Services,
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
  /**
   * Resolved canonical macro category code. `null` when the URL had no
   * `giro` param (user must then pick one from the dropdown). If the
   * URL DID provide a giro but it did not match any known slug,
   * `parseRegistrationIntent` throws — this field is never a silent
   * fallback.
   */
  primaryMacroCategoryCode: MacroCategoryCode | null;
  /** Resolved plan FK */
  planTypeId: PlanTypeId;
  /** Normalized ISO country code, upper-case — defaults to 'MX' */
  countryCode: string;
  /**
   * The original plan slug from the URL, preserved for the onboarding
   * wizard step 2 (Stripe checkout). `null` when the URL had no plan.
   */
  planSlug: string | null;
  /**
   * The original giro slug from the URL, normalized to lowercase.
   * Used only for the UI badge / analytics — the source of truth is
   * `primaryMacroCategoryCode`. `null` when the URL had no giro.
   */
  giroSlug: string | null;
}

/**
 * Resolves a giro slug from the landing URL to a `MacroCategoryCode`.
 * Fail-fast policy — no default fallback: an empty or unknown slug
 * throws, the caller is responsible for catching the error and
 * stopping the flow before any other state is built.
 *
 * @param slug Raw query-param value (may be null or mixed-case)
 * @throws Error when the slug is missing or does not match any known giro
 */
export function resolveMacroSlug(slug: string | null | undefined): MacroCategoryCode {
  if (!slug) {
    throw new Error('Invalid or missing business type slug. Cannot proceed.');
  }
  const key = slug.trim().toLowerCase();
  const mapped = GIRO_SLUG_MAP[key];
  if (mapped === undefined) {
    throw new Error(`Invalid or missing business type slug. Cannot proceed.`);
  }
  return mapped;
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

  // Fail-fast: if a giro slug IS provided but does not match any known
  // value, `resolveMacroSlug` throws and the caller must catch it.
  // If no slug was provided at all, `primaryMacroCategoryCode` is left
  // null so the register form can render the dropdown.
  const primaryMacroCategoryCode: MacroCategoryCode | null = giroRaw
    ? resolveMacroSlug(giroRaw)
    : null;

  return {
    primaryMacroCategoryCode,
    planTypeId: resolvePlanSlug(planRaw),
    countryCode: (countryRaw?.trim().toUpperCase()) || 'MX',
    planSlug: planRaw ? planRaw.trim().toLowerCase() : null,
    giroSlug: giroRaw ? giroRaw.trim().toLowerCase() : null,
  };
}
