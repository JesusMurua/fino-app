import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { RETURN_URL_KEY, UserRole } from '../models';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

/**
 * Role-based route guard with device setup check.
 *
 * Guard priority:
 *   1. If device is not configured → redirect to /setup
 *   2. If user is not authenticated → redirect to /pin
 *   3. If authenticated but wrong role → redirect to /pin
 */
export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const configService = inject(ConfigService);
  const router = inject(Router);

  if (!configService.isDeviceConfigured()) {
    return router.createUrlTree(['/setup']);
  }

  if (!authService.isAuthenticated()) {
    localStorage.setItem(RETURN_URL_KEY, route.routeConfig?.path ?? '/');
    return router.createUrlTree(['/pin']);
  }

  const allowedRoles: UserRole[] = route.data['roles'] ?? [];
  const userRole = authService.currentUser()?.role;

  if (allowedRoles.length > 0 && (!userRole || !allowedRoles.includes(userRole))) {
    return router.createUrlTree(['/pin']);
  }

  return true;
};
