import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';

import { InventoryLedgerDto, LedgerTransactionType } from '../../../../../core/models';

/** Maps the backend integer enum to a Spanish UI label */
const TRANSACTION_TYPE_LABELS: Record<LedgerTransactionType, string> = {
  0: 'Entrada',
  1: 'Salida',
  2: 'Ajuste',
};

/**
 * Presentational component for the global inventory ledger.
 * Renders a lazy-paginated, virtual-scroll table of ledger rows.
 */
@Component({
  selector: 'app-inventory-ledger-table',
  standalone: true,
  imports: [DatePipe, SkeletonModule, TableModule],
  templateUrl: './inventory-ledger-table.component.html',
  styleUrl: './inventory-ledger-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryLedgerTableComponent {

  //#region Inputs

  @Input({ required: true }) rows: InventoryLedgerDto[] = [];
  @Input({ required: true }) totalRecords = 0;
  @Input({ required: true }) isLoading = false;
  @Input() pageSize = 25;

  //#endregion

  //#region Outputs

  @Output() readonly lazyLoad = new EventEmitter<TableLazyLoadEvent>();

  //#endregion

  //#region Template Helpers

  /** Fixed array for skeleton @for loop */
  readonly skeletonRows = Array.from({ length: 8 });

  /** Resolves backend integer enum to Spanish label */
  transactionTypeLabel(type: LedgerTransactionType): string {
    return TRANSACTION_TYPE_LABELS[type] ?? 'Desconocido';
  }

  //#endregion
}
