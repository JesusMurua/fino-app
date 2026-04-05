import { Component, inject, signal } from '@angular/core';
import { TableLazyLoadEvent } from 'primeng/table';

import { InventoryLedgerDto } from '../../../../../core/models';
import { InventoryService } from '../../../../../core/services/inventory.service';
import { InventoryLedgerTableComponent } from './inventory-ledger-table.component';

/** Default page size for the ledger table */
const DEFAULT_PAGE_SIZE = 25;

/**
 * Smart container for the global inventory ledger tab.
 * Handles lazy-load events from the table and calls the paginated API.
 */
@Component({
  selector: 'app-inventory-ledger-tab',
  standalone: true,
  imports: [InventoryLedgerTableComponent],
  template: `
    <div class="border-round-xl shadow-1 surface-card overflow-hidden">
      <app-inventory-ledger-table
        [rows]="rows()"
        [totalRecords]="totalRecords()"
        [isLoading]="isLoading()"
        [pageSize]="pageSize"
        (lazyLoad)="onLazyLoad($event)"
      />
    </div>
  `,
})
export class InventoryLedgerTabComponent {

  //#region Injections

  private readonly inventoryService = inject(InventoryService);

  //#endregion

  //#region State

  readonly rows = signal<InventoryLedgerDto[]>([]);
  readonly totalRecords = signal(0);
  readonly isLoading = signal(false);
  readonly pageSize = DEFAULT_PAGE_SIZE;

  //#endregion

  //#region Lazy Load

  /**
   * Called by p-table on initial render and on every page change.
   * Maps the PrimeNG event to the backend's 1-indexed page param.
   */
  onLazyLoad(event: TableLazyLoadEvent): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    const page = Math.floor(first / rows) + 1;

    this.isLoading.set(true);

    this.inventoryService.getLedger(page, rows).subscribe({
      next: (result) => {
        this.rows.set(result.data);
        this.totalRecords.set(result.rowsCount);
        this.isLoading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.totalRecords.set(0);
        this.isLoading.set(false);
      },
    });
  }

  //#endregion
}
