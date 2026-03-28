import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogModule } from 'primeng/dialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { MessageService } from 'primeng/api';

import {
  BusinessType,
  RestaurantTable,
  TableStatus,
  TableStatusDto,
  Zone,
  ZoneType,
  mapDisplayStatus,
} from '../../core/models';
import { DatabaseService } from '../../core/services/database.service';
import { TableService, OrderSummary } from '../../core/services/table.service';
import { AuthService } from '../../core/services/auth.service';
import { ZoneService } from '../../core/services/zone.service';
import { PricePipe } from '../../shared/pipes/price.pipe';

const POLL_INTERVAL = 15_000;

/** Grouped zone entry for template iteration */
interface ZoneGroup {
  id: number | null;
  name: string;
  type: ZoneType;
  tables: TableStatusDto[];
}

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [DialogModule, ProgressSpinnerModule, PricePipe],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss',
})
export class TablesComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly tableService = inject(TableService);
  private readonly zoneService = inject(ZoneService);
  private readonly db = inject(DatabaseService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  readonly currentUser = this.authService.currentUser;

  /** Expose enums for template */
  readonly TableStatus = TableStatus;
  readonly ZoneType = ZoneType;

  /** Raw table statuses from the API */
  readonly tableStatuses = signal<TableStatusDto[]>([]);

  /** Legacy tables signal — kept for dialog downstream compatibility */
  readonly tables = signal<RestaurantTable[]>([]);

  readonly loading = signal(false);
  readonly showTableDialog = signal(false);
  readonly selectedTable = signal<RestaurantTable | null>(null);
  readonly tableOrders = signal<OrderSummary[]>([]);
  readonly loadingOrders = signal(false);

  /** Currently selected zone filter — null = all zones */
  readonly activeZone = signal<number | null>(null);

  //#endregion

  //#region KPI Computeds

  readonly kpiTotal = computed(() => this.tableStatuses().length);

  readonly kpiOccupied = computed(() =>
    this.tableStatuses().filter(t => mapDisplayStatus(t.displayStatus) !== TableStatus.Free).length,
  );

  readonly kpiAvailable = computed(() =>
    this.tableStatuses().filter(t => mapDisplayStatus(t.displayStatus) === TableStatus.Free).length,
  );

  readonly kpiInKitchen = computed(() =>
    this.tableStatuses().filter(t => mapDisplayStatus(t.displayStatus) === TableStatus.InKitchen).length,
  );

  readonly kpiReserved = computed(() =>
    this.tableStatuses().filter(t => mapDisplayStatus(t.displayStatus) === TableStatus.Reserved).length,
  );

  //#endregion

  //#region Zone Computeds

  /** Distinct zone names from current statuses, enriched with zone service data */
  readonly availableZones = computed<Zone[]>(() => {
    const zones = this.zoneService.getActiveZones();
    if (zones.length === 0) return [];
    const statusZoneIds = new Set(this.tableStatuses().map(t => t.zoneId).filter(Boolean));
    return zones.filter(z => statusZoneIds.has(z.id));
  });

  /** Tables grouped by zone, filtered by activeZone */
  readonly zoneGroups = computed<ZoneGroup[]>(() => {
    const statuses = this.tableStatuses();
    const zones = this.zoneService.getActiveZones();
    const activeZoneId = this.activeZone();

    // Build zone lookup
    const zoneMap = new Map<number, Zone>();
    zones.forEach(z => zoneMap.set(z.id, z));

    // Group by zoneId
    const groups = new Map<number | null, TableStatusDto[]>();
    for (const dto of statuses) {
      const key = dto.zoneId ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(dto);
    }

    // Build result
    const result: ZoneGroup[] = [];

    // Sorted zones first
    for (const zone of zones) {
      const tables = groups.get(zone.id);
      if (!tables || tables.length === 0) continue;
      if (activeZoneId !== null && activeZoneId !== zone.id) continue;
      result.push({ id: zone.id, name: zone.name, type: zone.type, tables });
    }

    // Tables without zone ("Sin zona")
    const noZone = groups.get(null);
    if (noZone && noZone.length > 0 && activeZoneId === null) {
      result.push({ id: null, name: 'Sin zona', type: ZoneType.Salon, tables: noZone });
    }

    return result;
  });

  /** True if zone tabs should render */
  readonly showZoneTabs = computed(() => this.availableZones().length > 1);

  //#endregion

  //#region Polling

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** ID of table to reopen dialog for after navigation return */
  private pendingReopenTableId: number | null = null;

  //#endregion

  //#region Constructor

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
        setTimeout(() => {
          const dto = this.tableStatuses().find(t => t.tableId === tableId);
          if (dto && mapDisplayStatus(dto.displayStatus) !== TableStatus.Free) {
            this.onTableCardClick(dto);
          }
        }, 500);
      }
    });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.zoneService.loadZones();
    await this.loadTableStatuses();
    this.pollTimer = setInterval(() => this.loadTableStatuses(), POLL_INTERVAL);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  //#endregion

  //#region Data Loading

  /** Loads enriched table statuses from the single backend endpoint */
  async loadTableStatuses(): Promise<void> {
    this.loading.set(true);
    try {
      const statuses = await firstValueFrom(this.tableService.getTableStatuses());
      this.tableStatuses.set(statuses);

      // Sync legacy tables signal for dialog downstream
      const tables: RestaurantTable[] = statuses.map(dto => ({
        id: dto.tableId,
        branchId: this.authService.branchId,
        name: dto.tableName,
        zoneId: dto.zoneId,
        status: mapDisplayStatus(dto.displayStatus) === TableStatus.Free ? 'available' as const : 'occupied' as const,
        isActive: true,
        createdAt: new Date(),
        orderId: dto.orderId,
      }));
      this.tables.set(tables);
    } catch {
      console.warn('[Tables] Failed to load table statuses');
    } finally {
      this.loading.set(false);
    }
  }

  /** Kept for backwards compat — redirects to new method */
  async loadTables(): Promise<void> {
    await this.loadTableStatuses();
  }

  //#endregion

  //#region Table Card Click

  /**
   * Handles click on a table card from the new zone grid.
   * Builds a RestaurantTable from the DTO and delegates to onTableClick.
   * @param dto The table status DTO from the grid
   */
  onTableCardClick(dto: TableStatusDto): void {
    const table: RestaurantTable = {
      id: dto.tableId,
      branchId: this.authService.branchId,
      name: dto.tableName,
      zoneId: dto.zoneId,
      status: mapDisplayStatus(dto.displayStatus) === TableStatus.Free ? 'available' : 'occupied',
      isActive: true,
      createdAt: new Date(),
      orderId: dto.orderId,
    };
    this.onTableClick(table);
  }

  /**
   * Handles table selection — preserved from original logic.
   * Available → navigate to POS with table context.
   * Occupied → open orders dialog.
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

  //#endregion

  //#region Dialog Methods (preserved)

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
    await this.loadTableStatuses();
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

  //#endregion

  //#region Display Helpers

  /** Returns CSS class modifier for a table status */
  getStatusClass(status: string): string {
    switch (mapDisplayStatus(status)) {
      case TableStatus.Free:        return 'free';
      case TableStatus.WithOrder:   return 'with-order';
      case TableStatus.InKitchen:   return 'in-kitchen';
      case TableStatus.Ready:       return 'ready';
      case TableStatus.WaitingBill: return 'waiting-bill';
      case TableStatus.Paid:        return 'paid';
      case TableStatus.Reserved:    return 'reserved';
      default:                      return 'free';
    }
  }

  /** Returns Spanish label for a table status */
  getStatusLabel(status: string): string {
    switch (mapDisplayStatus(status)) {
      case TableStatus.Free:        return 'Disponible';
      case TableStatus.WithOrder:   return 'Con orden';
      case TableStatus.InKitchen:   return 'En cocina';
      case TableStatus.Ready:       return 'Lista';
      case TableStatus.WaitingBill: return 'Por cobrar';
      case TableStatus.Paid:        return 'Pagada';
      case TableStatus.Reserved:    return 'Reservada';
      default:                      return 'Disponible';
    }
  }

  /** Whether a zone group should render as bar seats (circles) */
  isBarZone(group: ZoneGroup): boolean {
    return group.type === ZoneType.BarSeats;
  }

  /** Whether KPI strip should be visible based on business type */
  showKpis(): boolean {
    const giro = this.authService.businessType();
    return giro === BusinessType.Restaurant
      || giro === BusinessType.Bar
      || giro === BusinessType.Cafe;
  }

  /** Navigates back to POS */
  goBack(): void {
    this.router.navigate(['/pos']);
  }

  //#endregion

}
