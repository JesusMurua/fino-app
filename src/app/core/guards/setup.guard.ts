import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ConfigService } from '../services/config.service';

/**
 * Ensures the device has been configured before accessing /pin or /login.
 * If the device has no businessId/branchId → redirects to /setup.
 */
export const setupGuard: CanActivateFn = () => {
  const configService = inject(ConfigService);
  const router = inject(Router);

  if (!configService.isDeviceConfigured()) {
    return router.createUrlTree(['/setup']);
  }

  return true;
};
