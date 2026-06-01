import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { CashRegisterService } from './cash-register.service';
import { WelcomeStepsService } from './welcome-steps.service';

/**
 * Re-export of {@link WelcomeStep} so callers consuming the dashboard
 * checklist don't have to know about the underlying service. Shape is
 * intentionally identical.
 */
export type { WelcomeStep as ChecklistItem } from './welcome-steps.service';

/**
 * localStorage key used to remember that the tenant has opened at least
 * one cash register session. We need a sticky flag because
 * `CashRegisterService.hasOpenSession()` flips back to `false` every time
 * the current shift is closed — without pinning we would uncheck the
 * step right after the tenant's first successful close.
 */
const FIRST_SESSION_OPENED_KEY = 'fino.checklist.firstSessionOpened';
const HIDDEN_BY_USER_KEY = 'fino.checklist.hidden';

/**
 * Reactive source of truth for the FTUE checklist shown on the dashboard.
 *
 * The list itself is **delegated to {@link WelcomeStepsService.allApplicableSteps}**
 * so the dashboard checklist, the Welcome screen, and any future analytics
 * over "what's left to set up" share a single, plan-and-vertical-aware
 * source of truth. This service adds the dashboard-specific concerns on
 * top:
 *   - Sticky "first session opened" flag so the `register` step stays
 *     checked after the user closes their first shift.
 *   - "Hidden by user" dismiss flag persisted in localStorage.
 *   - Required-only progress percentage (optional items don't count
 *     toward 100%).
 */
@Injectable({ providedIn: 'root' })
export class OnboardingChecklistService {

  //#region Injections

  private readonly welcomeSteps = inject(WelcomeStepsService);
  private readonly cashRegisterService = inject(CashRegisterService);

  //#endregion

  //#region Sticky state

  /** Hydrated from localStorage so page refreshes don't uncheck the step. */
  private readonly _firstSessionOpened = signal<boolean>(
    localStorage.getItem(FIRST_SESSION_OPENED_KEY) === 'true',
  );

  /**
   * Sticky dismiss flag — the tenant clicked "Ocultar guía" and doesn't
   * want the checklist block anymore. Separate from completion so the
   * dashboard can distinguish "all done" from "user hid it mid-setup".
   */
  readonly hiddenByUser = signal<boolean>(
    localStorage.getItem(HIDDEN_BY_USER_KEY) === 'true',
  );

  //#endregion

  //#region Lifecycle

  constructor() {
    // Pin the "first session opened" flag the moment an open session is
    // observed. Guarded by `!already-pinned` so we don't write to
    // localStorage on every signal read.
    effect(() => {
      if (this.cashRegisterService.hasOpenSession() && !this._firstSessionOpened()) {
        this._firstSessionOpened.set(true);
        localStorage.setItem(FIRST_SESSION_OPENED_KEY, 'true');
      }
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Public API

  /**
   * Full list of checklist items with live completion state, sourced
   * from {@link WelcomeStepsService.allApplicableSteps} and re-mapped so
   * the `register` step stays sticky after the tenant's first close.
   */
  readonly checklist = computed(() =>
    this.welcomeSteps.allApplicableSteps().map(step =>
      step.id === 'register'
        ? { ...step, isCompleted: step.isCompleted || this._firstSessionOpened() }
        : step,
    ),
  );

  /** Required steps only — excludes items marked `isOptional: true`. */
  readonly requiredSteps = computed(() =>
    this.checklist().filter(item => !item.isOptional),
  );

  /** 0–100 integer percentage of required steps completed. */
  readonly progressPercentage = computed(() => {
    const required = this.requiredSteps();
    if (required.length === 0) return 100;
    const done = required.filter(item => item.isCompleted).length;
    return Math.round((done / required.length) * 100);
  });

  /** True when every required step is done (optional steps ignored). */
  readonly isChecklistComplete = computed(() =>
    this.requiredSteps().every(item => item.isCompleted),
  );

  /**
   * Master visibility flag for the dashboard FTUE block. Hidden once the
   * tenant finishes all required steps OR explicitly dismisses it.
   */
  readonly showChecklist = computed(() =>
    !this.isChecklistComplete() && !this.hiddenByUser(),
  );

  /** `<done> / <total>` string used by the progress bar label. */
  readonly progressLabel = computed(() => {
    const required = this.requiredSteps();
    const done = required.filter(item => item.isCompleted).length;
    return `${done} / ${required.length} pasos`;
  });

  /**
   * Persists the dismiss decision and updates the reactive flag so the
   * FTUE block disappears immediately without a page refresh.
   */
  dismissChecklist(): void {
    localStorage.setItem(HIDDEN_BY_USER_KEY, 'true');
    this.hiddenByUser.set(true);
  }

  /**
   * Clears the sticky dismiss flag and re-exposes the FTUE block. Called
   * from the "Ver guía de inicio" affordance on the legacy dashboard so
   * a user who hid the guide prematurely can bring it back.
   */
  resetDismiss(): void {
    localStorage.removeItem(HIDDEN_BY_USER_KEY);
    this.hiddenByUser.set(false);
  }

  //#endregion
}
