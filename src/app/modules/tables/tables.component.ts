import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { RestaurantTable } from '../../core/models';
import { TableService } from '../../core/services/table.service';
import { AuthService } from '../../core/services/auth.service';

const BRANCH_ID = 1;
const POLL_INTERVAL = 15_000;

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [DialogModule, ProgressSpinnerModule],
  templateUrl: './tables.component.html',
  styleUrl: './tables.component.scss',
})
export class TablesComponent implements OnInit, OnDestroy {

  private readonly tableService = inject(TableService);
  private readonly router = inject(Router);
  readonly currentUser = inject(AuthService).currentUser;

  readonly tables = signal<RestaurantTable[]>([]);
  readonly loading = signal(false);
  readonly showTableDialog = signal(false);
  readonly selectedTable = signal<RestaurantTable | null>(null);

  readonly availableTables = computed(() =>
    this.tables().filter(t => t.status === 'available')
  );
  readonly occupiedTables = computed(() =>
    this.tables().filter(t => t.status === 'occupied')
  );

  private pollTimer: ReturnType<typeof setInterval> | null = null;

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

  /** Loads tables from API/Dexie */
  async loadTables(): Promise<void> {
    this.loading.set(true);
    await this.tableService.loadTables(BRANCH_ID);
    const tables = await this.tableService.getTables(BRANCH_ID);
    this.tables.set(tables);
    this.loading.set(false);
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
      this.showTableDialog.set(true);
    }
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

  /** Releases an occupied table */
  async releaseTable(): Promise<void> {
    const table = this.selectedTable();
    if (!table) return;
    await this.tableService.updateTableStatus(table.id, 'available');
    this.showTableDialog.set(false);
    await this.loadTables();
  }

  /** Navigates back to POS */
  goBack(): void {
    this.router.navigate(['/pos']);
  }

  //#endregion
}
