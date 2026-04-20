import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionRehydrationService } from '../services/session-rehydration.service';

/**
 * Fires a `/auth/me` refresh before the Back Office shell renders so
 * that a stale `onboardingCompleted` flag cannot bounce the user to
 * `/onboarding` right after they finished onboarding on another device.
 *
 * Compose AFTER `authGuard` and `roleGuard` — we only need to hit the
 * network when the session is already authenticated and allowed to
 * reach `/admin`.
 *
 * Outcomes:
 *   - `ok` / `stale-ok` → allow traversal.
 *   - `unauthorized`    → `SessionRehydrationService` already cleared
 *                         the session; send the user to /pin.
 *   - `no-session`      → defensive fallback to /pin.
 */
export const adminShellGuard: CanActivateFn = async () => {
  const rehydration = inject(SessionRehydrationService);
  const router = inject(Router);

  const result = await rehydration.hydrateForShell('admin');

  if (result === 'unauthorized' || result === 'no-session') {
    return router.createUrlTree(['/pin']);
  }

  return true;
};
