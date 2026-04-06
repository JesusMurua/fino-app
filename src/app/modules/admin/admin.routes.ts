import { Routes } from '@angular/router';

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
        loadComponent: () =>
          import('./components/reports/reports.component')
            .then(m => m.ReportsComponent),
      },
      {
        path: 'tables',
        loadComponent: () =>
          import('./components/tables/admin-tables.component')
            .then(m => m.AdminTablesComponent),
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./components/inventory/admin-inventory-shell.component')
            .then(m => m.AdminInventoryShellComponent),
      },
      {
        path: 'recipes',
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
        path: 'cash',
        loadComponent: () =>
          import('./components/cash-register/cash-register.component')
            .then(m => m.CashRegisterComponent),
      },
      {
        path: 'registers',
        loadComponent: () =>
          import('./components/admin-registers/admin-registers.component')
            .then(m => m.AdminRegistersComponent),
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
        loadComponent: () =>
          import('./components/invoicing/admin-invoicing.component')
            .then(m => m.AdminInvoicingComponent),
      },
    ],
  },
];
