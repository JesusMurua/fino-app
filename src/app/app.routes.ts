import { Routes } from '@angular/router';

import { adminShellGuard } from './core/guards/admin-shell.guard';
import { authGuard } from './core/guards/auth.guard';
import { deviceAuthGuard } from './core/guards/device-auth.guard';
import { featureGuard } from './core/guards/feature.guard';
import { posShellGuard } from './core/guards/pos-shell.guard';
import { provisioningGuard } from './core/guards/provisioning.guard';
import { roleGuard } from './core/guards/role.guard';
import { setupGuard } from './core/guards/setup.guard';
import { taxConfigGuard } from './core/guards/tax-config.guard';
import { terminalGuard } from './core/guards/terminal.guard';
import { welcomeShownGuard } from './core/guards/welcome-shown.guard';
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
		// First-Run Experience — shown once after onboarding completes
		// (either via the wizard or via the super-admin direct-alta flow).
		// authGuard guarantees a session; welcomeShownGuard is NOT applied
		// here (would loop). Marking welcome shown happens inside the
		// WelcomeComponent itself.
		path: 'welcome',
		canActivate: [authGuard],
		loadComponent: () =>
			import('./modules/welcome/welcome.component').then(
				(m) => m.WelcomeComponent,
			),
	},
	{
		path: 'login',
		loadComponent: () =>
			import('./modules/login/login.component').then((m) => m.LoginComponent),
	},
	{
		// Cross-domain impersonation handoff. The super-admin emits a
		// short-lived Owner JWT and navigates here with `#token=<jwt>`;
		// the component seeds the session and forwards to the back office.
		// No `authGuard` — bootstrapping a session is the whole point.
		path: 'auth/handoff',
		loadComponent: () =>
			import('./modules/auth-handoff/auth-handoff.component').then(
				(m) => m.AuthHandoffComponent,
			),
	},
	{
		path: 'pin',
		canActivate: [setupGuard],
		loadComponent: () =>
			import('./modules/pin/pin.component').then((m) => m.PinComponent),
	},

	// --- Setup-required splash (staff sees this when defaultTaxId is missing) ---
	// Bookmarkable / shareable lazy-loaded splash. Shown by `taxConfigGuard`
	// to non-admin roles when business config is incomplete. Admins are
	// redirected to `/admin/dashboard` (sticky banner there).
	{
		path: 'setup-required',
		canActivate: [authGuard],
		loadComponent: () =>
			import('./modules/setup-required/setup-required.component').then(
				(m) => m.SetupRequiredComponent,
			),
	},

	// --- Machine-only routes (device token, no human session) ---
	{
		path: 'kiosk',
		canActivate: [deviceAuthGuard, featureGuard, taxConfigGuard],
		data: { requiredFeature: FeatureKey.MaxKiosks },
		loadChildren: () =>
			import('./modules/kiosk/kiosk.routes').then((m) => m.kioskRoutes),
	},
	{
		path: 'kitchen',
		canActivate: [deviceAuthGuard, featureGuard],
		data: {
			// MaxKdsScreens is the gate for the kitchen mode (quantitative
			// quota — backend enforces actual limits via 403 on activation).
			// RealtimeKds is an internal toggle layered on top, dictating
			// whether KDS uses SignalR sockets vs polling — not an access
			// gate, so it stays out of the route guard.
			requiredFeature: FeatureKey.MaxKdsScreens,
		},
		loadChildren: () =>
			import('./modules/kitchen/kitchen.routes').then((m) => m.kitchenRoutes),
	},

	// --- Back Office (identity + permissions, no hardware) ---
	{
		path: 'admin',
		canActivate: [authGuard, welcomeShownGuard, roleGuard, adminShellGuard],
		data: { roles: [UserRoleId.Owner, UserRoleId.Manager] },
		loadChildren: () =>
			import('./modules/admin/admin.routes').then((m) => m.adminRoutes),
	},

	// --- Operational routes (identity + permissions + terminal) ---
	{
		path: 'pos',
		canActivate: [authGuard, welcomeShownGuard, roleGuard, terminalGuard, posShellGuard, taxConfigGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter] },
		loadChildren: () =>
			import('./modules/pos/pos.routes').then((m) => m.posRoutes),
	},
	{
		path: 'orders',
		canActivate: [authGuard, welcomeShownGuard, roleGuard, terminalGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter] },
		loadChildren: () =>
			import('./modules/orders/orders.routes').then((m) => m.ordersRoutes),
	},
	{
		path: 'tables',
		canActivate: [authGuard, welcomeShownGuard, roleGuard, terminalGuard, taxConfigGuard],
		data: { roles: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter, UserRoleId.Host] },
		loadComponent: () =>
			import('./modules/tables/tables.component').then(
				(m) => m.TablesComponent,
			),
	},
	{
		path: 'reception',
		// Reception is a wall-mounted, unattended check-in screen — same
		// architectural pattern as /kiosk and /kitchen. Device-token only,
		// no human PIN session involved. Quota enforced backend-side via
		// MaxReceptionsPerBranch (per-branch scope, see monetization doc).
		canActivate: [deviceAuthGuard, featureGuard],
		data: { requiredFeature: FeatureKey.MaxReceptionsPerBranch },
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
