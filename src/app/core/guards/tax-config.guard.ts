import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';

import { UserRoleId } from '../enums';
import { AuthService } from '../services/auth.service';
import { TenantContextService } from '../services/tenant-context.service';

/**
 * Pre-condition guard for routes that depend on a configured tenant
 * default tax: `/pos/**`, `/tables`, `/kiosk`. Runs **before**
 * `posEntryGuard` in the `canActivate` chain so a missing config
 * short-circuits before the variant resolver fires.
 *
 * Logic:
 *   1. Await `tenantContext.ensureHydrated()` so `business()` and the
 *      tax catalog are settled before deciding (no false positives
 *      during the post-login race window).
 *   2. If `business().defaultTaxId` is non-null, allow.
 *   3. Otherwise, fire an ephemeral toast and redirect:
 *      - Owner / Manager → `/admin/dashboard` (sticky banner there)
 *      - Cashier / Waiter / Host → `/setup-required` splash
 *
 * Errors thrown here propagate to the router, so the redirect path is
 * always returned as a `UrlTree` rather than via `router.navigate`,
 * keeping the navigation atomic.
 */
export const taxConfigGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const tenantContext = inject(TenantContextService);
  const authService = inject(AuthService);
  const messageService = inject(MessageService);

  await tenantContext.ensureHydrated();

  const settings = tenantContext.business();
  if (settings && settings.defaultTaxId !== null && settings.defaultTaxId !== undefined) {
    return true;
  }

  const roleId = authService.currentUser()?.roleId;
  const isAdminish = roleId === UserRoleId.Owner || roleId === UserRoleId.Manager;

  messageService.add({
    severity: 'error',
    summary: 'Caja bloqueada',
    detail: isAdminish
      ? 'Configura los impuestos por defecto antes de operar.'
      : 'Pídele al administrador que configure los impuestos.',
    life: 5000,
  });

  return router.createUrlTree([isAdminish ? '/admin/dashboard' : '/setup-required']);
};
