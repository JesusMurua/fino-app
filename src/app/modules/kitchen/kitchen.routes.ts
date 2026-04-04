import { Routes } from '@angular/router';

export const kitchenRoutes: Routes = [
  {
    path: ':destinationId',
    loadComponent: () =>
      import('./kitchen-display.component').then(m => m.KitchenDisplayComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./kitchen-display.component').then(m => m.KitchenDisplayComponent),
  },
];
