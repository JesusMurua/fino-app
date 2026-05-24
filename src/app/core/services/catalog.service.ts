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

  /**
   * Backend-delivered feature manifest, keyed by planTypeId. Null until
   * fetched.
   *
   * After F2 of FDD-028 (warn-and-keep policy D5), the value type is
   * `(FeatureKey | string)[]` — unknown feature strings from the backend
   * are preserved (with a console.warn) so the UI can render them as
   * opaque-but-present features rather than silently dropping them.
   */
  private readonly _planApiFeatures = signal<Map<PlanTypeId, (FeatureKey | string)[]> | null>(null);

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
   *
   * Cohort A2 (FDD-028 F2): `/catalog/plans` uses the same cache pattern
   * via `hydrateRouteApply` with a transform callback that projects the
   * raw `PlanCatalogDto[]` into the derived feature map.
   *
   * Legacy pattern (`/catalog/business-types`) still goes through plain
   * `api.get()` — F3 of FDD-028 will migrate it (Cohort B reshape).
   *
   * `/api/Taxes` remains owned by `tax.service.ts` (separate Dexie cache
   * with tenant-default + offline-create business logic). FDD-028 F2.1
   * — a focused follow-up — will add ETag negotiation to that service.
   */
  async loadAll(): Promise<void> {
    // Cohort A1 + A2 — Dexie + ETag (FDD-028 F1 + F2).
    const cached = Promise.allSettled([
      this.hydrateRoute('/catalog/kitchen-statuses', this.kitchenStatuses),
      this.hydrateRoute('/catalog/display-statuses', this.displayStatuses),
      this.hydrateRoute('/catalog/payment-methods',  this.paymentMethods),
      this.hydrateRoute('/catalog/device-modes',     this.deviceModes),
      this.hydrateRoute('/catalog/zone-types',       this.zoneTypes),
      this.hydrateRouteApply<PlanCatalogDto>(
        '/catalog/plans',
        payload => this._planApiFeatures.set(this.parsePlanDto(payload)),
      ),
    ]);

    // Legacy pattern — FDD-028 F3 will migrate /catalog/business-types
    // (Cohort B reshape: BusinessTypeDto + client-side macro join).
    const legacy = Promise.allSettled([
      firstValueFrom(this.api.get<BusinessTypeCatalog[]>('/catalog/business-types')),
    ]);

    const [, legacyResults] = await Promise.all([cached, legacy]);
    if (legacyResults[0].status === 'fulfilled') this.businessTypes.set(legacyResults[0].value);
  }

  /**
   * Fetches the plan catalog on demand. Used by callers that need a
   * fresh manifest immediately after an entitlement change (e.g.
   * `TenantContextService` upgrade events).
   *
   * F2 of FDD-028: flows through the same Dexie + ETag cache pattern
   * as the boot path. Force-bypasses the stale-while-revalidate
   * shortcut by always issuing the network revalidation regardless of
   * Dexie freshness, so an entitlement change is reflected within one
   * round-trip rather than at the next 24h boundary.
   */
  async fetchPlanCatalog(): Promise<void> {
    const route  = '/catalog/plans';
    const cached = await this.db.catalogCache.get(route);
    const etag   = cached?.etag ?? '';
    try {
      const headers  = etag ? { 'If-None-Match': etag } : undefined;
      const response = await firstValueFrom(
        this.api.getFull<PlanCatalogDto[]>(route, headers ? { headers } : undefined),
      );

      if (response.status === 304) {
        await this.safeDexieUpdate(route, { fetchedAt: Date.now() });
        // Signal already reflects the cached payload; nothing to do.
        return;
      }

      if (response.status === 200 && response.body) {
        await this.writeCacheRow(route, response.body, this.readEtag(response.headers));
        this._planApiFeatures.set(this.parsePlanDto(response.body));
      }
    } catch {
      // Fallback stays in effect; not surfaced to the user.
    }
  }

  /**
   * Parses backend feature strings into the typed plan manifest.
   *
   * **F2 of FDD-028 (D5: warn-and-keep policy)**: unknown feature
   * strings (i.e. backend introduced a `FeatureKey` value before the
   * FE enum was updated) are logged at `console.warn` AND kept in the
   * result so the UI can render them as opaque-but-present features
   * rather than silently disappearing. Replaces the prior silent-drop
   * behaviour from before F2.
   */
  private parsePlanDto(dto: PlanCatalogDto[]): Map<PlanTypeId, (FeatureKey | string)[]> {
    const known    = new Set<string>(Object.values(FeatureKey));
    const result   = new Map<PlanTypeId, (FeatureKey | string)[]>();
    const unknowns = new Set<string>();

    for (const entry of dto) {
      for (const f of entry.features) {
        if (!known.has(f)) unknowns.add(f);
      }
      // Preserve the full list verbatim — warn-and-keep, not warn-and-drop.
      result.set(entry.planTypeId, [...entry.features]);
    }

    if (unknowns.size > 0) {
      console.warn(
        '[CatalogService] Plan catalog references unknown FeatureKey strings — '
        + 'preserved as opaque values per FDD-028 D5. Update the FE FeatureKey '
        + 'enum to render them as first-class features.',
        Array.from(unknowns),
      );
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
    return this.hydrateRouteApply<T>(route, payload => targetSignal.set(payload));
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
    return this.revalidateRouteApply<T>(route, etag, payload => targetSignal.set(payload));
  }

  /**
   * Callback-based variant of `hydrateRoute` (F2 of FDD-028). Same Dexie
   * + ETag pattern, but the consumer supplies an arbitrary `onPayload`
   * function instead of a writable signal. Enables routes whose
   * consumer-visible state is **derived** from the raw payload (e.g.
   * `/catalog/plans` projects `PlanCatalogDto[]` into a
   * `Map<PlanTypeId, (FeatureKey | string)[]>`).
   *
   * The signal-based `hydrateRoute` delegates to this method.
   */
  private async hydrateRouteApply<T>(
    route: string,
    onPayload: (payload: T[]) => void,
  ): Promise<void> {
    const cached  = await this.db.catalogCache.get(route);
    const isFresh = !!cached && (Date.now() - cached.fetchedAt) < CATALOG_CACHE_MAX_AGE_MS;

    if (isFresh && cached) {
      onPayload(cached.payload as T[]);
      void this.revalidateRouteApply<T>(route, cached.etag, onPayload);
      return;
    }

    try {
      const response = await firstValueFrom(this.api.getFull<T[]>(route));
      if (response.status === 200 && response.body) {
        await this.writeCacheRow(route, response.body, this.readEtag(response.headers));
        onPayload(response.body);
      }
    } catch {
      // Network failure — consumer state keeps its current value.
    }
  }

  /** Callback-based counterpart to `revalidateRoute` (F2 of FDD-028). */
  private async revalidateRouteApply<T>(
    route: string,
    etag:  string,
    onPayload: (payload: T[]) => void,
  ): Promise<void> {
    try {
      const headers  = etag ? { 'If-None-Match': etag } : undefined;
      const response = await firstValueFrom(
        this.api.getFull<T[]>(route, headers ? { headers } : undefined),
      );

      if (response.status === 304) {
        await this.safeDexieUpdate(route, { fetchedAt: Date.now() });
        return;
      }

      if (response.status === 200 && response.body) {
        await this.writeCacheRow(route, response.body, this.readEtag(response.headers));
        onPayload(response.body);
      }
    } catch {
      // Silent — consumer state remains valid.
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
