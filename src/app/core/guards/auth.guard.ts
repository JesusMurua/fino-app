import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { RETURN_URL_KEY } from '../models';
import { AuthService } from '../services/auth.service';

/**
 * Identity gate — validates that the user has a live session and has
 * finished the onboarding wizard. No role checks, no hardware checks.
 *
 *   1. Not authenticated → redirect to /pin, storing the attempted URL
 *      in RETURN_URL_KEY so post-login routing can resume.
 *   2. Onboarding pending → redirect to /onboarding.
 *
 * Role-based access is enforced by `roleGuard`; terminal provisioning
 * is enforced by `terminalGuard`. Compose them in route config.
 */
export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    localStorage.setItem(RETURN_URL_KEY, route.routeConfig?.path ?? '/');
    return router.createUrlTree(['/pin']);
  }

  if (!authService.isOnboardingComplete()) {
    return router.createUrlTree(['/onboarding']);
  }

  return true;
};
