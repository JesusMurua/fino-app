import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';

import { PlanTypeId } from '../enums';
import { PLAN_DISPLAY_NAME, PLAN_HIERARCHY } from '../models';
import { AuthService } from '../services/auth.service';

/**
 * Plan-tier route guard.
 *
 * Blocks access to premium routes when the current business plan does not
 * meet or exceed the route's `requiredPlan`. Redirects to `/admin/upgrade`
 * and shows a toast explaining the required tier.
 *
 * Usage in route config:
 *   { path: 'invoicing', canActivate: [planGuard], data: { requiredPlan: PlanTypeId.Pro } }
 */
export const planGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const authService = inject(AuthService);
  const messageService = inject(MessageService);
  const router = inject(Router);

  const requiredPlan: PlanTypeId | undefined = route.data['requiredPlan'];
  if (requiredPlan === undefined) return true;

  const currentPlan = authService.planTypeId();
  const currentLevel = PLAN_HIERARCHY[currentPlan] ?? 0;
  const requiredLevel = PLAN_HIERARCHY[requiredPlan] ?? 0;

  if (currentLevel >= requiredLevel) return true;

  messageService.add({
    severity: 'warn',
    summary: 'Función bloqueada',
    detail: `Esta función requiere Plan ${PLAN_DISPLAY_NAME[requiredPlan]}.`,
    life: 5000,
  });

  return router.createUrlTree(['/admin/upgrade']);
};
