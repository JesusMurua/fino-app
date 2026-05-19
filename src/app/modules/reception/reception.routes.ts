import { Routes } from '@angular/router';

export const receptionRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/access-kiosk/access-kiosk.component')
        .then(m => m.AccessKioskComponent),
  },
];
