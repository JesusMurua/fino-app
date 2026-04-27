import { inject } from '@angular/core';
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
import { LAST_AUTH_ENTRY_KEY } from './core/models';
import { ConfigService } from './core/services/config.service';

/**
 * Smart entry redirect for `''` and `'**'` routes.
 *
 * Order of preference:
 *   1. If localStorage records the browser was last on the email entry
 *      (Owner / Manager) → `/login`.
 *   2. Else, if a device has been provisioned on this browser → `/pin`
 *      (terminal entry — Cashier / Waiter / Host / Kitchen).
 *   3. Else, fall back to `/login` — safest for fresh installs because
 *      the device hasn't been paired yet, so a PIN-only flow can't run
 *      and an Owner needs the email entry to provision via codes.
 *
 * Runs in the router's DI context (same as `CanActivateFn`), so
 * `inject()` is valid here.
 */
function entryRedirect(): string {
  const configService = inject(ConfigService);
  const lastEntry = localStorage.getItem(LAST_AUTH_ENTRY_KEY);

  if (lastEntry === 'email') return '/login';
  if (configService.isDeviceConfigured()) return '/pin';
  return '/login';
}

export const appRoutes: Routes = [
	{
		path: '',
		redirectTo: entryRedirect,
		pathMatch: 'full',
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

	// --- Catch-all: route-aware redirect — Back Office users go to /login,
	//     terminal-bound browsers go to /pin, fresh installs default to /login ---
	{
		path: '**',
		redirectTo: entryRedirect,
	},
];
