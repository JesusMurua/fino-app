import { Routes } from '@angular/router';

export const posRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/restaurant-hub/restaurant-hub.component')
        .then(m => m.RestaurantHubComponent),
  },
  {
    path: 'quick-service',
    loadComponent: () =>
      import('./components/product-grid/product-grid.component')
        .then(m => m.ProductGridComponent),
  },
  {
    path: 'add-meal/:id',
    loadComponent: () =>
      import('./components/product-detail/product-detail.component')
        .then(m => m.ProductDetailComponent),
  },
  {
    path: 'checkout',
    loadComponent: () =>
      import('./components/checkout/checkout.component')
        .then(m => m.CheckoutComponent),
  },
  {
    path: 'retail',
    loadComponent: () =>
      import('./components/retail-pos/retail-pos.component')
        .then(m => m.RetailPosComponent),
  },
  {
    path: 'waiter',
    loadComponent: () =>
      import('./components/waiter-pos/waiter-pos.component')
        .then(m => m.WaiterPosComponent),
  },
  {
    path: 'quick',
    loadComponent: () =>
      import('./components/quick-pos/quick-pos.component')
        .then(m => m.QuickPosComponent),
  },
  {
    path: 'error-config',
    loadComponent: () =>
      import('./components/error-config/error-config.component')
        .then(m => m.ErrorConfigComponent),
  },
];
