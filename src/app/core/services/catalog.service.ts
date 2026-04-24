import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { FeatureKey, PlanTypeId } from '../enums';
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
import { PLAN_CATALOG } from '../models/catalog.fallback';
import { PricingTier } from '../models/plan-catalog.model';
import { ApiService } from './api.service';

/**
 * Shape returned by `GET /api/catalog/plans`. Backend is SSOT for the
 * feature manifest per tier; commercial metadata (prices, Stripe IDs,
 * badges) stays on the client in `PLAN_CATALOG` and is merged on top.
 */
interface PlanCatalogDto {
  planTypeId: PlanTypeId;
  features: string[];
}

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

  /** Backend-delivered feature manifest, keyed by planTypeId. Null until fetched. */
  private readonly _planApiFeatures = signal<Map<PlanTypeId, FeatureKey[]> | null>(null);

  /**
   * Live pricing catalog — commercial metadata from `PLAN_CATALOG`
   * (prices, badges, stripePriceIds) merged with the backend's
   * authoritative feature list. Falls back to the static catalog when
   * the API is unreachable so the UI always has something to render.
   */
  readonly planCatalog = computed<readonly PricingTier[]>(() => {
    const apiFeatures = this._planApiFeatures();
    if (!apiFeatures) return PLAN_CATALOG;

    return PLAN_CATALOG.map(tier => {
      const fromApi = apiFeatures.get(tier.planTypeId);
      return fromApi ? { ...tier, features: fromApi } : tier;
    });
  });

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
      firstValueFrom(this.api.get<PlanCatalogDto[]>('/catalog/plans')),
    ]);

    if (results[0].status === 'fulfilled') this.kitchenStatuses.set(results[0].value);
    if (results[1].status === 'fulfilled') this.displayStatuses.set(results[1].value);
    if (results[2].status === 'fulfilled') this.paymentMethods.set(results[2].value);
    if (results[3].status === 'fulfilled') this.deviceModes.set(results[3].value);
    if (results[4].status === 'fulfilled') this.businessTypes.set(results[4].value);
    if (results[5].status === 'fulfilled') this.zoneTypes.set(results[5].value);
    if (results[6].status === 'fulfilled') this._planApiFeatures.set(this.parsePlanDto(results[6].value));
  }

  /**
   * Fetches only the plan catalog on demand. Used by callers that
   * cannot wait for `loadAll()` (e.g. upgrade surfaces that need the
   * freshest feature list after an entitlement change). Silent on
   * failure — fallback static catalog remains in place.
   */
  async fetchPlanCatalog(): Promise<void> {
    try {
      const dto = await firstValueFrom(this.api.get<PlanCatalogDto[]>('/catalog/plans'));
      this._planApiFeatures.set(this.parsePlanDto(dto));
    } catch {
      // Fallback stays in effect; not surfaced to the user.
    }
  }

  /**
   * Validates backend feature strings against the `FeatureKey` enum and
   * drops unknowns. Keeps the contract one-way: the client enum is the
   * authoritative list of renderable features.
   */
  private parsePlanDto(dto: PlanCatalogDto[]): Map<PlanTypeId, FeatureKey[]> {
    const known = new Set<string>(Object.values(FeatureKey));
    const result = new Map<PlanTypeId, FeatureKey[]>();
    for (const entry of dto) {
      const valid = entry.features.filter(f => known.has(f)) as FeatureKey[];
      result.set(entry.planTypeId, valid);
    }
    return result;
  }

  /** Returns display name for a kitchen status ID */
  getKitchenStatusName(id: number): string {
    return this.kitchenStatuses().find(s => s.id === id)?.name ?? `ID ${id}`;
  }

  /** Returns hex color for a kitchen status ID */
  getKitchenStatusColor(id: number): string {
    return this.kitchenStatuses().find(s => s.id === id)?.color ?? '#6B7280';
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
