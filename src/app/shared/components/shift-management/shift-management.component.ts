import { Component, Input, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';

import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TableModule } from 'primeng/table';
import { ConfirmationService, MessageService } from 'primeng/api';

import { CashRegisterSession } from '../../../core/models';
import {
  CashMovementType,
  CashRegisterStatus,
  CASH_MOVEMENT_TYPE_LABELS,
} from '../../../core/enums';
import { AuthService } from '../../../core/services/auth.service';
import { CashRegisterService } from '../../../core/services/cash-register.service';
import { DatabaseService } from '../../../core/services/database.service';
import { PrinterService } from '../../../core/services/printer.service';
import { PricePipe } from '../../pipes/price.pipe';
import { StatusLabelPipe, StatusClassPipe } from '../../pipes/status-label.pipe';
import { SelectOnFocusDirective } from '../../directives/select-on-focus.directive';

/** Cosmetic flavour for the host context — drives copy and history visibility. */
export type ShiftManagementMode = 'admin' | 'pos';

/** Movement type options for the dialog */
interface MovementTypeOption {
  key: CashMovementType;
  label: string;
  icon: string;
  description: string;
  placeholder: string;
}

/**
 * Shared shift-management UI surface used by both the Admin "Caja" page
 * and the POS sidebar. Owns the open / close / movement / history flow
 * end-to-end (dialogs, blind-count state machine, drawer-pop, error
 * mapping, unpaid-orders confirmation, remote-close detection effect)
 * so the wrappers only worry about layout and triggers.
 *
 * Domain state — `activeSession`, `cashSalesTotalCents`, `expectedAmount`,
 * `linkedRegister` — is read directly from `CashRegisterService`, keeping
 * the component template thin and ensuring every consumer of these signals
 * shares a single Dexie liveQuery.
 *
 * The `mode` Input is purely cosmetic: it gates the History button and
 * its dialog (admin-only) without otherwise altering behaviour.
 */
@Component({
  selector: 'app-shift-management',
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
    SelectOnFocusDirective,
  ],
  providers: [ConfirmationService],
  templateUrl: './shift-management.component.html',
  styleUrl: './shift-management.component.scss',
})
export class ShiftManagementComponent implements OnInit {

  //#region Inputs

  /** Cosmetic flavour — `'admin'` shows the History button & dialog. */
  @Input() mode: ShiftManagementMode = 'admin';

  //#endregion

  //#region Injections

  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly authService = inject(AuthService);
  private readonly db = inject(DatabaseService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly printerService = inject(PrinterService);

  //#endregion

  //#region Service Signals (re-exports)

  /** Active session — single source of truth held by the service. */
  readonly activeSession = this.cashRegisterService.activeSession;

  /** Today's cash sales total in cents — driven by a Dexie liveQuery
   *  inside the service so every consumer shares one subscription. */
  readonly cashSalesTotalCents = this.cashRegisterService.cashSalesTotalCents;

  /** Expected drawer amount — computed by the service from session +
   *  cash sales + movements. */
  readonly expectedAmount = this.cashRegisterService.expectedAmount;

  //#endregion

  //#region Local State

  readonly loading = signal(false);
  readonly isClosingSession = signal(false);

  /**
   * Two-step state machine for the close-session dialog.
   *
   *   'counting' — blind count: only opening float and the counted-amount
   *                input are visible. Sales / movements / expected total
   *                stay hidden so the cashier cannot peek before
   *                committing the physical count.
   *   'reveal'   — full summary unlocked, count input becomes read-only,
   *                "Volver a contar" lets the cashier rewind if needed.
   */
  readonly closeStep = signal<'counting' | 'reveal'>('counting');

  // Dialog visibility
  readonly showCloseDialog = signal(false);
  readonly showMovementDialog = signal(false);
  readonly showHistoryDialog = signal(false);

  // History
  readonly history = signal<CashRegisterSession[]>([]);
  readonly loadingHistory = signal(false);

  // Close confirmation (unpaid orders)
  readonly showCloseConfirm = signal(false);
  readonly unpaidOrderCount = signal(0);

  // Forms — currency inputs start as `null` so the PrimeNG placeholder
  // ("$0.00") is visible and the first keystroke overwrites cleanly.
  closeAmount: number | null = null;
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

  /** Movements of the currently active session */
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

  /** Difference between counted and expected — null while still counting blind. */
  readonly difference = computed(() => {
    if (this.closeAmount == null || this.closeAmount <= 0) return null;
    return Math.round(this.closeAmount * 100) - this.expectedAmount();
  });

  readonly selectedMovementType = computed(() =>
    this.movementTypes.find(t => t.key === this.movementType) ?? this.movementTypes[0],
  );

  //#endregion

  //#region Constructor

  constructor() {
    // Detect external session closure (polling flip or another device)
    // while the close dialog is open, and dismiss it cleanly with a
    // warning toast instead of leaving the user staring at a blank
    // dialog frame.
    //
    // Only `activeSession` is tracked as a dependency. `showCloseDialog`
    // and `isClosingSession` are read via `untracked()` so the effect
    // only re-runs on session transitions — not on every dialog toggle
    // or user-initiated close round-trip.
    effect(() => {
      const session = this.activeSession();
      if (session !== null) return;

      const dialogOpen = untracked(() => this.showCloseDialog());
      if (!dialogOpen) return;

      const isClosingByUs = untracked(() => this.isClosingSession());
      if (isClosingByUs) return;

      this.showCloseDialog.set(false);
      this.messageService.add({
        severity: 'info',
        summary: 'Turno cerrado',
        detail: 'La sesión fue cerrada desde otro dispositivo.',
        life: 5000,
      });
    }, { allowSignalWrites: true });

    // The "Abrir turno" dialog is owned globally by
    // <app-open-shift-dialog>; it subscribes to
    // CashRegisterService.openDialogTrigger directly so this
    // component no longer mirrors that effect.
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadSession();
  }

  //#endregion

  //#region Session Methods

  /**
   * Refreshes the active session via the service. `cashSalesTotalCents`
   * is kept fresh automatically by the `liveQuery` subscription owned by
   * the service, so nothing else needs to be awaited here.
   */
  async loadSession(): Promise<void> {
    this.loading.set(true);
    await this.cashRegisterService.refreshActiveSession();
    this.loading.set(false);
  }

  /**
   * Surfaces the global "Abrir turno" dialog via the service trigger.
   * The dialog itself lives in `<app-open-shift-dialog>` at the
   * application root so it works from every host (POS blocker, admin
   * empty state, sidebar) without depending on this component being
   * mounted.
   */
  requestOpenShift(): void {
    this.cashRegisterService.requestOpenDialog();
  }

  /**
   * Manual "No Sale" / "Abrir cajón" operation — kicks the cash drawer
   * without recording a sale. Intended for giving change, settling a
   * bill, or any time the cashier needs physical access without a
   * completed order.
   */
  async triggerCashDrawer(): Promise<void> {
    try {
      await this.printerService.openCashDrawer();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error al abrir el cajón.';
      this.messageService.add({
        severity: 'error',
        summary: 'No se pudo abrir el cajón',
        detail,
        life: 4000,
      });
    }
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

    const session = this.activeSession();
    if (!session) return;

    this.showCloseDialog.set(false);
    this.isClosingSession.set(true);

    try {
      await this.cashRegisterService.closeSession({
        sessionId: session.id,
        countedAmountCents: Math.round((this.closeAmount ?? 0) * 100),
        notes: this.closeNotes.trim() || undefined,
      });

      this.clearCloseDraft();
      this.closeAmount = null;
      this.closeNotes = '';

      this.messageService.add({
        severity: 'success',
        summary: 'Turno cerrado',
        detail: 'Turno cerrado correctamente',
      });
    } catch (error) {
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
    });

    const summary = CASH_MOVEMENT_TYPE_LABELS[this.movementType] + ' registrado';

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
   * Opens the close dialog. Restores a draft (counted amount + notes)
   * left by a previous attempt of the SAME session so a mid-close
   * reload does not erase what the cashier had already entered. The
   * blind-count state machine still rewinds to `'counting'` so the
   * cashier re-confirms before seeing the expected total — only the
   * input values are restored.
   *
   * Draft is scoped per session-id and cleared on a successful close,
   * on explicit cancel, and naturally on tab close (sessionStorage).
   */
  openCloseDialog(): void {
    const restored = this.restoreCloseDraft();
    this.closeAmount = restored?.amount ?? null;
    this.closeNotes = restored?.notes ?? '';
    this.closeStep.set('counting');
    this.showCloseDialog.set(true);
  }

  /**
   * Persists the in-progress close form (counted amount + notes) to
   * sessionStorage under the active session id. Triggered from
   * `(ngModelChange)` on both fields so a reload mid-close does not
   * lose the cashier's entry.
   */
  persistCloseDraft(): void {
    const session = this.activeSession();
    if (!session) return;
    const draft = { amount: this.closeAmount, notes: this.closeNotes };
    try {
      sessionStorage.setItem(this.closeDraftKey(session.id), JSON.stringify(draft));
    } catch { /* sessionStorage quota — silent, draft is best-effort */ }
  }

  private restoreCloseDraft(): { amount: number | null; notes: string } | null {
    const session = this.activeSession();
    if (!session) return null;
    try {
      const raw = sessionStorage.getItem(this.closeDraftKey(session.id));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { amount?: number | null; notes?: string };
      return {
        amount: typeof parsed.amount === 'number' ? parsed.amount : null,
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      };
    } catch {
      return null;
    }
  }

  private clearCloseDraft(): void {
    const session = this.activeSession();
    if (!session) return;
    try {
      sessionStorage.removeItem(this.closeDraftKey(session.id));
    } catch { /* silent */ }
  }

  private closeDraftKey(sessionId: number): string {
    return `pos-close-shift-draft-${sessionId}`;
  }

  /**
   * Explicitly drops the in-progress close draft. Wired to the
   * Cancel button so the cashier gets a clean slate next time and
   * does not see a stale amount they thought they had discarded.
   */
  cancelCloseDialog(): void {
    this.clearCloseDraft();
    this.showCloseDialog.set(false);
  }

  /**
   * Commits the blind count and unlocks the reveal step.
   * Refuses to advance when the amount is still zero — the button is
   * also disabled in that state, this is a defensive guard for
   * programmatic invocation.
   */
  verifyCount(): void {
    if (this.closeAmount == null || this.closeAmount <= 0) return;
    this.closeStep.set('reveal');
  }

  /**
   * Returns the user to the counting step. Used by the "Volver a
   * contar" secondary button in step 2 when the cashier realises they
   * miskeyed and wants to correct the count before committing.
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

}
