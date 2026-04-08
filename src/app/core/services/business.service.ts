import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BusinessType, LoginResponse } from '../models';
import { ApiService } from './api.service';

/**
 * Manages business-level configuration: business type(s),
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

  //#region Business Type

  /**
   * Updates the business type(s) for the current business.
   * @param businessTypes Array of selected business types
   * @param customGiroDescription Free-text description when "Otra tienda" is selected
   */
  updateBusinessTypes(businessTypes: BusinessType[], customGiroDescription: string | null): Observable<void> {
    return this.api.put<void>('/business/type', { businessTypes, customGiroDescription });
  }

  //#endregion

}
