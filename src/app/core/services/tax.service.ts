import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Tax } from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';

/**
 * Backend tax catalog with offline-first hydration.
 *
 * Source of truth for the dropdowns in admin-settings (Fiscal tab) and
 * product-form, plus the resolver of `tenantContext.defaultTaxRatePercent()`.
 *
 * Hydration order on `loadCatalog()`:
 *   1. Hit `GET /api/taxes` (authoritative).
 *   2. On success, persist to Dexie `taxes` table.
 *   3. On failure (offline / 5xx), hydrate from Dexie cache.
 *   4. If both fail, the signal stays empty — UI renders "catalog
 *      unavailable" instead of injecting a hardcoded fallback list.
 *
 * **Adapter**: backend returns `rate` as a decimal (0.16). The service
 * decorates each entry with `ratePercent` (integer 16) so the rest of
 * the frontend keeps working in percentage units. The decimal `rate`
 * is preserved untouched — server-authoritative values must round-trip.
 */
@Injectable({ providedIn: 'root' })
export class TaxService {

  private readonly api = inject(ApiService);
  private readonly db = inject(DatabaseService);

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
   */
  clear(): void {
    this._catalog.set([]);
    this.loadPromise = null;
  }

  /**
   * Fetches from API, decorates with `ratePercent`, persists to Dexie,
   * and updates the signal. Falls back to Dexie on API failure so the
   * UI remains operable offline.
   */
  private async fetchAndCache(): Promise<readonly Tax[]> {
    this._isLoading.set(true);
    try {
      const remote = await firstValueFrom(this.api.get<Tax[]>('/taxes'));
      const decorated = remote.map(t => this.decorate(t));
      await this.db.transaction('rw', this.db.taxes, async () => {
        await this.db.taxes.clear();
        if (decorated.length > 0) await this.db.taxes.bulkAdd(decorated);
      });
      this._catalog.set(decorated);
      return decorated;
    } catch {
      // API unreachable — fall back to last known catalog from Dexie.
      try {
        const cached = await this.db.taxes.toArray();
        const decorated = cached.map(t => this.decorate(t));
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
   * Adapter — derives `ratePercent` (integer percentage) from the raw
   * decimal `rate`. Idempotent: if `ratePercent` is already populated
   * (e.g. cached from a prior decoration), it's recomputed deterministically.
   */
  private decorate(tax: Tax): Tax {
    return { ...tax, ratePercent: Math.round(tax.rate * 10000) / 100 };
  }
}
