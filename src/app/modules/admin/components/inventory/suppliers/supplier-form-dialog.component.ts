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
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { CreateSupplierRequest, Supplier, UpdateSupplierRequest } from '../../../../../core/models';

/** Payload emitted on save — discriminated by presence of `isActive` */
export type SupplierFormPayload = CreateSupplierRequest | UpdateSupplierRequest;

/** Internal form shape */
interface SupplierFormState {
  name: string;
  contactName: string;
  phone: string;
  notes: string;
  isActive: boolean;
}

/**
 * Presentational dialog for creating or editing a supplier.
 * Emits the validated form payload — the parent handles service calls and Toasts.
 */
@Component({
  selector: 'app-supplier-form-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    InputSwitchModule,
    InputTextModule,
    InputTextareaModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="supplier ? 'Editar proveedor' : 'Nuevo proveedor'"
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
          <label class="text-500 text-sm font-medium" for="sf-name">Nombre</label>
          <input
            [(ngModel)]="form.name"
            id="sf-name"
            type="text"
            pInputText
            placeholder="Ej. Distribuidora García"
          />
        </div>

        <!-- Contact -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="sf-contact">Contacto</label>
          <input
            [(ngModel)]="form.contactName"
            id="sf-contact"
            type="text"
            pInputText
            placeholder="Nombre del contacto"
          />
        </div>

        <!-- Phone -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="sf-phone">Teléfono</label>
          <input
            [(ngModel)]="form.phone"
            id="sf-phone"
            type="tel"
            pInputText
            placeholder="Ej. 55 1234 5678"
          />
        </div>

        <!-- Notes -->
        <div class="flex flex-column gap-2">
          <label class="text-500 text-sm font-medium" for="sf-notes">Notas</label>
          <textarea
            [(ngModel)]="form.notes"
            id="sf-notes"
            pInputTextarea
            placeholder="Notas adicionales..."
            rows="3"
          ></textarea>
        </div>

        <!-- Active toggle (edit only) -->
        @if (supplier) {
          <div class="flex align-items-center gap-3">
            <label class="text-500 text-sm font-medium" for="sf-active">Activo</label>
            <p-inputSwitch [(ngModel)]="form.isActive" inputId="sf-active" />
          </div>
        }

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
export class SupplierFormDialogComponent implements OnChanges {

  //#region Inputs

  /** Supplier to edit. Null = create mode. */
  @Input() supplier: Supplier | null = null;
  @Input() visible = false;

  //#endregion

  //#region Outputs

  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly save = new EventEmitter<SupplierFormPayload>();

  //#endregion

  //#region State

  form: SupplierFormState = this.emptyForm();

  //#endregion

  //#region Lifecycle

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.form = this.supplier
        ? {
            name: this.supplier.name,
            contactName: this.supplier.contactName ?? '',
            phone: this.supplier.phone ?? '',
            notes: this.supplier.notes ?? '',
            isActive: this.supplier.isActive,
          }
        : this.emptyForm();
    }
  }

  //#endregion

  //#region Actions

  onSave(): void {
    if (!this.form.name.trim()) return;

    const base: CreateSupplierRequest = {
      name: this.form.name.trim(),
      contactName: this.form.contactName.trim() || undefined,
      phone: this.form.phone.trim() || undefined,
      notes: this.form.notes.trim() || undefined,
    };

    if (this.supplier) {
      this.save.emit({ ...base, isActive: this.form.isActive } as UpdateSupplierRequest);
    } else {
      this.save.emit(base);
    }
  }

  //#endregion

  //#region Helpers

  private emptyForm(): SupplierFormState {
    return { name: '', contactName: '', phone: '', notes: '', isActive: true };
  }

  //#endregion
}
