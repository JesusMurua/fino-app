import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { DeviceRoutingService } from '../services/device-routing.service';

/**
 * Deterministic POS entry guard.
 *
 * When a user navigates directly to `/pos` (sidebar link, bookmark, URL bar),
 * this guard resolves the correct POS variant for their business type and
 * redirects there. Without this guard, the empty-path route would always
 * load RestaurantHubComponent regardless of the tenant's posExperience.
 *
 * The same resolution logic runs at login (via DeviceRoutingService), but
 * this guard ensures protection against direct navigation.
 */
export const posEntryGuard: CanActivateFn = () => {
  const router = inject(Router);
  const deviceRouting = inject(DeviceRoutingService);

  const target = deviceRouting.resolvePosRoute();

  // If the resolved route IS `/pos` itself, allow through to avoid
  // an infinite redirect loop — RestaurantHub is the correct default
  // for Restaurant business types.
  if (target === '/pos') return true;

  return router.createUrlTree([target]);
};
