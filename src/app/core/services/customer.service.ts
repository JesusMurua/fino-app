import { Injectable, inject, signal } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import {
  CustomerMembership,
  CustomerOrderRowDto,
  CustomerStatsDto,
  MembershipStatus,
  PageData,
} from '../models';
import { CreateCustomerRequest, Customer } from '../models/customer.model';
import { formatCustomerName } from '../../shared/pipes/customer-name.pipe';
import { toLocalIsoDate } from '../utils/date.utils';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DatabaseService } from './database.service';

/**
 * Manages the customer (CRM) database with offline-first caching.
 *
 * Flow:
 *   loadCustomers() → API → Dexie → signal
 *   searchByPhoneOrName() → Dexie only (offline-safe)
 *   createCustomer() → API → Dexie → refresh signal
 *   updateCustomer() → API → Dexie → refresh signal
 */
@Injectable({ providedIn: 'root' })
export class CustomerService {

  //#region Properties
  private readonly api = inject(ApiService);
  private readonly authService = inject(AuthService);
  private readonly db = inject(DatabaseService);

  /** All active customers for the current branch */
  readonly customers = signal<Customer[]>([]);

  /** Customer currently attached to the active cart/order */
  readonly selectedCustomer = signal<Customer | null>(null);

  /** Loading state for the admin table */
  readonly isLoading = signal(false);

  /** Search results for the autocomplete selector */
  readonly searchResults = signal<Customer[]>([]);
  //#endregion

  //#region Public Methods

  /**
   * Loads customers from API and caches in Dexie (stale-while-revalidate).
   * Updates the customers signal with the result.
   */
  async loadCustomers(): Promise<void> {
    this.isLoading.set(true);
    const businessId = this.authService.businessId;

    // Step 1 — Serve from Dexie immediately. Sort is JS-side because
    // the indexed firstName field alone does not produce the same order
    // as the rendered display name (`firstName lastName`).
    const local = await this.db.customers
      .where('businessId').equals(businessId)
      .filter(c => c.isActive)
      .toArray();
    if (local.length > 0) {
      this.customers.set(local.sort(this.byDisplayName));
    }

    // Step 2 — Fetch from API in background
    try {
      const remote = await firstValueFrom(
        this.api.get<Customer[]>('/customers'),
      );
      await this.db.customers.bulkPut(remote);
      this.customers.set(remote.filter(c => c.isActive).sort(this.byDisplayName));
    } catch {
      console.warn('[CustomerService] API unreachable — using Dexie cache');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Lazy-hydrates the cache (signal + Dexie) the first time it is
   * needed. Idempotent — returns immediately when the in-memory
   * signal already carries customers. Used as a guard at the entry
   * points (`searchByPhoneOrName`) so consumers outside the admin
   * shell (POS, reception) do not depend on someone else having
   * called `loadCustomers()` first. Necessary after FDD-026 because
   * the v26 Dexie upgrade clears the customers store.
   */
  async ensureLoaded(): Promise<void> {
    if (this.customers().length > 0) return;
    await this.loadCustomers();
  }

  /**
   * Searches customers by phone prefix or name substring.
   * Dexie-backed — auto-hydrates the cache on first call.
   * @param query Search string (phone if numeric, name if text)
   */
  async searchByPhoneOrName(query: string): Promise<Customer[]> {
    if (!query || query.trim().length < 2) {
      this.searchResults.set([]);
      return [];
    }

    // Self-heal when Dexie is empty (e.g. fresh install or post v26
    // schema upgrade) — without this, the POS search dropdown stays
    // empty until the cashier visits an admin route that triggers
    // loadCustomers().
    await this.ensureLoaded();

    const businessId = this.authService.businessId;
    const trimmed = query.trim();
    const isNumeric = /^\d+$/.test(trimmed);

    let results: Customer[];
    if (isNumeric) {
      results = await this.db.customers
        .where('phone').startsWith(trimmed)
        .filter(c => c.businessId === businessId && c.isActive)
        .limit(10)
        .toArray();
    } else {
      const lower = trimmed.toLowerCase();
      results = await this.db.customers
        .where('businessId').equals(businessId)
        .filter(c => c.isActive && formatCustomerName(c).toLowerCase().includes(lower))
        .limit(10)
        .toArray();
    }

    this.searchResults.set(results);
    return results;
  }

  /**
   * Creates a new customer via API and caches in Dexie.
   * @param data Customer creation payload
   */
  async createCustomer(data: CreateCustomerRequest): Promise<Customer> {
    const customer = await firstValueFrom(
      this.api.post<Customer>('/customers', data),
    );
    await this.db.customers.put(customer);
    this.customers.update(arr => [...arr, customer].sort(this.byDisplayName));
    return customer;
  }

  /**
   * Updates an existing customer via API and caches in Dexie.
   * @param id Customer ID
   * @param data Partial update payload
   */
  async updateCustomer(id: number, data: Partial<Customer>): Promise<Customer> {
    const updated = await firstValueFrom(
      this.api.put<Customer>(`/customers/${id}`, data),
    );
    await this.db.customers.put(updated);
    this.customers.update(arr =>
      arr.map(c => c.id === id ? updated : c),
    );
    return updated;
  }

  /**
   * Fetches a single page of the customer's order history.
   *
   * Errors are NOT swallowed — callers can `try/catch` to surface a
   * toast or fall back to an empty list. Aligns with FDD-027 §3.1
   * and the project's bubble-up pattern (see `createCustomer`).
   *
   * @param customerId Customer ID
   * @param opts Pagination + date filters; all keys are optional and
   * only forwarded to the backend when defined.
   */
  async getOrders(
    customerId: number,
    opts?: { page?: number; pageSize?: number; from?: Date; to?: Date },
  ): Promise<PageData<CustomerOrderRowDto>> {
    let params = new HttpParams();
    if (opts?.page !== undefined)     params = params.set('page', opts.page);
    if (opts?.pageSize !== undefined) params = params.set('pageSize', opts.pageSize);
    if (opts?.from)                   params = params.set('from', toLocalIsoDate(opts.from));
    if (opts?.to)                     params = params.set('to', toLocalIsoDate(opts.to));

    return firstValueFrom(
      this.api.get<PageData<CustomerOrderRowDto>>(`/customers/${customerId}/orders`, params),
    );
  }

  /**
   * Fetches the customer's memberships (active + historical) sorted
   * by `validUntil` desc per BDD-019 §5.1.2. Optional `status` filter
   * is applied server-side.
   *
   * Direct API call — admin context is online-only. The offline
   * reception cache lives in `CustomerMembershipsService` (FDD-027 §3.4).
   *
   * @param customerId Customer ID
   * @param status Optional lifecycle filter
   */
  async getMemberships(
    customerId: number,
    status?: MembershipStatus,
  ): Promise<CustomerMembership[]> {
    const path = status
      ? `/customers/${customerId}/memberships?status=${status}`
      : `/customers/${customerId}/memberships`;
    return firstValueFrom(this.api.get<CustomerMembership[]>(path));
  }

  /**
   * Fetches aggregated lifetime stats for a customer (totalSpentCents,
   * orderCount, lastOrderAt). Single GROUP BY on the BE per BDD-019
   * §5.1.3 — used by the admin drawer header.
   *
   * @param customerId Customer ID
   */
  async getStats(customerId: number): Promise<CustomerStatsDto> {
    return firstValueFrom(
      this.api.get<CustomerStatsDto>(`/customers/${customerId}/stats`),
    );
  }

  /**
   * Adjusts loyalty points for a customer.
   * @param customerId Customer ID
   * @param delta Points to add (positive) or subtract (negative)
   * @param reason Reason for the adjustment
   */
  async adjustPoints(customerId: number, delta: number, reason: string): Promise<void> {
    await firstValueFrom(
      this.api.post(`/customers/${customerId}/adjust-points`, { delta, reason }),
    );
    // Refresh the customer data
    await this.refreshCustomer(customerId);
  }

  /**
   * Adjusts store credit for a customer.
   * @param customerId Customer ID
   * @param deltaCents Amount in cents to add (positive) or subtract (negative)
   * @param reason Reason for the adjustment
   */
  async adjustCredit(customerId: number, deltaCents: number, reason: string): Promise<void> {
    await firstValueFrom(
      this.api.post(`/customers/${customerId}/adjust-credit`, { deltaCents, reason }),
    );
    await this.refreshCustomer(customerId);
  }

  /** Sets the customer attached to the current cart/order */
  selectCustomer(customer: Customer | null): void {
    this.selectedCustomer.set(customer);
  }

  /** Clears the customer selection */
  clearSelection(): void {
    this.selectedCustomer.set(null);
  }

  /**
   * Re-reads a single customer from Dexie and pushes the fresh row
   * into the public signals so the UI reacts without a full reload.
   *
   * Intended for callers that mutate the Dexie row directly (offline
   * side-effects like the membership extension hook in `SyncService`).
   * No API call is made — the local row is treated as authoritative.
   *
   * Best-effort: if the customer is no longer cached, signals remain
   * unchanged so we never blank an active selection on a transient miss.
   */
  async refreshFromDb(customerId: number): Promise<void> {
    const fresh = await this.db.customers.get(customerId);
    if (!fresh) return;

    this.customers.update(arr => {
      const idx = arr.findIndex(c => c.id === customerId);
      if (idx === -1) return [...arr, fresh].sort(this.byDisplayName);
      const next = arr.slice();
      next[idx] = fresh;
      return next;
    });

    if (this.selectedCustomer()?.id === customerId) {
      this.selectedCustomer.set(fresh);
    }
  }

  //#endregion

  //#region Private Helpers

  /**
   * Comparator that orders customers by their full display name (first +
   * last) using locale-aware comparison. Centralised so every consumer
   * keeps the same ordering after the model split.
   */
  private readonly byDisplayName = (a: Customer, b: Customer): number =>
    formatCustomerName(a).localeCompare(formatCustomerName(b));

  /** Refreshes a single customer from API and updates local state */
  private async refreshCustomer(id: number): Promise<void> {
    try {
      const fresh = await firstValueFrom(
        this.api.get<Customer>(`/customers/${id}`),
      );
      await this.db.customers.put(fresh);
      this.customers.update(arr =>
        arr.map(c => c.id === id ? fresh : c),
      );
      // If this is the selected customer, update that signal too
      if (this.selectedCustomer()?.id === id) {
        this.selectedCustomer.set(fresh);
      }
    } catch {
      console.warn(`[CustomerService] Failed to refresh customer ${id}`);
    }
  }

  //#endregion

}
