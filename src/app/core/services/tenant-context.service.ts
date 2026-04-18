import { Injectable, computed, signal } from '@angular/core';

import { FeatureKey, MacroCategoryType, PlanTypeId } from '../enums';
import { GIRO_FEATURE_MAP } from '../enums/feature-key.enum';

/**
 * Single source of truth for the current tenant's runtime context:
 * plan tier, business vertical, and the set of feature keys enabled
 * by the backend for this session.
 *
 * Hydrated by `AuthService` after a successful login or when the
 * user is restored from localStorage on app boot. All reads are
 * signal-based so consumers re-render automatically when the
 * backend pushes a new plan or feature set.
 */
@Injectable({ providedIn: 'root' })
export class TenantContextService {

  //#region Backing signals

  private readonly _currentPlan = signal<PlanTypeId>(PlanTypeId.Free);
  private readonly _currentMacro = signal<MacroCategoryType | null>(null);
  private readonly _activeFeatures = signal<ReadonlySet<FeatureKey>>(new Set());

  //#endregion

  //#region Public read API

  /** Current subscription plan tier */
  readonly currentPlan = this._currentPlan.asReadonly();

  /** Current macro category (primary business vertical) */
  readonly currentMacro = this._currentMacro.asReadonly();

  /** Set of feature keys currently enabled for this tenant */
  readonly activeFeatures = this._activeFeatures.asReadonly();

  /** Number of active features — useful for debug / dev tooling */
  readonly featureCount = computed(() => this._activeFeatures().size);

  /**
   * Returns true when the tenant has the given feature enabled.
   * O(1) lookup against the active features set.
   * @param feature Feature key to check
   */
  hasFeature(feature: FeatureKey): boolean {
    return this._activeFeatures().has(feature);
  }

  /**
   * Returns true when the tenant has at least one of the given features
   * enabled. Used by route guards and templates that accept OR logic
   * (e.g. `/kitchen` unlocks with either KdsBasic or RealtimeKds).
   * @param features Candidate feature keys
   */
  hasAnyFeature(features: readonly FeatureKey[]): boolean {
    const active = this._activeFeatures();
    return features.some(f => active.has(f));
  }

  /**
   * Returns true when the feature is relevant for the current giro,
   * regardless of whether the current plan unlocks it. Drives the
   * hide-vs-lock distinction in the UI: features that are not
   * applicable to a giro are hidden, features that are applicable
   * but not yet unlocked are shown with a padlock.
   *
   * Fail-fast: throws when the tenant's macro has not been loaded yet.
   * Callers that may run before auth hydration must guard with
   * `currentMacro() !== null` first.
   *
   * @param feature Feature key to check
   * @throws Error when `currentMacro()` is null
   */
  isApplicableToGiro(feature: FeatureKey): boolean {
    const macro = this._currentMacro();
    if (macro === null) {
      throw new Error(
        '[TenantContextService] isApplicableToGiro called before tenant context was loaded. ' +
        'Macro category is null — cannot read feature map.',
      );
    }
    return GIRO_FEATURE_MAP[macro].includes(feature);
  }

  //#endregion

  //#region Mutators (called by AuthService)

  /**
   * Replaces the tenant context with a fresh snapshot.
   * Unknown feature strings (not present in the `FeatureKey` enum)
   * are silently dropped — the enum is authoritative on the client.
   * @param plan Subscription plan from the JWT
   * @param macro Primary macro category from the JWT
   * @param features Array of feature key strings from the JWT `features` claim
   */
  setContext(
    plan: PlanTypeId,
    macro: MacroCategoryType,
    features: readonly string[],
  ): void {
    this._currentPlan.set(plan);
    this._currentMacro.set(macro);
    this._activeFeatures.set(this.parseFeatures(features));
  }

  /** Clears the tenant context — called on logout */
  clear(): void {
    this._currentPlan.set(PlanTypeId.Free);
    this._currentMacro.set(null);
    this._activeFeatures.set(new Set());
  }

  //#endregion

  //#region Private helpers

  /**
   * Validates raw feature strings against the `FeatureKey` enum
   * and returns a set of the recognized ones.
   * @param raw Array of feature strings from the backend
   */
  private parseFeatures(raw: readonly string[]): ReadonlySet<FeatureKey> {
    const known = new Set<string>(Object.values(FeatureKey));
    const valid = new Set<FeatureKey>();
    for (const feature of raw) {
      if (known.has(feature)) {
        valid.add(feature as FeatureKey);
      }
    }
    return valid;
  }

  //#endregion

}
