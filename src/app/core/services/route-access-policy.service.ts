import { Injectable } from '@angular/core';

import { UserRoleId } from '../enums';

/**
 * Role allow-list keyed by the first path segment of a URL.
 *
 * Mirrors the `data.roles` arrays declared in `app.routes.ts`. Any change
 * to a route's allow-list MUST be reflected here, otherwise `PinComponent`
 * will incorrectly honor (or reject) a stored `returnUrl` after PIN login.
 *
 * Routes not listed here (public ones like `/pin`, `/login`, `/register`,
 * `/onboarding`, `/setup`, or hardware-only ones like `/kiosk`, `/kitchen`)
 * are treated as unreachable for a human role — returning `false` from
 * `isAllowed()` so `PinComponent` falls back to the rehydration-driven
 * default destination.
 */
const SEGMENT_ROLES: Readonly<Record<string, readonly UserRoleId[]>> = {
  admin:  [UserRoleId.Owner, UserRoleId.Manager],
  pos:    [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter],
  orders: [UserRoleId.Cashier, UserRoleId.Kitchen, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter],
  tables: [UserRoleId.Cashier, UserRoleId.Owner, UserRoleId.Manager, UserRoleId.Waiter, UserRoleId.Host],
};

/**
 * Single source of truth for "is this role allowed to visit this URL?"
 * during the PIN post-login `returnUrl` decision.
 *
 * Kept as a stateless helper in `core/services/` so guards, the PIN
 * component, and tests can consult the same table.
 */
@Injectable({ providedIn: 'root' })
export class RouteAccessPolicy {

  /**
   * Returns whether the given role may resolve the given URL based on
   * the top-level path segment.
   *
   * @param roleId The authenticated user's numeric role.
   * @param url   A relative URL (e.g. `/admin/users?tab=invites`).
   */
  isAllowed(roleId: UserRoleId | null | undefined, url: string | null | undefined): boolean {
    if (roleId == null || !url) return false;

    const segment = this.firstSegment(url);
    if (!segment) return false;

    const allowed = SEGMENT_ROLES[segment];
    if (!allowed) return false;

    return allowed.includes(roleId);
  }

  /**
   * Extracts the first path segment of a URL, stripping leading slashes,
   * query strings and fragments. Returns null when the URL is empty or
   * points at the root.
   */
  private firstSegment(url: string): string | null {
    const trimmed = url.trim();
    if (!trimmed) return null;

    // Drop query / fragment before splitting.
    const pathPart = trimmed.split(/[?#]/, 1)[0];
    const segments = pathPart.split('/').filter(Boolean);
    return segments[0] ?? null;
  }

}
