import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import { Supplier } from '../../../../../core/models';

/**
 * Presentational component that renders suppliers in a
 * PrimeNG virtual-scroll table with skeleton loading state.
 */
@Component({
  selector: 'app-suppliers-table',
  standalone: true,
  imports: [ButtonModule, SkeletonModule, TableModule, TooltipModule],
  templateUrl: './suppliers-table.component.html',
  styleUrl: './suppliers-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuppliersTableComponent {

  //#region Inputs

  @Input({ required: true }) suppliers: Supplier[] = [];
  @Input({ required: true }) isLoading = false;

  //#endregion

  //#region Outputs

  @Output() readonly edit = new EventEmitter<Supplier>();
  @Output() readonly toggleActive = new EventEmitter<Supplier>();

  //#endregion

  //#region Template Helpers

  /** Fixed array used by the skeleton @for loop */
  readonly skeletonRows = Array.from({ length: 5 });

  //#endregion
}
