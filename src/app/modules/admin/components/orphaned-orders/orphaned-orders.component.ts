import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { CashRegisterSession, OrphanedOrderDto } from '../../../../core/models';
import { CashRegisterStatus } from '../../../../core/enums';
import { AuthService } from '../../../../core/services/auth.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { OrdersService } from '../../../../core/services/orders.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Window of session history fetched for the reconciliation selector (days). */
const SESSION_HISTORY_WINDOW_DAYS = 30;

/** Dropdown option shape — wraps a session with a presentational label. */
interface SessionOption {
  label: string;
  value: number;
  isOpen: boolean;
}

/**
 * Lists orders without a cash register session for the active branch and
 * lets the administrator reconcile them against an existing session via a
 * confirmation modal.
 */
@Component({
  selector: 'app-orphaned-orders',
  standalone: true,
  imports: [
    DatePipe,
    NgClass,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextareaModule,
    ToastModule,
    PricePipe,
  ],
  providers: [MessageService],
  templateUrl: './orphaned-orders.component.html',
  styleUrl: './orphaned-orders.component.scss',
})
export class OrphanedOrdersComponent implements OnInit {

  //#region Injections

  private readonly authService = inject(AuthService);
  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly ordersService = inject(OrdersService);
  private readonly messageService = inject(MessageService);

  //#endregion

  //#region Properties

  readonly orders = signal<OrphanedOrderDto[]>([]);
  readonly isLoading = signal(false);

  // ---- Reconciliation modal ----

  readonly showReconcileDialog = signal(false);
  readonly selectedOrder = signal<OrphanedOrderDto | null>(null);
  readonly sessions = signal<CashRegisterSession[]>([]);
  readonly isLoadingSessions = signal(false);
  readonly selectedSessionId = signal<number | null>(null);
  readonly reconciliationNote = signal('');
  readonly isReconciling = signal(false);

  /** Sessions normalized as PrimeNG dropdown options, open ones listed first. */
  readonly sessionOptions = computed<SessionOption[]>(() => {
    const sorted = [...this.sessions()].sort((a, b) => {
      // Open sessions first, then most recent first.
      const aOpen = a.cashRegisterStatusId === CashRegisterStatus.Open ? 0 : 1;
      const bOpen = b.cashRegisterStatusId === CashRegisterStatus.Open ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime();
    });

    return sorted.map(s => {
      const isOpen = s.cashRegisterStatusId === CashRegisterStatus.Open;
      const opened = new Date(s.openedAt).toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const tag = isOpen ? '🟢 Abierta' : '⚪ Cerrada';
      return {
        label: `${tag} · #${s.id} · ${s.openedBy} · ${opened}`,
        value: s.id,
        isOpen,
      };
    });
  });

  readonly canConfirm = computed(() =>
    this.selectedSessionId() != null && !this.isReconciling(),
  );

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadOrphanedOrders();
  }

  //#endregion

  //#region Orphaned list

  /** Loads the orphaned-orders list for the currently active branch. */
  async loadOrphanedOrders(): Promise<void> {
    const branchId = this.authService.activeBranchId();
    if (branchId == null) return;

    this.isLoading.set(true);
    this.ordersService.getOrphanedOrders(branchId).subscribe({
      next: (data) => {
        this.orders.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('[OrphanedOrders] Failed to load:', err);
        this.isLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudieron cargar las órdenes huérfanas',
          life: 4000,
        });
      },
    });
  }

  //#endregion

  //#region Reconciliation modal

  /** Opens the reconciliation modal and triggers session loading. */
  async onReconcileClick(order: OrphanedOrderDto): Promise<void> {
    this.selectedOrder.set(order);
    this.selectedSessionId.set(null);
    this.reconciliationNote.set('');
    this.showReconcileDialog.set(true);
    await this.loadSessions();
  }

  /** Loads the recent session window (open + closed) for the active branch. */
  private async loadSessions(): Promise<void> {
    this.isLoadingSessions.set(true);
    try {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - SESSION_HISTORY_WINDOW_DAYS);
      const sessions = await this.cashRegisterService.getHistory(from, to);
      this.sessions.set(sessions);
    } catch (err) {
      console.error('[OrphanedOrders] Failed to load sessions:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las sesiones de caja',
        life: 4000,
      });
      this.sessions.set([]);
    } finally {
      this.isLoadingSessions.set(false);
    }
  }

  /** Confirms the reconciliation against the selected session. */
  confirmReconciliation(): void {
    const order = this.selectedOrder();
    const sessionId = this.selectedSessionId();
    if (!order || sessionId == null || this.isReconciling()) return;

    this.isReconciling.set(true);
    const note = this.reconciliationNote().trim();
    this.ordersService.reconcileOrder(order.id, {
      cashRegisterSessionId: sessionId,
      note: note.length > 0 ? note : undefined,
    }).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Orden reconciliada correctamente',
          detail: `#${order.orderNumber} → sesión #${sessionId}`,
          life: 3000,
        });
        // Optimistic removal — also re-sync from API to be safe.
        this.orders.update(arr => arr.filter(o => o.id !== order.id));
        this.closeDialog();
        this.loadOrphanedOrders();
      },
      error: (err) => {
        console.error('[OrphanedOrders] Reconciliation failed:', err);
        const detail = err?.error?.message
          ?? err?.error?.error
          ?? 'No se pudo reconciliar la orden. Verifica la sesión seleccionada.';
        this.messageService.add({
          severity: 'error',
          summary: 'Error al reconciliar',
          detail,
          life: 5000,
        });
        this.isReconciling.set(false);
      },
    });
  }

  /** Closes the modal and clears transient state. */
  closeDialog(): void {
    this.showReconcileDialog.set(false);
    this.selectedOrder.set(null);
    this.selectedSessionId.set(null);
    this.reconciliationNote.set('');
    this.isReconciling.set(false);
  }

  //#endregion

}
