import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

const ONBOARDING_KEY_PREFIX = 'onboarding-completed-';

/**
 * Redirects to /onboarding if the current user hasn't completed
 * the onboarding wizard.
 *
 * Two skip conditions (OR):
 *   1. localStorage 'onboarding-completed-{branchId}' exists
 *   2. JWT claim onboardingCompleted === 'true'
 *
 * Applied AFTER authGuard — user is guaranteed authenticated.
 */
export const onboardingGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const branchId = authService.branchId;

  // Check 1: localStorage
  if (localStorage.getItem(`${ONBOARDING_KEY_PREFIX}${branchId}`) === 'true') {
    return true;
  }

  // Check 2: JWT claim
  const token = authService.getToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.onboardingCompleted === 'true' || payload.onboardingCompleted === true) {
        // Sync to localStorage for future fast checks
        localStorage.setItem(`${ONBOARDING_KEY_PREFIX}${branchId}`, 'true');
        return true;
      }
    } catch {
      // Token decode failed — continue to onboarding
    }
  }

  return router.createUrlTree(['/onboarding']);
};
