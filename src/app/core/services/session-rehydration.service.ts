import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from './auth.service';

/** Outcome returned to guards asking for a session refresh. */
export type RehydrationResult = 'ok' | 'stale-ok' | 'unauthorized' | 'no-session';

/** Shell identifiers used for logging and telemetry. */
export type ShellId = 'admin' | 'pos' | 'waiter';

/**
 * Time-to-live for a successful rehydration. Repeated shell transitions
 * within this window reuse the cached state and skip the network call.
 */
const REHYDRATION_TTL_MS = 60_000;

/**
 * Coordinates calls to `GET /api/auth/me` so that `AuthService` state
 * stays fresh across app bootstrap and shell transitions.
 *
 * Responsibilities:
 *   - De-duplicate concurrent callers (mutex via `inFlight`).
 *   - Enforce a 60 s TTL so shell guards do not hammer the backend.
 *   - Fail open on network / 5xx errors — callers keep the cached state.
 *   - Fail closed on 401/403 — forwards to `AuthService.logout()`.
 */
@Injectable({ providedIn: 'root' })
export class SessionRehydrationService {

  //#region Properties

  private readonly authService = inject(AuthService);

  /** Whether a `/auth/me` request is currently in flight. */
  readonly inFlight = signal(false);

  /** Shared promise so concurrent callers await the same request. */
  private inFlightPromise: Promise<RehydrationResult> | null = null;

  //#endregion

  //#region Public API

  /**
   * Runs on app bootstrap via `APP_INITIALIZER`.
   *
   * Never blocks the router — fires a best-effort refresh when a real
   * JWT is present and resolves immediately otherwise. Errors are
   * swallowed on purpose: the app must start even when the backend is
   * unreachable.
   */
  async hydrateOnBoot(): Promise<void> {
    if (!this.authService.isAuthenticated()) return;
    try {
      await this.refresh();
    } catch {
      // Best-effort — AuthService retains the cached session.
    }
  }

  /**
   * Invoked by shell guards (Back Office, POS) before the target tree
   * renders. Skips the network call when the last successful refresh
   * is within the TTL window.
   *
   * @param shell Which shell the user is transitioning into.
   * @returns A discriminator the guard branches on.
   */
  async hydrateForShell(shell: ShellId): Promise<RehydrationResult> {
    if (!this.authService.isAuthenticated()) return 'no-session';

    const lastAt = this.authService.lastRehydratedAt();
    if (lastAt !== null && Date.now() - lastAt < REHYDRATION_TTL_MS) {
      return 'stale-ok';
    }

    return this.refresh(shell);
  }

  //#endregion

  //#region Internals

  /**
   * Performs a single `/auth/me` call, de-duplicating concurrent callers
   * behind a shared in-flight promise.
   */
  private refresh(shell?: ShellId): Promise<RehydrationResult> {
    if (this.inFlightPromise) return this.inFlightPromise;

    this.inFlight.set(true);
    this.inFlightPromise = this.runRefresh(shell).finally(() => {
      this.inFlight.set(false);
      this.inFlightPromise = null;
    });
    return this.inFlightPromise;
  }

  /**
   * Actual HTTP call + response handling. Separated so `refresh()` can
   * wrap it in the mutex without mixing concerns.
   */
  private async runRefresh(shell?: ShellId): Promise<RehydrationResult> {
    try {
      await firstValueFrom(this.authService.rehydrate());
      return 'ok';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';

      if (message === 'no-session') return 'no-session';

      // HttpErrorResponse from Angular carries `.status`.
      const status = this.readStatus(error);
      if (status === 401 || status === 403) {
        this.authService.logout();
        return 'unauthorized';
      }

      console.warn(
        `[SessionRehydrationService] Hydration failed${shell ? ` for shell="${shell}"` : ''} — using cached state`,
        error,
      );
      return 'stale-ok';
    }
  }

  /** Safely reads the HTTP status from an unknown error shape. */
  private readStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const candidate = (error as { status?: unknown }).status;
    return typeof candidate === 'number' ? candidate : undefined;
  }

  //#endregion

}
