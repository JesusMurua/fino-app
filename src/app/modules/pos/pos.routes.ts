import { Routes } from '@angular/router';

export const posRoutes: Routes = [
  {
    path: '',
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
    path: 'counter',
    loadComponent: () =>
      import('./components/counter-pos/counter-pos.component')
        .then(m => m.CounterPosComponent),
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
