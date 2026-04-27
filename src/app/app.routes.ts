import { Routes } from '@angular/router';

import { adminShellGuard } from './core/guards/admin-shell.guard';
import { authGuard } from './core/guards/auth.guard';
import { deviceAuthGuard } from './core/guards/device-auth.guard';
import { featureGuard } from './core/guards/feature.guard';
import { posShellGuard } from './core/guards/pos-shell.guard';
import { provisioningGuard } from './core/guards/provisioning.guard';
import { roleGuard } from './core/guards/role.guard';
import { setupGuard } from './core/guards/setup.guard';
import { terminalGuard } from './core/guards/terminal.guard';
import { FeatureKey, UserRoleId } from './core/enums';

export const appRoutes: Routes = [
	// --- Root: dual-entry Auth Portal (Back Office vs Operational) ---
	{
		path: '',
		pathMatch: 'full',
		loadComponent: () =>
			import('./modules/auth-portal/auth-portal.component').then(
				(m) => m.AuthPortalComponent,
			),
	},

	// --- Public routes ---
	{
		path: 'register',
		loadComponent: () =>
			import('./modules/register/register.component').then(
				(m) => m.RegisterComponent,
			),
	},
	{
		path: 'setup',
		canActivate: [provisioningGuard],
		loadComponent: () =>
			import('./modules/setup/setup.component').then((m) => m.SetupComponent),
	},
	{
		path: 'onboarding',
		loadComponent: () =>
			import('./modules/onboarding/onboarding.component').then(
				(m) => m.OnboardingComponent,
			),
	},
	{
		path: 'login',
		loadComponent: () =>
			import('./modules/login/login.component').then((m) => m.LoginComponent),
	},
	{
		path: 'pin',
		canActivate: [setupGuard],
		loadComponent: () =>
			import('./modules/pin/pin.component').then((m) => m.PinComponent),
	},

	// --- Machine-only routes (device token, no human session) ---
	{
		path: 'kiosk',
		canActivate: [deviceAuthGuard, featureGuard],
		data: { requiredFeature: FeatureKey.KioskMode },
		loadChildren: () =>
			import('./modules/kiosk/kiosk.routes').then((m) => m.kioskRoutes),
	},
	{
		path: 'kitchen',
		canActivate: [deviceAuthGuard, featureGuard],
		data: {
			requiredFeature: [FeatureKey.KdsBasic, FeatureKey.RealtimeKds],
		},
		loadChildren: () =>
			import('./modules/kitchen/kitchen.routes').then((m) => m.kitchenRoutes),
	},

	// --- Back Office (identity + permissions, no hardware) ---
	{
		path: 'admin',
		canActivate: [authGuard, roleGuard, adminShellGuard],
		data: { roles: [UserRoleId.Owner, UserRoleId.Manager] },
		loadChildren: () =>
			import('./modules/admin/admin.routes').then((m) => m.adminRoutes),
	},

	// --- Operational routes (identity + permissions + terminal) ---
	{
		path: 'pos',
		canActivate: [authGuard, roleGuard, terminalGuard, posShellGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter] },
		loadChildren: () =>
			import('./modules/pos/pos.routes').then((m) => m.posRoutes),
	},
	{
		path: 'orders',
		canActivate: [authGuard, roleGuard, terminalGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Kitchen, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter] },
		loadChildren: () =>
			import('./modules/orders/orders.routes').then((m) => m.ordersRoutes),
	},
	{
		path: 'tables',
		canActivate: [authGuard, roleGuard, terminalGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter, UserRoleId.Host] },
		loadComponent: () =>
			import('./modules/tables/tables.component').then(
				(m) => m.TablesComponent,
			),
	},
	{
		path: 'reception',
		canActivate: [authGuard, roleGuard, terminalGuard],
		data: { roles: [UserRoleId.Host, UserRoleId.Cashier, UserRoleId.Manager, UserRoleId.Owner] },
		loadChildren: () =>
			import('./modules/reception/reception.routes').then((m) => m.receptionRoutes),
	},

	// --- Catch-all: send unknown URLs back to the Auth Portal so the user
	//     re-picks an entry consciously instead of being silently rerouted. ---
	{
		path: '**',
		redirectTo: '',
	},
];
