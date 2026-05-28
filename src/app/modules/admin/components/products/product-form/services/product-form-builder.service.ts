// LEGACY SHIM — survives until the product-form template migrates
// to <app-dynamic-form>. No target FDD yet — see FDD-031 §3.3 for context.
// This service keeps its existing iteration over `allFieldDescriptors()`
// (flat list from the POC registry, shape incompatible with the shared
// service's section-based API). It transparently delegates the validator
// resolution layer to `product-form-validators.ts`, which now rebinds to
// shared validator implementations per FDD-029 §12 (d).

import { Injectable, inject } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder } from '@angular/forms';

import { allFieldDescriptors } from '../schemas/product-form.registry';
import { FieldDescriptor, ProductFormSchema } from '../schemas/product-form.schema';
import { resolveValidators } from '../schemas/product-form-validators';

/**
 * Schema-driven FormGroup factory for `product-form`.
 *
 * AUDIT-058 Vector B POC — the service is intentionally scoped to the
 * product form (per the user's "Rule of 3" decision). When a second
 * form requires schema-driven construction the abstraction graduates
 * into a generic builder under `src/app/shared/`.
 *
 * Design notes
 * ------------
 *   - The builder produces a SUPERSET FormGroup containing every field
 *     declared across all verticals. Sections/fields that do not apply
 *     to the active vertical are hidden at render time via `showSection`
 *     / `showWhen`. Keeping every control in the FormGroup avoids
 *     invalidation when the user switches between verticals at runtime
 *     (e.g. dev tooling) and keeps the typed `ProductFormGroup` literal
 *     in the legacy component compatible without casts.
 *
 *   - Default values come from `FieldDescriptor.defaultValue`. The
 *     legacy component still owns edit-mode hydration: after build, it
 *     calls `formGroup.patchValue(productSnapshot)` to load existing
 *     product data.
 *
 *   - FormArray fields (`sizes`, `modifierGroups`) are NOT instantiated
 *     here. The legacy component keeps ownership of those FormArrays
 *     because they require dedicated CRUD UX (add/remove rows with
 *     nested sub-forms). The schema marks them with dedicated
 *     `FieldKind`s so the renderer can short-circuit to the existing
 *     sub-form components.
 */
@Injectable({ providedIn: 'root' })
export class ProductFormBuilderService {

  private readonly fb = inject(NonNullableFormBuilder);

  /**
   * Builds the per-field FormControls declared in the schema registry
   * and returns them as a plain key→control map. The legacy product
   * form component is responsible for wrapping the result in its own
   * `FormGroup` plus the FormArrays it owns.
   *
   * Skipping `array-*` field kinds intentional — those are managed by
   * the consumer with `FormArray<SizeFormGroup>` / `ModifierGroupForm`
   * tree shapes that don't fit a generic atomic control builder.
   */
  buildControls(): Record<string, FormControl<unknown>> {
    const controls: Record<string, FormControl<unknown>> = {};
    for (const descriptor of allFieldDescriptors()) {
      if (this.isArrayField(descriptor)) continue;
      controls[descriptor.key] = this.fb.control(
        descriptor.defaultValue,
        resolveValidators(descriptor.validators),
      );
    }
    return controls;
  }

  /**
   * Convenience wrapper — builds the atomic-control map AND wraps it
   * into a `FormGroup`. Returned group is untyped (`FormGroup<any>`);
   * callers that need a typed shape cast via the legacy
   * `ProductFormGroup` literal.
   *
   * Reserved for future migrations where the consumer does not own
   * any FormArrays. The current product form consumer uses
   * `buildControls()` directly to merge with its own arrays.
   */
  buildFormGroup(): FormGroup {
    return this.fb.group(this.buildControls());
  }

  /**
   * Resolves the section-level visibility predicate for a single
   * `SectionDescriptor`. Centralised here so consumers don't reimplement
   * the null-check / default-true pattern at every call site.
   *
   * Note: section visibility predicates are passed from the consumer
   * at render time (they typically close over `TenantContextService`
   * signals), not stored in the schema itself. This method exists for
   * symmetry with `isFieldVisible` below.
   */
  isSectionVisible(predicate: (() => boolean) | undefined): boolean {
    return predicate === undefined ? true : predicate();
  }

  /**
   * Resolves a single field's `showWhen` predicate against the current
   * FormGroup value. Returns `true` when the field should render.
   */
  isFieldVisible(
    descriptor: FieldDescriptor,
    currentValue: Record<string, unknown>,
  ): boolean {
    if (!descriptor.showWhen) return true;
    return descriptor.showWhen(currentValue);
  }

  /** Iterates a schema and returns sections currently flagged as visible. */
  visibleSections(
    schema: ProductFormSchema,
    sectionPredicates: Record<string, (() => boolean) | undefined>,
  ): ProductFormSchema['sections'] {
    return schema.sections.filter(
      section => this.isSectionVisible(sectionPredicates[section.id]),
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private isArrayField(descriptor: FieldDescriptor): boolean {
    return descriptor.kind === 'array-sizes'
        || descriptor.kind === 'array-modifier-groups';
  }

}
