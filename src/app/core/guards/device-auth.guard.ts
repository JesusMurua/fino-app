import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { UserRoleId } from '../enums';
import { AuthService } from '../services/auth.service';
import { DeviceService } from '../services/device.service';

/**
 * Route guard for infrastructure screens that may operate without a
 * human logged in (KDS, Kiosk).
 *
 * Resolution order:
 *   1. A valid device token is present → allow access immediately.
 *      The machine is authenticated against the backend via its own
 *      long-lived JWT, so no PIN/email login is required.
 *
 *   2. A human user is logged in AND their role is allowed by the
 *      route's `data.roles` (or no role restriction is declared) →
 *      allow access. This preserves the legacy flow where a Kitchen
 *      user enters a PIN to reach /kitchen, so existing provisioning
 *      still works while the device-token rollout lands.
 *
 *   3. Neither → redirect to /setup so the device can be provisioned.
 */
export const deviceAuthGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const deviceService = inject(DeviceService);
  const authService = inject(AuthService);
  const router = inject(Router);

  // 1. Device token — preferred path for 24/7 infrastructure
  if (deviceService.hasValidDeviceToken()) {
    return true;
  }

  // 2. Backward-compat: an authenticated human with the right role
  if (authService.isAuthenticated()) {
    const allowedRoles: UserRoleId[] = route.data['roles'] ?? [];
    const userRoleId = authService.currentUser()?.roleId;

    if (allowedRoles.length === 0) return true;
    if (userRoleId && allowedRoles.includes(userRoleId)) return true;
  }

  // 3. Neither — the device needs to be provisioned first.
  //    `reason=unbound` lets the setup screen show a distinctive
  //    "Dispositivo no vinculado" state instead of the generic
  //    first-time setup copy.
  return router.createUrlTree(['/setup'], { queryParams: { reason: 'unbound' } });
};
