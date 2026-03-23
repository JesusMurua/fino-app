import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';

export const appRoutes: Routes = [
  {
    path: '',
    redirectTo: 'pin',
    pathMatch: 'full',
  },
  {
    path: 'pos',
    canActivate: [authGuard],
    data: { roles: ['Cashier', 'Owner'] },
    loadChildren: () =>
      import('./modules/pos/pos.routes').then(m => m.posRoutes),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    data: { roles: ['Owner'] },
    loadChildren: () =>
      import('./modules/admin/admin.routes').then(m => m.adminRoutes),
  },
  {
    path: 'kitchen',
    canActivate: [authGuard],
    data: { roles: ['Kitchen', 'Owner'] },
    loadChildren: () =>
      import('./modules/kitchen/kitchen.routes').then(m => m.kitchenRoutes),
  },
  {
    path: 'orders',
    canActivate: [authGuard],
    data: { roles: ['Cashier', 'Kitchen', 'Owner'] },
    loadChildren: () =>
      import('./modules/orders/orders.routes').then(m => m.ordersRoutes),
  },
  {
    path: 'tables',
    canActivate: [authGuard],
    data: { roles: ['Cashier', 'Owner'] },
    loadComponent: () =>
      import('./modules/tables/tables.component').then(m => m.TablesComponent),
  },
  {
    path: 'pin',
    loadComponent: () =>
      import('./modules/pin/pin.component').then(m => m.PinComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./modules/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'kiosk',
    loadChildren: () =>
      import('./modules/kiosk/kiosk.routes').then(m => m.kioskRoutes),
  },
  {
    path: '**',
    redirectTo: 'pin',
  },
];
