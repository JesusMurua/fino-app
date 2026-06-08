import { Component, EventEmitter, Output, computed, effect, inject, input, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';

import { CartItem, Order, OrderPayment, PaymentMethod } from '../../../../core/models';
import { AvailablePaymentMethod } from '../../../../core/models/available-payment-method.model';
import { PaymentCategory } from '../../../../core/enums/payment-category.enum';
import { PaymentStatus, SyncStatusId } from '../../../../core/enums';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { PaymentMethodService } from '../../../../core/services/payment-method.service';
import { PrintService } from '../../../../core/services/print.service';
import { SyncService } from '../../../../core/services/sync.service';

/** Bill denominations in MXN (in centavos) — modifier maps to SCSS color theme */
const BILL_DENOMINATIONS = [
  { label: '$20',   cents: 2000,   modifier: 'b20'   },
  { label: '$50',   cents: 5000,   modifier: 'b50'   },
  { label: '$100',  cents: 10000,  modifier: 'b100'  },
  { label: '$200',  cents: 20000,  modifier: 'b200'  },
  { label: '$500',  cents: 50000,  modifier: 'b500'  },
  { label: '$1000', cents: 100000, modifier: 'b1000' },
];

/**
 * Categories that, in this PR's MVP scope, surface as informational placeholders
 * rather than functional inputs. Customer-balance (`Credit`, `Points`) needs a
 * customer selector + balance validation; provider-backed methods need the
 * `PaymentProcessingDialog` integration. Both will land in follow-up commits
 * within this same branch — listing them here keeps `selectMethod()` aware of
 * which catalog rows are merely visible vs interactive.
 */
const DEFERRED_CATEGORIES: ReadonlySet<PaymentCategory> = new Set([
  PaymentCategory.Credit,
  PaymentCategory.Points,
]);

const CATEGORY_DEFAULT_ICON: Record<PaymentCategory, string> = {
  [PaymentCategory.Cash]: 'pi pi-money-bill',
  [PaymentCategory.Card]: 'pi pi-credit-card',
  [PaymentCategory.Digital]: 'pi pi-arrows-h',
  [PaymentCategory.Credit]: 'pi pi-wallet',
  [PaymentCategory.Points]: 'pi pi-star',
  [PaymentCategory.Voucher]: 'pi pi-ticket',
  [PaymentCategory.Other]: 'pi pi-ellipsis-h',
};

/**
 * Inline quick-pay dialog used by non-F&B verticals (Services, Retail,
 * Counter, Quick) to skip the full `/pos/checkout` page and complete the
 * sale in a single tap.
 *
 * Multi-method aware: the available methods come from
 * `PaymentMethodService` (which loads `GET /api/payment-methods/available`
 * with offline fallback). The cashier picks a method tab and the inputs
 * adapt to its category:
 *
 *   - Cash       → bill denominations + custom amount + change
 *   - Card / Digital / Voucher / Other → exact amount + optional reference
 *   - Credit / Points (customer balance) → deferred placeholder (next commit)
 *   - Provider methods (Clip / MercadoPago / BankTerminal) → deferred placeholder
 *
 * Multi-payment architecture is in place (signal `pendingPayments` + the
 * derived totals) but the UI is single-method in this PR — `confirmPayment()`
 * always builds a one-row `payments[]`. The follow-up "Dividir" UI will only
 * append entries to `pendingPayments`; the persistence path stays the same.
 *
 * Stays in the Fast-Lane bounded context: it does **not** import any
 * `/pos/checkout` component. Provider integration when it lands will reuse
 * the *shared* `PaymentProcessingDialog` + the *singleton*
 * `PaymentProviderService`, not the F&B checkout itself.
 */
@Component({
  selector: 'app-quick-pay',
  standalone: true,
  imports: [ButtonModule, DialogModule, PricePipe],
  templateUrl: './quick-pay.component.html',
  styleUrl: './quick-pay.component.scss',
})
export class QuickPayComponent {

  //#region Properties

  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly paymentMethodService = inject(PaymentMethodService);
  private readonly syncService = inject(SyncService);
  private readonly printService = inject(PrintService);
  private readonly messageService = inject(MessageService);

  /** Two-way bound dialog visibility, owned by the parent */
  readonly visible = input<boolean>(false);
  @Output() readonly visibleChange = new EventEmitter<boolean>();

  /** Bill denomination buttons */
  readonly bills = BILL_DENOMINATIONS;

  /** Catalog state proxied from the service so the template stays declarative. */
  readonly availableMethods = this.paymentMethodService.availableMethods;
  readonly usedFallback = this.paymentMethodService.usedFallback;

  /** Currently selected method tab. `null` until the catalog resolves. */
  readonly selectedMethod = signal<AvailablePaymentMethod | null>(null);

  /** Cart total proxied from the shared CartService */
  readonly cartTotal = this.cartService.totalCents;

  /** Number of items in cart proxied from the shared CartService */
  readonly cartItemCount = this.cartService.itemCount;

  /**
   * Cash-only state: amount tendered (in centavos), accumulated via bill taps
   * or the free-form input. Reset on cart clear or method change away from
   * cash.
   */
  readonly receivedAmount = signal(0);

  /** Free-form amount typed by the cashier in the Cash tab (raw string in pesos) */
  readonly customAmountInput = signal('');

  /**
   * Non-cash exact-amount input (pesos). Defaults to the full cart total when
   * the cashier switches to a card/digital/voucher/other tab and lets them
   * adjust if needed. Capped at the remaining balance by template binding
   * (`max`) so the cashier cannot overpay on a method whose
   * `supportsOverpay` is false.
   */
  readonly exactAmountPesos = signal(0);

  /** Reference field for methods with `requiresReference: true` (folio, last-4, etc.) */
  readonly referenceInput = signal('');

  /**
   * Multi-payment architecture (single-method UI in this PR). Stays empty for
   * now; the follow-up "Dividir" feature will start pushing entries into it.
   * Persistence already reads `[…pendingPayments, currentPayment].filter(…)`
   * so flipping the UI later is a template change, not a logic change.
   */
  readonly pendingPayments = signal<OrderPayment[]>([]);

  /** Total already-committed (in pendingPayments). Today always 0. */
  readonly committedCents = computed(() =>
    this.pendingPayments().reduce((sum, p) => sum + p.amountCents, 0),
  );

  /** Cart total minus what's already committed via pendingPayments. */
  readonly remainingCents = computed(() =>
    Math.max(0, this.cartTotal() - this.committedCents()),
  );

  /**
   * Centavos that *this turn's* tab will tender. Reads from `receivedAmount`
   * when the active method is cash; from `exactAmountPesos` otherwise.
   * Defaults to the remaining balance for non-cash so the cashier rarely has
   * to type the exact figure.
   */
  readonly currentTenderedCents = computed(() => {
    const m = this.selectedMethod();
    if (!m) return 0;
    if (m.category === PaymentCategory.Cash) return this.receivedAmount();
    const pesos = this.exactAmountPesos();
    if (pesos > 0) return Math.round(pesos * 100);
    // No explicit amount entered yet → default to remaining (typed on confirm).
    return this.remainingCents();
  });

  /** Change to return to the customer in centavos (cash overpay only). */
  readonly changeAmount = computed(() => {
    const m = this.selectedMethod();
    if (!m || !m.supportsOverpay) return 0;
    return Math.max(0, this.currentTenderedCents() - this.remainingCents());
  });

  /**
   * True when the cashier can confirm the cobro. Branches by category:
   *
   *   - $0 total (full promo discount) confirms instantly.
   *   - Cash: tendered must cover the remaining.
   *   - Card / Digital / Voucher / Other: exact-amount must equal remaining
   *     (no overpay because `supportsOverpay` is false).
   *   - Methods in `DEFERRED_CATEGORIES`: never confirmable in this PR — the
   *     tabs are visible but interaction is blocked.
   *
   * Empty cart is also blocked separately at the button.
   */
  readonly canConfirmQuickPay = computed<boolean>(() => {
    if (this.cartTotal() === 0) return true;
    const m = this.selectedMethod();
    if (!m) return false;
    if (DEFERRED_CATEGORIES.has(m.category)) return false;
    if (m.providerKey) return false; // provider methods deferred
    // Reference is declarative on the catalog. When set, FE must collect it
    // before the sale closes — the wire DTO accepts an empty `reference` but
    // the operational intent (SPEI folio, terminal auth) requires it.
    if (m.requiresReference && this.referenceInput().trim() === '') return false;
    if (m.category === PaymentCategory.Cash) {
      return this.currentTenderedCents() >= this.remainingCents();
    }
    // Non-cash: must match remaining exactly (no overpay).
    return this.currentTenderedCents() === this.remainingCents();
  });

  /** Guards against double-tap on confirm */
  readonly isProcessing = signal(false);

  //#endregion

  //#region Lifecycle

  constructor() {
    // Lazy-load the catalog the first time the dialog opens. Idempotent — the
    // service is safe to invoke repeatedly and resolves to fallback on offline.
    effect(() => {
      if (!this.visible()) return;
      if (this.paymentMethodService.loaded()) return;
      void this.paymentMethodService.loadAvailable();
    });

    // Default-select the first interactive method once the catalog resolves.
    // Cash wins when present (most common cashier flow); otherwise the first
    // method sorted by `sortOrder` that isn't deferred.
    effect(() => {
      if (this.selectedMethod() !== null) return;
      const methods = this.availableMethods();
      if (methods.length === 0) return;
      const preferred =
        methods.find(m => m.category === PaymentCategory.Cash && this.canSelect(m))
        ?? methods.find(m => this.canSelect(m));
      if (preferred) this.selectMethod(preferred);
    });
  }

  //#endregion

  //#region Method selection

  /**
   * Whether the method can be picked in this PR. Returns false for the
   * categories whose UX is deferred (customer balance + providers) so the
   * tabs render disabled rather than mid-flow erroring.
   */
  canSelect(method: AvailablePaymentMethod): boolean {
    if (DEFERRED_CATEGORIES.has(method.category)) return false;
    if (method.providerKey) return false;
    return true;
  }

  /** Resolves the icon for a method — catalog override wins, then a sensible default. */
  iconFor(method: AvailablePaymentMethod): string {
    // The wire `icon` (or our category default) carries the icon name only —
    // we always prepend the PrimeIcons base class `pi`. Without that class
    // PrimeIcons' `font-family: 'primeicons'` doesn't apply and the `::before`
    // glyph renders as a generic-font tofu square. Defensive against the
    // backend shipping the value either way (`"pi-money-bill"` or
    // `"pi pi-money-bill"`).
    const raw = (method.icon?.trim()) || CATEGORY_DEFAULT_ICON[method.category] || 'pi-credit-card';
    return raw.startsWith('pi ') ? raw : `pi ${raw}`;
  }

  /**
   * Switches the active tab and resets the per-method input state. Keeps the
   * `pendingPayments` accumulation untouched — only the current turn's inputs
   * clear so the cashier can't carry a stale amount across methods.
   */
  selectMethod(method: AvailablePaymentMethod): void {
    if (!this.canSelect(method)) return;
    this.selectedMethod.set(method);
    this.receivedAmount.set(0);
    this.customAmountInput.set('');
    this.exactAmountPesos.set(method.category === PaymentCategory.Cash
      ? 0
      : this.remainingCents() / 100);
    this.referenceInput.set('');
  }

  //#endregion

  //#region Cash inputs (bills + custom)

  /** Adds a bill denomination to the running received amount (accumulates) */
  addBillAmount(cents: number): void {
    this.receivedAmount.update(prev => prev + cents);
    this.customAmountInput.set('');
  }

  /** Updates the received amount from the free-form custom-amount input */
  onCustomAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.customAmountInput.set(raw);
    const pesos = parseFloat(raw);
    if (!isNaN(pesos) && pesos > 0) {
      this.receivedAmount.set(Math.round(pesos * 100));
    } else if (raw.trim() === '') {
      this.receivedAmount.set(0);
    }
  }

  /** Updates the received amount from the dialog's editable Recibido field */
  onDialogReceivedInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const pesos = parseFloat(raw);
    if (!isNaN(pesos) && pesos > 0) {
      this.receivedAmount.set(Math.round(pesos * 100));
    } else if (raw.trim() === '') {
      this.receivedAmount.set(0);
    }
  }

  /** Resets the received amount and the custom-amount input together */
  resetReceived(): void {
    this.receivedAmount.set(0);
    this.customAmountInput.set('');
  }

  //#endregion

  //#region Non-cash inputs

  /** Reads the exact-amount input for card/digital/voucher/other methods (pesos). */
  onExactAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const pesos = parseFloat(raw);
    this.exactAmountPesos.set(!isNaN(pesos) && pesos > 0 ? pesos : 0);
  }

  /** Reads the reference/folio input. */
  onReferenceInput(event: Event): void {
    this.referenceInput.set((event.target as HTMLInputElement).value);
  }

  //#endregion

  //#region Dialog lifecycle

  /** Closes the dialog and clears local payment state */
  close(): void {
    this.visibleChange.emit(false);
    // Don't reset received here — re-opening the dialog should keep the
    // tendered amount the cashier already counted, until cart is cleared.
  }

  //#endregion

  //#region Confirm payment

  /**
   * Persists the order via SyncService, prints the ticket, and clears the
   * cart. Mirrors the previous cash-only flow but now sources the method
   * from `selectedMethod()` and ships `MethodCode` resolved from the catalog
   * (the backend freezes the snapshot at sync time per PR-A1).
   */
  async confirmPayment(): Promise<void> {
    if (this.isProcessing()) return;
    if (this.cartItemCount() === 0) return;
    if (!this.canConfirmQuickPay()) return;

    const method = this.selectedMethod();
    if (!method) return;

    const sessionId = this.cashRegisterService.activeSession()?.id;
    if (sessionId == null) {
      this.messageService.add({
        severity: 'error',
        summary: 'Caja cerrada',
        detail: 'Abre un turno de caja antes de cobrar.',
        life: 4000,
      });
      return;
    }

    this.isProcessing.set(true);

    try {
      const totalCents = this.cartTotal();
      const tendered = this.currentTenderedCents();
      const currentPayment: OrderPayment = {
        method: this.resolveMethodEnum(method),
        paymentStatusId: PaymentStatus.Completed,
        amountCents: method.category === PaymentCategory.Cash
          ? Math.max(tendered, this.remainingCents())
          : this.remainingCents(),
        reference: this.referenceInput().trim() || undefined,
      };

      const payments: OrderPayment[] = [...this.pendingPayments(), currentPayment];
      const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);

      const orderNumber = this.syncService.consumeOrderNumber();
      const items: CartItem[] = this.cartService.getSnapshot();

      const order: Order = {
        id: crypto.randomUUID(),
        orderNumber,
        items,
        subtotalCents: totalCents,
        totalCents,
        payments,
        paidCents,
        changeCents: Math.max(0, paidCents - totalCents),
        paymentProvider: null,
        createdAt: new Date(),
        syncStatusId: SyncStatusId.Pending,
        branchId: this.authService.branchId,
        cashRegisterSessionId: sessionId,
      };

      await this.syncService.saveOrder(order);

      try {
        await this.printService.printTicket(order);
      } catch {
        this.messageService.add({
          severity: 'error',
          summary: 'Error de impresora',
          detail: 'No se pudo imprimir el ticket. Reimprime desde Órdenes.',
          life: 5000,
        });
      }

      this.messageService.add({
        severity: 'success',
        summary: `Venta #${orderNumber}`,
        detail: `Cambio: ${(order.changeCents / 100).toFixed(2)}`,
        life: 3000,
      });

      // Centralised cleanup mirrors the F&B checkout reset so the
      // customer, applied coupon, and order context cannot leak into
      // the next transaction (see CartService.resetTransactionState).
      await this.cartService.resetTransactionState();
      this.resetTurnState();
      this.visibleChange.emit(false);
    } finally {
      this.isProcessing.set(false);
    }
  }

  //#endregion

  //#region Helpers

  /**
   * Maps the catalog's `code` (the backend's freeze key) to the legacy
   * `PaymentMethod` enum that `OrderPayment` still types its `method` field
   * against. Once PR-C drops that enum, this collapses to passing the code
   * through verbatim. Unknown codes fall back to `Other` — the backend will
   * record `WasUnknownMethod: true` per PR-A2.
   */
  private resolveMethodEnum(method: AvailablePaymentMethod): PaymentMethod {
    return (PaymentMethod as Record<string, PaymentMethod>)[method.code] ?? PaymentMethod.Other;
  }

  /** Clears all per-turn inputs after a successful confirm. */
  private resetTurnState(): void {
    this.pendingPayments.set([]);
    this.receivedAmount.set(0);
    this.customAmountInput.set('');
    this.exactAmountPesos.set(0);
    this.referenceInput.set('');
  }

  /** Expose for template */
  readonly PaymentCategory = PaymentCategory;

  //#endregion
}
