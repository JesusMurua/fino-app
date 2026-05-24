/**
 * Type-safe declarative schema for the product creation/edit form.
 *
 * Architecture (AUDIT-058 Vector B POC):
 *   Layer 1 — this file: pure type definitions.
 *   Layer 2 — `product-form.registry.ts`: per-vertical schema records.
 *   Layer 3 — `product-form-builder.service.ts` + renderer components.
 *
 * Goal: adding a new vertical (e.g. Hospitality) requires ONE entry in the
 * registry, not edits across `product-form.component.{ts,html}`.
 */

import { PosExperience } from '../../../../../../core/models/catalog.model';

/**
 * Closed union of every product field the form currently supports.
 * Adding a new field requires extending this union — TypeScript will
 * force the schema and renderer to handle it explicitly.
 */
export type ProductFormFieldKey =
  | 'name'
  | 'type'
  | 'barcode'
  | 'description'
  | 'pricePesos'
  | 'categoryId'
  | 'isAvailable'
  | 'trackStock'
  | 'currentStock'
  | 'lowStockThreshold'
  | 'printingDestinationId'
  | 'satProductCode'
  | 'satUnitCode'
  | 'taxRate'
  | 'isTaxIncluded'
  | 'isMembership'
  | 'membershipDurationDays'
  | 'sizes'
  | 'modifierGroups';

/**
 * Atomic widget kinds — drives the polymorphic switch inside
 * `<app-form-field>`. Each kind maps to one PrimeNG widget.
 *
 * `array-sizes` and `array-modifier-groups` are dedicated kinds for the
 * two FormArray fields — they delegate to their own sub-form components
 * because they require nested CRUD UX that does not fit the atomic
 * widget pattern.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'currency'
  | 'number'
  | 'integer'
  | 'switch'
  | 'dropdown'
  | 'category-picker'
  | 'printer-picker'
  | 'tax-picker'
  | 'sat-code'
  | 'array-sizes'
  | 'array-modifier-groups';

/**
 * Snapshot of the live form value passed to `showWhen` predicates.
 * Loosely typed so predicates can read any field without import noise;
 * predicates are pure functions and never mutate this object.
 */
export type ProductFormValueSnapshot = Partial<
  Record<ProductFormFieldKey, string | number | boolean | null | unknown>
>;

/**
 * Named validator key — maps to a real `ValidatorFn` inside
 * `product-form-validators.ts`. Keeping validators as named strings (not
 * inline functions) keeps the schema serializable / inspectable and
 * avoids spreading validator logic across multiple files.
 */
export type FieldValidatorKey =
  | 'required'
  | 'maxLength60'
  | 'positiveNumber'
  | 'min1'
  | 'max3650'
  | 'nonBlank';

/**
 * Field-level metadata. One per atomic input rendered by `<app-form-field>`.
 */
export interface FieldDescriptor {
  /** Stable key used by the FormGroup and by `showWhen` callbacks. */
  key: ProductFormFieldKey;

  /** Widget kind — selects the PrimeNG renderer in `<app-form-field>`. */
  kind: FieldKind;

  /** Visible label rendered above the input. */
  label: string;

  /** Optional placeholder text — passed through to the underlying widget. */
  placeholder?: string;

  /** Initial value applied by the builder service. */
  defaultValue: string | number | boolean | null;

  /** Named validators applied to the control. */
  validators?: readonly FieldValidatorKey[];

  /**
   * Conditional visibility predicate. Pure function over the current
   * form value. Returns true → field is rendered; false → hidden.
   * Omit for always-visible fields.
   */
  showWhen?: (formValue: ProductFormValueSnapshot) => boolean;

  /** Inline hint rendered below the input (`.form-hint` class). */
  hint?: string;

  /** Optional unit suffix shown by InputNumber widgets. */
  suffix?: string;

  /** Optional min/max bounds for numeric widgets. */
  min?: number;
  max?: number;
}

/**
 * Section group — corresponds to a collapsible `<details>` block in the
 * current template. Owns a list of fields and an optional section-wide
 * visibility predicate (e.g. `() => tenantContext.supportsMemberships()`).
 */
export interface SectionDescriptor {
  /** Stable id used by section-toggle state. */
  id: string;

  /** Visible section title. */
  title: string;

  /** PrimeIcons class for the section header icon. */
  icon: string;

  /** Optional pill badge displayed next to the title. */
  badge?: {
    label: string;
    variant: 'blue' | 'purple' | 'green';
  };

  /** Whether the section starts expanded. */
  defaultOpen: boolean;

  /** Fields rendered inside this section, in declaration order. */
  fields: readonly FieldDescriptor[];

  /**
   * Whole-section visibility predicate. Resolved against tenant context
   * capabilities at render time. Omit for always-visible sections.
   */
  showSection?: () => boolean;
}

/**
 * Preview-pane variant — selects which child renderer
 * `<app-product-preview>` instantiates.
 *
 * Today's mapping (from `MacroCategoryType` direct switch in the legacy
 * template): FoodBeverage → card-fb, QuickService → button-counter,
 * Retail → row-retail, Services / Quick → service-tile.
 */
export type PreviewVariant =
  | 'card-fb'
  | 'button-counter'
  | 'row-retail'
  | 'service-tile';

/**
 * Top-level schema for one vertical. The registry exposes one
 * `ProductFormSchema` per `PosExperience` value.
 */
export interface ProductFormSchema {
  sections: readonly SectionDescriptor[];
  previewVariant: PreviewVariant;
}

/**
 * Registry shape — exhaustive over `PosExperience` so TypeScript flags
 * any missing vertical entry at compile time. Implemented in
 * `product-form.registry.ts`.
 */
export type ProductFormSchemaRegistry = Record<PosExperience, ProductFormSchema>;
