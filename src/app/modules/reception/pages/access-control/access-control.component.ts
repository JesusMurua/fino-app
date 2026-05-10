import { Component, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import {
  AutoComplete,
  AutoCompleteCompleteEvent,
  AutoCompleteModule,
  AutoCompleteSelectEvent,
} from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { CustomerMembership, isCurrentlyValid } from '../../../../core/models';
import { Customer } from '../../../../core/models/customer.model';
import { CustomerMembershipsService } from '../../../../core/services/customer-memberships.service';
import { CustomerService } from '../../../../core/services/customer.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { CustomerNamePipe } from '../../../../shared/pipes/customer-name.pipe';

/** Discrete states surfaced by the giant status banner. */
type AccessStatus = 'IDLE' | 'VALID' | 'EXPIRED' | 'NO_MEMBERSHIP' | 'NOT_FOUND';

/**
 * Reception (gym vertical) — full-screen access-control display with
 * offline-first membership validation. Reads from the local Dexie
 * cache for instant feedback, with background refresh from the API
 * when online.
 */
@Component({
  selector: 'app-access-control',
  standalone: true,
  imports: [DatePipe, FormsModule, AutoCompleteModule, ButtonModule, InputTextModule, CustomerNamePipe],
  templateUrl: './access-control.component.html',
  styleUrl: './access-control.component.scss',
})
export class AccessControlComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly customerService = inject(CustomerService);
  private readonly customerMembershipsService = inject(CustomerMembershipsService);
  private readonly scannerService = inject(ScannerService);

  private readonly destroy$ = new Subject<void>();

  /**
   * Handle on the autocomplete so `handleScan` can trigger PrimeNG's
   * canonical `search()` lifecycle programmatically when a scanned
   * code resolves to multiple matches.
   */
  readonly ac = viewChild('ac', { read: AutoComplete });

  /**
   * Pure-helper re-export for template binding. The function lives in
   * `customer-history.model.ts`; Angular templates can only call class
   * properties, so we expose a class-level reference here.
   */
  readonly isCurrentlyValid = isCurrentlyValid;

  /**
   * Backing model for the autocomplete input. Cleared synchronously in
   * `(onSelect)` so the giant status banner takes over without leaving
   * a residual customer name in the search input.
   */
  readonly acModel = signal<Customer | null>(null);

  /** Customer currently displayed by the banner (null = idle) */
  readonly selectedCustomer = signal<Customer | null>(null);

  /** Membership row resolved from the Dexie cache for `selectedCustomer`. */
  readonly activeMembership = signal<CustomerMembership | null>(null);

  /** Suggestions feed for the autocomplete. */
  readonly results = signal<Customer[]>([]);

  /** True while a Dexie query is in flight (rare — Dexie is fast) */
  readonly isSearching = signal(false);

  /**
   * True after a barcode scan or explicit search yielded zero matches.
   * Drives the NOT_FOUND banner state. Cleared on every new keystroke.
   */
  readonly noMatchForCode = signal(false);

  /**
   * Reactive connectivity flag. Updated by `online`/`offline` window
   * events bound in `ngOnInit` and torn down in `ngOnDestroy` so the
   * "Sin conexión" pill in the template reflects state changes mid-
   * session without a manual refresh.
   */
  readonly isOnline = signal(navigator.onLine);

  private readonly handleOnline = () => this.isOnline.set(true);
  private readonly handleOffline = () => this.isOnline.set(false);

  /** Final status the template renders */
  readonly accessStatus = computed<AccessStatus>(() => {
    const customer = this.selectedCustomer();
    if (!customer) {
      return this.noMatchForCode() ? 'NOT_FOUND' : 'IDLE';
    }
    const m = this.activeMembership();
    if (!m) return 'NO_MEMBERSHIP';
    return this.isCurrentlyValid(m) ? 'VALID' : 'EXPIRED';
  });

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    // HID scanner — auto-pick the single match on a successful scan.
    this.scannerService.startListening();
    this.scannerService.onScan()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => this.handleScan(code));

    // Connectivity listeners — keep `isOnline` reactive so the
    // "Sin conexión" pill flips without a manual refresh.
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  ngOnDestroy(): void {
    this.scannerService.stopListening();
    this.destroy$.next();
    this.destroy$.complete();
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  //#endregion

  //#region Search

  /**
   * Bound to `(completeMethod)`. PrimeNG's `[delay]="300"` and
   * `[minLength]="2"` handle debounce and threshold natively, so this
   * handler runs only when there is real work to do.
   */
  async onComplete(event: AutoCompleteCompleteEvent): Promise<void> {
    this.noMatchForCode.set(false);
    this.isSearching.set(true);
    try {
      const found = await this.customerService.searchByPhoneOrName(event.query);
      this.results.set(found);
    } finally {
      this.isSearching.set(false);
    }
  }

  /**
   * Bound to `(onSelect)`. Clears `acModel` synchronously to prevent
   * the autocomplete input from holding the selected customer's name
   * after the banner takes over, then runs the offline-first lookup.
   */
  onCustomerSelect(event: AutoCompleteSelectEvent): void {
    this.acModel.set(null);
    void this.selectCustomer(event.value as Customer);
  }

  /**
   * Receptionist tapped a result row. Implements the FDD-027 §3.4
   * True Offline-First flow:
   *   1. Reset all section state (prevents flash from previous scan).
   *   2. Read the local Dexie cache synchronously — instant banner.
   *   3. First-scan edge case: if the cache is empty AND we are
   *      online, await `loadFor` and re-read before deciding the
   *      access status (avoids a misleading "Sin membresía" flash).
   *   4. Staleness guard: if the receptionist scanned a different
   *      customer mid-flight, abandon this update.
   *   5. Set `activeMembership` from the freshest cache snapshot.
   *   6. Background refresh: if cache had data and we are online,
   *      kick off a non-blocking `loadFor` that updates the signal
   *      once the API responds (with double staleness guard + inner
   *      try/catch around the Dexie re-read).
   */
  async selectCustomer(customer: Customer): Promise<void> {
    this.selectedCustomer.set(customer);
    this.activeMembership.set(null);
    this.results.set([]);
    this.noMatchForCode.set(false);

    const id = customer.id;
    let localMemberships = await this.customerMembershipsService.getLocalMemberships(id);

    // First-scan edge case — wait for the API before deciding status.
    if (localMemberships.length === 0 && this.isOnline()) {
      await this.customerMembershipsService.loadFor(id).catch(() => {});
      localMemberships = await this.customerMembershipsService.getLocalMemberships(id);
    }

    // Staleness guard — receptionist may have scanned a different
    // customer while we were awaiting.
    if (this.selectedCustomer()?.id !== id) return;

    this.activeMembership.set(localMemberships[0] ?? null);

    // Background refresh — only when we already had a cached row,
    // otherwise the first-scan branch above already covered the fetch.
    if (this.isOnline() && localMemberships.length > 0) {
      void this.customerMembershipsService.loadFor(id)
        .then(async () => {
          if (this.selectedCustomer()?.id !== id) return;
          try {
            const fresh = await this.customerMembershipsService.getLocalMemberships(id);
            if (this.selectedCustomer()?.id === id) {
              this.activeMembership.set(fresh[0] ?? null);
            }
          } catch (err) {
            console.warn('[AccessControl] Background refresh read failed:', err);
          }
        })
        .catch(() => {});
    }
  }

  /** Resets the screen back to its idle state */
  reset(): void {
    this.selectedCustomer.set(null);
    this.activeMembership.set(null);
    this.results.set([]);
    this.acModel.set(null);
    this.noMatchForCode.set(false);
  }

  //#endregion

  //#region Scanner

  /**
   * Resolves a scanned code to a single customer. The scanner emits
   * raw membership IDs/QR payloads — we look the customer up by phone
   * first (most common encoding), then fall back to name. Behaviour:
   *   - Single match → auto-select.
   *   - Zero matches → NOT_FOUND banner.
   *   - Multiple matches → trigger PrimeNG's canonical `search()` so
   *     the autocomplete panel opens with the disambiguation options.
   */
  private async handleScan(code: string): Promise<void> {
    this.noMatchForCode.set(false);
    const found = await this.customerService.searchByPhoneOrName(code);

    if (found.length === 1) {
      void this.selectCustomer(found[0]);
      return;
    }

    if (found.length === 0) {
      this.selectedCustomer.set(null);
      this.noMatchForCode.set(true);
      return;
    }

    // Multiple matches — surface the panel via PrimeNG's public `search()`
    // API. This re-runs `(completeMethod)` (cheap on Dexie) which fills
    // the suggestions and opens the overlay through the canonical path.
    this.selectedCustomer.set(null);
    this.ac()?.search(new Event('input'), code, 'click');
  }

  //#endregion

}
