import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { isBackOfficeRole } from '../enums';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

/**
 * Ensures the device has been configured before rendering the PIN numpad
 * or the legacy login route.
 *
 * Bypass rules (per FDD-013):
 *   1. Email-authenticated sessions (`sessionType === 'email'`) come in
 *      from a browser and must never be trapped by device provisioning.
 *   2. Back Office roles (Owner / Manager) follow the same bypass even
 *      without a `sessionType` claim, so legacy sessions keep working.
 *
 * Default flow for everyone else:
 *   - No device config → redirect to /setup.
 *   - Kiosk mode device → redirect to /kiosk (no human PIN needed).
 *   - Otherwise → allow.
 */
export const setupGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const configService = inject(ConfigService);
  const router = inject(Router);

  if (authService.sessionType() === 'email') return true;
  if (isBackOfficeRole(authService.currentUser()?.roleId)) return true;

  if (!configService.isDeviceConfigured()) {
    return router.createUrlTree(['/setup']);
  }

  if (configService.deviceConfig$.getValue().mode === 'kiosk') {
    return router.createUrlTree(['/kiosk']);
  }

  return true;
};
