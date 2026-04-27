import { Injectable, inject } from '@angular/core';

import { MacroCategoryType, UserRoleId } from '../enums';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';

/** Deterministic macro → POS experience mapping used as fallback. */
const MACRO_POS_EXPERIENCE: Record<MacroCategoryType, 'Restaurant' | 'Counter' | 'Retail' | 'Quick'> = {
  [MacroCategoryType.FoodBeverage]: 'Restaurant',
  [MacroCategoryType.QuickService]: 'Counter',
  [MacroCategoryType.Retail]:       'Retail',
  [MacroCategoryType.Services]:     'Quick',
};

/**
 * Result of `getPostLoginRoute` — a discriminated union so callers can
 * branch between a plain redirect and the "you signed in on a hardware
 * shell" error path without relying on sentinel strings.
 */
export type PostLoginRoute =
  | { kind: 'route'; route: string }
  | { kind: 'error'; error: 'hardware-shell'; mode: 'kitchen' | 'kiosk' };

/**
 * Determines the correct landing route after authentication
 * based on the user's role and the device's operating mode.
 *
 * Decouples role-based routing (who) from device-mode routing (where).
 */
@Injectable({ providedIn: 'root' })
export class DeviceRoutingService {

  private readonly authService = inject(AuthService);
  private readonly configService = inject(ConfigService);

  //#region Public API

  /**
   * Resolves the post-login landing route.
   *
   * @param roleId     Numeric role from the authenticated user.
   * @param deviceMode Optional device mode override (defaults to the
   *                   current device config). Hardware modes
   *                   (`kitchen`, `kiosk`) surface an error for
   *                   human-PIN roles because those shells are
   *                   device-authenticated only.
   */
  getPostLoginRoute(roleId: UserRoleId, deviceMode?: string): PostLoginRoute {
    const mode = deviceMode ?? this.configService.deviceConfig$.getValue().mode;

    // Back Office roles always land on /admin regardless of device mode —
    // an Owner signing in on a Reception tablet still expects management.
    if (roleId === UserRoleId.Owner || roleId === UserRoleId.Manager) {
      return { kind: 'route', route: '/admin' };
    }

    // Reception (member check-in) terminals route every operational role
    // straight to the access-control banner. Treated as a vertical-shell
    // override so Host / Cashier / Waiter all converge on the same screen.
    if (mode === 'reception') {
      return { kind: 'route', route: '/reception/access-control' };
    }

    switch (roleId) {
      case UserRoleId.Kitchen:
        // Kitchen role users exist, but the /kitchen shell is device-auth
        // only. Send them to /orders so they can triage tickets with the
        // human session; operators map this role to the KDS manually.
        return { kind: 'route', route: '/orders' };

      case UserRoleId.Host:
        return { kind: 'route', route: '/tables' };

      case UserRoleId.Waiter:
        if (mode === 'tables') return { kind: 'route', route: '/tables' };
        return { kind: 'route', route: '/pos/waiter' };

      case UserRoleId.Cashier: {
        if (mode === 'kitchen' || mode === 'kiosk') {
          return { kind: 'error', error: 'hardware-shell', mode };
        }
        if (mode === 'tables') return { kind: 'route', route: '/tables' };
        return { kind: 'route', route: this.resolvePosRoute() };
      }

      case UserRoleId.Kiosk: {
        if (mode === 'kitchen' || mode === 'kiosk') {
          return { kind: 'error', error: 'hardware-shell', mode };
        }
        return { kind: 'route', route: '/pin' };
      }

      default:
        return { kind: 'route', route: '/pin' };
    }
  }

  //#endregion

  //#region POS Route Resolution

  /**
   * Resolves the POS route variant based on the tenant's posExperience.
   *
   * Resolution order:
   *   1. configService.posExperience() — loaded from Dexie/API during preload
   *   2. Fallback: derive deterministically from the JWT macro category
   *   3. Last resort: /pos (Restaurant default)
   *
   * Public so the POS entry guard can reuse the same logic.
   */
  resolvePosRoute(): string {
    let experience = this.configService.posExperience();

    if (!experience) {
      const macroId = this.authService.primaryMacroCategoryId();
      if (macroId !== null) {
        experience = MACRO_POS_EXPERIENCE[macroId];
      }
    }

    switch (experience) {
      case 'Restaurant': return '/pos';
      case 'Retail':     return '/pos/retail';
      // 'Counter' posExperience now maps to Quick Service (standard ProductGrid)
      case 'Counter':    return '/pos/quick-service';
      case 'Quick':      return '/pos/quick';
      default:           return '/pos';
    }
  }

  //#endregion

}
