import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';

import { InventoryItem } from '../../../../../core/models';
import { InventoryMovementType } from '../../../../../core/enums';

/** Payload emitted on save */
export interface MovementFormPayload {
  quantity: number;
  reason: string;
}

/** Internal form shape */
interface MovementFormState {
  quantity: number;
  reason: string;
}

/**
 * Presentational dialog for recording a stock entry or exit.
 * Header, button label, and button color change based on the movement type.
 */
@Component({
  selector: 'app-inventory-movement-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="movementType === InventoryMovementType.In ? 'Entrada de stock' : 'Salida de stock'"
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [style]="{ width: '400px' }"
      [breakpoints]="{ '768px': '95vw' }"
    >
      <!-- Item context -->
      @if (item) {
        <div class="flex align-items-center gap-2 mb-4 pb-3 border-bottom-1 surface-border">
          <i class="pi pi-box text-500"></i>
          <span class="text-900 font-medium">{{ item.name }}</span>
          <span class="text-500 text-sm">({{ item.currentStock }} {{ item.unit }} actual)</span>
        </div>
      }

      <div class="flex flex-column gap-4">

        <!-- Quantity -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="mf-qty">Cantidad</label>
          <p-inputNumber
            [(ngModel)]="form.quantity"
            inputId="mf-qty"
            [min]="1"
            [showButtons]="true"
            buttonLayout="horizontal"
            incrementButtonIcon="pi pi-plus"
            decrementButtonIcon="pi pi-minus"
          />
        </div>

        <!-- Reason -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="mf-reason">Motivo (opcional)</label>
          <input
            [(ngModel)]="form.reason"
            id="mf-reason"
            type="text"
            pInputText
            [placeholder]="movementType === InventoryMovementType.In ? 'Ej. Compra a proveedor' : 'Ej. Merma, caducidad'"
          />
        </div>

      </div>

      <ng-template pTemplate="footer">
        <div class="flex justify-content-end gap-2">
          <p-button
            label="Cancelar"
            severity="secondary"
            [text]="true"
            (onClick)="visibleChange.emit(false)"
          />
          @if (movementType === InventoryMovementType.In) {
            <p-button
              label="Registrar entrada"
              icon="pi pi-plus"
              [disabled]="form.quantity <= 0"
              (onClick)="onSave()"
            />
          } @else {
            <p-button
              label="Registrar salida"
              icon="pi pi-minus"
              severity="danger"
              [disabled]="form.quantity <= 0"
              (onClick)="onSave()"
            />
          }
        </div>
      </ng-template>
    </p-dialog>
  `,
})
export class InventoryMovementDialogComponent implements OnChanges {

  //#region Inputs

  /** Item receiving the movement — shown as context in the dialog header area */
  @Input() item: InventoryItem | null = null;
  @Input() movementType: InventoryMovementType = InventoryMovementType.In;
  @Input() visible = false;

  //#endregion

  //#region Outputs

  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly save = new EventEmitter<MovementFormPayload>();

  //#endregion

  /** Expose enum for template bindings */
  readonly InventoryMovementType = InventoryMovementType;

  //#region State

  form: MovementFormState = { quantity: 1, reason: '' };

  //#endregion

  //#region Lifecycle

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.form = { quantity: 1, reason: '' };
    }
  }

  //#endregion

  //#region Actions

  onSave(): void {
    if (this.form.quantity <= 0) return;
    this.save.emit({
      quantity: this.form.quantity,
      reason: this.form.reason.trim(),
    });
  }

  //#endregion
}
