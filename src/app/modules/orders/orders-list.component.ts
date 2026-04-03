import { Component, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { DialogModule } from 'primeng/dialog';
import { RadioButtonModule } from 'primeng/radiobutton';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { Order } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { OrdersService, getDisplayStatus } from '../../core/services/orders.service';
import { PrintService } from '../../core/services/print.service';
import { TableService } from '../../core/services/table.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { OrderRowComponent } from './order-row.component';

/** Filter tabs for the order list */
type StatusFilter = 'all' | 'new' | 'cooking' | 'ready' | 'delivered' | 'cancelled';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [FormsModule, OrderRowComponent, DialogModule, RadioButtonModule, InputTextareaModule, ToastModule],
  providers: [MessageService],
  templateUrl: './orders-list.component.html',
  styleUrl: './orders-list.component.scss',
})
export class OrdersListComponent implements OnInit, OnDestroy {

  //#region Properties
  readonly activeFilter = signal<StatusFilter>('all');
  readonly searchQuery = signal('');
  readonly now = signal(new Date());

  /** Whether the current user can mark orders as delivered */
  readonly canDeliver: boolean;

  /** Cancel dialog state */
  readonly showCancelDialog = signal(false);
  readonly cancellingOrder = signal<Order | null>(null);
  readonly selectedReason = signal('');
  readonly cancelNotes = signal('');

  /** Ticket preview dialog state */
  readonly showTicketDialog = signal(false);
  readonly ticketHtmlContent = signal('');
  readonly ticketOrder = signal<Order | null>(null);

  readonly cancellationReasons = [
    'Error en la orden',
    'Cliente canceló',
    'Ingrediente no disponible',
    'Orden duplicada',
    'Otro',
  ];

  readonly filters: { key: StatusFilter; label: string }[] = [
    { key: 'all',       label: 'Todas' },
    { key: 'new',       label: 'Nueva' },
    { key: 'cooking',   label: 'En cocina' },
    { key: 'ready',     label: 'Lista' },
    { key: 'delivered', label: 'Entregada' },
    { key: 'cancelled', label: 'Cancelada' },
  ];

  /** Filtered and searched orders */
  readonly filteredOrders = computed(() => {
    let orders = this.ordersService.todayOrders();
    const filter = this.activeFilter();
    const query = this.searchQuery().trim();

    if (filter !== 'all') {
      orders = orders.filter(o => this.matchesFilter(o, filter));
    }

    if (query) {
      const num = parseInt(query.replace('#', ''), 10);
      if (!isNaN(num)) {
        orders = orders.filter(o => o.orderNumber === num);
      }
    }

    return orders;
  });

  private clockTimerId: ReturnType<typeof setInterval> | null = null;
  //#endregion

  //#region Constructor
  /** Whether the thermal printer is currently connected */
  readonly hasThermalPrinter = () => this.printService.hasThermalPrinter();

  constructor(
    private readonly ordersService: OrdersService,
    private readonly authService: AuthService,
    private readonly printService: PrintService,
    private readonly tableService: TableService,
    private readonly messageService: MessageService,
    private readonly router: Router,
  ) {
    const role = this.authService.currentUser()?.role;
    this.canDeliver = role === 'Cashier' || role === 'Owner';

    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.ordersService.start();
    }, { allowSignalWrites: true });
  }
  //#endregion

  //#region Lifecycle
  async ngOnInit(): Promise<void> {
    await this.ordersService.start();
    this.clockTimerId = setInterval(() => this.now.set(new Date()), 1000);
  }

  ngOnDestroy(): void {
    this.ordersService.stop();
    if (this.clockTimerId !== null) {
      clearInterval(this.clockTimerId);
    }
  }
  //#endregion

  //#region Actions

  setFilter(filter: StatusFilter): void {
    this.activeFilter.set(filter);
  }

  onSearch(query: string): void {
    this.searchQuery.set(query);
  }

  async onMarkDelivered(order: Order): Promise<void> {
    await this.ordersService.markAsDelivered(order.id);

    // Release table when order is delivered
    if (order.tableId) {
      this.tableService.updateTableStatus(order.tableId, 'available').catch(() => {});
    }
  }

  /** Navigates to checkout to charge an unpaid table order */
  onChargeOrder(order: Order): void {
    this.router.navigate(['/pos/checkout'], {
      queryParams: { orderId: order.id },
    });
  }

  goBack(): void {
    this.router.navigate(['/pos']);
  }

  /** Opens the ticket preview dialog for an order */
  onViewTicket(order: Order): void {
    this.ticketHtmlContent.set(this.printService.getTicketHtml(order));
    this.ticketOrder.set(order);
    this.showTicketDialog.set(true);
  }

  /** Opens a new window with the ticket HTML and triggers print */
  onPrintTicket(): void {
    const html = this.ticketHtmlContent();
    if (!html) return;

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Ticket</title>
          <style>
            body { margin: 0; padding: 0; background: white; }
            @media print {
              @page { size: 80mm auto; margin: 2mm; }
            }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `);
    win.document.close();
    win.print();
  }

  /** Reprints a ticket via thermal printer (ESC/POS) */
  async onReprintThermal(): Promise<void> {
    const order = this.ticketOrder();
    if (!order) return;

    try {
      await this.printService.printTicket(order);
      this.messageService.add({
        severity: 'success',
        summary: 'Ticket reimpreso',
        detail: `Orden #${order.orderNumber}`,
        life: 3000,
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error de impresora',
        detail: 'Verifica la conexión de la impresora e intenta de nuevo.',
        life: 5000,
      });
    }
  }

  /** Handles print errors bubbled from order-row components */
  onPrintError(message: string): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error de impresora',
      detail: message,
      life: 5000,
    });
  }

  /** Opens the cancellation dialog for a specific order */
  openCancelDialog(order: Order): void {
    this.cancellingOrder.set(order);
    this.selectedReason.set('');
    this.cancelNotes.set('');
    this.showCancelDialog.set(true);
  }

  /** Confirms cancellation, updates Dexie + API, closes dialog */
  async confirmCancel(): Promise<void> {
    const order = this.cancellingOrder();
    const reason = this.selectedReason();
    if (!order || !reason) return;

    const notes = this.cancelNotes().trim() || undefined;
    await this.ordersService.cancelOrder(order.id, reason, notes);
    this.showCancelDialog.set(false);
    this.cancellingOrder.set(null);
  }

  //#endregion

  //#region Helpers

  /** Returns true if the order can be cancelled */
  canCancel(order: Order): boolean {
    return !order.cancelledAt && order.kitchenStatus !== 'Delivered';
  }

  getStatus(order: Order) {
    return getDisplayStatus(order);
  }

  isDelivered(order: Order): boolean {
    return order.kitchenStatus === 'Delivered';
  }

  private matchesFilter(order: Order, filter: StatusFilter): boolean {
    const status = getDisplayStatus(order);
    switch (filter) {
      case 'new':       return status.label === 'Nueva';
      case 'cooking':   return status.label === 'En cocina';
      case 'ready':     return status.label === 'Listo';
      case 'delivered':  return status.label === 'Entregado';
      case 'cancelled':  return status.label === 'Cancelada';
      default:           return true;
    }
  }

  //#endregion

}
