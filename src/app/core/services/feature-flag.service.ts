import { Injectable } from '@angular/core';

import {
  BUSINESS_FEATURE_MAP,
  FEATURE_MIN_PLAN,
  FeatureKey,
  PLAN_DISPLAY_NAME,
  PLAN_FEATURE_MAP,
  PLAN_HIERARCHY,
  PlanInfo,
  PlanType,
} from '../models';
import { AuthService } from './auth.service';

/**
 * Determines feature availability based on the current plan and business type.
 *
 * Pure computed logic — no HTTP calls, reads from AuthService signals only.
 * During an active trial, the user is treated as having a Basic plan.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagService {

  //#region Constructor

  constructor(private readonly authService: AuthService) {}

  //#endregion

  //#region Public API

  /**
   * Returns true if the current plan includes this feature
   * AND the feature is relevant for the current business type.
   * During active trial: all Basic features are available.
   * @param feature The feature to check
   */
  canUse(feature: FeatureKey): boolean {
    const info = this.authService.planInfo();
    const effectivePlan = this.getEffectivePlan(info);

    const planFeatures = PLAN_FEATURE_MAP[effectivePlan];
    const giroFeatures = BUSINESS_FEATURE_MAP[info.businessType];

    return planFeatures.includes(feature) && giroFeatures.includes(feature);
  }

  /**
   * Returns true if the current plan meets or exceeds the required plan level.
   * During active trial: treated as Basic.
   * @param required The minimum plan needed
   */
  meetsPlan(required: PlanType): boolean {
    const info = this.authService.planInfo();
    const effectivePlan = this.getEffectivePlan(info);

    return PLAN_HIERARCHY[effectivePlan] >= PLAN_HIERARCHY[required];
  }

  /**
   * Returns an upgrade message for a locked feature.
   * Example: "Zonas requiere Plan Básico — Ver planes"
   * @param feature The locked feature
   */
  upgradeMessage(feature: FeatureKey): string {
    const requiredPlan = FEATURE_MIN_PLAN[feature];
    const planName = PLAN_DISPLAY_NAME[requiredPlan];
    return `Requiere Plan ${planName}`;
  }

  /**
   * Returns true if the feature is relevant for the current business type
   * (regardless of plan). Used to hide irrelevant features in the UI.
   * @param feature The feature to check
   */
  isRelevantForGiro(feature: FeatureKey): boolean {
    const giro = this.authService.planInfo().businessType;
    return BUSINESS_FEATURE_MAP[giro].includes(feature);
  }

  /**
   * Returns true if the feature is blocked because the current
   * business type does not support it — regardless of plan tier.
   * @param feature The feature to check
   */
  isBlockedByBusinessType(feature: FeatureKey): boolean {
    const giro = this.authService.planInfo().businessType;
    return !BUSINESS_FEATURE_MAP[giro].includes(feature);
  }

  /**
   * Returns the appropriate locked message for a feature.
   * Distinguishes between business-type blocks and plan-tier blocks.
   * @param feature The locked feature
   */
  lockedMessage(feature: FeatureKey): string {
    if (this.isBlockedByBusinessType(feature)) {
      return 'No disponible para tu tipo de negocio';
    }
    return this.upgradeMessage(feature);
  }

  //#endregion

  //#region Private Helpers

  /**
   * Resolves the effective plan for feature gating.
   * During active trial: uses the contracted planType (Pro/Enterprise).
   * If planType is Free and trial is active, falls back to Basic
   * (subscription endpoint may not have updated the plan yet).
   */
  private getEffectivePlan(info: PlanInfo): PlanType {
    if (info.isOnTrial) {
      return info.planType !== PlanType.Free ? info.planType : PlanType.Basic;
    }
    return info.planType;
  }

  //#endregion

}
