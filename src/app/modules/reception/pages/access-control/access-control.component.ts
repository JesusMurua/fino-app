import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { Customer } from '../../../../core/models/customer.model';
import { CustomerService } from '../../../../core/services/customer.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { CustomerNamePipe } from '../../../../shared/pipes/customer-name.pipe';

/** Discrete states surfaced by the giant status banner */
type AccessStatus = 'IDLE' | 'VALID' | 'EXPIRED' | 'NOT_FOUND';

/** Debounce window for the manual-search input (ms) */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Reception (gym vertical) — full-screen access-control display.
 *
 * Receptionist scans a member's barcode/QR or types a name/phone; the
 * banner flips to a giant Green/Red status based on
 * `customer.membershipValidUntil`.
 *
 * Search is offline-first via `CustomerService.searchByPhoneOrName` and
 * the HID scanner is captured globally by `ScannerService.onScan`.
 */
@Component({
  selector: 'app-access-control',
  standalone: true,
  imports: [DatePipe, FormsModule, ButtonModule, InputTextModule, CustomerNamePipe],
  templateUrl: './access-control.component.html',
  styleUrl: './access-control.component.scss',
})
export class AccessControlComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly customerService = inject(CustomerService);
  private readonly scannerService = inject(ScannerService);

  private readonly destroy$ = new Subject<void>();
  private readonly query$ = new Subject<string>();

  /** Current value of the search input (bound via ngModel) */
  readonly query = signal('');

  /** Customer currently displayed by the banner (null = idle) */
  readonly selectedCustomer = signal<Customer | null>(null);

  /** Live search results for the dropdown under the input */
  readonly results = signal<Customer[]>([]);

  /** True while a Dexie query is in flight (rare — Dexie is fast) */
  readonly isSearching = signal(false);

  /**
   * True after a barcode scan or explicit search yielded zero matches.
   * Drives the NOT_FOUND banner state. Cleared on every new keystroke.
   */
  readonly noMatchForCode = signal(false);

  /**
   * Re-evaluates every minute so a banner left open across an
   * expiration boundary flips Green→Red without the receptionist
   * needing to refresh.
   */
  private readonly tick = signal(Date.now());
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  /** Final status the template renders */
  readonly accessStatus = computed<AccessStatus>(() => {
    const customer = this.selectedCustomer();

    if (!customer) {
      return this.noMatchForCode() ? 'NOT_FOUND' : 'IDLE';
    }

    const validUntilRaw = customer.membershipValidUntil;
    if (!validUntilRaw) return 'EXPIRED';

    const validUntilMs = new Date(validUntilRaw).getTime();
    return validUntilMs > this.tick() ? 'VALID' : 'EXPIRED';
  });

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    // Manual-search debounce — Dexie is fast but typing-burst protection
    // still avoids re-rendering the dropdown on every keystroke.
    this.query$
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntil(this.destroy$))
      .subscribe(value => this.runSearch(value));

    // HID scanner — auto-pick the single match on a successful scan.
    this.scannerService.startListening();
    this.scannerService.onScan()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => this.handleScan(code));

    // 60 s tick so the banner re-evaluates across midnight or a
    // long idle window without manual intervention.
    this.tickHandle = setInterval(() => this.tick.set(Date.now()), 60_000);
  }

  ngOnDestroy(): void {
    this.scannerService.stopListening();
    this.destroy$.next();
    this.destroy$.complete();
    if (this.tickHandle) clearInterval(this.tickHandle);
  }

  //#endregion

  //#region Search

  /** Bound to the input — pushes through the debounced pipeline */
  onQueryChange(value: string): void {
    this.query.set(value);
    this.noMatchForCode.set(false);

    if (value.trim().length < 2) {
      this.results.set([]);
      return;
    }

    this.query$.next(value);
  }

  /** Runs the offline Dexie search and refreshes the dropdown */
  private async runSearch(value: string): Promise<void> {
    this.isSearching.set(true);
    try {
      const found = await this.customerService.searchByPhoneOrName(value);
      this.results.set(found);
    } finally {
      this.isSearching.set(false);
    }
  }

  /** Receptionist tapped a result row */
  selectCustomer(customer: Customer): void {
    this.selectedCustomer.set(customer);
    this.results.set([]);
    this.query.set('');
    this.noMatchForCode.set(false);
  }

  /** Resets the screen back to its idle state */
  reset(): void {
    this.selectedCustomer.set(null);
    this.results.set([]);
    this.query.set('');
    this.noMatchForCode.set(false);
  }

  //#endregion

  //#region Scanner

  /**
   * Resolves a scanned code to a single customer. The scanner emits
   * raw membership IDs/QR payloads — we look the customer up by phone
   * first (most common encoding), then fall back to name. If the
   * search returns exactly one match we auto-select it; otherwise we
   * surface a NOT_FOUND state so the receptionist sees the failure
   * immediately without needing to read the dropdown.
   */
  private async handleScan(code: string): Promise<void> {
    this.noMatchForCode.set(false);
    const found = await this.customerService.searchByPhoneOrName(code);

    if (found.length === 1) {
      this.selectCustomer(found[0]);
      return;
    }

    if (found.length === 0) {
      this.selectedCustomer.set(null);
      this.noMatchForCode.set(true);
      return;
    }

    // Multiple matches — show the dropdown so the receptionist disambiguates
    this.selectedCustomer.set(null);
    this.results.set(found);
    this.query.set(code);
  }

  //#endregion

}
