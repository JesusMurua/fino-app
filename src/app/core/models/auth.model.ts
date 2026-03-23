/** Roles returned by the API — PascalCase to match backend enum */
export type UserRole = 'Owner' | 'Manager' | 'Cashier' | 'Kitchen' | 'Waiter' | 'Kiosk';

/** Authenticated user state held in AuthService */
export interface AuthUser {
  role: UserRole;
  name: string;
  branchId: number;
  token: string;
}

/** Shape of the JSON body returned by POST /api/auth/pin-login and /api/auth/email-login */
export interface LoginResponse {
  token: string;
  role: UserRole;
  name: string;
  branchId: number;
}

/** localStorage keys for auth persistence */
export const AUTH_TOKEN_KEY = 'pos_auth_token';
export const AUTH_USER_KEY = 'pos_auth_user';
export const RETURN_URL_KEY = 'pos_return_url';
