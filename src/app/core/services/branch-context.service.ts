import { Injectable, signal } from '@angular/core';

import { ACTIVE_BRANCH_KEY } from '../models';

/**
 * Lightweight, dependency-free store for the active branch ID.
 *
 * Owns the `ACTIVE_BRANCH_KEY` localStorage entry and the reactive signal
 * that components subscribe to. Extracted from `AuthService` so that
 * services lower in the DI graph (notably `ConfigService`) can read the
 * active branch without depending on `AuthService` — the cycle that
 * AUDIT-046 traced through the auth interceptor.
 *
 * Single source of truth: `AuthService` writes to this store on login,
 * branch switch, offline re-auth, and logout; reads everywhere else go
 * through `activeBranchId()` (signal) or `AuthService.branchId` (proxy
 * getter that re-exports this signal).
 */
@Injectable({ providedIn: 'root' })
export class BranchContextService {

  /**
   * Active branch ID — `0` when no branch has been selected yet
   * (auth guards block access in that state). Hydrated from
   * localStorage on construction so the last-selected branch
   * survives a hard refresh.
   */
  readonly activeBranchId = signal<number>(this.loadStored());

  /**
   * Persists the new branch ID and updates the reactive signal in
   * lockstep. Components reacting via `effect()` re-render on the
   * next change-detection cycle.
   */
  setBranchId(id: number): void {
    this.activeBranchId.set(id);
    localStorage.setItem(ACTIVE_BRANCH_KEY, id.toString());
  }

  /**
   * Resets the active branch to `0` and clears localStorage.
   * Called by `AuthService.logout()`.
   */
  clear(): void {
    this.activeBranchId.set(0);
    localStorage.removeItem(ACTIVE_BRANCH_KEY);
  }

  private loadStored(): number {
    const raw = localStorage.getItem(ACTIVE_BRANCH_KEY);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

}
