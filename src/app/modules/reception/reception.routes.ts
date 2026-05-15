import { Routes } from '@angular/router';

export const receptionRoutes: Routes = [
  {
    path: '',
    redirectTo: 'access-control',
    pathMatch: 'full',
  },
  {
    path: 'access-control',
    loadComponent: () =>
      import('./pages/access-control/access-control.component')
        .then(m => m.AccessControlComponent),
  },
];
