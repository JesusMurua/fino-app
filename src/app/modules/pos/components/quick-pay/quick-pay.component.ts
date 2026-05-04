import { Component, EventEmitter, Output, computed, inject, input, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';

import { CartItem, Order, OrderPayment, PaymentMethod } from '../../../../core/models';
import { PaymentStatus, SyncStatusId } from '../../../../core/enums';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
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
 * Inline cash quick-pay dialog used by non-F&B verticals (Services, Retail,
 * Counter, Quick) to skip the full `/pos/checkout` page and complete the
 * sale in a single tap.
 *
 * Owns:
 *   - Bill denomination strip
 *   - Free-form custom amount input
 *   - Change calculation
 *   - Order persistence via SyncService + ticket print
 *
 * The cart snapshot is read directly from `CartService` so this component
 * has no inputs other than dialog visibility.
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
  private readonly syncService = inject(SyncService);
  private readonly printService = inject(PrintService);
  private readonly messageService = inject(MessageService);

  /** Two-way bound dialog visibility, owned by the parent */
  readonly visible = input<boolean>(false);
  @Output() readonly visibleChange = new EventEmitter<boolean>();

  /** Bill denomination buttons */
  readonly bills = BILL_DENOMINATIONS;

  /** Cart total proxied from the shared CartService */
  readonly cartTotal = this.cartService.totalCents;

  /** Number of items in cart proxied from the shared CartService */
  readonly cartItemCount = this.cartService.itemCount;

  /** Amount received from customer in centavos — accumulates with each bill tap */
  readonly receivedAmount = signal(0);

  /** Free-form amount typed by the cashier (raw string in pesos) */
  readonly customAmountInput = signal('');

  /** Change to return in centavos (0 when nothing has been received yet) */
  readonly changeAmount = computed(() => {
    const received = this.receivedAmount();
    if (received === 0) return 0;
    return Math.max(0, received - this.cartTotal());
  });

  /** Guards against double-tap on confirm */
  readonly isProcessing = signal(false);

  //#endregion

  //#region Bills + change

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

  /** Resets the received amount and the custom-amount input together */
  resetReceived(): void {
    this.receivedAmount.set(0);
    this.customAmountInput.set('');
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
   * cart. Mirrors the flow that lived in the legacy `quick-pos`/`retail-pos`
   * components — same SyncStatusId.Pending + offline-first guarantees.
   */
  async confirmPayment(): Promise<void> {
    if (this.isProcessing()) return;
    if (this.cartItemCount() === 0) return;

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
      const paidCents = Math.max(this.receivedAmount(), totalCents);
      const orderNumber = this.syncService.consumeOrderNumber();
      const items: CartItem[] = this.cartService.getSnapshot();

      const payment: OrderPayment = {
        method: PaymentMethod.Cash,
        paymentStatusId: PaymentStatus.Completed,
        amountCents: paidCents,
      };

      const order: Order = {
        id: crypto.randomUUID(),
        orderNumber,
        items,
        subtotalCents: totalCents,
        totalCents,
        payments: [payment],
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

      await this.cartService.clearCart();
      this.resetReceived();
      this.visibleChange.emit(false);
    } finally {
      this.isProcessing.set(false);
    }
  }

  //#endregion

  //#region Helpers

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

  //#endregion
}
