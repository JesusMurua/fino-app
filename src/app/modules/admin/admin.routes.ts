import { Routes } from '@angular/router';

import { FeatureKey } from '../../core/enums';
import { featureGuard } from '../../core/guards/feature.guard';

export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./admin-shell.component').then(m => m.AdminShellComponent),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./components/dashboard/dashboard.component')
            .then(m => m.DashboardComponent),
      },
      {
        path: 'products',
        loadComponent: () =>
          import('./components/products/admin-products.component')
            .then(m => m.AdminProductsComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./components/settings/admin-settings.component')
            .then(m => m.AdminSettingsComponent),
      },
      {
        path: 'reports',
        canActivate: [featureGuard],
        data: { requiredFeature: FeatureKey.AdvancedReports },
        loadComponent: () =>
          import('./components/reports/reports.component')
            .then(m => m.ReportsComponent),
      },
      {
        path: 'upgrade',
        loadComponent: () =>
          import('./components/upgrade/upgrade.component')
            .then(m => m.UpgradeComponent),
      },
      {
        path: 'tables',
        loadComponent: () =>
          import('./components/tables/admin-tables.component')
            .then(m => m.AdminTablesComponent),
      },
      {
        path: 'inventory',
        canActivate: [featureGuard],
        data: { requiredFeature: [FeatureKey.RecipeInventory, FeatureKey.MultiWarehouseInventory] },
        loadComponent: () =>
          import('./components/inventory/admin-inventory-shell.component')
            .then(m => m.AdminInventoryShellComponent),
      },
      {
        path: 'recipes',
        canActivate: [featureGuard],
        data: { requiredFeature: FeatureKey.RecipeInventory },
        loadComponent: () =>
          import('./components/recipes/admin-recipes.component')
            .then(m => m.AdminRecipesComponent),
      },
      {
        path: 'promotions',
        loadComponent: () =>
          import('./components/promotions/admin-promotions.component')
            .then(m => m.AdminPromotionsComponent),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./components/users/admin-users.component')
            .then(m => m.AdminUsersComponent),
      },
      {
        path: 'devices',
        loadComponent: () =>
          import('./components/devices/admin-devices.component')
            .then(m => m.AdminDevicesComponent),
      },
      {
        // Accessible to Owner and Manager — inherits `/admin` guards which
        // already enforce `roles: [Owner, Manager]` (see app.routes.ts).
        path: 'branches',
        loadComponent: () =>
          import('./components/branches/admin-branches.component')
            .then(m => m.AdminBranchesComponent),
      },
      {
        path: 'cash',
        redirectTo: 'registers',
        pathMatch: 'full',
      },
      {
        // Core: every business with a POS has at least 1 cash register
        // and needs to open/close shifts. MultiTill is enforced granularly
        // inside the component on the "Nueva caja" button only.
        path: 'registers',
        loadComponent: () =>
          import('./components/cajas-container/cajas-container.component')
            .then(m => m.CajasContainerComponent),
      },
      {
        path: 'reservations',
        loadComponent: () =>
          import('./components/reservations/reservations.component')
            .then(m => m.ReservationsComponent),
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./components/customers/admin-customers.component')
            .then(m => m.AdminCustomersComponent),
      },
      {
        path: 'invoicing',
        canActivate: [featureGuard],
        data: { requiredFeature: FeatureKey.CfdiInvoicing },
        loadComponent: () =>
          import('./components/invoicing/admin-invoicing.component')
            .then(m => m.AdminInvoicingComponent),
      },
    ],
  },
];
