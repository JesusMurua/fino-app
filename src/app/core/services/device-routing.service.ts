import { Injectable, inject } from '@angular/core';

import { MacroCategoryType, UserRoleId } from '../enums';
import { PosExperience } from '../models/catalog.model';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Deterministic macro → POS experience mapping used as fallback when
 * neither the tenant context nor the branch config can answer. The
 * Services macro maps to `'Quick'` here for backwards compatibility
 * with the offline catalog seed; the resolver also accepts `'Services'`
 * straight from the backend (see the switch in `resolvePosRoute`).
 */
const MACRO_POS_EXPERIENCE: Record<MacroCategoryType, PosExperience> = {
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
  | { kind: 'error'; error: 'hardware-shell'; mode: 'kitchen' | 'kiosk' | 'reception' };

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
  private readonly tenantContext = inject(TenantContextService);

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

    switch (roleId) {
      case UserRoleId.Host:
        return { kind: 'route', route: '/tables' };

      case UserRoleId.Waiter:
        if (mode === 'tables') return { kind: 'route', route: '/tables' };
        return { kind: 'route', route: '/pos/waiter' };

      case UserRoleId.Cashier: {
        if (mode === 'kitchen' || mode === 'kiosk' || mode === 'reception') {
          return { kind: 'error', error: 'hardware-shell', mode };
        }
        if (mode === 'tables') return { kind: 'route', route: '/tables' };
        return { kind: 'route', route: this.resolvePosRoute() };
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
   * Resolution order (most reliable first):
   *   1. `tenantContext.posExperience()` — derived from the hydrated
   *      sub-category + business-type catalog. Most authoritative when
   *      the sub-giro fetch has resolved, because it is keyed by the
   *      tenant's actual business type, not a macro-level approximation.
   *   2. `configService.posExperience()` — loaded from Dexie/branch API
   *      during preload. Reflects whatever the backend stored on the
   *      branch row.
   *   3. `MACRO_POS_EXPERIENCE[macroId]` — deterministic fallback from
   *      the JWT macro category. Covers the cold-boot window before the
   *      sub-giro fetch resolves and acts as a safety net when the
   *      branch config is missing the field entirely.
   *   4. Neutral fail-safe — `/pos/quick` (a generic product grid that
   *      lets the cashier sell). The legacy fallback was `/pos` (the
   *      Restaurant Hub) which silently dropped Services / Retail
   *      tenants into a tables view they did not configure (AUDIT-049).
   *
   * Public so the POS entry guard can reuse the same logic.
   */
  resolvePosRoute(): string {
    let experience: PosExperience | undefined =
      this.tenantContext.posExperience() ?? this.configService.posExperience();

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
      // 'Services' is the canonical value emitted by the backend for the
      // Services macro; the offline catalog still emits 'Quick' for the
      // same tenants, so we accept both as synonyms in this PR.
      case 'Quick':
      case 'Services':   return '/pos/quick';
      default:
        console.warn(
          '[DeviceRouting] No POS experience resolved — falling back to /pos/quick. ' +
          'Check the branch config and JWT `macroCategory` claim for the active tenant.',
        );
        return '/pos/quick';
    }
  }

  //#endregion

}
