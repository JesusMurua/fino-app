import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { ConfirmationService, MessageService } from 'primeng/api';

import { CashRegisterService } from '../../../core/services/cash-register.service';
import { PrinterService } from '../../../core/services/printer.service';
import { SelectOnFocusDirective } from '../../directives/select-on-focus.directive';

/**
 * Standalone "Abrir turno de caja" dialog.
 *
 * Lives at the application root (mounted by AppComponent) so it works
 * from every surface — the POS session-blocker "Caja Cerrada" CTA, the
 * Admin "Caja" empty state, the POS shift sidebar — without depending
 * on any particular host being rendered.
 *
 * Previously this dialog lived inside ShiftManagementComponent, which
 * is itself wrapped in a PrimeNG sidebar that lazily instantiates its
 * content. From any surface where the sidebar had not been opened yet
 * (most notably the session-blocker shortcut after a fresh
 * self-link), the consuming effect never subscribed and the request
 * fired into the void. Owning the trigger here, in an always-mounted
 * component, removes that timing dependency entirely.
 *
 * The component subscribes to `CashRegisterService.openDialogTrigger`,
 * a monotonic counter, and surfaces itself whenever the counter
 * advances. Callers request the dialog by invoking
 * `CashRegisterService.requestOpenDialog()`.
 */
@Component({
  selector: 'app-open-shift-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ConfirmDialogModule,
    DialogModule,
    InputNumberModule,
    SelectOnFocusDirective,
  ],
  providers: [ConfirmationService],
  templateUrl: './open-shift-dialog.component.html',
  styleUrl: './open-shift-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenShiftDialogComponent {

  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly printerService = inject(PrinterService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  /** Dialog visibility — two-way bound to `<p-dialog>`. */
  readonly showOpenDialog = signal(false);

  /** Submitting flag — disables both CTAs while the POST is in flight. */
  readonly isOpeningSession = signal(false);

  /**
   * Fondo inicial en pesos. `null` keeps the placeholder visible so the
   * first keystroke overwrites cleanly. Bound to `<p-inputNumber>`
   * with `mode="currency"`.
   */
  openAmount: number | null = null;

  constructor() {
    // Monotonic trigger: skip the initial `0` so the dialog never
    // auto-opens on mount, then surface it every time the counter
    // advances (each call to `requestOpenDialog()`).
    let lastTrigger = this.cashRegisterService.openDialogTrigger();
    effect(() => {
      const current = this.cashRegisterService.openDialogTrigger();
      if (current === lastTrigger) return;
      lastTrigger = current;
      this.openAmount = null;
      this.showOpenDialog.set(true);
    }, { allowSignalWrites: true });
  }

  /**
   * Opens a new cash register session.
   * Guards against double-submit, accidental $0 float, and maps known
   * HTTP errors to readable toasts while keeping the dialog state so
   * the user can retry without re-typing the amount.
   */
  async openSession(): Promise<void> {
    if (this.isOpeningSession()) return;

    const amount = this.openAmount ?? 0;
    if (amount === 0) {
      const confirmed = await this.confirmOpenWithoutFloat();
      if (!confirmed) return;
    }

    this.isOpeningSession.set(true);
    try {
      await this.cashRegisterService.openSession({
        initialAmountCents: Math.round(amount * 100),
      });

      this.showOpenDialog.set(false);

      // Pop the drawer so the cashier can drop the initial float inside.
      // Fire-and-forget: a missing or disconnected drawer must not
      // block the happy path of opening the shift.
      this.printerService.openCashDrawer().catch(() => { /* ignored */ });

      this.messageService.add({
        severity: 'success',
        summary: 'Turno abierto',
        detail: 'Turno abierto correctamente',
      });
    } catch (error) {
      this.showOpenError(error);
    } finally {
      this.isOpeningSession.set(false);
    }
  }

  private confirmOpenWithoutFloat(): Promise<boolean> {
    return new Promise(resolve => {
      this.confirmationService.confirm({
        key: 'openShiftDialogConfirm',
        header: '¿Abrir sin fondo de cambio?',
        message: 'Vas a abrir el turno con $0. Sin fondo no podrás dar cambio a tus clientes. ¿Estás seguro?',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Sí, abrir sin fondo',
        rejectLabel: 'Cancelar',
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  private showOpenError(error: unknown): void {
    let detail = 'No se pudo abrir el turno. Intenta de nuevo.';

    if (error instanceof HttpErrorResponse) {
      if (error.status === 409) {
        detail = 'Ya existe un turno abierto para esta caja.';
      } else if (error.status === 400) {
        detail = 'El monto inicial no es válido.';
      } else if (error.status === 0) {
        detail = 'Sin conexión. Intenta de nuevo cuando vuelva internet.';
      }
    } else if (error instanceof Error && error.message.toLowerCase().includes('not linked')) {
      detail = 'Este dispositivo no está vinculado a una caja física.';
    }

    this.messageService.add({
      severity: 'error',
      summary: 'Error al abrir turno',
      detail,
      life: 5000,
    });
  }
}
