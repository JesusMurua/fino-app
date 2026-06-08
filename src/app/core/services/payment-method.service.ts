import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AvailablePaymentMethod } from '../models/available-payment-method.model';
import { PaymentCategory } from '../enums/payment-category.enum';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

const STORAGE_KEY_PREFIX = 'payment_methods_';

/**
 * Last-resort fallback used when both the network and the local cache are
 * unavailable — guarantees the cashier can always close a sale offline with
 * the four `IsSystem` methods that exist in every seeded environment. `id: 0`
 * is a sentinel: the persisted order ships by `code` (the freeze key per
 * `docs/payment-method-catalog-api.md` §1.5), so the backend resolves the
 * real catalog id at sync time.
 */
const HARDCODED_FALLBACK: AvailablePaymentMethod[] = [
  {
    id: 0,
    code: 'Cash',
    name: 'Efectivo',
    category: PaymentCategory.Cash,
    supportsOverpay: true,
    requiresReference: false,
    requiresCustomer: false,
    sortOrder: 10,
  },
  {
    id: 0,
    code: 'Card',
    name: 'Tarjeta',
    category: PaymentCategory.Card,
    supportsOverpay: false,
    requiresReference: false,
    requiresCustomer: false,
    sortOrder: 20,
  },
  {
    id: 0,
    code: 'Transfer',
    name: 'Transferencia',
    category: PaymentCategory.Digital,
    supportsOverpay: false,
    requiresReference: true,
    requiresCustomer: false,
    sortOrder: 30,
  },
  {
    id: 0,
    code: 'Other',
    name: 'Otro',
    category: PaymentCategory.Other,
    supportsOverpay: false,
    requiresReference: false,
    requiresCustomer: false,
    sortOrder: 40,
  },
];

/**
 * Loads and exposes the per-tenant set of usable payment methods from
 * `GET /api/payment-methods/available` (PR-B backend). Three-layer
 * degradation so the cashier can always cobrar:
 *
 *   1. Network — fresh fetch on demand (idempotent: safe to call N times).
 *   2. Local cache — `localStorage` keyed by `businessId`, written on every
 *      successful network load. Survives full reload + lets the next session
 *      open offline with the last-known list.
 *   3. Hardcoded fallback — the four `IsSystem` methods (Cash/Card/Transfer/
 *      Other). Triggered only when both network and cache are empty (e.g.
 *      brand-new install signed in for the first time offline). Marked via
 *      `usedFallback()` so the UI can surface a "modo de respaldo" banner.
 *
 * The backend has its own server-side per-tenant cache (5-min TTL, invalidated
 * on admin mutation), so we don't add aggressive client caching beyond
 * "remember last good snapshot for offline." Callers can call `loadAvailable()`
 * anytime to refresh.
 */
@Injectable({ providedIn: 'root' })
export class PaymentMethodService {

  //#region Dependencies

  private readonly api = inject(ApiService);
  private readonly authService = inject(AuthService);

  //#endregion

  //#region State

  private readonly _availableMethods = signal<AvailablePaymentMethod[]>([]);
  private readonly _loaded = signal(false);
  private readonly _usedFallback = signal(false);

  /** Methods the logged-in tenant may use, ordered by `sortOrder` then `code`. */
  readonly availableMethods = this._availableMethods.asReadonly();

  /** `true` once `loadAvailable()` has resolved (success or fallback) at least once. */
  readonly loaded = this._loaded.asReadonly();

  /**
   * `true` when the current `availableMethods()` came from the hardcoded
   * last-resort list — neither the network nor the cache produced a value.
   * UI surfaces a "Modo de respaldo" banner so the cashier knows.
   */
  readonly usedFallback = this._usedFallback.asReadonly();

  /** Quick lookup by `code` — useful when persisting an order. */
  readonly methodsByCode = computed(() => {
    const map = new Map<string, AvailablePaymentMethod>();
    for (const m of this._availableMethods()) map.set(m.code, m);
    return map;
  });

  //#endregion

  //#region Public API

  /**
   * Loads the per-tenant catalog from the API, falling back to local cache
   * then to hardcoded methods as documented above. Always resolves — never
   * throws — so the caller can trust `availableMethods()` to be non-empty
   * once `loaded()` flips true.
   */
  async loadAvailable(): Promise<void> {
    try {
      const fromApi = await firstValueFrom(
        this.api.get<AvailablePaymentMethod[]>('/payment-methods/available'),
      );
      if (Array.isArray(fromApi) && fromApi.length > 0) {
        this.applyMethods(fromApi, false);
        this.writeCache(fromApi);
        return;
      }
      // API returned empty (plan with no seeded matrix) — try cache then fallback
      this.loadFromCacheOrFallback();
    } catch {
      this.loadFromCacheOrFallback();
    }
  }

  /**
   * Resolves a method by its stable `code`. Returns `undefined` if absent —
   * the caller decides whether to treat that as an error or surface "Otro".
   */
  getByCode(code: string): AvailablePaymentMethod | undefined {
    return this.methodsByCode().get(code);
  }

  //#endregion

  //#region Private helpers

  private loadFromCacheOrFallback(): void {
    const cached = this.readCache();
    if (cached && cached.length > 0) {
      this.applyMethods(cached, false);
      return;
    }
    this.applyMethods(HARDCODED_FALLBACK, true);
  }

  private applyMethods(methods: AvailablePaymentMethod[], usedFallback: boolean): void {
    const sorted = [...methods].sort((a, b) =>
      a.sortOrder !== b.sortOrder
        ? a.sortOrder - b.sortOrder
        : a.code.localeCompare(b.code),
    );
    this._availableMethods.set(sorted);
    this._usedFallback.set(usedFallback);
    this._loaded.set(true);
  }

  private storageKey(): string | null {
    const businessId = this.authService.businessId;
    if (!businessId) return null;
    return `${STORAGE_KEY_PREFIX}${businessId}`;
  }

  private readCache(): AvailablePaymentMethod[] | null {
    const key = this.storageKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AvailablePaymentMethod[]) : null;
    } catch {
      return null;
    }
  }

  private writeCache(methods: AvailablePaymentMethod[]): void {
    const key = this.storageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(methods));
    } catch {
      // localStorage full or denied — non-fatal, in-memory state still works
    }
  }

  //#endregion
}
