import { Injectable, effect, signal } from '@angular/core';

/** localStorage key — shared with the legacy admin shell so users keep
 *  their preference when migrating to the unified theme model. */
const DARK_MODE_KEY = 'fino.dashboard.darkMode';

/**
 * Single source of truth for the application-wide light / dark theme.
 *
 * Toggles `app-light` / `app-dark` classes on the `<html>` element so
 * every shell (admin, POS, kitchen, kiosk) inherits the same CSS custom
 * properties (`--bg`, `--surface`, `--text1`, …) without each owning a
 * scoped copy of the toggle.
 *
 * Persists to localStorage under the legacy admin key so users who
 * already had a preference don't lose it on this migration.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {

  /** True → dark mode is active. */
  readonly isDarkMode = signal<boolean>(this.loadStored());

  constructor() {
    // Side-effect: keep the document root class in lockstep with the
    // signal. Runs once on construction so the initial preference is
    // applied before any shell component mounts.
    effect(() => {
      const dark = this.isDarkMode();
      const root = document.documentElement;
      root.classList.toggle('app-dark', dark);
      root.classList.toggle('app-light', !dark);
      localStorage.setItem(DARK_MODE_KEY, String(dark));
    });
  }

  /** Flips the theme and persists the preference. */
  toggle(): void {
    this.isDarkMode.update(v => !v);
  }

  /** Explicit setter — exposed for migration paths that already know
   *  the desired state (e.g. system-preference media query listener). */
  set(dark: boolean): void {
    this.isDarkMode.set(dark);
  }

  private loadStored(): boolean {
    return localStorage.getItem(DARK_MODE_KEY) === 'true';
  }

}
