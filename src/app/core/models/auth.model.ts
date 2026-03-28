import { BusinessType, PlanType } from './plan.model';

/** Roles returned by the API — PascalCase to match backend enum */
export type UserRole = 'Owner' | 'Manager' | 'Cashier' | 'Kitchen' | 'Waiter' | 'Kiosk';

/** Branch summary returned in the login response */
export interface BranchInfo {
  id: number;
  name: string;
}

/** Authenticated user state held in AuthService */
export interface AuthUser {
  role: UserRole;
  name: string;
  branchId: number;
  token: string;
  branches: BranchInfo[];
  currentBranchId: number;
  /** Subscription plan tier */
  planType: PlanType;
  /** Business vertical */
  businessType: BusinessType;
  /** ISO date string — null if no trial */
  trialEndsAt?: string;
}

/** Shape of the JSON body returned by POST /api/auth/pin-login and /api/auth/email-login */
export interface LoginResponse {
  token: string;
  role: UserRole;
  name: string;
  branchId: number;
  branches: BranchInfo[];
  currentBranchId: number;
  /** Subscription plan tier */
  planType?: PlanType;
  /** Business vertical */
  businessType?: BusinessType;
  /** ISO date string — null if no trial */
  trialEndsAt?: string;
}

/** localStorage keys for auth persistence */
export const AUTH_TOKEN_KEY = 'pos_auth_token';
export const AUTH_USER_KEY = 'pos_auth_user';
export const ACTIVE_BRANCH_KEY = 'pos_active_branch_id';
export const RETURN_URL_KEY = 'pos_return_url';
