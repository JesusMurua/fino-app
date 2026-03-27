import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import {
  CashMovement,
  CashRegisterSession,
} from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Movement type options for the dialog */
interface MovementTypeOption {
  key: 'withdrawal' | 'expense' | 'adjustment';
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
    DialogModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    TableModule,
    ToastModule,
    PricePipe,
  ],
  providers: [MessageService],
  templateUrl: './cash-register.component.html',
  styleUrl: './cash-register.component.scss',
})
export class CashRegisterComponent implements OnInit {

  //#region Properties

  readonly currentSession = signal<CashRegisterSession | null>(null);
  readonly movements = signal<CashMovement[]>([]);
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
  movementType: 'withdrawal' | 'expense' | 'adjustment' = 'withdrawal';

  /** Movement type options for the selector */
  readonly movementTypes: MovementTypeOption[] = [
    { key: 'withdrawal', label: 'Retiro', icon: '💰', description: 'Dinero retirado para depósito o resguardo', placeholder: 'Ej: Depósito al banco' },
    { key: 'expense', label: 'Gasto', icon: '🧾', description: 'Pago a proveedor, servicios, etc.', placeholder: 'Ej: Pago de gas' },
    { key: 'adjustment', label: 'Ajuste', icon: '⚖️', description: 'Corrección por error de conteo', placeholder: 'Ej: Corrección de cambio' },
  ];

  //#endregion

  //#region Computeds

  readonly isSessionOpen = computed(() => this.currentSession()?.status === 'open');

  readonly movementsTotal = computed(() => {
    return this.movements()
      .filter(m => m.type === 'withdrawal' || m.type === 'expense')
      .reduce((sum, m) => sum + m.amountCents, 0);
  });

  readonly expectedAmount = computed(() => {
    const session = this.currentSession();
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

  //#region Constructor
  constructor(
    private readonly cashRegisterService: CashRegisterService,
    private readonly authService: AuthService,
    private readonly db: DatabaseService,
    private readonly messageService: MessageService,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadSession();
  }

  //#endregion

  //#region Session Methods

  /** Loads current open session and today's cash sales */
  async loadSession(): Promise<void> {
    this.loading.set(true);

    const session = await this.cashRegisterService.getOpenSession(this.authService.branchId);
    this.currentSession.set(session);
    this.movements.set(session?.movements ?? []);

    await this.loadCashSales();

    this.loading.set(false);
  }

  /** Opens a new cash register session */
  async openSession(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    const session = await this.cashRegisterService.openSession(this.authService.branchId, {
      initialAmountCents: Math.round(this.openAmount * 100),
      openedBy: user.name,
    });

    this.currentSession.set(session);
    this.movements.set(session.movements ?? []);
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
        o.paymentMethod == null &&
        (o.cancellationStatus === undefined || o.cancellationStatus === 'none') &&
        new Date(o.createdAt) >= todayStart
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

    this.currentSession.set(null);
    this.movements.set([]);
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
      type: this.movementType,
      amountCents: Math.round(this.movementAmount * 100),
      description: this.movementDescription.trim(),
      createdBy: user.name,
    });

    await this.loadSession();
    this.showMovementDialog.set(false);
    this.movementAmount = 0;
    this.movementDescription = '';
    this.movementType = 'withdrawal';

    const labels: Record<string, string> = {
      withdrawal: 'Retiro registrado',
      expense: 'Gasto registrado',
      adjustment: 'Ajuste registrado',
    };

    this.messageService.add({
      severity: 'success',
      summary: labels[this.movementType] ?? 'Movimiento registrado',
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
    this.movementType = 'withdrawal';
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
      .filter(o => o.paymentMethod === 'cash' && o.cancellationStatus !== 'cancelled')
      .reduce((sum, o) => sum + o.totalCents, 0);

    this.cashSalesTotalCents.set(cashTotal);
  }

  //#endregion

}
