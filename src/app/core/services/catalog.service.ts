import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { FeatureKey, PlanTypeId } from '../enums';
import { AccessReasonCatalog } from '../models/access-event.model';
import {
  CATALOG_CACHE_MAX_AGE_MS,
  CatalogCacheRow,
} from '../models/catalog-cache.model';
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
import { DatabaseService } from './database.service';

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
  private readonly db  = inject(DatabaseService);

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
   * Loads all system catalogs on app boot.
   *
   * Cohort A1 (5 wire-compatible endpoints) — kitchen / display / payment
   * / device / zone — flow through the Dexie + ETag cache (FDD-028 F1):
   * Dexie hit → signal hydrate → background revalidate via `If-None-Match`.
   * Each `hydrateRoute()` handles its own errors so one failure cannot
   * block the others.
   *
   * Legacy pattern (business-types, plans) still goes through plain
   * `api.get()` — F3 and F2 of FDD-028 will migrate them respectively.
   */
  async loadAll(): Promise<void> {
    // Cohort A1 — Dexie + ETag (FDD-028 F1).
    const cohortA1 = Promise.allSettled([
      this.hydrateRoute('/catalog/kitchen-statuses', this.kitchenStatuses),
      this.hydrateRoute('/catalog/display-statuses', this.displayStatuses),
      this.hydrateRoute('/catalog/payment-methods',  this.paymentMethods),
      this.hydrateRoute('/catalog/device-modes',     this.deviceModes),
      this.hydrateRoute('/catalog/zone-types',       this.zoneTypes),
    ]);

    // Legacy pattern — FDD-028 F2 / F3 will migrate these.
    const legacy = Promise.allSettled([
      firstValueFrom(this.api.get<BusinessTypeCatalog[]>('/catalog/business-types')),
      firstValueFrom(this.api.get<PlanCatalogDto[]>('/catalog/plans')),
    ]);

    const [, legacyResults] = await Promise.all([cohortA1, legacy]);
    if (legacyResults[0].status === 'fulfilled') this.businessTypes.set(legacyResults[0].value);
    if (legacyResults[1].status === 'fulfilled') this._planApiFeatures.set(this.parsePlanDto(legacyResults[1].value));
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
   *
   * NOTE: F5 of FDD-028 D5 will migrate this to "warn-and-keep" — log
   * unknowns at `console.warn` and preserve them in the signal as opaque
   * strings instead of silently dropping. Today's silent-drop is kept
   * intact during F1 to avoid scope creep.
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

  /**
   * Cache-aside helper for a single catalog endpoint. Implements the
   * fallback chain documented in FDD-028 §7.3:
   *
   *   1. Read Dexie row for `route`.
   *   2. If hit AND fresh (< 24h)        → hydrate signal from cache,
   *                                         schedule background revalidate.
   *   3. If miss OR stale (> 24h)        → full network GET (no
   *                                         If-None-Match), persist, hydrate.
   *   4. Background revalidate (step 2)  → GET with `If-None-Match`.
   *      ├── 304  → bump Dexie `fetchedAt`, signal unchanged.
   *      ├── 200  → replace Dexie row + signal with fresh payload + ETag.
   *      └── err  → silent; cached signal stays; retry next boot.
   *
   * Network errors at step 3 leave the signal at its current value
   * (hardcoded fallback during F1–F5, seed JSON after F6). Dexie write
   * failures are logged at `console.warn` and do not propagate.
   *
   * @param route       Canonical lowercase route, e.g. `/catalog/kitchen-statuses`.
   * @param targetSignal The writable signal to set on hit / fetch success.
   */
  private async hydrateRoute<T>(
    route: string,
    targetSignal: WritableSignal<T[]>,
  ): Promise<void> {
    const cached  = await this.db.catalogCache.get(route);
    const isFresh = !!cached && (Date.now() - cached.fetchedAt) < CATALOG_CACHE_MAX_AGE_MS;

    // Step 2 — hot path: serve from Dexie immediately, then revalidate.
    if (isFresh && cached) {
      targetSignal.set(cached.payload as T[]);
      // Fire-and-forget background revalidation. Errors handled inside.
      void this.revalidateRoute<T>(route, cached.etag, targetSignal);
      return;
    }

    // Step 3 — cold or stale: full network fetch (no If-None-Match).
    try {
      const response = await firstValueFrom(this.api.getFull<T[]>(route));
      if (response.status === 200 && response.body) {
        await this.writeCacheRow(route, response.body, this.readEtag(response.headers));
        targetSignal.set(response.body);
      }
    } catch {
      // Network failure — signal keeps its current value (hardcoded
      // fallback during F1–F5, seed JSON after F6 lands).
    }
  }

  /**
   * Step 4 of the FDD-028 §7.3 fallback chain — background revalidation
   * of a previously-cached route via `If-None-Match`. Called only after
   * a fresh Dexie hit served the signal synchronously.
   */
  private async revalidateRoute<T>(
    route: string,
    etag:  string,
    targetSignal: WritableSignal<T[]>,
  ): Promise<void> {
    try {
      const headers  = etag ? { 'If-None-Match': etag } : undefined;
      const response = await firstValueFrom(
        this.api.getFull<T[]>(route, headers ? { headers } : undefined),
      );

      if (response.status === 304) {
        // Unchanged — bump fetchedAt to defer the next stale-check.
        await this.safeDexieUpdate(route, { fetchedAt: Date.now() });
        return;
      }

      if (response.status === 200 && response.body) {
        await this.writeCacheRow(route, response.body, this.readEtag(response.headers));
        targetSignal.set(response.body);
      }
    } catch {
      // Silent — the previously-cached signal value remains valid.
    }
  }

  /** Reads the ETag header verbatim (including surrounding quotes). */
  private readEtag(headers: { get(name: string): string | null }): string {
    return headers.get('ETag') ?? '';
  }

  /**
   * Persists a cache row to Dexie. Wrapped in try/catch so storage
   * failures (quota, eviction, private-mode) never propagate to callers.
   */
  private async writeCacheRow(route: string, payload: unknown[], etag: string): Promise<void> {
    const row: CatalogCacheRow = { route, payload, etag, fetchedAt: Date.now() };
    try {
      await this.db.catalogCache.put(row);
    } catch (err) {
      console.warn(`[CatalogService] Failed to persist cache row for ${route}:`, err);
    }
  }

  /** Idempotent Dexie `update` wrapper that swallows storage failures. */
  private async safeDexieUpdate(route: string, patch: Partial<CatalogCacheRow>): Promise<void> {
    try {
      await this.db.catalogCache.update(route, patch);
    } catch (err) {
      console.warn(`[CatalogService] Failed to update cache row for ${route}:`, err);
    }
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

  /**
   * Fetches the access-reason catalog used by the live reception
   * dashboard to translate `AccessResultDto.accessReasonId` into a
   * human-readable label. Seeded by the backend `DbInitializer` and
   * exposed at `/catalog/access-reasons` (anonymous).
   */
  getAccessReasons(): Promise<AccessReasonCatalog[]> {
    return firstValueFrom(
      this.api.get<AccessReasonCatalog[]>('/catalog/access-reasons'),
    );
  }

  //#endregion

}
