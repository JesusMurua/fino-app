import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { SessionRehydrationService } from '../services/session-rehydration.service';

/**
 * Opportunistically refreshes the session when the user re-enters the
 * POS shell from Back Office (or from a deep-link outside `/pos`).
 *
 * Fail-open guard: never redirects. Returns `true` even when the
 * network call fails — the cached session is trustworthy enough to
 * render the POS. Callers of `hydrateForShell('pos')` internally
 * enforce a 60 s TTL so repeated transitions are cheap.
 *
 * Compose AFTER `authGuard`, `roleGuard`, `terminalGuard` and
 * `posEntryGuard` so the call is only issued for sessions that are
 * genuinely allowed on `/pos`.
 */
export const posShellGuard: CanActivateFn = async () => {
  const rehydration = inject(SessionRehydrationService);
  await rehydration.hydrateForShell('pos');
  return true;
};
