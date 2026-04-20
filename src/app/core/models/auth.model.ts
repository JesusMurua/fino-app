import { MacroCategoryType, PlanTypeId, UserRoleId } from '../enums';

/** Branch summary returned in the login response */
export interface BranchInfo {
  id: number;
  name: string;
}

/**
 * Identifies how the current session was created.
 * - `email`: browser login with email + password (Back Office users).
 * - `pin`: terminal login with a 4-digit PIN (operational staff).
 * - `device`: long-lived machine token (KDS, kiosk) — humans never own this.
 */
export type AuthSessionType = 'email' | 'pin' | 'device';

/** Authenticated user state held in AuthService */
export interface AuthUser {
  /** Numeric role FK — use UserRoleId enum for comparisons */
  roleId: UserRoleId;
  name: string;
  businessId: number;
  branchId: number;
  token: string;
  branches: BranchInfo[];
  currentBranchId: number;
  /** Numeric plan FK — use PlanTypeId enum */
  planTypeId: PlanTypeId;
  /**
   * Primary macro category — drives feature gating, pricing and POS experience.
   * Sub-giros live server-side (`BusinessGiro` N:M) and are NOT carried here.
   */
  primaryMacroCategoryId: MacroCategoryType;
  /** ISO date string — null if no trial */
  trialEndsAt?: string;
  /** 1=Pending, 2=InProgress, 3=Completed */
  onboardingStatusId?: number;
  /** Last reached onboarding step (1-based) */
  currentOnboardingStep?: number;
  /**
   * Feature keys enabled for this tenant, mirrored from the
   * JWT `features` claim. Drives `TenantContextService`.
   */
  features?: string[];
  /**
   * How the session was authenticated. Drives setup-guard bypass and
   * hardware-shell separation. Optional to stay backwards compatible
   * with sessions created before the `/auth/me` contract shipped.
   */
  sessionType?: AuthSessionType;
}

/**
 * Shape of the JSON body for POST /api/auth/register.
 *
 * The landing handshake commits a single macro category; specific
 * sub-giros are captured later during the onboarding wizard and
 * persisted via `PUT /api/business/giro`.
 */
export interface RegisterRequest {
  businessName: string;
  ownerName: string;
  email: string;
  password: string;
  /** Primary macro FK — use MacroCategoryType enum */
  primaryMacroCategoryId: MacroCategoryType;
  /** Numeric plan FK — use PlanTypeId enum */
  planTypeId: PlanTypeId;
  /** ISO 3166-1 alpha-2 country code (e.g. 'MX') — drives tax engine defaults */
  countryCode: string;
  /**
   * IANA timezone id (e.g. 'America/Mexico_City', 'America/Tijuana').
   * Backend defaults to 'America/Mexico_City' when omitted.
   * Used to compute local day boundaries for reports and register cuts.
   */
  timeZoneId?: string;
}

/**
 * Shape of the JSON body returned by:
 *   - POST /api/auth/pin-login
 *   - POST /api/auth/email-login
 *   - GET  /api/auth/me  (rehydration)
 */
export interface LoginResponse {
  token: string;
  roleId: UserRoleId;
  name: string;
  businessId: number;
  branchId: number;
  branches: BranchInfo[];
  currentBranchId: number;
  /** Numeric plan FK */
  planTypeId: PlanTypeId;
  /** Primary macro FK — sub-giros are fetched separately when needed */
  primaryMacroCategoryId: MacroCategoryType;
  /** ISO date string — null if no trial */
  trialEndsAt?: string;
  /** 1=Pending, 2=InProgress, 3=Completed */
  onboardingStatusId?: number;
  /** Last reached onboarding step (1-based) */
  currentOnboardingStep?: number;
  /**
   * Feature keys enabled for this tenant — mirrors the JWT
   * `features` claim for convenience. Drives `TenantContextService`.
   */
  features?: string[];
  /** How this session was authenticated — see AuthSessionType. */
  sessionType?: AuthSessionType;
}

/** Shape of GET /api/subscription/status response */
export interface SubscriptionStatus {
  /** Numeric plan FK — use PlanTypeId enum */
  planTypeId: PlanTypeId;
  /** active | trialing | past_due | canceled */
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** Monthly | Annual */
  billingCycle: string | null;
}

/** localStorage keys for auth persistence */
export const AUTH_TOKEN_KEY = 'pos_auth_token';
export const AUTH_USER_KEY = 'pos_auth_user';
export const ACTIVE_BRANCH_KEY = 'pos_active_branch_id';
export const RETURN_URL_KEY = 'pos_return_url';
