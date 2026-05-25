import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Tax } from '../models';
import { CATALOG_CACHE_MAX_AGE_MS, CatalogCacheRow } from '../models/catalog-cache.model';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';

/**
 * Backend tax catalog with offline-first hydration.
 *
 * Source of truth for the dropdowns in admin-settings (Fiscal tab) and
 * product-form, plus the resolver of `tenantContext.defaultTaxRatePercent()`.
 *
 * **Cache hydration order (FDD-028 F2.1 — stale-while-revalidate):**
 *   1. Read `catalogCache` Dexie row for `/taxes`.
 *      - Hit + fresh (< 24 h) → decorate cached payload, set signal,
 *        schedule background revalidate via `If-None-Match` ETag.
 *      - Miss / stale → step 2.
 *   2. Network GET `/taxes` via `ApiService.getFull<Tax[]>` (no header).
 *      - On 200 → persist raw payload + ETag to `catalogCache`,
 *        mirror to the legacy `taxes` Dexie table, decorate, set signal.
 *      - On 401 / 403 → do NOT write cache; fall through to step 3.
 *      - On network error → fall through to step 3.
 *   3. Fallback to the legacy `taxes` Dexie table (offline-create scratch).
 *      Signal stays `[]` if the read also fails.
 *
 * **Adapter:** the backend returns `rate` as a decimal (0.16). The
 * service decorates each entry with `ratePercent` (integer 16) so the
 * rest of the frontend keeps working in percentage units. The decimal
 * `rate` is preserved untouched — server-authoritative values must
 * round-trip. Storage in `catalogCache` is the **raw** wire shape (no
 * `ratePercent`) so the backend-computed ETag's semantic integrity is
 * protected; decoration is applied on every read before setting the
 * signal.
 *
 * **TODO (FDD-028 cleanup):** the Dexie `taxes` table (v25) is retained
 * for offline-create scratch space. The READ path now mirrors into
 * `catalogCache` (`/taxes` route) for ETag negotiation. A future
 * refactor can consolidate both paths into `catalogCache` + a dedicated
 * offline-create queue.
 */
@Injectable({ providedIn: 'root' })
export class TaxService {

  private readonly api = inject(ApiService);
  private readonly db = inject(DatabaseService);

  /** Canonical lowercase route — matches FDD-028 §7.3 convention. */
  private readonly TAXES_ROUTE = '/taxes';

  /** Catalog of taxes — empty until `loadCatalog()` resolves */
  private readonly _catalog = signal<readonly Tax[]>([]);
  readonly catalog = this._catalog.asReadonly();

  /** True while the API fetch is in flight */
  private readonly _isLoading = signal(false);
  readonly isLoading = this._isLoading.asReadonly();

  /**
   * Cached promise of the in-flight or resolved catalog load. Multiple
   * callers (TenantContextService.ensureHydrated, guards, components
   * mounting concurrently) share a single fetch. Reset on logout.
   */
  private loadPromise: Promise<readonly Tax[]> | null = null;

  /** Country default — the entry flagged `isDefault: true`, or null */
  readonly countryDefault = computed<Tax | null>(() =>
    this._catalog().find(t => t.isDefault) ?? null,
  );

  /**
   * Loads the tax catalog (cached). Idempotent — subsequent calls within
   * the same session return the cached promise.
   */
  loadCatalog(): Promise<readonly Tax[]> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.fetchAndCache();
    return this.loadPromise;
  }

  /** Looks up a tax by id from the loaded catalog */
  findById(id: number): Tax | null {
    return this._catalog().find(t => t.id === id) ?? null;
  }

  /**
   * Clears the cache — called on logout so a subsequent login fetches
   * fresh (a different tenant might be in a different country).
   *
   * F2.1: also removes the `catalogCache` row for `/taxes` to prevent
   * cross-tenant data leak — the next tenant may live in a different
   * country and would otherwise see the previous tenant's tax list
   * until the background revalidate replaces it.
   */
  clear(): void {
    this._catalog.set([]);
    this.loadPromise = null;
    // Fire-and-forget — storage failures here must never block logout.
    void this.db.catalogCache.delete(this.TAXES_ROUTE).catch((err: unknown) => {
      console.warn(`[TaxService] Failed to clear catalogCache row for ${this.TAXES_ROUTE}:`, err);
    });
  }

  /**
   * Hydrates the tax catalog via the FDD-028 §7.3 fallback chain:
   * Dexie `catalogCache` → network with ETag negotiation → legacy Dexie
   * `taxes` table. Decoration to `ratePercent` happens on every read
   * before setting the signal.
   *
   * NOTE: if `countryCode` filtering is later added to `loadCatalog()`,
   * the cache key MUST include it (e.g. `${TAXES_ROUTE}?countryCode=MX`).
   * Each filter variant requires its own `catalogCache` row.
   */
  private async fetchAndCache(): Promise<readonly Tax[]> {
    this._isLoading.set(true);
    try {
      const cached  = await this.db.catalogCache.get(this.TAXES_ROUTE);
      const isFresh = !!cached && (Date.now() - cached.fetchedAt) < CATALOG_CACHE_MAX_AGE_MS;

      // Step 1 — hot path: serve from catalogCache + background revalidate.
      if (isFresh && cached) {
        const decorated = (cached.payload as Tax[]).map(t => this.decorate(t));
        this._catalog.set(decorated);
        void this.revalidateInBackground(cached.etag);
        return decorated;
      }

      // Step 2 — cold / stale: full network fetch (no `If-None-Match`).
      try {
        const response = await firstValueFrom(this.api.getFull<Tax[]>(this.TAXES_ROUTE));
        if (response.status === 200 && response.body) {
          const raw  = response.body;
          const etag = response.headers.get('ETag') ?? '';
          await this.writeTaxCacheRow(raw, etag);
          await this.mirrorToLegacyTaxesTable(raw);
          const decorated = raw.map(t => this.decorate(t));
          this._catalog.set(decorated);
          return decorated;
        }
      } catch {
        // Network failure (including 401 / 403 thrown by the auth
        // interceptor) — fall through to the legacy Dexie taxes table
        // as last-resort. Cache row is intentionally NOT written.
      }

      // Step 3 — fallback: legacy Dexie `taxes` table.
      try {
        const cachedRows = await this.db.taxes.toArray();
        const decorated  = cachedRows.map(t => this.decorate(t));
        this._catalog.set(decorated);
        return decorated;
      } catch {
        this._catalog.set([]);
        return [];
      }
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Background revalidation via `If-None-Match` (step 4 of the FDD-028
   * §7.3 fallback chain). Called only after a fresh `catalogCache` hit
   * served the signal synchronously.
   *
   *   - 304 → bump `fetchedAt`, signal unchanged.
   *   - 200 → replace cache row + legacy mirror + signal with fresh data.
   *   - 401 / 403 / network error → silent; cached signal stays valid.
   */
  private async revalidateInBackground(etag: string): Promise<void> {
    try {
      const headers  = etag ? { 'If-None-Match': etag } : undefined;
      const response = await firstValueFrom(
        this.api.getFull<Tax[]>(this.TAXES_ROUTE, headers ? { headers } : undefined),
      );

      if (response.status === 304) {
        await this.safeDexieUpdate({ fetchedAt: Date.now() });
        return;
      }

      if (response.status === 200 && response.body) {
        const raw     = response.body;
        const etagNew = response.headers.get('ETag') ?? '';
        await this.writeTaxCacheRow(raw, etagNew);
        await this.mirrorToLegacyTaxesTable(raw);
        const decorated = raw.map(t => this.decorate(t));
        this._catalog.set(decorated);
      }
      // 401 / 403 / other: silent — preserve cached signal value.
    } catch {
      // Silent — cached signal remains valid.
    }
  }

  /**
   * Persists a `catalogCache` row to Dexie. Wrapped in try/catch so
   * storage failures (quota, eviction, private-mode) never propagate to
   * callers — signal hydration is independent of cache persistence.
   */
  private async writeTaxCacheRow(payload: Tax[], etag: string): Promise<void> {
    const row: CatalogCacheRow = {
      route:     this.TAXES_ROUTE,
      payload,
      etag,
      fetchedAt: Date.now(),
    };
    try {
      await this.db.catalogCache.put(row);
    } catch (err) {
      console.warn(`[TaxService] Failed to persist catalogCache row for ${this.TAXES_ROUTE}:`, err);
    }
  }

  /** Idempotent Dexie `update` wrapper for the `/taxes` catalogCache row. */
  private async safeDexieUpdate(patch: Partial<CatalogCacheRow>): Promise<void> {
    try {
      await this.db.catalogCache.update(this.TAXES_ROUTE, patch);
    } catch (err) {
      console.warn(`[TaxService] Failed to update catalogCache row for ${this.TAXES_ROUTE}:`, err);
    }
  }

  /**
   * Mirrors a successful `/taxes` GET response into the legacy Dexie
   * `taxes` table (v25). Preserves the offline-create flow which
   * continues to use that table as scratch space — its catalogue base
   * stays aligned with the backend after every successful fetch.
   */
  private async mirrorToLegacyTaxesTable(rows: Tax[]): Promise<void> {
    const decorated = rows.map(t => this.decorate(t));
    try {
      await this.db.transaction('rw', this.db.taxes, async () => {
        await this.db.taxes.clear();
        if (decorated.length > 0) await this.db.taxes.bulkAdd(decorated);
      });
    } catch (err) {
      console.warn('[TaxService] Failed to mirror /taxes to the legacy taxes table:', err);
    }
  }

  /**
   * Adapter — derives `ratePercent` (integer percentage) from the raw
   * decimal `rate`. Idempotent: if `ratePercent` is already populated
   * (e.g. cached from a prior decoration), it's recomputed deterministically.
   */
  private decorate(tax: Tax): Tax {
    return { ...tax, ratePercent: Math.round(tax.rate * 10000) / 100 };
  }
}
