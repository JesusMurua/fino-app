import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';

import { StockReceipt } from '../../../../../core/models';

/**
 * Read-only dialog displaying the full detail of a stock receipt,
 * including header info and line items table.
 */
@Component({
  selector: 'app-stock-receipt-detail-dialog',
  standalone: true,
  imports: [DatePipe, ButtonModule, DialogModule, TableModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      header="Detalle de recepción"
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [style]="{ width: '700px' }"
      [breakpoints]="{ '768px': '95vw' }"
    >
      @if (receipt) {
        <!-- Header info -->
        <div class="flex flex-column gap-3 mb-4 pb-3 border-bottom-1 surface-border">
          <div class="flex align-items-center gap-2">
            <span class="text-500 text-sm font-medium" style="min-width: 100px">Proveedor:</span>
            <span class="text-900">{{ receipt.supplierName || 'Sin proveedor' }}</span>
          </div>
          <div class="flex align-items-center gap-2">
            <span class="text-500 text-sm font-medium" style="min-width: 100px">Fecha:</span>
            <span class="text-900">{{ receipt.receivedAt | date:'dd MMM y, h:mm a' }}</span>
          </div>
          <div class="flex align-items-center gap-2">
            <span class="text-500 text-sm font-medium" style="min-width: 100px">Recibido por:</span>
            <span class="text-900">{{ receipt.receivedByName || '—' }}</span>
          </div>
          @if (receipt.notes) {
            <div class="flex align-items-center gap-2">
              <span class="text-500 text-sm font-medium" style="min-width: 100px">Notas:</span>
              <span class="text-900">{{ receipt.notes }}</span>
            </div>
          }
        </div>

        <!-- Line items table -->
        <p-table
          [value]="receipt.items"
          [rowHover]="true"
          styleClass="p-datatable-sm"
        >
          <ng-template pTemplate="header">
            <tr>
              <th style="min-width: 14rem">Producto / Insumo</th>
              <th style="min-width: 6rem">Cantidad</th>
              <th style="min-width: 8rem">Costo unit.</th>
              <th style="min-width: 8rem">Total</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td class="text-900 font-medium">{{ item.inventoryItemName || item.productName || '—' }}</td>
              <td class="text-500">{{ item.quantity }}</td>
              <td class="text-500">\${{ (item.costCents / 100).toFixed(2) }}</td>
              <td class="text-primary font-semibold">\${{ (item.totalCents / 100).toFixed(2) }}</td>
            </tr>
          </ng-template>
        </p-table>

        <!-- Grand total -->
        <div class="flex justify-content-end align-items-center gap-3 mt-4 pt-3 border-top-1 surface-border">
          <span class="text-500 font-medium">Total:</span>
          <span class="text-900 text-xl font-bold">\${{ (receipt.totalCents / 100).toFixed(2) }}</span>
        </div>
      }

      <ng-template pTemplate="footer">
        <div class="flex justify-content-end">
          <p-button
            label="Cerrar"
            severity="secondary"
            [text]="true"
            (onClick)="visibleChange.emit(false)"
          />
        </div>
      </ng-template>
    </p-dialog>
  `,
})
export class StockReceiptDetailDialogComponent {

  //#region Inputs

  @Input() receipt: StockReceipt | null = null;
  @Input() visible = false;

  //#endregion

  //#region Outputs

  @Output() readonly visibleChange = new EventEmitter<boolean>();

  //#endregion
}
