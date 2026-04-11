import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';

import { RETURN_URL_KEY } from '../models';
import { UserRoleId, isBackOfficeRole } from '../enums';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

/**
 * Role-based route guard with onboarding and device setup checks.
 *
 * Guard priority:
 *   1. If user is not authenticated → redirect to /pin
 *   2. If onboarding not completed → redirect to /onboarding
 *   3. If device is not configured → redirect to /setup
 *      EXCEPTION: Back Office roles (Owner/Manager) navigating to
 *      /admin routes skip this check — the laptop used to read
 *      reports does not need to be provisioned as a POS terminal.
 *   4. If authenticated but wrong role → redirect to /pin
 */
export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
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

  // 3. Device configuration check — skipped for Back Office roles on /admin.
  //    Rationale: Owners and Managers must reach the dashboard from any
  //    browser without binding a physical register. Selling flows (/pos)
  //    still enforce the device check below for every role.
  const userRoleId = authService.currentUser()?.roleId;
  const isAdminRoute = state.url.startsWith('/admin');
  const skipDeviceCheck = isBackOfficeRole(userRoleId) && isAdminRoute;

  if (!skipDeviceCheck && !configService.isDeviceConfigured()) {
    return router.createUrlTree(['/setup']);
  }

  // 4. Role check
  const allowedRoles: UserRoleId[] = route.data['roles'] ?? [];

  if (allowedRoles.length > 0 && (!userRoleId || !allowedRoles.includes(userRoleId))) {
    return router.createUrlTree(['/pin']);
  }

  return true;
};
