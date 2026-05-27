/**
 * Atomic field renderer. Switches over `descriptor.kind` and emits the
 * corresponding PrimeNG widget, paired with a `<label htmlFor>` and a
 * `<app-print-control-error>` placeholder.
 *
 * Promoted from product-form POC (AUDIT-058 Vector B / FDD-029 §4.4).
 * Generic over `<TKey extends string>` so consumers retain literal-key
 * inference on `descriptor.key`.
 *
 * Slot pattern for `kind: 'array'` — the consumer projects its own
 * FormArray sub-form via `<ng-content>` (used when consuming this
 * component directly; the orchestrator path leaves array slots empty
 * pending FDD-030 extension API).
 */

import {
  ChangeDetectionStrategy,
  Component,
  Input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { FieldDescriptor } from '../schemas/dynamic-form.schema';
import { PrintControlErrorComponent } from './print-control-error.component';

@Component({
  selector: 'app-form-field',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputTextareaModule,
    InputSwitchModule,
    DropdownModule,
    InputNumberModule,
    PrintControlErrorComponent,
  ],
  templateUrl: './form-field.component.html',
  styleUrl: './form-field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormFieldComponent<TKey extends string = string> {

  //#region Inputs

  @Input({ required: true }) descriptor!: FieldDescriptor<TKey>;
  @Input({ required: true }) control!: AbstractControl;

  /**
   * Unique-per-form prefix injected by the parent orchestrator. Combined
   * with `descriptor.key` to produce input ids that don't collide when
   * multiple dynamic forms render on the same page.
   */
  @Input({ required: true }) formId!: string;

  //#endregion

  //#region Computed view state

  /** DOM id paired with `<label htmlFor>` on the input element. */
  get inputId(): string {
    return `${this.formId}-${this.descriptor.key}`;
  }

  /** DOM id of the associated print-control-error region. */
  get errorId(): string {
    return `${this.inputId}-error`;
  }

  /** Reactive forms requires a `FormControl` (not `AbstractControl`) on [formControl]. */
  get formControl(): FormControl {
    return this.control as FormControl;
  }

  /** ARIA: true when control is invalid and the user has interacted. */
  get isInvalid(): boolean {
    return this.control.invalid && (this.control.dirty || this.control.touched);
  }

  /** ARIA: true when the descriptor declares the `required` validator. */
  get isRequired(): boolean {
    return (this.descriptor.validators ?? []).some(
      (v) => v === 'required',
    );
  }

  //#endregion

}
