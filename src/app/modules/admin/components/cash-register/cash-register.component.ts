import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TableModule } from 'primeng/table';
import { ConfirmationService, MessageService } from 'primeng/api';

import { CashRegisterSession } from '../../../../core/models';
import {
  CashMovementType,
  CashRegisterStatus,
  CASH_MOVEMENT_TYPE_LABELS,
} from '../../../../core/enums';
import { AuthService } from '../../../../core/services/auth.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { StatusLabelPipe, StatusClassPipe } from '../../../../shared/pipes/status-label.pipe';

/** Movement type options for the dialog */
interface MovementTypeOption {
  key: CashMovementType;
  label: string;
  icon: string;
  description: string;
  placeholder: string;
}

@Component({
  selector: 'app-cash-register',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    NgClass,
    ConfirmDialogModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    TableModule,
    PricePipe,
    StatusLabelPipe,
    StatusClassPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './cash-register.component.html',
  styleUrl: './cash-register.component.scss',
})
export class CashRegisterComponent implements OnInit {

  //#region Injections

  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly authService = inject(AuthService);
  private readonly db = inject(DatabaseService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  //#endregion

  //#region State

  /**
   * Reactive reference to the service's active session signal.
   * The component NEVER mirrors this locally — every render reads the
   * single source of truth exposed by `CashRegisterService`.
   */
  readonly activeSession = this.cashRegisterService.activeSession;

  readonly loading = signal(false);
  readonly cashSalesTotalCents = signal(0);

  /** True while the open-session API call is in flight */
  readonly isOpeningSession = signal(false);

  /** True while the close-session API call is in flight */
  readonly isClosingSession = signal(false);

  /**
   * Two-step state machine for the close-session dialog:
   *
   *   'counting' — the cashier sees only the opening float and the
   *                counted-amount input. Sales, movements, expected
   *                total and difference are all hidden. This is the
   *                blind-count step — the whole point of an arqueo is
   *                that the cashier cannot peek at the system total
   *                before committing their physical count.
   *
   *   'reveal'   — after the cashier confirms their count via
   *                "Verificar conteo", the full summary panel and
   *                the difference label are unlocked. The amount
   *                input becomes read-only so the cashier cannot
   *                adjust their count to match the expected total.
   *                A "Volver a contar" secondary button lets them
   *                return to the counting step if they miskeyed.
   */
  readonly closeStep = signal<'counting' | 'reveal'>('counting');

  // Dialog visibility
  readonly showOpenDialog = signal(false);
  readonly showCloseDialog = signal(false);
  readonly showMovementDialog = signal(false);
  readonly showHistoryDialog = signal(false);

  // History
  readonly history = signal<CashRegisterSession[]>([]);
  readonly loadingHistory = signal(false);

  // ---- Close confirmation ----
  readonly showCloseConfirm = signal(false);
  readonly unpaidOrderCount = signal(0);

  // Forms
  openAmount = 0;
  closeAmount = 0;
  closeNotes = '';
  movementAmount = 0;
  movementDescription = '';
  movementType: CashMovementType = CashMovementType.In;

  /** Movement type options for the selector */
  readonly movementTypes: MovementTypeOption[] = [
    {
      key: CashMovementType.In,
      label: 'Retiro',
      icon: '💰',
      description: 'Dinero retirado para depósito o resguardo',
      placeholder: 'Ej: Depósito al banco',
    },
    {
      key: CashMovementType.Out,
      label: 'Gasto',
      icon: '🧾',
      description: 'Pago a proveedor, servicios, etc.',
      placeholder: 'Ej: Pago de gas',
    },
    {
      key: CashMovementType.Adjustment,
      label: 'Ajuste',
      icon: '⚖️',
      description: 'Corrección por error de conteo',
      placeholder: 'Ej: Corrección de cambio',
    },
  ];

  /** Expose enums for template bindings */
  readonly CashMovementType = CashMovementType;
  readonly CashRegisterStatus = CashRegisterStatus;

  //#endregion

  //#region Computeds

  /** True when the session held by the service is in the Open state */
  readonly isSessionOpen = computed(() =>
    this.activeSession()?.cashRegisterStatusId === CashRegisterStatus.Open,
  );

  /** Movements of the currently active session — derived from the service signal */
  readonly movements = computed(() =>
    this.activeSession()?.movements ?? [],
  );

  /** Total cents moved as In/Out this shift */
  readonly movementsTotal = computed(() =>
    this.movements()
      .filter(m => m.cashMovementTypeId === CashMovementType.In
                || m.cashMovementTypeId === CashMovementType.Out)
      .reduce((sum, m) => sum + m.amountCents, 0),
  );

  readonly expectedAmount = computed(() => {
    const session = this.activeSession();
    if (!session) return 0;
    return this.cashRegisterService.calculateExpected(session, this.cashSalesTotalCents());
  });

  readonly difference = computed(() => {
    if (this.closeAmount <= 0) return null;
    return Math.round(this.closeAmount * 100) - this.expectedAmount();
  });

  readonly selectedMovementType = computed(() =>
    this.movementTypes.find(t => t.key === this.movementType) ?? this.movementTypes[0],
  );

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadSession();
  }

  //#endregion

  //#region Session Methods

  /**
   * Refreshes the active session via the service and loads today's cash
   * sales. The component does not hold a local copy of the session — the
   * service's signal is the single source of truth.
   */
  async loadSession(): Promise<void> {
    this.loading.set(true);
    await this.cashRegisterService.refreshActiveSession();
    await this.loadCashSales();
    this.loading.set(false);
  }

  /**
   * Opens a new cash register session.
   *
   * Guards against:
   *   - Double-click / concurrent opens via `isOpeningSession`
   *   - Accidental $0 float via a confirmation dialog (the cajero must
   *     explicitly acknowledge that there is no cash for change)
   *   - Network / validation errors via a typed toast that preserves
   *     the dialog so the user can retry without re-entering the amount
   */
  async openSession(): Promise<void> {
    if (this.isOpeningSession()) return;

    const user = this.authService.currentUser();
    if (!user) return;

    if (this.openAmount === 0) {
      const confirmed = await this.confirmOpenWithoutFloat();
      if (!confirmed) return;
    }

    this.isOpeningSession.set(true);
    try {
      await this.cashRegisterService.openSession({
        initialAmountCents: Math.round(this.openAmount * 100),
        openedBy: user.name,
      });

      this.showOpenDialog.set(false);
      await this.loadCashSales();

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

  /**
   * Prompts the user to confirm an opening balance of zero.
   * Resolves to `true` when the user explicitly accepts, `false` on
   * reject / close.
   */
  private confirmOpenWithoutFloat(): Promise<boolean> {
    return new Promise(resolve => {
      this.confirmationService.confirm({
        key: 'cashRegisterConfirm',
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

  /** Maps an open-session error to a human-readable toast */
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

  /**
   * Validates unpaid orders before closing the session.
   * If active orders exist, shows a confirmation dialog.
   */
  async onCloseSession(): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const unpaid = await this.db.orders
      .filter(o =>
        (o.payments?.length ?? 0) === 0 &&
        !o.cancelledAt &&
        new Date(o.createdAt) >= todayStart,
      )
      .toArray();

    if (unpaid.length > 0) {
      this.unpaidOrderCount.set(unpaid.length);
      this.showCloseConfirm.set(true);
      return;
    }

    await this.closeSession();
  }

  /**
   * Closes the current session.
   *
   * The close dialog is dismissed BEFORE awaiting the service call so
   * the user does not see a one-frame blank dialog when the service
   * flips `_activeSession` to null. If the call fails the dialog is
   * reopened with the preserved form state so the user can retry
   * without re-entering their counted amount.
   */
  async closeSession(): Promise<void> {
    this.showCloseConfirm.set(false);
    if (this.isClosingSession()) return;

    const user = this.authService.currentUser();
    if (!user) return;

    // The close request requires an explicit sessionId so the backend
    // can reject a stale close (e.g. the session was already closed
    // from another device) with a precise 409 instead of silently
    // acting on whatever session it thinks is active.
    const session = this.activeSession();
    if (!session) return;

    // Dismiss the dialog before awaiting — the service will clear
    // `_activeSession` on success, and a visible dialog bound to
    // `@if (activeSession(); as session)` would otherwise render a
    // one-frame blank card.
    this.showCloseDialog.set(false);
    this.isClosingSession.set(true);

    try {
      await this.cashRegisterService.closeSession({
        sessionId: session.id,
        countedAmountCents: Math.round(this.closeAmount * 100),
        closedBy: user.name,
        notes: this.closeNotes.trim() || undefined,
      });

      this.closeAmount = 0;
      this.closeNotes = '';

      this.messageService.add({
        severity: 'success',
        summary: 'Turno cerrado',
        detail: 'Turno cerrado correctamente',
      });
    } catch (error) {
      // Reopen the dialog — the service throws before clearing
      // `_activeSession`, so the preserved counted amount is still
      // consistent with the session currently held in the signal.
      this.showCloseDialog.set(true);
      this.showCloseError(error);
    } finally {
      this.isClosingSession.set(false);
    }
  }

  /** Maps a close-session error to a human-readable toast */
  private showCloseError(error: unknown): void {
    let detail = 'No se pudo cerrar el turno. Intenta de nuevo.';

    if (error instanceof HttpErrorResponse) {
      if (error.status === 409) {
        detail = 'El turno ya fue cerrado desde otro dispositivo.';
      } else if (error.status === 400) {
        detail = 'El monto declarado no es válido.';
      } else if (error.status === 0) {
        detail = 'Sin conexión. Intenta de nuevo cuando vuelva internet.';
      }
    }

    this.messageService.add({
      severity: 'error',
      summary: 'Error al cerrar turno',
      detail,
      life: 5000,
    });
  }

  /** Adds a cash movement (withdrawal, expense, adjustment) */
  async addMovement(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    await this.cashRegisterService.addMovement({
      cashMovementTypeId: this.movementType,
      amountCents: Math.round(this.movementAmount * 100),
      description: this.movementDescription.trim(),
      createdBy: user.name,
    });

    const summary = CASH_MOVEMENT_TYPE_LABELS[this.movementType] + ' registrado';

    // Re-query the session so the service signal picks up the new
    // movement. Local `movements()` reacts automatically.
    await this.cashRegisterService.refreshActiveSession();

    this.showMovementDialog.set(false);
    this.movementAmount = 0;
    this.movementDescription = '';
    this.movementType = CashMovementType.In;

    this.messageService.add({
      severity: 'success',
      summary,
    });
  }

  //#endregion

  //#region History

  /** Loads session history for last 30 days */
  async loadHistory(): Promise<void> {
    this.loadingHistory.set(true);

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const sessions = await this.cashRegisterService.getHistory(from, to);
    this.history.set(sessions);

    this.loadingHistory.set(false);
    this.showHistoryDialog.set(true);
  }

  //#endregion

  //#region Helpers

  /** Formats a Date to HH:MM */
  formatTime(date: Date | string): string {
    return new Date(date).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Formats a Date to short date string */
  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  /**
   * Opens the open-session dialog and clears any residual amount
   * from a previous attempt so the cashier never sees a stale value.
   */
  openOpenDialog(): void {
    this.openAmount = 0;
    this.showOpenDialog.set(true);
  }

  /**
   * Opens the close dialog. Always rewinds the two-step flow to
   * `'counting'` so a previous session never leaks into the next
   * attempt — the cashier must count blind every single time.
   */
  openCloseDialog(): void {
    this.closeAmount = 0;
    this.closeNotes = '';
    this.closeStep.set('counting');
    this.showCloseDialog.set(true);
  }

  /**
   * Commits the blind count and unlocks the reveal step.
   * Called by the primary button in step 1. Refuses to advance when
   * the amount is still zero — the button is also disabled in that
   * state, this is a defensive guard for programmatic invocation.
   */
  verifyCount(): void {
    if (this.closeAmount <= 0) return;
    this.closeStep.set('reveal');
  }

  /**
   * Returns the user to the counting step. Called by the "Volver a
   * contar" secondary button in step 2 when the cashier realizes
   * they miskeyed and wants to correct the count before committing.
   */
  backToCounting(): void {
    this.closeStep.set('counting');
  }

  /** Opens the movement dialog and resets form */
  openMovementDialog(): void {
    this.movementAmount = 0;
    this.movementDescription = '';
    this.movementType = CashMovementType.In;
    this.showMovementDialog.set(true);
  }

  //#endregion

  //#region Private

  /**
   * Loads today's cash sales total from Dexie.
   *
   * Uses the `createdAt` index to narrow the scan to today, then
   * applies the "non-cancelled, has cash payment" predicate via
   * Dexie's `Collection.and(...)` so filtering happens during the
   * index walk. The accumulator is built with `Collection.each(...)`
   * to avoid materializing an intermediate array.
   */
  private async loadCashSales(): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let cashTotal = 0;
    await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .and(o => !o.cancelledAt && (o.payments ?? []).some(p => p.method === 'Cash'))
      .each(o => { cashTotal += o.totalCents; });

    this.cashSalesTotalCents.set(cashTotal);
  }

  //#endregion

}
