import { MacroCategoryType, PlanTypeId } from '../enums';

/**
 * Computed plan metadata derived from auth state. Kept here because
 * `AuthService.planInfo` is a signal consumed across the app (trial
 * banner, expired overlay, etc).
 */
export interface PlanInfo {
  planTypeId: PlanTypeId;
  /**
   * Wire-shape numeric macro id (FDD-028 F5 / wire reality). Typed as
   * the deprecated {@link MacroCategoryType} enum so the value lines
   * up with backend seed identifiers. Null until the user logs in and
   * the tenant context is hydrated.
   */
  primaryMacroCategoryId: MacroCategoryType | null;
  trialEndsAt?: string;
  /** True when trialEndsAt is in the future */
  isOnTrial: boolean;
  /** Days remaining in trial — 0 if expired or not on trial */
  trialDaysLeft: number;
  /** True when planTypeId is not Free */
  isPaid: boolean;
}

// ---------------------------------------------------------------------------
// Plan metadata — kept for plan comparison and display
// ---------------------------------------------------------------------------

/** Numeric hierarchy for plan comparison */
export const PLAN_HIERARCHY: Record<PlanTypeId, number> = {
  [PlanTypeId.Free]: 0,
  [PlanTypeId.Basic]: 1,
  [PlanTypeId.Pro]: 2,
  [PlanTypeId.Enterprise]: 3,
};

/** Quantitative limits per plan tier */
export interface PlanLimits {
  maxUsers: number;
  maxProducts: number;
}

export const PLAN_LIMITS: Record<PlanTypeId, PlanLimits> = {
  [PlanTypeId.Free]:       { maxUsers: 3,        maxProducts: 100 },
  [PlanTypeId.Basic]:      { maxUsers: Infinity,  maxProducts: Infinity },
  [PlanTypeId.Pro]:        { maxUsers: Infinity,  maxProducts: Infinity },
  [PlanTypeId.Enterprise]: { maxUsers: Infinity,  maxProducts: Infinity },
};

/** Human-readable plan names in Spanish */
export const PLAN_DISPLAY_NAME: Record<PlanTypeId, string> = {
  [PlanTypeId.Free]: 'Gratuito',
  [PlanTypeId.Basic]: 'Básico',
  [PlanTypeId.Pro]: 'Pro',
  [PlanTypeId.Enterprise]: 'Enterprise',
};

/**
 * Plans the business matrix allows per macro category. Mirrors the
 * onboarding `AVAILABLE_PLANS_BY_MACRO` constant but keyed by
 * `PlanTypeId` so guards and Back Office code can filter without
 * mapping between slug and enum.
 *
 * Source of truth: `.claude/business-rules-matrix.md`.
 */
export const AVAILABLE_PLAN_TYPES_BY_MACRO: Record<MacroCategoryType, ReadonlySet<PlanTypeId>> = {
  [MacroCategoryType.FoodBeverage]: new Set([PlanTypeId.Free, PlanTypeId.Basic, PlanTypeId.Pro, PlanTypeId.Enterprise]),
  [MacroCategoryType.QuickService]: new Set([PlanTypeId.Free, PlanTypeId.Basic, PlanTypeId.Pro]),
  [MacroCategoryType.Retail]:       new Set([PlanTypeId.Free, PlanTypeId.Basic, PlanTypeId.Pro]),
  [MacroCategoryType.Services]:     new Set([PlanTypeId.Free, PlanTypeId.Pro]),
};
