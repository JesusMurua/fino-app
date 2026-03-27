import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ConfigService } from '../services/config.service';

/**
 * Ensures the device has been configured before accessing /pin or /login.
 * If the device has no businessId/branchId → redirects to /setup.
 * If the device is in kiosk mode → redirects to /kiosk (no PIN needed).
 */
export const setupGuard: CanActivateFn = () => {
  const configService = inject(ConfigService);
  const router = inject(Router);

  if (!configService.isDeviceConfigured()) {
    return router.createUrlTree(['/setup']);
  }

  if (configService.deviceConfig$.getValue().mode === 'kiosk') {
    return router.createUrlTree(['/kiosk']);
  }

  return true;
};
