import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { UserRoleId, isBackOfficeRole } from '../enums';
import { AuthService } from '../services/auth.service';

/**
 * Permissions gate — validates that the authenticated user's role is in
 * the allow-list declared via `route.data['roles']`. When the `roles`
 * array is missing or empty the guard is a no-op.
 *
 * Denial strategy: Back Office roles get bounced to /admin (their home),
 * everyone else falls back to /pin so they can re-authenticate under a
 * different identity. There is no dedicated /unauthorized screen today.
 *
 * This guard carries NO session or hardware logic — always compose it
 * after `authGuard` and before `terminalGuard`.
 */
export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const allowedRoles: UserRoleId[] = route.data['roles'] ?? [];
  if (allowedRoles.length === 0) return true;

  const roleId = authService.currentUser()?.roleId;
  if (roleId && allowedRoles.includes(roleId)) return true;

  const fallback = isBackOfficeRole(roleId) ? '/admin' : '/pin';
  return router.createUrlTree([fallback]);
};
