import { Component, computed, effect, inject, model, output, signal } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';

import { RestaurantTable } from '../../../../core/models';
import { TableStatus } from '../../../../core/enums';
import { AuthService } from '../../../../core/services/auth.service';
import { TableService } from '../../../../core/services/table.service';

/** Payload emitted when the user confirms a table selection */
export interface TableSelectedEvent {
  tableId: number;
  tableName: string;
}

/** Group of tables by zone for display */
interface ZoneGroup {
  zoneId: number | null;
  zoneName: string;
  tables: RestaurantTable[];
}

@Component({
  selector: 'app-table-selector-dialog',
  standalone: true,
  imports: [DialogModule, ButtonModule, ProgressSpinnerModule, TagModule],
  templateUrl: './table-selector-dialog.component.html',
  styleUrl: './table-selector-dialog.component.scss',
})
export class TableSelectorDialogComponent {

  //#region Properties
  private readonly tableService = inject(TableService);
  private readonly authService = inject(AuthService);

  /** Two-way binding for dialog visibility */
  readonly visible = model<boolean>(false);

  /** Emits when user confirms table selection */
  readonly tableSelected = output<TableSelectedEvent>();

  /** All available (active) tables from Dexie */
  readonly tables = signal<RestaurantTable[]>([]);

  /** Loading state while fetching tables */
  readonly loading = signal(true);

  /** User's current selection (before confirm) */
  readonly selectedTable = signal<RestaurantTable | null>(null);

  /** Guard against double-tap on confirm */
  readonly confirming = signal(false);

  /** Tables grouped by zoneId for visual organization */
  readonly zoneGroups = computed<ZoneGroup[]>(() => {
    const all = this.tables();
    const available = all.filter(t => t.tableStatusId === TableStatus.Available);
    const map = new Map<number | null, RestaurantTable[]>();

    for (const table of available) {
      const key = table.zoneId ?? null;
      const group = map.get(key);
      if (group) {
        group.push(table);
      } else {
        map.set(key, [table]);
      }
    }

    const groups: ZoneGroup[] = [];
    for (const [zoneId, tables] of map) {
      groups.push({
        zoneId,
        zoneName: zoneId != null ? `Zona ${zoneId}` : 'Sin zona',
        tables,
      });
    }
    return groups;
  });

  /** Total available tables count */
  readonly availableCount = computed(() =>
    this.tables().filter(t => t.tableStatusId === TableStatus.Available).length,
  );

  /** True when confirm button should be enabled */
  readonly canConfirm = computed(() =>
    this.selectedTable() !== null && !this.confirming(),
  );
  //#endregion

  //#region Constructor
  constructor() {
    // Load tables whenever dialog becomes visible
    effect(() => {
      if (this.visible()) {
        this.loadTables();
      }
    });
  }
  //#endregion

  //#region Methods

  /** Loads active tables from Dexie (offline-safe) */
  private async loadTables(): Promise<void> {
    this.loading.set(true);
    this.selectedTable.set(null);

    try {
      const branchId = this.authService.branchId;
      const tables = await this.tableService.getTables(branchId);
      this.tables.set(tables);
    } catch (err) {
      console.error('[TableSelectorDialog] Failed to load tables:', err);
      this.tables.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** Handles table card tap */
  onTableClick(table: RestaurantTable): void {
    if (table.tableStatusId !== TableStatus.Available) return;

    // Toggle selection
    if (this.selectedTable()?.id === table.id) {
      this.selectedTable.set(null);
    } else {
      this.selectedTable.set(table);
    }
  }

  /** Confirms the selection and emits event */
  onConfirm(): void {
    const table = this.selectedTable();
    if (!table || this.confirming()) return;

    this.confirming.set(true);
    this.tableSelected.emit({ tableId: table.id, tableName: table.name });
    this.visible.set(false);
    this.confirming.set(false);
  }

  /** Closes dialog without emitting */
  onCancel(): void {
    this.visible.set(false);
    this.selectedTable.set(null);
  }

  /** Returns true if the given table is currently selected */
  isSelected(table: RestaurantTable): boolean {
    return this.selectedTable()?.id === table.id;
  }

  //#endregion

}
