import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { FeatureKey, PlanTypeId } from '../enums';
import { AccessReasonCatalog } from '../models/access-event.model';
import {
  CATALOG_CACHE_MAX_AGE_MS,
  CatalogCacheRow,
} from '../models/catalog-cache.model';
import {
  AccessMethodCatalog,
  BusinessTypeCatalog,
  DeviceModeCatalog,
  DisplayStatusCatalog,
  KitchenStatusCatalog,
  MacroCategoryDto,
  PaymentMethodCatalog,
  PlanTypeDto,
  ZoneTypeCatalog,
} from '../models/catalog.model';
// FDD-028 F6: hardcoded `catalog.constants.ts` deleted. Cold-boot
// offline UX now relies on the Dexie cache (FDD-028 D2) with a
// last-resort fallback to seed JSONs under `src/assets/catalog-seed/`
// (see `loadSeedFallback()` below). `PLAN_CATALOG` is retained because
// it carries commercial metadata (prices, Stripe IDs, badges) that the
// backend does NOT serve — see plan-catalog.model.ts.
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

  // FDD-028 F6: initial values are `[]`. Hydration order on app boot:
  // (1) Dexie cache hit (≤ 20 ms) — populated on first online session;
  // (2) network fetch (with `If-None-Match` on revalidate);
  // (3) seed JSON fallback (`src/assets/catalog-seed/<route>.json`)
  //     on network failure when Dexie is also empty (first-install offline).
  // See `loadSeedFallback()` and `hydrateRouteApply()` for the chain.
  readonly kitchenStatuses = signal<KitchenStatusCatalog[]>([]);
  readonly displayStatuses = signal<DisplayStatusCatalog[]>([]);
  readonly paymentMethods  = signal<PaymentMethodCatalog[]>([]);
  readonly deviceModes     = signal<DeviceModeCatalog[]>([]);
  readonly businessTypes   = signal<BusinessTypeCatalog[]>([]);
  readonly zoneTypes       = signal<ZoneTypeCatalog[]>([]);

  // ── FDD-028 F4 (Cohort C) ─ new consumer surface, no hardcoded fallback.
  // Initial value is `[]`; F6 will commit seed JSONs under
  // `src/assets/catalog-seed/` to provide first-install offline values.
  readonly macroCategories = signal<MacroCategoryDto[]>([]);
  readonly planTypes       = signal<PlanTypeDto[]>([]);
  readonly accessMethods   = signal<AccessMethodCatalog[]>([]);
  readonly accessReasons   = signal<AccessReasonCatalog[]>([]);

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
    // Cohorts A1 + A2 + C — Dexie + ETag (FDD-028 F1 + F2 + F4).
    const cached = Promise.allSettled([
      // A1 (F1)
      this.hydrateRoute('/catalog/kitchen-statuses', this.kitchenStatuses),
      this.hydrateRoute('/catalog/display-statuses', this.displayStatuses),
      this.hydrateRoute('/catalog/payment-methods',  this.paymentMethods),
      this.hydrateRoute('/catalog/device-modes',     this.deviceModes),
      this.hydrateRoute('/catalog/zone-types',       this.zoneTypes),
      // A2 (F2)
      this.hydrateRouteApply<PlanCatalogDto>(
        '/catalog/plans',
        payload => this._planApiFeatures.set(this.parsePlanDto(payload)),
      ),
      // C (F4) — new consumer surface
      this.hydrateRoute('/catalog/macro-categories', this.macroCategories),
      this.hydrateRoute('/catalog/plan-types',       this.planTypes),
      this.hydrateRoute('/catalog/access-methods',   this.accessMethods),
      this.hydrateRoute('/catalog/access-reasons',   this.accessReasons),
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
        return;
      }
    } catch {
      // Network failure — fall through to seed JSON fallback below.
    }

    // FDD-028 F6 step 4 — last-resort fallback to the bundled seed JSON
    // (only reaches here if Dexie was empty AND network failed). Empty
    // result keeps the signal at its initial `[]` value.
    const seed = await this.loadSeedFallback<T>(route);
    if (seed.length > 0) onPayload(seed);
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

  /**
   * Last-resort fallback for first-install cold-boot without network
   * (FDD-028 F6 step 4 of the §7.3 fallback chain). Fetches the
   * bundled seed JSON under `src/assets/catalog-seed/<resource>.json`
   * — present for routes that had a hardcoded fallback before F6
   * (kitchen-statuses, display-statuses, payment-methods, device-modes,
   * zone-types, business-types, macro-categories) and absent for new
   * Cohort C routes that ship empty until first online sync.
   *
   * Returns `[]` on any failure (missing file, parse error, fetch
   * rejection) — silent degradation; caller keeps signal at `[]`.
   *
   * Manual seed maintenance for now; `npm run sync-catalog-seed`
   * (future) will regenerate them against production backend when
   * `DbInitializer` changes.
   */
  private async loadSeedFallback<T>(route: string): Promise<T[]> {
    const resource = route.split('/').pop();
    if (!resource) return [];
    try {
      const response = await fetch(`/assets/catalog-seed/${resource}.json`);
      if (!response.ok) return [];
      const data = await response.json() as T[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
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

  /**
   * Returns business type config by id (FDD-028 F3 — replaces the
   * legacy `getBusinessType(code: string)` lookup since `code` is no
   * longer in the BDD-021 `BusinessTypeDto` wire shape).
   */
  getBusinessTypeById(id: number): BusinessTypeCatalog | undefined {
    return this.businessTypes().find(s => s.id === id);
  }

  /**
   * Resolves a `BusinessTypeDto` to its `MacroCategoryDto` by joining on
   * `primaryMacroCategoryId` (FDD-028 F4 / D6).
   *
   * The returned `MacroCategoryDto` carries the macro-derived attributes
   * (`posExperience`, `hasKitchen`, `hasTables`, `internalCode`) that the
   * F3-reshaped `BusinessTypeDto` no longer ships. Replaces the
   * hardcoded `macroOfBusinessType()` ID-range helper deleted in F4
   * (closes AUDIT-058 §1.2).
   *
   * @returns The joined `MacroCategoryDto` or `null` if either catalog
   *          has not been hydrated yet or the business type id is unknown.
   */
  resolveMacro(businessTypeId: number): MacroCategoryDto | null {
    const bt = this.businessTypes().find(b => b.id === businessTypeId);
    if (!bt) return null;
    return this.macroCategories().find(m => m.id === bt.primaryMacroCategoryId) ?? null;
  }

  /**
   * Fetches the access-reason catalog used by the live reception
   * dashboard to translate `AccessResultDto.accessReasonId` into a
   * human-readable label. Seeded by the backend `DbInitializer` and
   * exposed at `/catalog/access-reasons` (anonymous).
   *
   * @deprecated Since FDD-028 F4 / FR-012, prefer the symmetric signal
   * `catalogService.accessReasons()`. This Promise wrapper is kept for
   * BC; it now resolves immediately from the cached signal value
   * (hydrated by `loadAll()` at boot via the same Dexie + ETag pattern
   * as the rest of Cohort C). Consumers can migrate at their own pace.
   */
  getAccessReasons(): Promise<AccessReasonCatalog[]> {
    return Promise.resolve(this.accessReasons());
  }

  //#endregion

}
