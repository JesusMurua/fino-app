/** Subscription plan tiers — mirrors backend PlanType enum */
export enum PlanType {
  Free = 'Free',
  Basic = 'Basic',
  Pro = 'Pro',
  Enterprise = 'Enterprise',
}

/** Business verticals — mirrors backend BusinessType enum */
export enum BusinessType {
  Restaurant = 'Restaurant',
  Retail = 'Retail',
  Cafe = 'Cafe',
  Bar = 'Bar',
  FoodTruck = 'FoodTruck',
  General = 'General',
}

/** Gated features that require a specific plan */
export enum FeatureKey {
  Zones = 'Zones',
  BarSeats = 'BarSeats',
  KioskMode = 'KioskMode',
  HardwarePrinter = 'HardwarePrinter',
  HardwareScanner = 'HardwareScanner',
  HardwareScale = 'HardwareScale',
  Promotions = 'Promotions',
  AdvancedReports = 'AdvancedReports',
  Cfdi = 'Cfdi',
  LoyaltyProgram = 'LoyaltyProgram',
  ClientsAndCredit = 'ClientsAndCredit',
  MultiBranch = 'MultiBranch',
  ApiAccess = 'ApiAccess',
}

/** Computed plan metadata derived from auth state */
export interface PlanInfo {
  planType: PlanType;
  businessType: BusinessType;
  trialEndsAt?: string;
  /** True when trialEndsAt is in the future */
  isOnTrial: boolean;
  /** Days remaining in trial — 0 if expired or not on trial */
  trialDaysLeft: number;
  /** True when planType is not Free */
  isPaid: boolean;
}

// ---------------------------------------------------------------------------
// Feature maps — which plan/giro unlocks which features
// ---------------------------------------------------------------------------

/** Numeric hierarchy for plan comparison */
export const PLAN_HIERARCHY: Record<PlanType, number> = {
  [PlanType.Free]: 0,
  [PlanType.Basic]: 1,
  [PlanType.Pro]: 2,
  [PlanType.Enterprise]: 3,
};

const BASIC_FEATURES: FeatureKey[] = [
  FeatureKey.Zones,
  FeatureKey.BarSeats,
  FeatureKey.KioskMode,
  FeatureKey.HardwarePrinter,
  FeatureKey.HardwareScanner,
  FeatureKey.Promotions,
];

const PRO_FEATURES: FeatureKey[] = [
  ...BASIC_FEATURES,
  FeatureKey.AdvancedReports,
  FeatureKey.Cfdi,
  FeatureKey.LoyaltyProgram,
  FeatureKey.ClientsAndCredit,
  FeatureKey.MultiBranch,
];

const ENTERPRISE_FEATURES: FeatureKey[] = [
  ...PRO_FEATURES,
  FeatureKey.HardwareScale,
  FeatureKey.ApiAccess,
];

/** Features unlocked per plan tier */
export const PLAN_FEATURE_MAP: Record<PlanType, FeatureKey[]> = {
  [PlanType.Free]: [],
  [PlanType.Basic]: BASIC_FEATURES,
  [PlanType.Pro]: PRO_FEATURES,
  [PlanType.Enterprise]: ENTERPRISE_FEATURES,
};

/** Features relevant per business type (regardless of plan) */
export const BUSINESS_FEATURE_MAP: Record<BusinessType, FeatureKey[]> = {
  [BusinessType.Restaurant]: [
    FeatureKey.Zones, FeatureKey.BarSeats, FeatureKey.KioskMode,
    FeatureKey.HardwarePrinter, FeatureKey.Promotions, FeatureKey.LoyaltyProgram,
  ],
  [BusinessType.Retail]: [
    FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.HardwareScale, FeatureKey.Promotions, FeatureKey.ClientsAndCredit,
  ],
  [BusinessType.Cafe]: [
    FeatureKey.KioskMode, FeatureKey.HardwarePrinter,
    FeatureKey.Promotions, FeatureKey.LoyaltyProgram,
  ],
  [BusinessType.Bar]: [
    FeatureKey.Zones, FeatureKey.BarSeats,
    FeatureKey.HardwarePrinter, FeatureKey.Promotions,
  ],
  [BusinessType.FoodTruck]: [
    FeatureKey.HardwarePrinter, FeatureKey.KioskMode,
  ],
  [BusinessType.General]: [
    FeatureKey.Zones, FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.ClientsAndCredit,
  ],
};

/** Minimum plan required to unlock a feature */
export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanType> = {
  [FeatureKey.Zones]: PlanType.Basic,
  [FeatureKey.BarSeats]: PlanType.Basic,
  [FeatureKey.KioskMode]: PlanType.Basic,
  [FeatureKey.HardwarePrinter]: PlanType.Basic,
  [FeatureKey.HardwareScanner]: PlanType.Basic,
  [FeatureKey.Promotions]: PlanType.Basic,
  [FeatureKey.AdvancedReports]: PlanType.Pro,
  [FeatureKey.Cfdi]: PlanType.Pro,
  [FeatureKey.LoyaltyProgram]: PlanType.Pro,
  [FeatureKey.ClientsAndCredit]: PlanType.Pro,
  [FeatureKey.MultiBranch]: PlanType.Pro,
  [FeatureKey.HardwareScale]: PlanType.Enterprise,
  [FeatureKey.ApiAccess]: PlanType.Enterprise,
};

/** Human-readable plan names in Spanish */
export const PLAN_DISPLAY_NAME: Record<PlanType, string> = {
  [PlanType.Free]: 'Gratuito',
  [PlanType.Basic]: 'Básico',
  [PlanType.Pro]: 'Pro',
  [PlanType.Enterprise]: 'Enterprise',
};
