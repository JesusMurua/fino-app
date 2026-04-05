import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  BusinessTypeCatalog,
  DeviceModeCatalog,
  DisplayStatusCatalog,
  KitchenStatusCatalog,
  PaymentMethodCatalog,
  ZoneTypeCatalog,
} from '../models/catalog.model';
import {
  BUSINESS_TYPES,
  DEVICE_MODES,
  DISPLAY_STATUSES,
  KITCHEN_STATUSES,
  PAYMENT_METHODS,
  ZONE_TYPES,
} from '../models/catalog.constants';
import { ApiService } from './api.service';

/**
 * Provides system catalog data from the backend API.
 * Signals are initialized with hardcoded constants for offline support.
 * When the API responds, signals update with server values.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {

  //#region Properties

  private readonly api = inject(ApiService);

  readonly kitchenStatuses = signal<KitchenStatusCatalog[]>(KITCHEN_STATUSES);
  readonly displayStatuses = signal<DisplayStatusCatalog[]>(DISPLAY_STATUSES);
  readonly paymentMethods  = signal<PaymentMethodCatalog[]>(PAYMENT_METHODS);
  readonly deviceModes     = signal<DeviceModeCatalog[]>(DEVICE_MODES);
  readonly businessTypes   = signal<BusinessTypeCatalog[]>(BUSINESS_TYPES);
  readonly zoneTypes       = signal<ZoneTypeCatalog[]>(ZONE_TYPES);

  //#endregion

  //#region Public Methods

  /**
   * Loads all system catalogs from the API in parallel.
   * Uses Promise.allSettled so one failure doesn't block the others.
   * On failure, the constant fallback values remain in the signals.
   */
  async loadAll(): Promise<void> {
    const results = await Promise.allSettled([
      firstValueFrom(this.api.get<KitchenStatusCatalog[]>('/catalog/kitchen-statuses')),
      firstValueFrom(this.api.get<DisplayStatusCatalog[]>('/catalog/display-statuses')),
      firstValueFrom(this.api.get<PaymentMethodCatalog[]>('/catalog/payment-methods')),
      firstValueFrom(this.api.get<DeviceModeCatalog[]>('/catalog/device-modes')),
      firstValueFrom(this.api.get<BusinessTypeCatalog[]>('/catalog/business-types')),
      firstValueFrom(this.api.get<ZoneTypeCatalog[]>('/catalog/zone-types')),
    ]);

    if (results[0].status === 'fulfilled') this.kitchenStatuses.set(results[0].value);
    if (results[1].status === 'fulfilled') this.displayStatuses.set(results[1].value);
    if (results[2].status === 'fulfilled') this.paymentMethods.set(results[2].value);
    if (results[3].status === 'fulfilled') this.deviceModes.set(results[3].value);
    if (results[4].status === 'fulfilled') this.businessTypes.set(results[4].value);
    if (results[5].status === 'fulfilled') this.zoneTypes.set(results[5].value);
  }

  /** Returns display name for a kitchen status code */
  getKitchenStatusName(code: string): string {
    return this.kitchenStatuses().find(s => s.code === code)?.name ?? code;
  }

  /** Returns hex color for a kitchen status code */
  getKitchenStatusColor(code: string): string {
    return this.kitchenStatuses().find(s => s.code === code)?.color ?? '#6B7280';
  }

  /** Returns display name for a display status code */
  getDisplayStatusName(code: string): string {
    return this.displayStatuses().find(s => s.code === code)?.name ?? code;
  }

  /** Returns hex color for a display status code */
  getDisplayStatusColor(code: string): string {
    return this.displayStatuses().find(s => s.code === code)?.color ?? '#6B7280';
  }

  /** Returns display name for a payment method code */
  getPaymentMethodName(code: string): string {
    return this.paymentMethods().find(s => s.code === code)?.name ?? code;
  }

  /** Returns zone type config by code */
  getZoneType(code: string): ZoneTypeCatalog | undefined {
    return this.zoneTypes().find(s => s.code === code);
  }

  /** Returns business type config by code */
  getBusinessType(code: string): BusinessTypeCatalog | undefined {
    return this.businessTypes().find(s => s.code === code);
  }

  //#endregion

}
