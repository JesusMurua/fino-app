import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CreateCustomerRequest, Customer } from '../models/customer.model';
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
    const branchId = this.authService.branchId;

    // Step 1 — Serve from Dexie immediately
    const local = await this.db.customers
      .where('branchId').equals(branchId)
      .filter(c => c.isActive)
      .sortBy('name');
    if (local.length > 0) {
      this.customers.set(local);
    }

    // Step 2 — Fetch from API in background
    try {
      const remote = await firstValueFrom(
        this.api.get<Customer[]>('/customers'),
      );
      await this.db.customers.bulkPut(remote);
      this.customers.set(remote.filter(c => c.isActive));
    } catch {
      console.warn('[CustomerService] API unreachable — using Dexie cache');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Searches customers by phone prefix or name substring.
   * 100% offline — queries Dexie only.
   * @param query Search string (phone if numeric, name if text)
   */
  async searchByPhoneOrName(query: string): Promise<Customer[]> {
    if (!query || query.trim().length < 2) {
      this.searchResults.set([]);
      return [];
    }

    const branchId = this.authService.branchId;
    const trimmed = query.trim();
    const isNumeric = /^\d+$/.test(trimmed);

    let results: Customer[];
    if (isNumeric) {
      results = await this.db.customers
        .where('phone').startsWith(trimmed)
        .filter(c => c.branchId === branchId && c.isActive)
        .limit(10)
        .toArray();
    } else {
      const lower = trimmed.toLowerCase();
      results = await this.db.customers
        .where('branchId').equals(branchId)
        .filter(c => c.isActive && c.name.toLowerCase().includes(lower))
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
    this.customers.update(arr => [...arr, customer].sort((a, b) => a.name.localeCompare(b.name)));
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
   * Fetches the order history for a specific customer.
   * @param customerId Customer ID
   */
  async getCustomerOrders(customerId: number): Promise<any[]> {
    try {
      return await firstValueFrom(
        this.api.get<any[]>(`/customers/${customerId}/orders`),
      );
    } catch {
      return [];
    }
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
      if (idx === -1) return [...arr, fresh].sort((a, b) => a.name.localeCompare(b.name));
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
