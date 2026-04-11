import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { deviceAuthGuard } from './core/guards/device-auth.guard';
import { featureGuard } from './core/guards/feature.guard';
import { onboardingGuard } from './core/guards/onboarding.guard';
import { provisioningGuard } from './core/guards/provisioning.guard';
import { setupGuard } from './core/guards/setup.guard';
import { FeatureKey, UserRoleId } from './core/enums';

export const appRoutes: Routes = [
	{
		path: '',
		redirectTo: 'pin',
		pathMatch: 'full',
	},

	// --- Public routes (no guards or setupGuard only) ---
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
		canActivate: [setupGuard],
		loadComponent: () =>
			import('./modules/login/login.component').then((m) => m.LoginComponent),
	},
	{
		path: 'pin',
		canActivate: [setupGuard],
		loadComponent: () =>
			import('./modules/pin/pin.component').then((m) => m.PinComponent),
	},
	{
		path: 'kiosk',
		canActivate: [deviceAuthGuard, featureGuard],
		data: { requiredFeature: FeatureKey.KioskMode },
		loadChildren: () =>
			import('./modules/kiosk/kiosk.routes').then((m) => m.kioskRoutes),
	},

	// --- Protected routes (authGuard) ---
	{
		path: 'pos',
		canActivate: [authGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter] },
		loadChildren: () =>
			import('./modules/pos/pos.routes').then((m) => m.posRoutes),
	},
	{
		path: 'admin',
		canActivate: [authGuard, onboardingGuard],
		data: { roles: [UserRoleId.Owner, UserRoleId.Manager] },
		loadChildren: () =>
			import('./modules/admin/admin.routes').then((m) => m.adminRoutes),
	},
	{
		path: 'kitchen',
		canActivate: [deviceAuthGuard, featureGuard],
		data: {
			roles: [UserRoleId.Kitchen, UserRoleId.Owner, UserRoleId.Manager],
			requiredFeature: [FeatureKey.KdsBasic, FeatureKey.RealtimeKds],
		},
		loadChildren: () =>
			import('./modules/kitchen/kitchen.routes').then((m) => m.kitchenRoutes),
	},
	{
		path: 'orders',
		canActivate: [authGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Kitchen, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter] },
		loadChildren: () =>
			import('./modules/orders/orders.routes').then((m) => m.ordersRoutes),
	},
	{
		path: 'tables',
		canActivate: [authGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter, UserRoleId.Host] },
		loadComponent: () =>
			import('./modules/tables/tables.component').then(
				(m) => m.TablesComponent,
			),
	},

	// --- Catch-all (must be LAST) ---
	{
		path: '**',
		canActivate: [setupGuard],
		loadComponent: () =>
			import('./modules/pin/pin.component').then((m) => m.PinComponent),
	},
];
