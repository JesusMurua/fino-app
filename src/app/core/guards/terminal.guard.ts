import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { isBackOfficeRole } from '../enums';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

/**
 * Gate for operational routes that require a provisioned physical terminal
 * (/pos, /tables, /orders).
 *
 * Back Office roles (Owner/Manager) bypass the hardware check — they can
 * reach these screens from any browser without binding the machine as a
 * POS register. Every other role is bounced to /setup when the device has
 * no businessId/branchId configured.
 *
 * This guard carries NO identity or role-permission logic — run it after
 * `authGuard` (session + onboarding) and `roleGuard` (roles allow-list).
 */
export const terminalGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const configService = inject(ConfigService);
  const router = inject(Router);

  if (isBackOfficeRole(authService.currentUser()?.roleId)) {
    return true;
  }

  if (!configService.isDeviceConfigured()) {
    return router.parseUrl('/setup');
  }

  return true;
};
