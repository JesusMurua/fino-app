import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import {
  AppConfig,
  DEFAULT_APP_CONFIG,
  DEFAULT_DEVICE_CONFIG,
  DEVICE_CONFIG_KEY,
  DeviceConfig,
  PosExperience,
} from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { CatalogService } from './catalog.service';
import { DatabaseService } from './database.service';

/** API response shape for GET /api/branch/{id}/config */
interface BranchConfigResponse {
  id: number;
  businessId: number;
  businessName: string;
  branchName: string;
  locationName?: string;
  hasKitchen?: boolean;
  hasTables?: boolean;
  hasDelivery?: boolean;
  folioPrefix?: string;
  folioFormat?: string;
  folioCounter?: number;
  planType?: string;
  businessType?: string;
  posExperience?: string;
}

/**
 * Manages two separate layers of configuration:
 *
 * Business config (IndexedDB via Dexie):
 *   Shared across all devices — businessName, locationName, PIN.
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

  /** Reactive device config stream — emits on every loadDeviceConfig() and saveDeviceConfig() */
  readonly deviceConfig$ = new BehaviorSubject<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  constructor(
    private readonly db: DatabaseService,
    private readonly api: ApiService,
    private readonly authService: AuthService,
    private readonly catalogService: CatalogService,
  ) {
    // Eagerly load device config so subscribers get the real value immediately
    this.loadDeviceConfig();
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
    this.posExperience.set(config.businessTypeCatalog?.posExperience);

    // Step 2 — Try to fetch from API in background
    try {
      const remote = await firstValueFrom(
        this.api.get<BranchConfigResponse>(`/branch/${this.authService.branchId}/config`),
      );

      // Resolve business type catalog from CatalogService using JWT business type
      const btCode = this.authService.businessType();
      const btCatalog = this.catalogService.getBusinessType(btCode) ?? config.businessTypeCatalog;

      config = {
        ...config,
        businessName: remote.businessName,
        locationName: remote.locationName || remote.branchName || config.locationName,
        hasKitchen: remote.hasKitchen ?? false,
        hasTables: remote.hasTables ?? false,
        hasDelivery: remote.hasDelivery ?? false,
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
      console.warn('[ConfigService] API unreachable — using local config:', error);
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
    this.posExperience.set(normalized.businessTypeCatalog?.posExperience);
  }

  /**
   * Verifies whether the provided PIN matches the stored one.
   * @param pin 4-digit PIN string to verify
   */
  async verifyPin(pin: string): Promise<boolean> {
    const config = await this.load();
    return config.pin === pin;
  }

  /**
   * Updates the PIN in the stored config.
   * @param newPin New 4-digit PIN string
   */
  async updatePin(newPin: string): Promise<void> {
    const config = await this.load();
    await this.save({ ...config, pin: newPin });
  }

  //#endregion

  //#region Device config (localStorage)

  /**
   * Returns true if the device has been configured with a valid
   * businessId and branchId (set during the /setup flow).
   */
  isDeviceConfigured(): boolean {
    const config = this.deviceConfig$.getValue();
    return config.businessId > 0 && config.branchId > 0;
  }

  /**
   * Reads the device config from localStorage and emits to deviceConfig$.
   * Falls back to DEFAULT_DEVICE_CONFIG if no value has been saved yet.
   */
  loadDeviceConfig(): DeviceConfig {
    try {
      const raw = localStorage.getItem(DEVICE_CONFIG_KEY);
      const config: DeviceConfig = raw ? JSON.parse(raw) : { ...DEFAULT_DEVICE_CONFIG };

      // Migrate deprecated modes
      const mode = config.mode as string;
      if (mode === 'counter') config.mode = 'cashier';
      if (mode === 'waiter') config.mode = 'tables';
      if (mode !== config.mode) this.saveDeviceConfig(config);

      this.deviceConfig$.next(config);
      return config;
    } catch {
      this.deviceConfig$.next({ ...DEFAULT_DEVICE_CONFIG });
      return { ...DEFAULT_DEVICE_CONFIG };
    }
  }

  /**
   * Persists the device config to localStorage and emits to deviceConfig$.
   * Only affects this physical device — other devices are unchanged.
   * @param config Updated device config to save
   */
  saveDeviceConfig(config: DeviceConfig): void {
    localStorage.setItem(DEVICE_CONFIG_KEY, JSON.stringify(config));
    this.deviceConfig$.next(config);
  }

  //#endregion

}
