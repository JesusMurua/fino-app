import { Routes } from '@angular/router';

import { FeatureKey } from '../../core/enums';
import { featureGuard } from '../../core/guards/feature.guard';
import { posEntryGuard } from '../../core/guards/pos-entry.guard';

export const posRoutes: Routes = [
  {
    path: '',
    canActivate: [posEntryGuard],
    loadComponent: () =>
      import('./pages/restaurant-hub/restaurant-hub.component')
        .then(m => m.RestaurantHubComponent),
  },
  {
    // Unified "chameleon" POS — single shell for non-F&B macros (Retail,
    // Counter, Quick, Services). View mode (keypad ↔ grid) is driven by
    // `PosViewModeService` and seeded from the tenant's `PosExperience`.
    // F&B remains on `/pos` (RestaurantHubComponent) — see AUDIT-052
    // for the bounded-context rationale.
    path: 'sell',
    loadComponent: () =>
      import('./components/unified-pos/unified-pos.component')
        .then(m => m.UnifiedPosComponent),
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
    path: 'waiter',
    canActivate: [featureGuard],
    data: { requiredFeature: FeatureKey.WaiterApp },
    loadComponent: () =>
      import('./components/waiter-pos/waiter-pos.component')
        .then(m => m.WaiterPosComponent),
  },
  {
    path: 'error-config',
    loadComponent: () =>
      import('./components/error-config/error-config.component')
        .then(m => m.ErrorConfigComponent),
  },
];
