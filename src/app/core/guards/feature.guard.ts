import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';

import { FeatureKey } from '../enums';
import { TenantContextService } from '../services/tenant-context.service';

/**
 * Feature-based route guard.
 *
 * Reads `route.data['requiredFeature']` — a single `FeatureKey` or an
 * array for OR logic — and checks it against the current
 * `TenantContextService.activeFeatures` set. When the tenant lacks
 * every candidate feature, the guard shows a toast and redirects to
 * the upgrade page.
 *
 * Usage in route config:
 *   // Single feature
 *   {
 *     path: 'invoicing',
 *     canActivate: [featureGuard],
 *     data: { requiredFeature: FeatureKey.CfdiInvoicing }
 *   }
 *
 *   // OR logic — any of the listed features unlocks the route
 *   {
 *     path: 'kitchen',
 *     canActivate: [featureGuard],
 *     data: { requiredFeature: [FeatureKey.KdsBasic, FeatureKey.RealtimeKds] }
 *   }
 */
export const featureGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const tenantContext = inject(TenantContextService);
  const messageService = inject(MessageService);
  const router = inject(Router);

  const required: FeatureKey | readonly FeatureKey[] | undefined =
    route.data['requiredFeature'];

  if (required === undefined) return true;

  const required$ = Array.isArray(required) ? required : [required as FeatureKey];
  if (required$.length === 0) return true;

  if (tenantContext.hasAnyFeature(required$)) return true;

  messageService.add({
    severity: 'warn',
    summary: 'Función bloqueada',
    detail: 'Esta función no está disponible en tu plan actual.',
    life: 5000,
  });

  return router.createUrlTree(['/admin/upgrade']);
};
