import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, NgClass } from '@angular/common';

import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TableModule } from 'primeng/table';
import { MessageService } from 'primeng/api';

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
    DialogModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    TableModule,
    PricePipe,
    StatusLabelPipe,
    StatusClassPipe,
  ],
  templateUrl: './cash-register.component.html',
  styleUrl: './cash-register.component.scss',
})
export class CashRegisterComponent implements OnInit {

  //#region Injections

  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly authService = inject(AuthService);
  private readonly db = inject(DatabaseService);
  private readonly messageService = inject(MessageService);

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

  /** Opens a new cash register session */
  async openSession(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    await this.cashRegisterService.openSession({
      initialAmountCents: Math.round(this.openAmount * 100),
      openedBy: user.name,
    });

    this.showOpenDialog.set(false);
    this.openAmount = 0;
    await this.loadCashSales();

    this.messageService.add({
      severity: 'success',
      summary: 'Turno abierto',
      detail: 'Turno abierto correctamente',
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

  /** Closes the current session */
  async closeSession(): Promise<void> {
    this.showCloseConfirm.set(false);
    const user = this.authService.currentUser();
    if (!user) return;

    await this.cashRegisterService.closeSession(this.authService.branchId, {
      countedAmountCents: Math.round(this.closeAmount * 100),
      closedBy: user.name,
      notes: this.closeNotes.trim() || undefined,
    });

    // `closeSession` clears `_activeSession` internally, so every
    // signal-backed computed reactively flips to the empty state.
    this.showCloseDialog.set(false);
    this.closeAmount = 0;
    this.closeNotes = '';

    this.messageService.add({
      severity: 'success',
      summary: 'Turno cerrado',
      detail: 'Turno cerrado correctamente',
    });
  }

  /** Adds a cash movement (withdrawal, expense, adjustment) */
  async addMovement(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    await this.cashRegisterService.addMovement(this.authService.branchId, {
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

    const sessions = await this.cashRegisterService.getHistory(this.authService.branchId, from, to);
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

  /** Opens the close dialog and pre-sets expected */
  openCloseDialog(): void {
    this.closeAmount = 0;
    this.closeNotes = '';
    this.showCloseDialog.set(true);
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

  /** Loads today's cash sales total from Dexie (non-cancelled, cash only) */
  private async loadCashSales(): Promise<void> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const orders = await this.db.orders
      .where('createdAt')
      .aboveOrEqual(todayStart)
      .toArray();

    const cashTotal = orders
      .filter(o => (o.payments ?? []).some(p => p.method === 'Cash') && !o.cancelledAt)
      .reduce((sum, o) => sum + o.totalCents, 0);

    this.cashSalesTotalCents.set(cashTotal);
  }

  //#endregion

}
