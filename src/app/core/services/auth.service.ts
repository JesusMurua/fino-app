import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  ACTIVE_BRANCH_KEY,
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  AuthUser,
  BranchInfo,
  BusinessType,
  EmployeeHash,
  LoginResponse,
  PlanInfo,
  PlanType,
  RETURN_URL_KEY,
  SubscriptionStatus,
  sha256Hex,
} from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';

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

  /** Current subscription plan tier — restored from storage on init */
  readonly planType = signal<PlanType>(
    this.loadUserFromStorage()?.planType ?? PlanType.Free,
  );

  /** Current business vertical — restored from storage on init */
  readonly businessType = signal<BusinessType>(
    this.loadUserFromStorage()?.businessType ?? BusinessType.General,
  );

  /** Trial end date as ISO string — null if no trial */
  readonly trialEndsAt = signal<string | null>(
    this.loadUserFromStorage()?.trialEndsAt ?? null,
  );

  /** Computed plan metadata derived from plan signals */
  readonly planInfo = computed<PlanInfo>(() => {
    const endsAt = this.trialEndsAt();
    const now = new Date();
    const trialDate = endsAt ? new Date(endsAt) : null;
    return {
      planType: this.planType(),
      businessType: this.businessType(),
      trialEndsAt: endsAt ?? undefined,
      isOnTrial: trialDate ? trialDate > now : false,
      trialDaysLeft: trialDate
        ? Math.max(0, Math.ceil((trialDate.getTime() - now.getTime()) / 86_400_000))
        : 0,
      isPaid: this.planType() !== PlanType.Free,
    };
  });

  /** Cached subscription status from the API */
  readonly subscriptionStatus = signal<SubscriptionStatus | null>(null);

  /** True when the plan is expired — Free plan with trial ended or no trial */
  readonly isExpired = computed(() => {
    if (this.planType() !== PlanType.Free) return false;
    const trial = this.trialEndsAt();
    if (!trial) return true;
    return new Date(trial) < new Date();
  });

  //#endregion

  //#region Constructor
  constructor(
    private readonly api: ApiService,
    private readonly db: DatabaseService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Branch Access

  /**
   * Returns the current branch ID.
   * Reads from the activeBranchId signal — 0 before login (auth guards block access).
   */
  get branchId(): number {
    return this.activeBranchId();
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
   * Online-first with offline fallback:
   *   1. Try API → on success, sync hashes and return user
   *   2. On network failure → try offline Dexie lookup
   *   3. On 401 (wrong PIN) → return null (no fallback)
   * @param branchId Branch to authenticate against
   * @param pin 4-digit PIN string
   * @returns Object with user (or null) and whether auth was offline
   */
  async pinLogin(branchId: number, pin: string): Promise<{ user: AuthUser | null; offline: boolean }> {
    // 1. Try online auth
    try {
      const response = await firstValueFrom(
        this.api.post<LoginResponse>('/auth/pin-login', { branchId, pin }),
      );
      const user = this.handleLoginSuccess(response);

      // Sync employee hashes in background after successful online login
      this.syncEmployeeHashes(branchId).catch(() => {});

      return { user, offline: false };
    } catch (error: any) {
      const status = error?.status ?? 0;

      // 401 = wrong PIN — don't fall back to offline
      if (status === 401) {
        return { user: null, offline: false };
      }

      // Network error (status 0) or timeout — try offline
      console.warn('[AuthService] Online PIN login unavailable, trying offline:', error);
      const offlineUser = await this.offlinePinLogin(branchId, pin);
      return { user: offlineUser, offline: true };
    }
  }

  /**
   * Fetches employee PIN hashes from the API and stores them in Dexie.
   * Called after every successful online login to keep the cache fresh.
   * @param branchId Branch to fetch hashes for
   */
  async syncEmployeeHashes(branchId: number): Promise<void> {
    try {
      const hashes = await firstValueFrom(
        this.api.get<EmployeeHash[]>(`/auth/employee-hashes?branchId=${branchId}`),
      );
      await this.db.transaction('rw', this.db.employeeHashes, async () => {
        // Clear old hashes for this branch and replace with fresh ones
        await this.db.employeeHashes.where('branchId').equals(branchId).delete();
        if (hashes.length > 0) {
          await this.db.employeeHashes.bulkPut(hashes);
        }
      });
    } catch (error) {
      console.warn('[AuthService] Failed to sync employee hashes:', error);
    }
  }

  /**
   * Authenticates offline by hashing the PIN and comparing against Dexie.
   * Creates a local-only AuthUser (no real JWT) to enable the UI.
   * @param branchId Branch to authenticate against
   * @param pin 4-digit PIN string
   * @returns AuthUser on match, or null
   */
  private async offlinePinLogin(branchId: number, pin: string): Promise<AuthUser | null> {
    try {
      const pinHash = await sha256Hex(pin);
      const match = await this.db.employeeHashes
        .where({ branchId, pinHash })
        .first();

      if (!match) return null;

      // Build a local-only AuthUser — use a marker token so isAuthenticated works
      // but the interceptor knows not to send it to the API
      const user: AuthUser = {
        token: `offline-session-${Date.now()}`,
        role: match.role,
        name: match.name,
        businessId: 0,
        branchId,
        branches: [{ id: branchId, name: '' }],
        currentBranchId: branchId,
        planType: this.planType(),
        businessType: this.businessType(),
        trialEndsAt: this.trialEndsAt() ?? undefined,
      };

      localStorage.setItem(AUTH_TOKEN_KEY, user.token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      localStorage.setItem(ACTIVE_BRANCH_KEY, branchId.toString());
      this.currentUser.set(user);
      this.activeBranchId.set(branchId);

      return user;
    } catch (error) {
      console.error('[AuthService] Offline PIN login failed:', error);
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
    this.planType.set(PlanType.Free);
    this.businessType.set(BusinessType.General);
    this.trialEndsAt.set(null);

    // Clear cached catalog from IndexedDB (orders are preserved)
    this.db.products.clear().catch(() => {});
    this.db.categories.clear().catch(() => {});

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

  //#region Subscription

  /**
   * Fetches the current subscription status from the API and updates
   * planType/trialEndsAt signals if they have changed.
   * Silently fails on error — never throws.
   */
  async refreshSubscriptionStatus(): Promise<void> {
    try {
      const status = await firstValueFrom(
        this.api.get<SubscriptionStatus>('/subscription/status'),
      );

      this.subscriptionStatus.set(status);

      // Canceled or past_due → downgrade to Free
      const effectivePlan = (status.status === 'canceled' || status.status === 'past_due')
        ? PlanType.Free
        : (status.planType ?? PlanType.Free);

      const changed = effectivePlan !== this.planType()
        || (status.trialEndsAt ?? null) !== this.trialEndsAt();

      if (changed) {
        this.planType.set(effectivePlan);
        this.trialEndsAt.set(status.trialEndsAt ?? null);

        // Persist to localStorage
        const user = this.currentUser();
        if (user) {
          const updated = { ...user, planType: effectivePlan, trialEndsAt: status.trialEndsAt ?? undefined };
          this.currentUser.set(updated);
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
        }
      }
    } catch (error: any) {
      // 404 = endpoint not implemented yet — silently ignore
      if (error?.status !== 404) {
        console.warn('[AuthService] Failed to refresh subscription status:', error);
      }
    }
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
   * Public so register flow can call it with the registration response.
   */
  handleLoginSuccess(response: LoginResponse): AuthUser {
    const responseBranchId = response.currentBranchId ?? response.branchId;
    // Preserve the user's last-selected branch across re-authentication
    const storedBranchId = parseInt(localStorage.getItem(ACTIVE_BRANCH_KEY) ?? '', 10);
    const effectiveBranchId = storedBranchId || responseBranchId;

    const user: AuthUser = {
      token: response.token,
      role: response.role,
      name: response.name,
      businessId: response.businessId,
      branchId: response.branchId,
      branches: response.branches ?? [],
      currentBranchId: effectiveBranchId,
      planType: response.planType ?? PlanType.Free,
      businessType: response.businessType ?? BusinessType.General,
      trialEndsAt: response.trialEndsAt,
    };

    localStorage.setItem(AUTH_TOKEN_KEY, user.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    localStorage.setItem(ACTIVE_BRANCH_KEY, effectiveBranchId.toString());
    this.currentUser.set(user);
    this.activeBranchId.set(effectiveBranchId);
    this.planType.set(user.planType);
    this.businessType.set(user.businessType);
    this.trialEndsAt.set(user.trialEndsAt ?? null);

    return user;
  }

  /**
   * Restores the active branch ID from localStorage.
   * Priority: ACTIVE_BRANCH_KEY → user.currentBranchId → user.branchId → 0.
   */
  private loadStoredBranchId(): number {
    const stored = localStorage.getItem(ACTIVE_BRANCH_KEY);
    if (stored) return parseInt(stored, 10) || 0;
    const user = this.loadUserFromStorage();
    return user?.currentBranchId || user?.branchId || 0;
  }

  /**
   * Restores user from localStorage on service creation.
   * Returns null if the stored token is missing, malformed, or expired.
   */
  private loadUserFromStorage(): AuthUser | null {
    try {
      const raw = localStorage.getItem(AUTH_USER_KEY);
      if (!raw) return null;
      const user: AuthUser = JSON.parse(raw);
      if (!user.token || !user.role) return null;
      if (this.isTokenExpired(user.token)) return null;
      return user;
    } catch {
      return null;
    }
  }

  /**
   * Checks whether a JWT is expired by decoding its payload.
   * Uses native atob() — no external libraries needed.
   * Returns true if the token is expired or cannot be decoded.
   */
  private isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(atob(parts[1]));
      if (!payload.exp) return true;
      return Date.now() / 1000 > payload.exp;
    } catch {
      return true;
    }
  }

  //#endregion

}
