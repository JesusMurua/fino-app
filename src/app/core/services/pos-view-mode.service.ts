import { Injectable, signal } from '@angular/core';

import { PosExperience } from '../models/catalog.model';

/** Two-way switch driving the unified POS chameleon shell. */
export type PosViewMode = 'grid' | 'keypad';

/**
 * Cross-component state for the unified POS view mode.
 *
 * `<app-unified-pos>` consumes `viewMode()` to swap between the catalog grid
 * and the keypad calculator. `<app-pos-header>` reads the same signal to
 * render the segmented toggle, and writes back via `setViewMode()` when the
 * cashier flips it. Persistence to `localStorage` survives reloads so the
 * cashier's last choice always wins on cold boot.
 *
 * `toggleVisible` is set by the unified shell on mount/destroy so the
 * header toggle only renders when there's a stage to control — a Restaurant
 * Hub session never shows it.
 */
@Injectable({ providedIn: 'root' })
export class PosViewModeService {

  private static readonly STORAGE_KEY = 'pos_view_mode_override';

  /** True when a user override is stored — locks the default rule below. */
  private readonly hasUserOverride = signal(this.loadStored() !== null);

  /** Active view mode. Defaults to grid until `initializeDefault` overrides. */
  readonly viewMode = signal<PosViewMode>(this.loadStored() ?? 'grid');

  /** Whether the header toggle should render (gated by unified-pos mount). */
  private readonly _toggleVisible = signal(false);
  readonly toggleVisible = this._toggleVisible.asReadonly();

  /**
   * Sets the view mode and persists it. Subsequent `initializeDefault`
   * calls are ignored so the user's choice is sticky across re-mounts.
   */
  setViewMode(mode: PosViewMode): void {
    this.viewMode.set(mode);
    this.hasUserOverride.set(true);
    try {
      localStorage.setItem(PosViewModeService.STORAGE_KEY, mode);
    } catch { /* storage quota / privacy mode — keep working in-memory */ }
  }

  /**
   * Seeds the view mode from the tenant's `PosExperience` *only when the
   * user has not yet overridden the choice*. Services/Quick default to
   * 'keypad'; everything else defaults to 'grid'.
   */
  initializeDefault(experience: PosExperience | undefined): void {
    if (this.hasUserOverride()) return;
    const def: PosViewMode =
      experience === 'Services' || experience === 'Quick' ? 'keypad' : 'grid';
    this.viewMode.set(def);
  }

  /** Mark the toggle as visible (called on `<app-unified-pos>` mount). */
  setToggleVisible(visible: boolean): void {
    this._toggleVisible.set(visible);
  }

  /** Reads the persisted view-mode preference. Returns null when unset. */
  private loadStored(): PosViewMode | null {
    try {
      const raw = localStorage.getItem(PosViewModeService.STORAGE_KEY);
      return raw === 'grid' || raw === 'keypad' ? raw : null;
    } catch {
      return null;
    }
  }
}
