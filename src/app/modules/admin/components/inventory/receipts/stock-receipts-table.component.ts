import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import { StockReceipt } from '../../../../../core/models';

/**
 * Presentational component that renders stock receipts in a
 * PrimeNG virtual-scroll table with skeleton loading state.
 */
@Component({
  selector: 'app-stock-receipts-table',
  standalone: true,
  imports: [DatePipe, ButtonModule, SkeletonModule, TableModule, TooltipModule],
  templateUrl: './stock-receipts-table.component.html',
  styleUrl: './stock-receipts-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockReceiptsTableComponent {

  //#region Inputs

  @Input({ required: true }) receipts: StockReceipt[] = [];
  @Input({ required: true }) isLoading = false;

  //#endregion

  //#region Outputs

  @Output() readonly viewDetail = new EventEmitter<StockReceipt>();

  //#endregion

  //#region Template Helpers

  /** Fixed array for skeleton @for loop */
  readonly skeletonRows = Array.from({ length: 5 });

  //#endregion
}
