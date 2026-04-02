import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DialogModule } from 'primeng/dialog';

import { MessageService } from 'primeng/api';

import {
  BusinessType,
  RestaurantTable,
  TableStatusDto,
  Zone,
  ZoneType,
  normalizeDisplayStatus,
} from '../../core/models';
import { Reservation } from '../../core/models/reservation.model';
import { CatalogService } from '../../core/services/catalog.service';
import { DatabaseService } from '../../core/services/database.service';
import { ReservationService } from '../../core/services/reservation.service';
import { TableService, OrderSummary, MoveItemsResult, SplitGroup } from '../../core/services/table.service';
import { PaymentMethod, PAYMENT_METHOD_OPTIONS } from '../../core/models/order.model';
import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';
import { SyncService } from '../../core/services/sync.service';
import { ZoneService } from '../../core/services/zone.service';
import { PricePipe } from '../../shared/pipes/price.pipe';

const POLL_INTERVAL = 15_000;

/** TableStatusDto enriched with reservation data for the template */
interface EnrichedTableStatus extends TableStatusDto {
  partySize: number | null;
}

/** Grouped zone entry for template iteration */
interface ZoneGroup {
  id: number | null;
  name: string;
  type: ZoneType;
  tables: EnrichedTableStatus[];
}

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [DialogModule, PricePipe, NgClass],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss',
})
export class TablesComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly tableService = inject(TableService);
  private readonly zoneService = inject(ZoneService);
  private readonly db = inject(DatabaseService);
  private readonly syncService = inject(SyncService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly configService = inject(ConfigService);
  readonly currentUser = this.authService.currentUser;

  /** Expose enums for template */
  readonly ZoneType = ZoneType;
  readonly catalogService = inject(CatalogService);
  private readonly reservationService = inject(ReservationService);

  /** Raw table statuses from the API */
  readonly tableStatuses = signal<TableStatusDto[]>([]);

  /** Today's reservations for floor map integration */
  readonly todayReservations = signal<Reservation[]>([]);

  /** Reserved table dialog state */
  readonly showReservedDialog = signal(false);
  readonly selectedReservation = signal<Reservation | null>(null);
  readonly seatingBusy = signal(false);

  /** Legacy tables signal — kept for dialog downstream compatibility */
  readonly tables = signal<RestaurantTable[]>([]);

  /** Seconds elapsed since last successful poll */
  readonly secondsSinceUpdate = signal(0);
  private updateTimerInterval: ReturnType<typeof setInterval> | null = null;

  /** Device config as signal for reactive top bar */
  private readonly deviceConfig = toSignal(this.configService.deviceConfig$);

  readonly loading = signal(false);
  readonly showTableDialog = signal(false);
  readonly selectedTable = signal<RestaurantTable | null>(null);
  readonly tableOrders = signal<OrderSummary[]>([]);
  readonly loadingOrders = signal(false);

  /** Currently selected zone filter — null = all zones */
  readonly activeZone = signal<number | null>(null);

  // ---- Move items dialog ----
  readonly showMoveDialog = signal(false);
  readonly moveStep = signal<1 | 2>(1);
  readonly moveSourceOrderId = signal<string | null>(null);
  readonly moveSourceTableName = signal('');
  readonly moveTargetTable = signal<TableStatusDto | null>(null);
  readonly moveOrderItems = signal<{ id: number; productName: string; quantity: number }[]>([]);
  readonly moveSelectedIds = signal<Set<number>>(new Set());
  readonly moveBusy = signal(false);

  // ---- Merge tables dialog ----
  readonly showMergeDialog = signal(false);
  readonly mergeBusy = signal(false);
  readonly mergeSourceTable = signal<TableStatusDto | null>(null);
  readonly mergeTargetOrderId = signal<string | null>(null);
  readonly mergeTargetTableName = signal('');

  // ---- Split bill dialog ----
  readonly showSplitDialog = signal(false);
  readonly splitMode = signal<'choice' | 'equal' | 'items'>('choice');
  readonly splitSourceOrderId = signal<string | null>(null);
  readonly splitSourceTableName = signal('');
  readonly splitSourceItems = signal<{ id: number; productName: string; quantity: number }[]>([]);
  readonly splitOrderTotal = signal(0);
  readonly splitBusy = signal(false);

  // Equal split
  readonly splitPartsCount = signal(2);
  readonly splitEqualPaymentStep = signal(0);
  readonly splitEqualMethod = signal<PaymentMethod | null>(null);

  // Items split
  private splitGroupCounter = 0;
  readonly splitGroups = signal<{ id: number; label: string; itemIds: number[] }[]>([]);

  readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS;

  //#endregion

  //#region KPI Computeds

  readonly kpiTotal = computed(() => this.tableStatuses().length);

  readonly kpiOccupied = computed(() =>
    this.tableStatuses().filter(t => t.displayStatus !== 'free').length,
  );

  readonly kpiAvailable = computed(() =>
    this.tableStatuses().filter(t => t.displayStatus === 'free').length,
  );

  readonly kpiInKitchen = computed(() =>
    this.tableStatuses().filter(t => t.displayStatus === 'in_kitchen').length,
  );

  readonly kpiReserved = computed(() =>
    this.tableStatuses().filter(t => t.displayStatus === 'reserved').length,
  );

  /** Total amount in progress from all occupied tables */
  readonly totalInProgressCents = computed(() =>
    this.tableStatuses()
      .filter(t => t.displayStatus !== 'free')
      .reduce((sum, t) => sum + (t.orderTotalCents ?? 0), 0),
  );

  //#endregion

  //#region Top Bar Computeds

  /** Branch display name from user's branches list */
  private readonly branchDisplayName = computed(() => {
    const user = this.currentUser();
    const branchId = this.authService.activeBranchId();
    return user?.branches.find(b => b.id === branchId)?.name ?? 'tu sucursal';
  });

  /** Top bar label combining business name and branch name */
  readonly topBarLabel = computed(() => {
    const dc = this.deviceConfig();
    if (dc?.businessName && dc?.branchName) {
      return `${dc.businessName} — ${dc.branchName}`;
    }
    return this.branchDisplayName();
  });

  //#endregion

  //#region Zone Computeds

  /** Distinct zone names from current statuses, enriched with zone service data */
  readonly availableZones = computed<Zone[]>(() => {
    const zones = this.zoneService.getActiveZones();
    if (zones.length === 0) return [];
    const statusZoneIds = new Set(this.tableStatuses().map(t => t.zoneId).filter(Boolean));
    return zones.filter(z => statusZoneIds.has(z.id));
  });

  /** Table statuses enriched with reservation partySize */
  readonly enrichedTables = computed<EnrichedTableStatus[]>(() => {
    const reservations = this.todayReservations();
    return this.tableStatuses().map(dto => ({
      ...dto,
      partySize: reservations.find(r => r.tableId === dto.tableId && r.status === 'Confirmed')?.partySize ?? null,
    }));
  });

  /** Tables grouped by zone, filtered by activeZone */
  readonly zoneGroups = computed<ZoneGroup[]>(() => {
    const statuses = this.enrichedTables();
    const zones = this.zoneService.getActiveZones();
    const activeZoneId = this.activeZone();

    // Build zone lookup
    const zoneMap = new Map<number, Zone>();
    zones.forEach(z => zoneMap.set(z.id, z));

    // Group by zoneId
    const groups = new Map<number | null, EnrichedTableStatus[]>();
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

  //#region Move Items Computeds

  /** Occupied tables excluding the source table — targets for move */
  readonly occupiedTargetTables = computed(() => {
    const sourceId = this.selectedTable()?.id;
    return this.tableStatuses().filter(t =>
      t.displayStatus !== 'free' && t.tableId !== sourceId,
    );
  });

  /** Number of selected items to move */
  readonly moveSelectedCount = computed(() => this.moveSelectedIds().size);

  /** Whether all items are selected */
  readonly moveAllSelected = computed(() => {
    const items = this.moveOrderItems();
    return items.length > 0 && this.moveSelectedIds().size === items.length;
  });

  //#endregion

  //#region Split Bill Computeds

  /** Amount each person pays in equal split */
  readonly splitEqualAmount = computed(() =>
    Math.ceil(this.splitOrderTotal() / this.splitPartsCount()),
  );

  /** All item IDs currently assigned to any split group */
  readonly splitItemsAssigned = computed(() => {
    const ids = new Set<number>();
    for (const g of this.splitGroups()) {
      for (const id of g.itemIds) ids.add(id);
    }
    return ids;
  });

  /** Items not yet assigned to any group */
  readonly splitItemsUnassigned = computed(() =>
    this.splitSourceItems().filter(i => !this.splitItemsAssigned().has(i.id)),
  );

  /** Whether items split can be confirmed */
  readonly splitCanConfirmItems = computed(() =>
    this.splitGroups().length >= 2 && this.splitItemsUnassigned().length === 0,
  );

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
          if (dto && dto.displayStatus !== 'free') {
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
    this.loadTodayReservations();
    this.pollTimer = setInterval(() => this.loadTableStatuses(), POLL_INTERVAL);
    this.updateTimerInterval = setInterval(() => this.secondsSinceUpdate.update(s => s + 1), 1000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.updateTimerInterval) clearInterval(this.updateTimerInterval);
  }

  //#endregion

  //#region Data Loading

  /** Loads enriched table statuses from the single backend endpoint */
  async loadTableStatuses(): Promise<void> {
    this.loading.set(true);
    try {
      const statuses = await firstValueFrom(this.tableService.getTableStatuses());
      this.tableStatuses.set(statuses);
      this.secondsSinceUpdate.set(0);

      // Sync legacy tables signal for dialog downstream
      const tables: RestaurantTable[] = statuses.map(dto => ({
        id: dto.tableId,
        branchId: this.authService.branchId,
        name: dto.tableName,
        zoneId: dto.zoneId,
        status: dto.displayStatus === 'free' ? 'available' as const : 'occupied' as const,
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
    // Reserved tables → show reservation info + Sentar button
    if (dto.displayStatus === 'reserved') {
      const reservation = this.todayReservations().find(
        r => r.tableId === dto.tableId && r.status === 'Confirmed',
      );
      if (reservation) {
        this.selectedReservation.set(reservation);
        this.showReservedDialog.set(true);
        return;
      }
    }

    const table: RestaurantTable = {
      id: dto.tableId,
      branchId: this.authService.branchId,
      name: dto.tableName,
      zoneId: dto.zoneId,
      status: dto.displayStatus === 'free' ? 'available' : 'occupied',
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
        (o.payments?.length ?? 0) === 0 &&
        !o.cancelledAt
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

  //#region Move Items Methods

  /**
   * Opens the move items dialog for a given order.
   * Pre-selects all items by default.
   * @param order The order whose items to move
   */
  openMoveFlow(order: OrderSummary): void {
    const tableName = this.selectedTable()?.name ?? '';
    this.moveSourceOrderId.set(order.id);
    this.moveSourceTableName.set(tableName);
    this.moveTargetTable.set(null);
    this.moveStep.set(1);

    // Populate items and select all by default
    const items = order.items.map(i => ({
      id: i.id,
      productName: i.productName,
      quantity: i.quantity,
    }));
    this.moveOrderItems.set(items);
    this.moveSelectedIds.set(new Set(items.map(i => i.id)));

    if (items.some(i => !i.id)) {
      console.warn('[Tables] Some order items have no ID — move may fail');
    }

    this.showTableDialog.set(false);
    this.showMoveDialog.set(true);
  }

  /**
   * Selects a target table and advances to step 2.
   * @param table Target table DTO
   */
  selectMoveTarget(table: TableStatusDto): void {
    this.moveTargetTable.set(table);
    this.moveStep.set(2);
  }

  /**
   * Toggles an item in the move selection.
   * @param itemId The order item ID to toggle
   */
  toggleMoveItem(itemId: number): void {
    this.moveSelectedIds.update(set => {
      const next = new Set(set);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  /** Selects or deselects all items */
  toggleAllMoveItems(): void {
    if (this.moveAllSelected()) {
      this.moveSelectedIds.set(new Set());
    } else {
      this.moveSelectedIds.set(new Set(this.moveOrderItems().map(i => i.id)));
    }
  }

  /**
   * Calls the move items API and handles the result.
   * On success: reloads table statuses and shows toast.
   */
  async confirmMoveItems(): Promise<void> {
    const sourceId = this.moveSourceOrderId();
    const target = this.moveTargetTable();
    if (!sourceId || !target?.orderId || this.moveSelectedIds().size === 0) return;

    this.moveBusy.set(true);

    try {
      const result = await firstValueFrom(
        this.tableService.moveItems(
          sourceId,
          target.orderId,
          Array.from(this.moveSelectedIds()),
        ),
      );

      this.cancelMove();
      await this.loadTableStatuses();

      this.messageService.add({
        severity: 'success',
        summary: `Items movidos a ${target.tableName}`,
        life: 3000,
      });

      if (result.sourceTableFreed) {
        this.messageService.add({
          severity: 'info',
          summary: `${this.moveSourceTableName()} quedó libre`,
          life: 3000,
        });
      }
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error al mover items',
        life: 4000,
      });
    } finally {
      this.moveBusy.set(false);
    }
  }

  /** Resets all move state and closes the dialog */
  cancelMove(): void {
    this.showMoveDialog.set(false);
    this.moveStep.set(1);
    this.moveSourceOrderId.set(null);
    this.moveSourceTableName.set('');
    this.moveTargetTable.set(null);
    this.moveOrderItems.set([]);
    this.moveSelectedIds.set(new Set());
  }

  //#endregion

  //#region Merge Tables Methods

  /**
   * Opens the merge dialog for the current active order.
   * Shows list of other occupied tables to merge from.
   * @param order The order that will survive (target)
   */
  openMergeFlow(order: OrderSummary): void {
    const tableName = this.selectedTable()?.name ?? '';
    this.mergeTargetOrderId.set(order.id);
    this.mergeTargetTableName.set(tableName);
    this.mergeSourceTable.set(null);

    this.showTableDialog.set(false);
    this.showMergeDialog.set(true);
  }

  /**
   * Confirms the merge — calls mergeOrders API.
   * All items from source table's order move to the target order.
   */
  async confirmMerge(): Promise<void> {
    const targetId = this.mergeTargetOrderId();
    const source = this.mergeSourceTable();
    if (!targetId || !source?.orderId) return;

    this.mergeBusy.set(true);

    try {
      const result = await firstValueFrom(
        this.tableService.mergeOrders(targetId, source.orderId),
      );

      this.cancelMerge();
      await this.loadTableStatuses();

      this.messageService.add({
        severity: 'success',
        summary: `${source.tableName} unida con ${this.mergeTargetTableName()}`,
        life: 3000,
      });

      if (result.sourceTableFreed) {
        this.messageService.add({
          severity: 'info',
          summary: `${source.tableName} quedó libre`,
          life: 3000,
        });
      }
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error al unir mesas',
        life: 4000,
      });
    } finally {
      this.mergeBusy.set(false);
    }
  }

  /** Resets all merge state and closes the dialog */
  cancelMerge(): void {
    this.showMergeDialog.set(false);
    this.mergeSourceTable.set(null);
    this.mergeTargetOrderId.set(null);
    this.mergeTargetTableName.set('');
  }

  //#endregion

  //#region Split Bill Methods

  /**
   * Opens the split bill dialog for a given order.
   * @param order The order to split
   */
  openSplitFlow(order: OrderSummary): void {
    const tableName = this.selectedTable()?.name ?? '';
    this.splitSourceOrderId.set(order.id);
    this.splitSourceTableName.set(tableName);
    this.splitOrderTotal.set(order.totalCents);
    this.splitSourceItems.set(order.items.map(i => ({
      id: i.id, productName: i.productName, quantity: i.quantity,
    })));
    this.splitMode.set('choice');
    this.splitPartsCount.set(2);
    this.splitEqualPaymentStep.set(0);
    this.splitEqualMethod.set(null);
    this.splitGroupCounter = 0;
    this.splitGroups.set([]);

    this.showTableDialog.set(false);
    this.showSplitDialog.set(true);
  }

  /** Sets split mode and initializes groups for items mode */
  setSplitMode(mode: 'choice' | 'equal' | 'items'): void {
    this.splitMode.set(mode);
    if (mode === 'items' && this.splitGroups().length === 0) {
      this.addSplitGroup();
      this.addSplitGroup();
    }
  }

  /** Resets ALL split signals and closes the dialog */
  cancelSplit(): void {
    this.showSplitDialog.set(false);
    this.splitMode.set('choice');
    this.splitSourceOrderId.set(null);
    this.splitSourceTableName.set('');
    this.splitSourceItems.set([]);
    this.splitOrderTotal.set(0);
    this.splitBusy.set(false);
    this.splitPartsCount.set(2);
    this.splitEqualPaymentStep.set(0);
    this.splitEqualMethod.set(null);
    this.splitGroupCounter = 0;
    this.splitGroups.set([]);
  }

  // ---- Equal split ----

  /**
   * Starts the sequential payment flow for equal split.
   * Sets step to 1 so the payment buttons appear.
   */
  startEqualPayments(): void {
    this.splitEqualPaymentStep.set(1);
  }

  /**
   * Registers one payment for the current equal-split step.
   * Advances to next step or completes when all done.
   * @param method Payment method to use
   */
  async registerEqualPayment(method: PaymentMethod): Promise<void> {
    const orderId = this.splitSourceOrderId();
    if (!orderId) return;

    this.splitBusy.set(true);

    try {
      await firstValueFrom(
        this.tableService.addPayment(orderId, method, this.splitEqualAmount()),
      );

      const currentStep = this.splitEqualPaymentStep();
      if (currentStep >= this.splitPartsCount()) {
        // All payments done — sync updated order to Dexie
        try {
          const dto = await firstValueFrom(
            this.tableService.getOrderById(orderId),
          );
          if (dto) {
            const mapped = this.syncService.mapPullDto(dto);
            await this.db.orders.put(mapped);
          }
        } catch {
          // Best-effort — next pull sync will catch up
        }

        this.cancelSplit();
        await this.loadTableStatuses();
        this.messageService.add({
          severity: 'success',
          summary: `Cuenta dividida y pagada en ${currentStep} partes`,
          life: 3000,
        });
      } else {
        this.splitEqualPaymentStep.set(currentStep + 1);
      }
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error al registrar pago',
        life: 4000,
      });
    } finally {
      this.splitBusy.set(false);
    }
  }

  // ---- Items split ----

  /** Adds a new empty split group with auto-incrementing label */
  addSplitGroup(): void {
    this.splitGroupCounter++;
    this.splitGroups.update(groups => [
      ...groups,
      { id: this.splitGroupCounter, label: `Persona ${this.splitGroupCounter}`, itemIds: [] },
    ]);
  }

  /** Removes a split group and frees its items */
  removeSplitGroup(groupId: number): void {
    this.splitGroups.update(groups => groups.filter(g => g.id !== groupId));
  }

  /** Updates the label of a split group */
  updateGroupLabel(groupId: number, label: string): void {
    this.splitGroups.update(groups =>
      groups.map(g => g.id === groupId ? { ...g, label } : g),
    );
  }

  /** Assigns an unassigned item to a group */
  assignItemToGroup(itemId: number, groupId: number): void {
    this.splitGroups.update(groups =>
      groups.map(g => g.id === groupId
        ? { ...g, itemIds: [...g.itemIds, itemId] }
        : g,
      ),
    );
  }

  /** Removes an item from its group (returns to unassigned) */
  removeItemFromGroup(itemId: number): void {
    this.splitGroups.update(groups =>
      groups.map(g => ({
        ...g,
        itemIds: g.itemIds.filter(id => id !== itemId),
      })),
    );
  }

  /** Returns the product name for an item ID */
  splitItemName(itemId: number): string {
    return this.splitSourceItems().find(i => i.id === itemId)?.productName ?? '—';
  }

  /**
   * Confirms the items split — calls splitOrderByItems API.
   * Creates separate orders per group.
   */
  async confirmItemsSplit(): Promise<void> {
    const orderId = this.splitSourceOrderId();
    if (!orderId) return;

    this.splitBusy.set(true);

    const splits: SplitGroup[] = this.splitGroups().map(g => ({
      itemIds: g.itemIds,
      label: g.label,
    }));

    try {
      const result = await firstValueFrom(
        this.tableService.splitOrderByItems(orderId, splits),
      );

      this.cancelSplit();
      await this.loadTableStatuses();

      const names = result.splitOrders.map(o => `${o.label} (${o.folioNumber})`).join(', ');
      this.messageService.add({
        severity: 'success',
        summary: `Orden dividida en ${result.splitOrders.length} partes`,
        detail: names,
        life: 5000,
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error al dividir la orden',
        life: 4000,
      });
    } finally {
      this.splitBusy.set(false);
    }
  }

  //#endregion

  //#region Reservation Methods

  /** Loads today's reservations for floor map integration */
  private loadTodayReservations(): void {
    this.reservationService.getByDay(new Date()).subscribe({
      next: (data) => this.todayReservations.set(data),
      error: () => this.todayReservations.set([]),
    });
  }

  /** Seats a confirmed reservation from the floor map */
  async seatReservation(): Promise<void> {
    const reservation = this.selectedReservation();
    if (!reservation) return;

    this.seatingBusy.set(true);
    try {
      await firstValueFrom(this.reservationService.seat(reservation.id));
      this.messageService.add({ severity: 'success', summary: 'Reservación sentada', life: 3000 });
      this.showReservedDialog.set(false);
      this.loadTodayReservations();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al sentar reservación', life: 3000 });
    } finally {
      this.seatingBusy.set(false);
    }
  }

  //#endregion

  //#region Display Helpers

  /** Returns CSS class modifier for a display status code */
  getStatusClass(status: string): string {
    const s = normalizeDisplayStatus(status);
    const map: Record<string, string> = {
      'free': 'free', 'in_kitchen': 'kitchen', 'ready': 'ready',
      'waiting_bill': 'waiting', 'paid': 'paid', 'reserved': 'reserved',
    };
    return map[s] ?? 'free';
  }

  /** Returns Spanish label for a display status code */
  getStatusLabel(status: string): string {
    return this.catalogService.getDisplayStatusName(normalizeDisplayStatus(status));
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

  /**
   * Returns zone icon config by ZoneType.
   * @param type Zone type enum value
   */
  getZoneIconConfig(type: ZoneType): { bg: string; icon: string } {
    switch (type) {
      case ZoneType.Salon:    return { bg: '#F0FDF4', icon: 'pi-th-large' };
      case ZoneType.BarSeats: return { bg: '#EFF6FF', icon: 'pi-circle' };
      default:                return { bg: '#FEF9C3', icon: 'pi-hashtag' };
    }
  }

  /**
   * Returns count of occupied tables in a zone.
   * @param zoneId Zone ID or null for unzoned tables
   */
  getZoneOccupiedCount(zoneId: number | null): number {
    return this.tableStatuses().filter(t => {
      const tZoneId = t.zoneId ?? null;
      return tZoneId === zoneId && t.displayStatus !== 'free';
    }).length;
  }

  /**
   * Returns total table count for a zone, or all tables if null.
   * @param zoneId Zone ID or null for total count
   */
  getZoneTableCount(zoneId: number | null): number {
    if (zoneId === null) return this.tableStatuses().length;
    return this.tableStatuses().filter(t => t.zoneId === zoneId).length;
  }

  /** Navigates back to POS */
  goBack(): void {
    this.router.navigate(['/pos']);
  }

  //#endregion

}
