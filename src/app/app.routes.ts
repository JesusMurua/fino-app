import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { onboardingGuard } from './core/guards/onboarding.guard';
import { setupGuard } from './core/guards/setup.guard';

export const appRoutes: Routes = [
  {
    path: '',
    redirectTo: 'pin',
    pathMatch: 'full',
  },
  {
    path: 'pos',
    canActivate: [authGuard],
    data: { roles: ['Cashier', 'Owner', 'Manager', 'Waiter'] },
    loadChildren: () =>
      import('./modules/pos/pos.routes').then(m => m.posRoutes),
  },
  {
    path: 'admin',
    canActivate: [authGuard, onboardingGuard],
    data: { roles: ['Owner', 'Manager'] },
    loadChildren: () =>
      import('./modules/admin/admin.routes').then(m => m.adminRoutes),
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./modules/onboarding/onboarding.component').then(m => m.OnboardingComponent),
  },
  {
    path: 'kitchen',
    canActivate: [authGuard],
    data: { roles: ['Kitchen', 'Owner', 'Manager'] },
    loadChildren: () =>
      import('./modules/kitchen/kitchen.routes').then(m => m.kitchenRoutes),
  },
  {
    path: 'orders',
    canActivate: [authGuard],
    data: { roles: ['Cashier', 'Kitchen', 'Owner', 'Manager', 'Waiter'] },
    loadChildren: () =>
      import('./modules/orders/orders.routes').then(m => m.ordersRoutes),
  },
  {
    path: 'tables',
    canActivate: [authGuard],
    data: { roles: ['Cashier', 'Owner', 'Manager', 'Waiter'] },
    loadComponent: () =>
      import('./modules/tables/tables.component').then(m => m.TablesComponent),
  },
  {
    path: 'pin',
    canActivate: [setupGuard],
    loadComponent: () =>
      import('./modules/pin/pin.component').then(m => m.PinComponent),
  },
  {
    path: 'login',
    canActivate: [setupGuard],
    loadComponent: () =>
      import('./modules/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./modules/register/register.component').then(m => m.RegisterComponent),
  },
  {
    path: 'setup',
    loadComponent: () =>
      import('./modules/setup/setup.component').then(m => m.SetupComponent),
  },
  {
    path: 'kiosk',
    loadChildren: () =>
      import('./modules/kiosk/kiosk.routes').then(m => m.kioskRoutes),
  },
  {
    path: '**',
    canActivate: [setupGuard],
    loadComponent: () =>
      import('./modules/pin/pin.component').then(m => m.PinComponent),
  },
];
