import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { UserRoleId } from '../enums';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

/**
 * Protects the /setup route from unauthorized re-provisioning.
 *
 * - Device NOT configured → allow access (first-time setup)
 * - Device already configured → only Owner/Manager can re-provision
 * - All other roles → redirect to /pin
 */
export const provisioningGuard: CanActivateFn = () => {
  const configService = inject(ConfigService);
  const authService = inject(AuthService);
  const router = inject(Router);

  // First-time setup: device not configured yet — allow access
  if (!configService.isDeviceConfigured()) {
    return true;
  }

  // Device already configured — only Owner/Manager can re-provision
  const roleId = authService.currentUser()?.roleId;
  if (roleId === UserRoleId.Owner || roleId === UserRoleId.Manager) {
    return true;
  }

  // Block everyone else — redirect to /pin
  return router.createUrlTree(['/pin']);
};
