/**
 * Schema-driven FormGroup factory for the shared dynamic-form library.
 *
 * Promoted from `product-form-builder.service.ts` POC
 * (AUDIT-058 Vector B / FDD-029 F1 sub-phase b). Extended by FDD-031
 * §4.3 with async + cross-field validator integration.
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
 *   - Sync validators are resolved at build time via `resolveValidators()` —
 *     the schema stays serializable (refs, not closures).
 *
 *   - Uses NonNullableFormBuilder to match the POC pattern and produce
 *     strictly-typed controls without an explicit `nonNullable: true`
 *     option per field.
 *
 * API distinction (important — FDD-031 §4.3):
 *   - `buildControls()` returns the atomic-control map. Sync validators
 *     ARE applied (per descriptor). Async validators and cross-field
 *     (form-level) validators are NOT applied — consumers using this
 *     method must call `ctrl.setAsyncValidators(...)` per control and
 *     `group.setValidators(resolveCrossFieldValidators(...))` on the
 *     wrapping FormGroup themselves.
 *   - `buildFormGroup()` returns a fully-wired FormGroup with sync,
 *     async, AND cross-field validators applied. Preferred when the
 *     consumer does not own any FormArrays.
 *
 * The distinction exists because `buildControls` is the lower-level
 * primitive for consumers who need to merge atomic controls with their
 * own FormArrays; `buildFormGroup` is the full-orchestration path.
 */

import { Injectable, Injector, inject } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder } from '@angular/forms';

import {
  DynamicFormSchema,
  FieldDescriptor,
} from '../schemas/dynamic-form.schema';
import { resolveAsyncValidators } from '../validators/resolve-async-validators';
import { resolveCrossFieldValidators } from '../validators/resolve-cross-field-validators';
import { resolveValidators } from '../validators/resolve-validators';

@Injectable({ providedIn: 'root' })
export class DynamicFormBuilderService {

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly injector = inject(Injector);

  /**
   * Builds the atomic FormControls declared in the schema and returns
   * them as a key-indexed map. Sync validators applied per descriptor;
   * async validators and form-level cross-field validators are NOT
   * (see service docblock — API distinction).
   *
   * Fields with `kind: 'array'` are intentionally skipped.
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
   * Builds the atomic-control map, wires async validators per
   * descriptor, wraps into a FormGroup, then applies cross-field
   * (form-level) validators if the schema declares any.
   *
   * Use this method when the consumer does NOT own any FormArrays and
   * wants the library to fully wire validation. For consumers that own
   * FormArrays or otherwise need the lower-level primitive, prefer
   * `buildControls()` and apply async + cross-field validators
   * manually post-construction.
   */
  buildFormGroup<TKey extends string>(
    schema: DynamicFormSchema<TKey>,
  ): FormGroup {
    const controls = this.buildControls(schema);

    // Apply async validators per descriptor BEFORE wrapping into the
    // FormGroup — once a control is inside a FormGroup, setAsyncValidators
    // still works but reading the result requires re-running validation.
    for (const section of schema.sections) {
      for (const descriptor of section.fields) {
        if (!descriptor.asyncValidators?.length) continue;
        const ctrl = (controls as Record<string, FormControl<unknown>>)[descriptor.key];
        if (!ctrl) continue;
        ctrl.setAsyncValidators(
          resolveAsyncValidators(descriptor.asyncValidators, this.injector),
        );
      }
    }

    const group = this.fb.group(controls);

    // Apply form-level cross-field validators if any. setValidators
    // does NOT auto-run validation, so explicitly trigger evaluation
    // against the initial values — cross-field validators surface
    // immediately on construction (matches sync validator semantics).
    if (schema.formValidators?.length) {
      group.setValidators(
        resolveCrossFieldValidators(schema.formValidators),
      );
      group.updateValueAndValidity();
    }

    return group;
  }

  private isArrayField(descriptor: FieldDescriptor): boolean {
    return descriptor.kind === 'array';
  }

}
