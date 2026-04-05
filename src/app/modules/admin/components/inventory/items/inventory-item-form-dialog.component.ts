import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';

import { InventoryItem } from '../../../../../core/models';

/** Payload emitted on save */
export interface ItemFormPayload {
  name: string;
  unit: InventoryItem['unit'];
  currentStock: number;
  lowStockThreshold: number;
  costCents: number;
}

/** Internal form shape */
interface ItemFormState {
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPesos: number;
}

/** Unit dropdown options */
const UNIT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Pieza', value: 'pza' },
  { label: 'Kilogramo', value: 'kg' },
  { label: 'Litro', value: 'lt' },
  { label: 'Caja', value: 'caja' },
  { label: 'Gramo', value: 'g' },
  { label: 'Mililitro', value: 'ml' },
];

/**
 * Presentational dialog for creating or editing an inventory item.
 * Emits the validated form payload — the parent handles service calls and Toasts.
 */
@Component({
  selector: 'app-inventory-item-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="item ? 'Editar artículo' : 'Nuevo artículo'"
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [style]="{ width: '460px' }"
      [breakpoints]="{ '768px': '95vw' }"
    >
      <div class="flex flex-column gap-4 pt-2">

        <!-- Name -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="if-name">Nombre</label>
          <input
            [(ngModel)]="form.name"
            id="if-name"
            type="text"
            pInputText
            placeholder="Ej. Tortillas de maíz"
          />
        </div>

        <!-- Unit -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="if-unit">Unidad</label>
          <p-dropdown
            [(ngModel)]="form.unit"
            inputId="if-unit"
            [options]="unitOptions"
            optionLabel="label"
            optionValue="value"
            [appendTo]="'body'"
          />
        </div>

        <!-- Initial stock (create only) -->
        @if (!item) {
          <div class="flex flex-column gap-2">
            <label class="text-500 text-sm font-medium" for="if-stock">Stock inicial</label>
            <p-inputNumber
              [(ngModel)]="form.currentStock"
              inputId="if-stock"
              [min]="0"
            />
          </div>
        }

        <!-- Low stock threshold -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="if-threshold">Alerta mínima</label>
          <p-inputNumber
            [(ngModel)]="form.lowStockThreshold"
            inputId="if-threshold"
            [min]="0"
          />
        </div>

        <!-- Unit cost -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="if-cost">Costo unitario (MXN)</label>
          <p-inputNumber
            [(ngModel)]="form.costPesos"
            inputId="if-cost"
            [min]="0"
            mode="currency"
            currency="MXN"
            locale="es-MX"
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
          <p-button
            label="Guardar"
            icon="pi pi-check"
            [disabled]="!form.name.trim()"
            (onClick)="onSave()"
          />
        </div>
      </ng-template>
    </p-dialog>
  `,
})
export class InventoryItemFormDialogComponent implements OnChanges {

  //#region Inputs

  /** Item to edit. Null = create mode. */
  @Input() item: InventoryItem | null = null;
  @Input() visible = false;

  //#endregion

  //#region Outputs

  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly save = new EventEmitter<ItemFormPayload>();

  //#endregion

  //#region State

  readonly unitOptions = UNIT_OPTIONS;

  form: ItemFormState = this.emptyForm();

  //#endregion

  //#region Lifecycle

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.form = this.item
        ? {
            name: this.item.name,
            unit: this.item.unit,
            currentStock: this.item.currentStock,
            lowStockThreshold: this.item.lowStockThreshold,
            costPesos: this.item.costCents / 100,
          }
        : this.emptyForm();
    }
  }

  //#endregion

  //#region Actions

  onSave(): void {
    if (!this.form.name.trim()) return;

    this.save.emit({
      name: this.form.name.trim(),
      unit: this.form.unit as InventoryItem['unit'],
      currentStock: this.form.currentStock,
      lowStockThreshold: this.form.lowStockThreshold,
      costCents: Math.round(this.form.costPesos * 100),
    });
  }

  //#endregion

  //#region Helpers

  private emptyForm(): ItemFormState {
    return { name: '', unit: 'pza', currentStock: 0, lowStockThreshold: 0, costPesos: 0 };
  }

  //#endregion
}
