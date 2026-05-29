/**
 * Contract for custom widget components registered via
 * `provideFormWidget`. Consumed by `FormFieldComponent` via
 * `*ngComponentOutlet` when a field descriptor declares a custom
 * `kind` that the built-in switch does not handle.
 *
 * Custom widgets receive their inputs at instantiation. The
 * `*ngComponentOutlet` directive does NOT re-apply inputs when the
 * descriptor changes — only on first instantiation. Custom widgets
 * are responsible for any internal signal / reactive handling:
 * subscribe to `control.valueChanges`, inject signals from DI, etc.
 *
 * Example consumer:
 *
 *   @Component({ selector: 'category-picker', standalone: true, ... })
 *   export class CategoryPickerComponent implements FormWidget {
 *     @Input({ required: true }) descriptor!: FieldDescriptor;
 *     @Input({ required: true }) control!: AbstractControl;
 *     @Input({ required: true }) formId!: string;
 *     // internal reactive logic...
 *   }
 *
 *   // In the module's providers:
 *   provideFormWidget('category-picker', CategoryPickerComponent)
 */

import { AbstractControl } from '@angular/forms';

import { FieldDescriptor } from '../schemas/dynamic-form.schema';

export interface FormWidget {
  /** Descriptor declaring this field (drives label, hint, etc.). */
  descriptor: FieldDescriptor;

  /** Reactive form control bound to this widget. */
  control: AbstractControl;

  /** Form id namespace — used for input `id` pairing with labels. */
  formId: string;
}
