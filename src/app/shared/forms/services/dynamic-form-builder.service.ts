/**
 * Schema-driven FormGroup factory for the shared dynamic-form library.
 *
 * Promoted from `product-form-builder.service.ts` POC
 * (AUDIT-058 Vector B / FDD-029 F1 sub-phase b).
 *
 * Design notes
 * ------------
 *   - Generic over `<TKey extends string>` so consumers retain literal
 *     key inference. The returned record is typed as
 *     `Record<TKey, FormControl<unknown>>` for direct destructuring.
 *
 *   - Skips fields with `kind: 'array'`. Consumers OWN their FormArrays
 *     (they require nested CRUD UX with add/remove rows that doesn't fit
 *     the atomic control pattern). The schema marks them so the renderer
 *     short-circuits to a `<ng-content>` slot the consumer projects into.
 *
 *   - Validators are resolved at build time via `resolveValidators()` —
 *     the schema stays serializable (refs, not closures).
 *
 *   - Uses NonNullableFormBuilder to match the POC pattern and produce
 *     strictly-typed controls without an explicit `nonNullable: true`
 *     option per field.
 */

import { Injectable, inject } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder } from '@angular/forms';

import {
  DynamicFormSchema,
  FieldDescriptor,
} from '../schemas/dynamic-form.schema';
import { resolveValidators } from '../validators/resolve-validators';

@Injectable({ providedIn: 'root' })
export class DynamicFormBuilderService {

  private readonly fb = inject(NonNullableFormBuilder);

  /**
   * Builds the atomic FormControls declared in the schema and returns
   * them as a key-indexed map. Consumers wrap the result in their own
   * FormGroup, merging in any FormArrays they own.
   *
   * Fields with `kind: 'array'` are intentionally skipped — see service
   * docblock for rationale.
   */
  buildControls<TKey extends string>(
    schema: DynamicFormSchema<TKey>,
  ): Record<TKey, FormControl<unknown>> {
    const controls = {} as Record<TKey, FormControl<unknown>>;

    for (const section of schema.sections) {
      for (const descriptor of section.fields) {
        if (this.isArrayField(descriptor)) continue;
        controls[descriptor.key] = this.fb.control(
          descriptor.defaultValue,
          resolveValidators(descriptor.validators),
        );
      }
    }

    return controls;
  }

  /**
   * Convenience wrapper — builds the atomic-control map AND wraps it
   * into a `FormGroup`. Use this when the consumer does not own any
   * FormArrays. When the consumer owns arrays, prefer `buildControls()`
   * and merge manually.
   */
  buildFormGroup<TKey extends string>(
    schema: DynamicFormSchema<TKey>,
  ): FormGroup {
    return this.fb.group(this.buildControls(schema));
  }

  private isArrayField(descriptor: FieldDescriptor): boolean {
    return descriptor.kind === 'array';
  }

}
