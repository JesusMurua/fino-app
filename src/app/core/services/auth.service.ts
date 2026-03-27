import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  ACTIVE_BRANCH_KEY,
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  AuthUser,
  BranchInfo,
  LoginResponse,
  RETURN_URL_KEY,
} from '../models';
import { ApiService } from './api.service';

/**
 * Manages authentication state for the POS application.
 *
 * Two login methods:
 *   - PIN login (cashiers, kitchen staff) → POST /api/auth/pin-login
 *   - Email login (owners) → POST /api/auth/email-login
 *
 * Token and user are persisted in localStorage so sessions survive refresh.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {

  //#region Properties

  /** Current authenticated user — null when logged out */
  readonly currentUser = signal<AuthUser | null>(this.loadUserFromStorage());

  /** True when a user is authenticated with a valid token */
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  /** Branches available for the current user */
  readonly availableBranches = computed<BranchInfo[]>(() =>
    this.currentUser()?.branches ?? [],
  );

  /**
   * Reactive branch ID — components use effect() on this signal
   * to reload data when the active branch changes.
   * Restores from localStorage so the last-selected branch persists
   * across navigation and page refreshes.
   */
  readonly activeBranchId = signal<number>(
    this.loadStoredBranchId(),
  );

  //#endregion

  //#region Constructor
  constructor(
    private readonly api: ApiService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Branch Access

  /**
   * Returns the current branch ID.
   * Reads from the activeBranchId signal for consistency.
   * Falls back to 1 when no user is logged in.
   */
  get branchId(): number {
    return this.activeBranchId() || 1;
  }

  /**
   * Sets the active branch locally and persists it.
   * Components with effect() on activeBranchId will reload automatically.
   * @param branchId Branch ID to activate
   */
  setActiveBranch(branchId: number): void {
    this.activeBranchId.set(branchId);
    localStorage.setItem(ACTIVE_BRANCH_KEY, branchId.toString());
    const user = this.currentUser();
    if (user) {
      const updated = { ...user, currentBranchId: branchId };
      this.currentUser.set(updated);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
    }
  }

  /**
   * Switches the active branch for the current user.
   * Calls the backend to get a new token scoped to the target branch,
   * then updates the local auth state (including activeBranchId signal).
   * @param branchId Branch to switch to
   */
  async switchBranch(branchId: number): Promise<void> {
    const response = await firstValueFrom(
      this.api.post<LoginResponse>('/auth/switch-branch', { branchId }),
    );
    // Write the target branch BEFORE handleLoginSuccess so it takes priority
    localStorage.setItem(ACTIVE_BRANCH_KEY, branchId.toString());
    if (!response.currentBranchId) {
      response.currentBranchId = branchId;
    }
    this.handleLoginSuccess(response);
  }

  //#endregion

  //#region Login Methods

  /**
   * Authenticates via 4-digit PIN (cashiers, kitchen staff).
   * @param branchId Branch to authenticate against
   * @param pin 4-digit PIN string
   * @returns The authenticated user on success, or null on failure
   */
  async pinLogin(branchId: number, pin: string): Promise<AuthUser | null> {
    try {
      const response = await firstValueFrom(
        this.api.post<LoginResponse>('/auth/pin-login', { branchId, pin }),
      );
      return this.handleLoginSuccess(response);
    } catch (error) {
      console.error('[AuthService] PIN login failed:', error);
      return null;
    }
  }

  /**
   * Authenticates via email and password (owners).
   * @param email User email
   * @param password User password
   * @returns The authenticated user on success, or null on failure
   */
  async emailLogin(email: string, password: string): Promise<AuthUser | null> {
    try {
      const response = await firstValueFrom(
        this.api.post<LoginResponse>('/auth/email-login', { email, password }),
      );
      return this.handleLoginSuccess(response);
    } catch (error) {
      console.error('[AuthService] Email login failed:', error);
      return null;
    }
  }

  /**
   * Clears auth state and redirects to /pin.
   */
  logout(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(ACTIVE_BRANCH_KEY);
    this.currentUser.set(null);
    this.activeBranchId.set(0);
    this.router.navigate(['/pin']);
  }

  /**
   * Returns the stored token, or null if not authenticated.
   * Used by the auth interceptor to attach Bearer headers.
   */
  getToken(): string | null {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  /**
   * Consumes and clears the saved return URL (set by AuthGuard on redirect).
   * @returns The URL the user was trying to reach, or null
   */
  consumeReturnUrl(): string | null {
    const url = localStorage.getItem(RETURN_URL_KEY);
    if (url) localStorage.removeItem(RETURN_URL_KEY);
    return url;
  }

  //#endregion

  //#region Private Helpers

  /**
   * Persists auth state after a successful login response.
   */
  /**
   * Persists auth state after a successful login response.
   * Preserves the previously selected branch if one was stored,
   * so re-authenticating via PIN doesn't reset the active branch.
   */
  private handleLoginSuccess(response: LoginResponse): AuthUser {
    const responseBranchId = response.currentBranchId ?? response.branchId;
    // Preserve the user's last-selected branch across re-authentication
    const storedBranchId = parseInt(localStorage.getItem(ACTIVE_BRANCH_KEY) ?? '', 10);
    const effectiveBranchId = storedBranchId || responseBranchId;

    const user: AuthUser = {
      token: response.token,
      role: response.role,
      name: response.name,
      branchId: response.branchId,
      branches: response.branches ?? [],
      currentBranchId: effectiveBranchId,
    };

    localStorage.setItem(AUTH_TOKEN_KEY, user.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    localStorage.setItem(ACTIVE_BRANCH_KEY, effectiveBranchId.toString());
    this.currentUser.set(user);
    this.activeBranchId.set(effectiveBranchId);

    return user;
  }

  /**
   * Restores the active branch ID from localStorage.
   * Falls back to the user's currentBranchId, then 0.
   */
  private loadStoredBranchId(): number {
    const stored = localStorage.getItem(ACTIVE_BRANCH_KEY);
    if (stored) return parseInt(stored, 10) || 0;
    return this.loadUserFromStorage()?.currentBranchId ?? 0;
  }

  /**
   * Restores user from localStorage on service creation.
   */
  private loadUserFromStorage(): AuthUser | null {
    try {
      const raw = localStorage.getItem(AUTH_USER_KEY);
      if (!raw) return null;
      const user: AuthUser = JSON.parse(raw);
      if (!user.token || !user.role) return null;
      return user;
    } catch {
      return null;
    }
  }

  //#endregion

}
