import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { RETURN_URL_KEY, UserRole } from '../models';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

/**
 * Role-based route guard with onboarding and device setup checks.
 *
 * Guard priority:
 *   1. If user is not authenticated → redirect to /pin
 *   2. If onboarding not completed → redirect to /onboarding
 *   3. If device is not configured → redirect to /setup
 *   4. If authenticated but wrong role → redirect to /pin
 */
export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const configService = inject(ConfigService);
  const router = inject(Router);

  // 1. Authentication check
  if (!authService.isAuthenticated()) {
    localStorage.setItem(RETURN_URL_KEY, route.routeConfig?.path ?? '/');
    return router.createUrlTree(['/pin']);
  }

  // 2. Onboarding check
  if (!authService.isOnboardingComplete()) {
    return router.createUrlTree(['/onboarding']);
  }

  // 3. Device configuration check
  if (!configService.isDeviceConfigured()) {
    return router.createUrlTree(['/setup']);
  }

  // 4. Role check
  const allowedRoles: UserRole[] = route.data['roles'] ?? [];
  const userRole = authService.currentUser()?.role;

  if (allowedRoles.length > 0 && (!userRole || !allowedRoles.includes(userRole))) {
    return router.createUrlTree(['/pin']);
  }

  return true;
};
