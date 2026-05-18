import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BusinessGiroResponse, BusinessSettings, LoginResponse, UpdateBusinessGiroRequest, UpdateBusinessSettingsRequest } from '../models';
import { ApiService } from './api.service';

/**
 * Manages business-level configuration: giro (macro + sub-giros),
 * onboarding step sync, and onboarding completion.
 */
@Injectable({ providedIn: 'root' })
export class BusinessService {

  //#region Properties
  private readonly api = inject(ApiService);
  //#endregion

  //#region Onboarding

  /**
   * Syncs the current onboarding step to the backend.
   * Fire-and-forget — callers should not block on this.
   * @param statusId 1=Pending, 2=InProgress, 3=Completed
   * @param step Current step number (1-based)
   */
  syncOnboardingStep(statusId: number, step: number): Observable<void> {
    return this.api.put<void>('/business/onboarding-step', { statusId, step });
  }

  /**
   * Marks onboarding as complete. Returns a new LoginResponse
   * with an updated JWT (onboardingStatusId=3).
   */
  completeOnboarding(): Observable<LoginResponse> {
    return this.api.post<LoginResponse>('/business/complete-onboarding', {});
  }

  //#endregion

  //#region Business Giro

  /**
   * Idempotent write of the tenant's giro selection — the macro category
   * plus any number of sub-giros (with optional free-text for "Otra").
   *
   * Safe to call multiple times; the backend replaces the current set on
   * each call. The onboarding wizard invokes this between Step 1 and
   * Step 2 so the tenant context is reconciled before plan selection.
   *
   * @param payload Primary macro + sub-giro ids + optional custom text
   */
  updateGiro(payload: UpdateBusinessGiroRequest): Observable<void> {
    return this.api.put<void>('/business/giro', payload);
  }

  /**
   * Reads the current giro selection so the onboarding wizard can hydrate
   * its signals on re-entry. Returns the server snapshot — may have a
   * `null` macro and empty sub-giros when the user has not yet passed
   * Step 1.
   */
  getGiro(): Observable<BusinessGiroResponse> {
    return this.api.get<BusinessGiroResponse>('/business/giro');
  }

  //#endregion

  //#region Business Settings (Fiscal)

  /**
   * Reads the tenant's business settings — used by `TenantContextService`
   * during post-auth hydration to populate `defaultTaxId` and any future
   * tenant-scoped configuration. Returns the server snapshot.
   */
  getSettings(): Observable<BusinessSettings> {
    return this.api.get<BusinessSettings>('/business/settings');
  }

  /**
   * Persists the business settings — currently scoped to `defaultTaxId`
   * but extensible. Mandatory on the write side: the UI must validate
   * the dropdown selection before invoking. The backend rejects null.
   */
  updateSettings(payload: UpdateBusinessSettingsRequest): Observable<void> {
    return this.api.put<void>('/business/settings', payload);
  }

  //#endregion
}
