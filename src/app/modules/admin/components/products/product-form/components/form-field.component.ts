import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { FieldDescriptor } from '../schemas/product-form.schema';

/**
 * Atomic field renderer.
 *
 * Switches on `FieldDescriptor.kind` to instantiate the right PrimeNG
 * widget for an atomic input (text / textarea / number / switch / etc.).
 * Picker-style kinds (`dropdown`, `category-picker`, `printer-picker`,
 * `tax-picker`, `sat-code`) render a placeholder for the POC — the
 * legacy product form continues to own those richer pickers because
 * they depend on signals from `ProductService`, `TaxService`, etc.
 * which would require dependency-injection plumbing not part of the
 * Vector B POC scope.
 *
 * Array kinds (`array-sizes`, `array-modifier-groups`) emit a marker
 * comment — the legacy product form keeps ownership of the FormArrays
 * and renders them with dedicated sub-form components.
 *
 * Usage:
 *   <app-form-field [descriptor]="fieldDescriptor" [parentForm]="form" />
 *
 * The component binds via `formControlName` keyed off
 * `descriptor.key`, so the parent FormGroup must have a matching control.
 */
@Component({
  selector: 'app-form-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputTextareaModule,
    InputNumberModule,
    InputSwitchModule,
  ],
  template: `
    <ng-container [formGroup]="parentForm">
      <div class="form-field" [class.form-field--row]="isRowLayout()">
        <label class="form-field__label" [for]="inputId">{{ descriptor.label }}</label>

        @switch (descriptor.kind) {
          @case ('text') {
            <input
              [formControlName]="descriptor.key"
              [id]="inputId"
              [placeholder]="descriptor.placeholder ?? ''"
              type="text"
              pInputText
              class="w-full"
            />
          }
          @case ('textarea') {
            <textarea
              [formControlName]="descriptor.key"
              [id]="inputId"
              [placeholder]="descriptor.placeholder ?? ''"
              pInputTextarea
              class="w-full"
              rows="3"
            ></textarea>
          }
          @case ('currency') {
            <p-inputNumber
              [formControlName]="descriptor.key"
              [inputId]="inputId"
              [min]="descriptor.min ?? 0"
              [max]="descriptor.max"
              [showButtons]="false"
              mode="currency"
              currency="MXN"
              locale="es-MX"
              styleClass="w-full"
            />
          }
          @case ('number') {
            <p-inputNumber
              [formControlName]="descriptor.key"
              [inputId]="inputId"
              [min]="descriptor.min"
              [max]="descriptor.max"
              [suffix]="descriptor.suffix ?? ''"
              styleClass="w-full"
            />
          }
          @case ('integer') {
            <p-inputNumber
              [formControlName]="descriptor.key"
              [inputId]="inputId"
              [min]="descriptor.min ?? 0"
              [max]="descriptor.max"
              [suffix]="descriptor.suffix ?? ''"
              [useGrouping]="false"
              [maxFractionDigits]="0"
              styleClass="w-full"
            />
          }
          @case ('switch') {
            <p-inputSwitch [formControlName]="descriptor.key" [inputId]="inputId" />
          }
          @default {
            <!-- Picker / array kinds fall back to a placeholder — the
                 legacy product-form continues to own these widgets.
                 Once a second form needs them, the picker components
                 can be promoted into shared renderers. -->
            <em class="form-field__placeholder">
              [{{ descriptor.kind }} — rendered by legacy product-form]
            </em>
          }
        }

        @if (descriptor.hint) {
          <small class="form-field__hint">{{ descriptor.hint }}</small>
        }
      </div>
    </ng-container>
  `,
})
export class FormFieldComponent {

  /** Field metadata — declares widget kind, label, validators, etc. */
  @Input({ required: true }) descriptor!: FieldDescriptor;

  /** Parent FormGroup whose key matches `descriptor.key`. */
  @Input({ required: true }) parentForm!: FormGroup;

  /** Stable DOM id for label/input association. */
  get inputId(): string {
    return `ff-${this.descriptor.key}`;
  }

  /** Switch-kind fields render label and control on a single row. */
  isRowLayout(): boolean {
    return this.descriptor.kind === 'switch';
  }

}
