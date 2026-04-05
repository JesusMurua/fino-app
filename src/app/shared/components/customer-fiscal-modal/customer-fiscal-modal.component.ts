import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import {
  CustomerFiscalData,
  InvoiceRequest,
  REGIMEN_FISCAL_OPTIONS,
  RFC_PUBLICO_GENERAL,
  RFC_REGEX,
  USO_CFDI_OPTIONS,
} from '../../../core/models/invoice.model';
import { InvoicingService } from '../../../core/services/invoicing.service';
import { PricePipe } from '../../pipes/price.pipe';

/** Internal UI state for the modal */
type ModalStatus = 'form' | 'submitting' | 'success' | 'error';

@Component({
  selector: 'app-customer-fiscal-modal',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    ProgressSpinnerModule,
    PricePipe,
  ],
  templateUrl: './customer-fiscal-modal.component.html',
  styleUrl: './customer-fiscal-modal.component.scss',
})
export class CustomerFiscalModalComponent {

  //#region Properties
  private readonly invoicingService = inject(InvoicingService);

  /** Two-way binding for dialog visibility */
  readonly visible = model<boolean>(false);

  /** Order ID to invoice */
  readonly orderId = input.required<string>();

  /** Total amount for display */
  readonly totalCents = input<number>(0);

  /** Emits when invoice is successfully requested */
  readonly invoiceRequested = output<InvoiceRequest>();

  // ---- Form fields ----
  readonly rfc = signal('');
  readonly razonSocial = signal('');
  readonly regimenFiscal = signal('');
  readonly usoCfdi = signal('');
  readonly codigoPostal = signal('');
  readonly email = signal('');

  // ---- UI state ----
  readonly status = signal<ModalStatus>('form');
  readonly errorMessage = signal('');
  readonly cfdiUuid = signal('');

  // ---- SAT catalog options ----
  readonly regimenOptions = REGIMEN_FISCAL_OPTIONS;
  readonly usoCfdiOptions = USO_CFDI_OPTIONS;

  // ---- Validation ----
  readonly rfcValid = computed(() =>
    this.rfc().length === 0 || RFC_REGEX.test(this.rfc()),
  );

  readonly emailValid = computed(() => {
    const v = this.email();
    return v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  });

  readonly cpValid = computed(() => {
    const v = this.codigoPostal();
    return v.length === 0 || /^\d{5}$/.test(v);
  });

  readonly canSubmit = computed(() =>
    this.rfc().length > 0
    && RFC_REGEX.test(this.rfc())
    && this.razonSocial().trim().length > 0
    && this.regimenFiscal().length > 0
    && this.usoCfdi().length > 0
    && this.codigoPostal().length === 5
    && /^\d{5}$/.test(this.codigoPostal())
    && this.email().length > 0
    && this.emailValid()
    && this.status() === 'form',
  );
  //#endregion

  //#region Methods

  /** Pre-fills with "Público en General" generic RFC */
  fillPublicoGeneral(): void {
    this.rfc.set(RFC_PUBLICO_GENERAL);
    this.razonSocial.set('PUBLICO EN GENERAL');
    this.regimenFiscal.set('616');
    this.usoCfdi.set('S01');
  }

  /** Submits the invoice request to the backend */
  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;

    this.status.set('submitting');
    this.errorMessage.set('');

    const fiscalData: CustomerFiscalData = {
      rfc: this.rfc().toUpperCase().trim(),
      razonSocial: this.razonSocial().toUpperCase().trim(),
      regimenFiscal: this.regimenFiscal(),
      usoCfdi: this.usoCfdi(),
      codigoPostal: this.codigoPostal().trim(),
      email: this.email().trim().toLowerCase(),
    };

    const result = await this.invoicingService.requestInvoice(this.orderId(), fiscalData);

    if (result.success) {
      this.status.set('success');
      this.cfdiUuid.set(result.cfdiUuid ?? '');
      this.invoiceRequested.emit({
        fiscalData,
        status: 'completed',
        invoiceId: result.invoiceId,
        cfdiUuid: result.cfdiUuid,
        requestedAt: new Date(),
        completedAt: new Date(),
      });
    } else {
      this.status.set('error');
      this.errorMessage.set(result.errorMessage ?? 'Error desconocido');
    }
  }

  /** Retries after an error — goes back to form state */
  onRetry(): void {
    this.status.set('form');
    this.errorMessage.set('');
  }

  /** Closes the modal and resets state */
  onClose(): void {
    this.visible.set(false);
    this.resetForm();
  }

  /** Resets all form fields and status */
  private resetForm(): void {
    this.rfc.set('');
    this.razonSocial.set('');
    this.regimenFiscal.set('');
    this.usoCfdi.set('');
    this.codigoPostal.set('');
    this.email.set('');
    this.status.set('form');
    this.errorMessage.set('');
    this.cfdiUuid.set('');
  }

  //#endregion

}
