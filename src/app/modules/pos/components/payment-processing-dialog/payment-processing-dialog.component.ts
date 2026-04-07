import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';

import { OrderPayment } from '../../../../core/models/order.model';
import { PaymentTransaction } from '../../../../core/models/payment.model';
import { PaymentProviderService } from '../../../../core/services/payment-provider.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-payment-processing-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, DialogModule, InputTextModule, ProgressBarModule, PricePipe],
  templateUrl: './payment-processing-dialog.component.html',
  styleUrl: './payment-processing-dialog.component.scss',
})
export class PaymentProcessingDialogComponent {

  //#region Properties
  private readonly paymentProviderService = inject(PaymentProviderService);

  /** Two-way binding for dialog visibility */
  readonly visible = model<boolean>(false);

  /** The active transaction to display */
  readonly transaction = input<PaymentTransaction | null>(null);

  /** Order ID for intent endpoints (required for retries) */
  readonly orderId = input.required<string>();

  /** Emits when a payment is approved and ready to add to pendingPayments */
  readonly paymentConfirmed = output<OrderPayment>();

  /** Emits when the user cancels the transaction */
  readonly paymentCancelled = output<void>();

  /** Clip reference input */
  readonly clipReference = signal('');

  /** Guard against double-tap on confirm */
  readonly confirming = signal(false);

  /** Header text based on provider */
  readonly dialogHeader = computed(() => {
    const tx = this.transaction();
    if (!tx) return 'Procesando pago';
    switch (tx.provider) {
      case 'clip': return 'Pago con Clip';
      case 'mercadopago': return 'Pago con MercadoPago';
      default: return 'Procesando pago';
    }
  });

  /** Whether the confirm button should be enabled for Clip */
  readonly canConfirmClip = computed(() =>
    this.clipReference().trim().length > 0 && !this.confirming(),
  );
  //#endregion

  //#region Methods

  /** Confirms the Clip transaction with the manual reference */
  onConfirmClip(): void {
    if (this.confirming()) return;
    this.confirming.set(true);

    this.paymentProviderService.confirmClipReference(this.clipReference());
    const payment = this.paymentProviderService.resolveToPayment();

    if (payment) {
      this.paymentConfirmed.emit(payment);
    }

    this.clipReference.set('');
    this.confirming.set(false);
    this.visible.set(false);
  }

  /** Accepts an approved MercadoPago transaction */
  onAcceptApproved(): void {
    const payment = this.paymentProviderService.resolveToPayment();
    if (payment) {
      this.paymentConfirmed.emit(payment);
    }
    this.visible.set(false);
  }

  /** Retries a failed/timed-out transaction */
  async onRetry(): Promise<void> {
    const tx = this.transaction();
    if (!tx) return;

    this.paymentProviderService.cancelTransaction();
    await this.paymentProviderService.startTransaction(tx.method, tx.amountCents, this.orderId());
  }

  /** Cancels the active transaction and closes the dialog */
  onCancel(): void {
    this.paymentProviderService.cancelTransaction();
    this.clipReference.set('');
    this.paymentCancelled.emit();
    this.visible.set(false);
  }

  //#endregion

}
