/**
 * Atomic field renderer. Switches over `descriptor.kind` and emits the
 * corresponding PrimeNG widget, paired with a `<label htmlFor>` and a
 * `<app-print-control-error>` placeholder.
 *
 * Promoted from product-form POC (AUDIT-058 Vector B / FDD-029 §4.4).
 * Generic over `<TKey extends string>` so consumers retain literal-key
 * inference on `descriptor.key`.
 *
 * Built-in kinds are handled by the `@switch` in the template. Custom
 * kinds (FDD-031 §4.1) registered via `provideFormWidget` are resolved
 * via `resolveCustomWidget` and rendered through `*ngComponentOutlet`
 * in the `@default` branch. When neither built-in nor registered, the
 * `array` kind / unknown kind falls through to `<ng-content>` so the
 * consumer can project a sub-form directly.
 *
 * Reactive options (FDD-031 §4.2): `descriptor.options` may be either
 * a static array or a `Signal<readonly Option[]>`. The `resolvedOptions`
 * getter unifies both at render time; OnPush + signal reactivity keeps
 * the view fresh without manual subscriptions.
 */

import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  Input,
  Type,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';

import { FieldDescriptor } from '../schemas/dynamic-form.schema';
import {
  FORM_WIDGETS,
  FormWidgetRegistration,
} from '../widgets/form-widget.tokens';
import { FormWidget } from '../widgets/form-widget.interface';
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

  //#region Constructor

  constructor(
    @Inject(FORM_WIDGETS) private readonly widgets: readonly FormWidgetRegistration[],
  ) {
    this.assertNoDuplicateWidgetNames();
  }

  /**
   * Defensive O(N) scan over the registered widgets for duplicate names.
   * Per FDD-031 OQ3 lockdown: throw at construction so conflicts surface
   * loudly rather than silently last-write-wins. The check runs per
   * FormFieldComponent instance — acceptable for F2 (N typically ≤ 10).
   * Future optimization could move this to APP_INITIALIZER in a single
   * pass, but per-instance cost is negligible.
   */
  private assertNoDuplicateWidgetNames(): void {
    const seen = new Set<string>();
    for (const reg of this.widgets) {
      if (seen.has(reg.name)) {
        throw new Error(`Duplicate FORM_WIDGETS registration: "${reg.name}"`);
      }
      seen.add(reg.name);
    }
  }

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

  /**
   * Resolves dropdown options from either a static array or a Signal.
   * Per FDD-031 §4.2: unified at render time via type guard
   * `typeof opts === 'function'`. With OnPush + signal reactivity the
   * template re-renders automatically when the source signal emits.
   */
  get resolvedOptions(): readonly { label: string; value: unknown }[] {
    const opts = this.descriptor.options;
    if (!opts) return [];
    return typeof opts === 'function' ? opts() : opts;
  }

  /**
   * Returns the registered Type<FormWidget> matching the given kind,
   * or undefined if no consumer registered that kind. Used by the
   * template's `@default` branch to dynamically render custom widgets
   * via `*ngComponentOutlet`.
   */
  resolveCustomWidget(kind: string): Type<FormWidget> | undefined {
    return this.widgets.find((w) => w.name === kind)?.component;
  }

  //#endregion

}
