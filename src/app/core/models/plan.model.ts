import { BusinessTypeId, PlanTypeId } from '../enums';

/**
 * @deprecated Use PlanTypeId from enums instead. Kept for backward compat.
 */
export enum PlanType {
  Free = 'Free',
  Basic = 'Basic',
  Pro = 'Pro',
  Enterprise = 'Enterprise',
}

/**
 * @deprecated Use BusinessTypeId from enums instead. Kept for backward compat.
 */
export enum BusinessType {
  Restaurant = 'Restaurant',
  Retail = 'Retail',
  Cafe = 'Cafe',
  Bar = 'Bar',
  FoodTruck = 'FoodTruck',
  General = 'General',
  Taqueria = 'Taqueria',
  Abarrotes = 'Abarrotes',
  Ferreteria = 'Ferreteria',
  Papeleria = 'Papeleria',
  Farmacia = 'Farmacia',
  Servicios = 'Servicios',
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
  Tables = 'Tables',
  Reservations = 'Reservations',
  Inventory = 'Inventory',
  CashRegister = 'CashRegister',
}

/** Computed plan metadata derived from auth state */
export interface PlanInfo {
  planTypeId: PlanTypeId;
  businessTypeId: BusinessTypeId;
  trialEndsAt?: string;
  /** True when trialEndsAt is in the future */
  isOnTrial: boolean;
  /** Days remaining in trial — 0 if expired or not on trial */
  trialDaysLeft: number;
  /** True when planTypeId is not Free */
  isPaid: boolean;
}

// ---------------------------------------------------------------------------
// Feature maps — which plan/giro unlocks which features
// ---------------------------------------------------------------------------

/** Numeric hierarchy for plan comparison */
export const PLAN_HIERARCHY: Record<PlanTypeId, number> = {
  [PlanTypeId.Free]: 0,
  [PlanTypeId.Basic]: 1,
  [PlanTypeId.Pro]: 2,
  [PlanTypeId.Enterprise]: 3,
};

const BASIC_FEATURES: FeatureKey[] = [
  FeatureKey.Zones,
  FeatureKey.BarSeats,
  FeatureKey.KioskMode,
  FeatureKey.HardwarePrinter,
  FeatureKey.HardwareScanner,
  FeatureKey.Promotions,
  FeatureKey.Tables,
  FeatureKey.Inventory,
  FeatureKey.CashRegister,
];

const PRO_FEATURES: FeatureKey[] = [
  ...BASIC_FEATURES,
  FeatureKey.AdvancedReports,
  FeatureKey.Cfdi,
  FeatureKey.LoyaltyProgram,
  FeatureKey.ClientsAndCredit,
  FeatureKey.MultiBranch,
  FeatureKey.Reservations,
];

const ENTERPRISE_FEATURES: FeatureKey[] = [
  ...PRO_FEATURES,
  FeatureKey.HardwareScale,
  FeatureKey.ApiAccess,
];

/** Features unlocked per plan tier */
export const PLAN_FEATURE_MAP: Record<PlanTypeId, FeatureKey[]> = {
  [PlanTypeId.Free]: [],
  [PlanTypeId.Basic]: BASIC_FEATURES,
  [PlanTypeId.Pro]: PRO_FEATURES,
  [PlanTypeId.Enterprise]: ENTERPRISE_FEATURES,
};

/** Features relevant per business type (regardless of plan) */
export const BUSINESS_FEATURE_MAP: Record<BusinessTypeId, FeatureKey[]> = {
  [BusinessTypeId.Restaurant]: [
    FeatureKey.Zones, FeatureKey.BarSeats, FeatureKey.KioskMode,
    FeatureKey.HardwarePrinter, FeatureKey.Promotions, FeatureKey.LoyaltyProgram,
    FeatureKey.Tables, FeatureKey.Reservations, FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Cafe]: [
    FeatureKey.KioskMode, FeatureKey.HardwarePrinter,
    FeatureKey.Promotions, FeatureKey.LoyaltyProgram,
    FeatureKey.Tables, FeatureKey.Reservations, FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Bar]: [
    FeatureKey.Zones, FeatureKey.BarSeats,
    FeatureKey.HardwarePrinter, FeatureKey.Promotions,
    FeatureKey.Tables, FeatureKey.Reservations, FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.FoodTruck]: [
    FeatureKey.HardwarePrinter, FeatureKey.KioskMode,
    FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Taqueria]: [
    FeatureKey.HardwarePrinter, FeatureKey.KioskMode,
    FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Retail]: [
    FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.HardwareScale, FeatureKey.Promotions, FeatureKey.ClientsAndCredit,
    FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Abarrotes]: [
    FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.HardwareScale, FeatureKey.Promotions, FeatureKey.ClientsAndCredit,
    FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Ferreteria]: [
    FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.HardwareScale, FeatureKey.Promotions, FeatureKey.ClientsAndCredit,
    FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Papeleria]: [
    FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.Promotions, FeatureKey.ClientsAndCredit,
    FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Farmacia]: [
    FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.Promotions, FeatureKey.ClientsAndCredit,
    FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.General]: [
    FeatureKey.HardwarePrinter, FeatureKey.HardwareScanner,
    FeatureKey.ClientsAndCredit, FeatureKey.Inventory, FeatureKey.CashRegister,
  ],
  [BusinessTypeId.Servicios]: [
    FeatureKey.HardwarePrinter, FeatureKey.ClientsAndCredit,
    FeatureKey.CashRegister,
  ],
};

/** Minimum plan required to unlock a feature */
export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanTypeId> = {
  [FeatureKey.Zones]: PlanTypeId.Basic,
  [FeatureKey.BarSeats]: PlanTypeId.Basic,
  [FeatureKey.KioskMode]: PlanTypeId.Basic,
  [FeatureKey.HardwarePrinter]: PlanTypeId.Basic,
  [FeatureKey.HardwareScanner]: PlanTypeId.Basic,
  [FeatureKey.Promotions]: PlanTypeId.Basic,
  [FeatureKey.AdvancedReports]: PlanTypeId.Pro,
  [FeatureKey.Cfdi]: PlanTypeId.Pro,
  [FeatureKey.LoyaltyProgram]: PlanTypeId.Pro,
  [FeatureKey.ClientsAndCredit]: PlanTypeId.Pro,
  [FeatureKey.MultiBranch]: PlanTypeId.Pro,
  [FeatureKey.HardwareScale]: PlanTypeId.Enterprise,
  [FeatureKey.ApiAccess]: PlanTypeId.Enterprise,
  [FeatureKey.Tables]: PlanTypeId.Basic,
  [FeatureKey.Reservations]: PlanTypeId.Pro,
  [FeatureKey.Inventory]: PlanTypeId.Basic,
  [FeatureKey.CashRegister]: PlanTypeId.Basic,
};

/** Human-readable plan names in Spanish */
export const PLAN_DISPLAY_NAME: Record<PlanTypeId, string> = {
  [PlanTypeId.Free]: 'Gratuito',
  [PlanTypeId.Basic]: 'Básico',
  [PlanTypeId.Pro]: 'Pro',
  [PlanTypeId.Enterprise]: 'Enterprise',
};
