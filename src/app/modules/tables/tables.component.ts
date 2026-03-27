import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogModule } from 'primeng/dialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { RestaurantTable } from '../../core/models';
import { DatabaseService } from '../../core/services/database.service';
import { TableService, OrderSummary } from '../../core/services/table.service';
import { AuthService } from '../../core/services/auth.service';
import { PricePipe } from '../../shared/pipes/price.pipe';

const POLL_INTERVAL = 15_000;

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [DialogModule, ProgressSpinnerModule, ToastModule, PricePipe],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss',
  providers: [MessageService],
})
export class TablesComponent implements OnInit, OnDestroy {

  private readonly tableService = inject(TableService);
  private readonly db = inject(DatabaseService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  readonly currentUser = this.authService.currentUser;

  readonly tables = signal<RestaurantTable[]>([]);
  readonly loading = signal(false);
  readonly showTableDialog = signal(false);
  readonly selectedTable = signal<RestaurantTable | null>(null);
  readonly tableOrders = signal<OrderSummary[]>([]);
  readonly loadingOrders = signal(false);
  /** Map of tableId → active order count (for occupied badges) */
  readonly tableOrderCounts = signal<Map<number, number>>(new Map());

  readonly availableTables = computed(() =>
    this.tables().filter(t => t.status === 'available')
  );
  readonly occupiedTables = computed(() =>
    this.tables().filter(t => t.status === 'occupied')
  );

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** ID of table to reopen dialog for after navigation return */
  private pendingReopenTableId: number | null = null;

  constructor() {
    // Reopen table dialog when returning from checkout/pos
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      filter(e => e.url.startsWith('/tables')),
      takeUntilDestroyed(),
    ).subscribe(() => {
      if (this.pendingReopenTableId) {
        const tableId = this.pendingReopenTableId;
        this.pendingReopenTableId = null;
        // Wait for tables to load, then reopen dialog
        setTimeout(() => {
          const table = this.tables().find(t => t.id === tableId);
          if (table && table.status === 'occupied') {
            this.onTableClick(table);
          }
        }, 500);
      }
    });
  }

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadTables();
    this.pollTimer = setInterval(() => this.loadTables(), POLL_INTERVAL);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  //#endregion

  //#region Public Methods

  /** Loads tables from API/Dexie and fetches order counts for occupied tables */
  async loadTables(): Promise<void> {
    this.loading.set(true);
    await this.tableService.loadTables(this.authService.branchId);
    const tables = await this.tableService.getTables(this.authService.branchId);
    this.tables.set(tables);
    this.loading.set(false);

    // Fetch order counts for occupied tables in parallel (best-effort)
    const occupied = tables.filter(t => t.status === 'occupied');
    if (occupied.length > 0) {
      const results = await Promise.allSettled(
        occupied.map(t => this.tableService.getActiveOrdersByTable(t.id))
      );
      const counts = new Map<number, number>();
      occupied.forEach((t, i) => {
        const r = results[i];
        if (r.status === 'fulfilled') {
          counts.set(t.id, r.value.length);
        }
      });
      this.tableOrderCounts.set(counts);
    }
  }

  /**
   * Handles table selection.
   * Available → navigate to POS with table context.
   * Occupied → navigate to orders filtered by table.
   */
  onTableClick(table: RestaurantTable): void {
    if (table.status === 'available') {
      sessionStorage.setItem('activeTable', JSON.stringify({
        tableId: table.id,
        tableName: table.name,
      }));
      this.router.navigate(['/pos']);
    } else {
      this.selectedTable.set(table);
      this.tableOrders.set([]);
      this.showTableDialog.set(true);
      this.loadTableOrders(table.id);
    }
  }

  /** Loads active orders for a table from the API */
  private async loadTableOrders(tableId: number): Promise<void> {
    this.loadingOrders.set(true);
    const orders = await this.tableService.getActiveOrdersByTable(tableId);
    this.tableOrders.set(orders);
    this.loadingOrders.set(false);
  }

  /** Navigates to orders filtered by table */
  viewTableOrders(): void {
    const table = this.selectedTable();
    if (!table) return;
    this.showTableDialog.set(false);
    this.router.navigate(['/orders'], {
      queryParams: { tableId: table.id },
    });
  }

  /** Releases an occupied table — blocked if there are active orders */
  async releaseTable(): Promise<void> {
    const table = this.selectedTable();
    if (!table) return;

    if (this.tableOrders().length > 0) {
      this.messageService.add({
        severity: 'error',
        summary: `No se puede liberar, hay ${this.tableOrders().length} orden(es) activa(s)`,
        life: 4000,
      });
      return;
    }

    await this.tableService.updateTableStatus(table.id, 'available');
    this.showTableDialog.set(false);
    await this.loadTables();
  }

  /**
   * Navigates to POS to add items to an existing table order.
   * Stores order context in sessionStorage for cart-panel to pick up.
   */
  async onAddItemsToTable(table: RestaurantTable): Promise<void> {
    const order = await this.db.orders
      .filter(o =>
        o.tableId === table.id &&
        o.paymentMethod === null &&
        (o.cancellationStatus === undefined || o.cancellationStatus === 'none')
      )
      .first();

    if (!order) {
      this.messageService.add({ severity: 'warn', summary: 'No hay orden activa en esta mesa', life: 3000 });
      return;
    }

    sessionStorage.setItem('activeTable', JSON.stringify({
      tableId: table.id,
      tableName: table.name,
    }));
    sessionStorage.setItem('addingToOrder', JSON.stringify({
      orderId: order.id,
      orderNumber: order.orderNumber,
    }));

    this.showTableDialog.set(false);
    this.router.navigate(['/pos']);
  }

  /** Navigates to checkout to charge an existing order */
  /** Navigates to checkout to charge an existing order */
  chargeOrder(order: OrderSummary): void {
    this.pendingReopenTableId = this.selectedTable()?.id ?? null;
    this.showTableDialog.set(false);
    this.router.navigate(['/pos/checkout'], {
      queryParams: { orderId: order.id },
    });
  }

  /** Navigates to POS to add items to a specific order */
  addItemsToOrder(order: OrderSummary): void {
    const table = this.selectedTable();
    if (!table) return;

    this.pendingReopenTableId = table.id;
    sessionStorage.setItem('activeTable', JSON.stringify({
      tableId: table.id,
      tableName: table.name,
    }));
    sessionStorage.setItem('addingToOrder', JSON.stringify({
      orderId: order.id,
      orderNumber: order.orderNumber,
    }));

    this.showTableDialog.set(false);
    this.router.navigate(['/pos']);
  }

  /** Creates a new order for the selected table (navigate to POS) */
  newOrderForTable(): void {
    const table = this.selectedTable();
    if (!table) return;

    sessionStorage.setItem('activeTable', JSON.stringify({
      tableId: table.id,
      tableName: table.name,
    }));

    this.showTableDialog.set(false);
    this.router.navigate(['/pos']);
  }

  /** Returns order count for a table, or 0 if unknown */
  getOrderCount(tableId: number): number {
    return this.tableOrderCounts().get(tableId) ?? 0;
  }

  /** Navigates back to POS */
  goBack(): void {
    this.router.navigate(['/pos']);
  }

  //#endregion
}
