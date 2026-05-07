import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { CustomerMembership } from '../models';
import { ApiService } from './api.service';
import { DatabaseService } from './database.service';

/**
 * Manages the offline-first cache of `CustomerMembership` rows.
 *
 * Flow (FDD-027 P2):
 *   loadFor(customerId) → API → Dexie (delete-then-bulkPut, transactional)
 *   getLocalMemberships(customerId) → Dexie only (offline-safe)
 *
 * Refresh-always semantics: every `loadFor` call replaces the local
 * snapshot for the given customer with the authoritative server view.
 * The delete-before-insert guarantees that BE-side row removals (e.g.
 * a cancelled membership pruned out of the listing) do not leave
 * ghost records in Dexie.
 *
 * The backend's `CustomerMembershipDto` omits `customerId` (it is
 * implicit in the URL); this service stamps it back into each row
 * before persisting so the Dexie secondary index actually populates.
 */
@Injectable({ providedIn: 'root' })
export class CustomerMembershipsService {

  //#region Properties
  private readonly api = inject(ApiService);
  private readonly db = inject(DatabaseService);
  //#endregion

  //#region Public Methods

  /**
   * Refreshes the local membership cache for a single customer from
   * the authoritative API. Skips the network round-trip when offline
   * so the receptionist does not see noisy warnings between scans.
   *
   * Errors are swallowed and logged so the caller never crashes —
   * the offline cache survives a failed refresh and consumers fall
   * back to whatever was cached previously.
   *
   * @param customerId Owning customer's id.
   */
  async loadFor(customerId: number): Promise<void> {
    if (!navigator.onLine) return;

    try {
      const remote = await firstValueFrom(
        this.api.get<CustomerMembership[]>(`/customers/${customerId}/memberships`),
      );

      // The BE response omits `customerId` (implicit in the URL); stamp
      // it back into each row so the Dexie `customerId` secondary
      // index — and the `[customerId+status]` composite — populate.
      const stamped = remote.map(m => ({ ...m, customerId }));

      await this.db.transaction('rw', this.db.customerMemberships, async () => {
        await this.db.customerMemberships
          .where('customerId').equals(customerId)
          .delete();
        await this.db.customerMemberships.bulkPut(stamped);
      });
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        console.warn(
          `[CustomerMembershipsService] API error ${err.status} for customer ${customerId}:`,
          err.message,
        );
      } else {
        console.warn(
          `[CustomerMembershipsService] Cache error for customer ${customerId}:`,
          err,
        );
      }
    }
  }

  /**
   * Pulls the cross-customer "expiring soon" list from the API. Used
   * by the admin dashboard widget — the call is online-only and does
   * NOT touch the local cache (admin context, no offline support).
   *
   * The backend response includes `customerName` so the widget can
   * render owner names without a separate lookup.
   *
   * @param days Lookahead window in days (default 7).
   */
  async getExpiringSoon(days: number = 7): Promise<CustomerMembership[]> {
    return firstValueFrom(
      this.api.get<CustomerMembership[]>(`/memberships/expiring?days=${days}`),
    );
  }

  /**
   * Reads the cached memberships for a customer from Dexie, sorted by
   * `validUntil` descending (most recent expiration first).
   *
   * Sorting is performed in JavaScript because Dexie's `sortBy` runs
   * in-memory anyway and would silently ignore a preceding `.reverse()`
   * call. Coercing through `new Date(...)` keeps the comparison safe
   * regardless of whether `validUntil` is an ISO string or a `Date`.
   *
   * @param customerId Owning customer's id.
   */
  async getLocalMemberships(customerId: number): Promise<CustomerMembership[]> {
    const arr = await this.db.customerMemberships
      .where('customerId').equals(customerId)
      .toArray();

    return arr.sort((a, b) =>
      new Date(b.validUntil).getTime() - new Date(a.validUntil).getTime(),
    );
  }

  //#endregion

}
