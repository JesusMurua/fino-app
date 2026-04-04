import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import { InventoryItem } from '../../../../../core/models';

/**
 * Presentational component that renders inventory items in a
 * PrimeNG virtual-scroll table with skeleton loading state.
 */
@Component({
  selector: 'app-inventory-items-table',
  standalone: true,
  imports: [ButtonModule, SkeletonModule, TableModule, TooltipModule],
  templateUrl: './inventory-items-table.component.html',
  styleUrl: './inventory-items-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryItemsTableComponent {

  //#region Inputs

  @Input({ required: true }) items: InventoryItem[] = [];
  @Input({ required: true }) isLoading = false;

  //#endregion

  //#region Outputs

  @Output() readonly edit = new EventEmitter<InventoryItem>();
  @Output() readonly addStock = new EventEmitter<InventoryItem>();
  @Output() readonly removeStock = new EventEmitter<InventoryItem>();
  @Output() readonly viewHistory = new EventEmitter<InventoryItem>();

  //#endregion

  //#region Template Helpers

  /** Fixed array used by the skeleton @for loop */
  readonly skeletonRows = Array.from({ length: 8 });

  //#endregion
}
