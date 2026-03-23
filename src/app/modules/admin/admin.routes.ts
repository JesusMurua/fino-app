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
        path: 'cash',
        loadComponent: () =>
          import('./components/cash-register/cash-register.component')
            .then(m => m.CashRegisterComponent),
      },
    ],
  },
];
