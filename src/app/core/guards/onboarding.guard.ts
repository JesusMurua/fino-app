import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * Redirects to /onboarding if the current user hasn't completed
 * the onboarding wizard. Delegates the actual check to
 * AuthService.isOnboardingComplete (single source of truth).
 *
 * Applied AFTER authGuard — user is guaranteed authenticated.
 */
export const onboardingGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isOnboardingComplete()
    ? true
    : router.createUrlTree(['/onboarding']);
};
