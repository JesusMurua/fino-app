import { Injectable, inject } from '@angular/core';

import { BusinessTypeId, UserRoleId } from '../enums';
import { BUSINESS_TYPE_LABELS } from '../enums/config.enum';
import { AuthService } from './auth.service';
import { CatalogService } from './catalog.service';
import { ConfigService } from './config.service';

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
  private readonly catalogService = inject(CatalogService);

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

  //#region Private Helpers

  /**
   * Resolves the POS route variant based on the business type's posExperience.
   *
   * Resolution order:
   *   1. configService.posExperience() — loaded from Dexie/API during preload
   *   2. Fallback: derive from authService.businessTypeId() using static catalog
   *   3. Last resort: /pos (Restaurant default)
   */
  private resolvePosRoute(): string {
    let experience = this.configService.posExperience();

    if (!experience) {
      const btId = this.authService.businessTypeId();
      const btCode = BusinessTypeId[btId]; // e.g. 'Restaurant'
      const catalog = this.catalogService.getBusinessType(btCode);
      experience = catalog?.posExperience;
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
