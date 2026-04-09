import { BusinessTypeId, PlanTypeId, UserRoleId } from '../enums';

/** Branch summary returned in the login response */
export interface BranchInfo {
  id: number;
  name: string;
}

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
  /** Numeric business type FK — use BusinessTypeId enum */
  businessTypeId: BusinessTypeId;
  /** ISO date string — null if no trial */
  trialEndsAt?: string;
  /** 1=Pending, 2=InProgress, 3=Completed */
  onboardingStatusId?: number;
  /** Last reached onboarding step (1-based) */
  currentOnboardingStep?: number;
}

/** Shape of the JSON body returned by POST /api/auth/pin-login and /api/auth/email-login */
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
  /** Numeric business type FK */
  businessTypeId: BusinessTypeId;
  /** ISO date string — null if no trial */
  trialEndsAt?: string;
  /** 1=Pending, 2=InProgress, 3=Completed */
  onboardingStatusId?: number;
  /** Last reached onboarding step (1-based) */
  currentOnboardingStep?: number;
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
