import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';

import { RETURN_URL_KEY } from '../models';
import { AuthService } from '../services/auth.service';

/** URL prefixes that belong to the Back Office surface (email entry). */
const BACK_OFFICE_PREFIXES = ['/admin', '/settings'] as const;

/** True when the requested URL targets a Back Office surface. */
function isBackOfficeUrl(url: string): boolean {
  return BACK_OFFICE_PREFIXES.some(prefix => url === prefix || url.startsWith(`${prefix}/`));
}

/**
 * Identity gate — validates that the user has a live session and has
 * finished the onboarding wizard. No role checks, no hardware checks.
 *
 *   1. Not authenticated:
 *      - Stores the FULL attempted URL in RETURN_URL_KEY (not just the
 *        route definition) so deep links survive login.
 *      - Redirects to `/login` for Back Office surfaces (`/admin`,
 *        `/settings`), `/pin` for terminal surfaces.
 *   2. Onboarding pending → redirect to /onboarding.
 *
 * Role-based access is enforced by `roleGuard`; terminal provisioning
 * is enforced by `terminalGuard`. Compose them in route config.
 */
export const authGuard: CanActivateFn = (_route, state: RouterStateSnapshot) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    localStorage.setItem(RETURN_URL_KEY, state.url || '/');
    const entry = isBackOfficeUrl(state.url) ? '/login' : '/pin';
    return router.createUrlTree([entry]);
  }

  if (!authService.isOnboardingComplete()) {
    return router.createUrlTree(['/onboarding']);
  }

  return true;
};
