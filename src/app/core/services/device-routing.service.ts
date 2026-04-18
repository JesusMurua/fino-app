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
   * @param roleId Numeric role from the authenticated user
   * @param deviceMode Optional device mode override (defaults to current device config)
   */
  getPostLoginRoute(roleId: UserRoleId, deviceMode?: string): string {
    const mode = deviceMode ?? this.configService.deviceConfig$.getValue().mode;

    switch (roleId) {
      case UserRoleId.Owner:
      case UserRoleId.Manager:
        return '/admin';
      case UserRoleId.Kitchen:
        return '/kitchen';
      case UserRoleId.Host:
        return '/tables';
      case UserRoleId.Waiter:
        return mode === 'tables' ? '/tables' : this.resolvePosRoute();
      case UserRoleId.Cashier:
        if (mode === 'tables') return '/tables';
        if (mode === 'kitchen') return '/kitchen';
        return this.resolvePosRoute();
      default:
        return '/pin';
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
