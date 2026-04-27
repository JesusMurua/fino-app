import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import {
  AppConfig,
  DEFAULT_APP_CONFIG,
  DeviceConfig,
  PosExperience,
} from '../models';
import { MacroCategoryType } from '../enums';
import { ApiService } from './api.service';
import { BranchContextService } from './branch-context.service';
import { DatabaseService } from './database.service';
import { DeviceConfigStore } from './device-config.store';
import { TenantContextService } from './tenant-context.service';

/** Derives the default POS experience variant from the primary macro category. */
function posExperienceForMacro(macro: MacroCategoryType): PosExperience {
  switch (macro) {
    case MacroCategoryType.FoodBeverage: return 'Restaurant';
    case MacroCategoryType.QuickService: return 'Counter';
    case MacroCategoryType.Retail:       return 'Retail';
    case MacroCategoryType.Services:     return 'Quick';
  }
}

/** API response shape for GET /api/branch/{id}/config */
interface BranchConfigResponse {
  id: number;
  businessId: number;
  businessName: string;
  branchName: string;
  locationName?: string;
  businessPhone?: string;
  hasKitchen?: boolean;
  hasTables?: boolean;
  hasDelivery?: boolean;
  hasInvoicing?: boolean;
  folioPrefix?: string;
  folioFormat?: string;
  folioCounter?: number;
  planTypeId?: number;
  primaryMacroCategoryId?: number;
  posExperience?: string;
}

/**
 * Manages two separate layers of configuration:
 *
 * Business config (IndexedDB via Dexie):
 *   Shared across all devices — businessName, locationName, folio/fiscal.
 *   On load(), tries GET /api/branch/1/config first.
 *   If API succeeds → updates Dexie with fresh data.
 *   If API fails → uses Dexie local fallback.
 *   Exposed via config$.
 *
 * Device config (localStorage):
 *   Local to this device only — mode, deviceName.
 *   Exposed via deviceConfig$.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {

  /** Reactive business config stream — emits on every load() and save() */
  readonly config$ = new BehaviorSubject<AppConfig>({ ...DEFAULT_APP_CONFIG });

  /** Whether the current business has a kitchen */
  readonly hasKitchen = signal(false);

  /** Whether the current business uses table management */
  readonly hasTables = signal(false);

  /** Whether the current business receives delivery aggregator orders */
  readonly hasDelivery = signal(false);

  /** Whether CFDI invoicing is enabled for this branch */
  readonly hasInvoicing = signal(false);

  /**
   * POS experience variant — undefined until config is loaded.
   * Explicit signal (not computed from BehaviorSubject) to guarantee
   * synchronous updates within the same change detection cycle as load().
   */
  readonly posExperience = signal<PosExperience | undefined>(undefined);

  /** Whether load() has completed successfully at least once */
  private _isLoaded = false;

  /** Returns true if config has been loaded from API or Dexie */
  isLoaded(): boolean { return this._isLoaded; }

  /**
   * Reactive device config stream — emits on every `loadDeviceConfig()`
   * and `saveDeviceConfig()`. Re-exports the subject owned by
   * `DeviceConfigStore` (not a derived stream) so consumers using
   * `toSignal()` / `.getValue()` keep their reactive identity after
   * the extraction. See AUDIT-046.
   */
  get deviceConfig$() { return this.deviceConfigStore.deviceConfig$; }

  constructor(
    private readonly db: DatabaseService,
    private readonly api: ApiService,
    private readonly branchContext: BranchContextService,
    private readonly tenantContext: TenantContextService,
    private readonly deviceConfigStore: DeviceConfigStore,
  ) {
    // DeviceConfigStore hydrates itself in its own constructor —
    // no need to call loadDeviceConfig() here.
  }

  //#region Business config (Dexie + API)

  /**
   * Loads the business config:
   *   1. Read from Dexie (instant, may be stale)
   *   2. Try GET /api/branch/1/config
   *   3. If API succeeds → merge into local config and persist
   *   4. If API fails → keep Dexie data as-is
   */
  async load(): Promise<AppConfig> {
    // Step 1 — Load local config from Dexie
    const stored = await this.db.config.get('main');
    let config = stored ?? { ...DEFAULT_APP_CONFIG };

    if (!stored) {
      await this.db.config.put(DEFAULT_APP_CONFIG);
    }

    this.config$.next(config);
    this.hasKitchen.set(config.hasKitchen ?? false);
    this.hasTables.set(config.hasTables ?? false);
    this.hasDelivery.set(config.hasDelivery ?? false);
    this.hasInvoicing.set(config.hasInvoicing ?? false);
    this.posExperience.set(config.businessTypeCatalog?.posExperience);

    // Step 2 — Try to fetch from API in background
    try {
      const remote = await firstValueFrom(
        this.api.get<BranchConfigResponse>(`/branch/${this.branchContext.activeBranchId()}/config`),
      );

      // Derive the POS experience from the branch payload when available,
      // or fall back to the macro category from the tenant context.
      // Macro → experience is deterministic (see `posExperienceForMacro`),
      // so we never need to hit the catalog service for this resolution.
      const macroId = this.tenantContext.currentMacro();
      const posExperience: PosExperience | undefined =
        (remote.posExperience as PosExperience | undefined)
        ?? (macroId !== null ? posExperienceForMacro(macroId) : config.businessTypeCatalog?.posExperience);
      const btCatalog = config.businessTypeCatalog
        ? { ...config.businessTypeCatalog, posExperience: posExperience ?? config.businessTypeCatalog.posExperience }
        : posExperience
          ? { id: 0, code: '', name: '', hasKitchen: remote.hasKitchen ?? false, hasTables: remote.hasTables ?? false, posExperience, sortOrder: 0 }
          : config.businessTypeCatalog;

      // Use `||` (not `??`) on string fields so an empty remote string
      // does not overwrite a populated local value — the backend can
      // return `''` for unset columns and we never want to clobber data
      // the user already typed locally.
      config = {
        ...config,
        businessName: remote.businessName || config.businessName || '',
        locationName: remote.locationName || remote.branchName || config.locationName,
        businessPhone: remote.businessPhone || config.businessPhone || '',
        hasKitchen: remote.hasKitchen ?? false,
        hasTables: remote.hasTables ?? false,
        hasDelivery: remote.hasDelivery ?? false,
        hasInvoicing: remote.hasInvoicing ?? false,
        businessTypeCatalog: btCatalog,
        folioPrefix: remote.folioPrefix ?? config.folioPrefix,
        folioFormat: remote.folioFormat ?? config.folioFormat,
        folioCounter: remote.folioCounter ?? config.folioCounter,
      };

      await this.db.config.put(config);
      this.config$.next(config);
      this.hasKitchen.set(config.hasKitchen ?? false);
      this.hasTables.set(config.hasTables ?? false);
      this.hasDelivery.set(config.hasDelivery ?? false);
      this.posExperience.set(config.businessTypeCatalog?.posExperience);
      console.info('[ConfigService] Config updated from API');
    } catch (error) {
      // Surface the failure loudly so an empty form does not look like a
      // hydration race — the user (and Sentry/console) need to know that
      // the remote merge step failed and we are showing local-only data.
      const status = (error as { status?: unknown })?.status;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[ConfigService] Failed to refresh config from API (status=${status ?? 'n/a'}): ${message}. ` +
        `Showing local Dexie data — fields may be empty if this is a fresh install.`,
        error,
      );
    }

    this._isLoaded = true;
    return config;
  }

  /**
   * Persists the business config to IndexedDB and emits to config$.
   * @param config Updated config to save
   */
  async save(config: AppConfig): Promise<void> {
    const normalized = { ...config, id: 'main' as const };
    await this.db.config.put(normalized);
    this.config$.next(normalized);
    this.hasKitchen.set(normalized.hasKitchen ?? false);
    this.hasTables.set(normalized.hasTables ?? false);
    this.hasDelivery.set(normalized.hasDelivery ?? false);
    this.hasInvoicing.set(normalized.hasInvoicing ?? false);
    this.posExperience.set(normalized.businessTypeCatalog?.posExperience);
  }

  //#endregion

  //#region Device config (proxy over DeviceConfigStore)

  /**
   * Returns true if the device has been configured with a valid
   * businessId and branchId (set during the /setup flow).
   */
  isDeviceConfigured(): boolean {
    return this.deviceConfigStore.isConfigured();
  }

  /**
   * Reads the device config from localStorage and emits to `deviceConfig$`.
   * Delegates to `DeviceConfigStore` — see that service for the storage
   * format and legacy migration rules.
   */
  loadDeviceConfig(): DeviceConfig {
    return this.deviceConfigStore.load();
  }

  /**
   * Persists the device config to localStorage and emits to `deviceConfig$`.
   * Delegates to `DeviceConfigStore`.
   */
  saveDeviceConfig(config: DeviceConfig): void {
    this.deviceConfigStore.save(config);
  }

  //#endregion

}
