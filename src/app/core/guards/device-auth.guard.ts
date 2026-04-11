import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { DeviceService } from '../services/device.service';

/**
 * Route guard for infrastructure screens (KDS, Kiosk) that operate 24/7
 * without a human logged in.
 *
 * Zero-fallback policy: access is granted if and only if a valid device
 * token is present in localStorage. Under NO circumstance is a logged-in
 * human session used to authorize an infrastructure route — an
 * unprovisioned machine is rebounced to the setup screen with a
 * `reason=unbound` hint so the UI can render the distinctive
 * "Dispositivo no vinculado" copy.
 */
export const deviceAuthGuard: CanActivateFn = () => {
  const deviceService = inject(DeviceService);
  const router = inject(Router);

  if (deviceService.hasValidDeviceToken()) {
    return true;
  }

  return router.createUrlTree(['/setup'], {
    queryParams: { reason: 'unbound' },
  });
};
