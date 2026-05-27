/**
 * Shape definitions for declarative dynamic forms.
 *
 * Promoted from product-form POC (AUDIT-058 Vector B / FDD-029 F1).
 *
 * Architecture:
 *   Layer 1 — this file: shape types parameterized by a consumer-owned
 *             field key union `<TKey extends string>`.
 *   Layer 2 — consumer's registry: per-variant schema records keyed on
 *             the consumer's variant axis (e.g. PosExperience).
 *   Layer 3 — `dynamic-form-builder.service.ts` + renderer components.
 *
 * The shared library does NOT expose a `DynamicFormSchemaRegistry<TKey, TVariant>`
 * wrapper — each consumer defines its own variant mapping locally. Keeps
 * the shared surface minimal.
 */

import { FieldKind, ValidatorRef } from './dynamic-form.types';

/**
 * Snapshot of the live form value passed to `showWhen` / `showSection`
 * predicates. Loosely typed so predicates can read any field without
 * import noise; predicates are pure functions and never mutate.
 *
 * `Partial<Record>` semantics — fields may be undefined under partial
 * hydration (edit-mode patch in progress, fields gated by other
 * predicates, etc.).
 */
export type FormValueSnapshot<TKey extends string = string> = Partial<
  Record<TKey, unknown>
>;

/**
 * Responsive column span configuration. Both breakpoints are required
 * per `.claude/html-standards.md` §"Form Structure" — dropping `md`
 * breaks responsive on tablets, which is the dominant form factor for
 * back-office POS surfaces.
 *
 * Defaults to `{ md: 12, lg: 12 }` (full width) when omitted on a
 * descriptor.
 */
export interface FieldColSpan {
  md?: number;
  lg?: number;
}

/**
 * Field-level metadata. One per atomic input rendered by `<app-form-field>`.
 *
 * Generic over `TKey` so consumers can constrain `key` to their own
 * literal-union of allowed field names. Default `string` keeps the type
 * usable in untyped contexts (tests, generic tooling).
 */
export interface FieldDescriptor<TKey extends string = string> {
  /** Stable key — addresses the FormControl in the parent FormGroup. */
  key: TKey;

  /** Widget kind — selects the renderer in `<app-form-field>`. */
  kind: FieldKind;

  /** Visible label rendered above the input via `<label htmlFor>`. */
  label: string;

  /** Optional placeholder forwarded to the underlying widget. */
  placeholder?: string;

  /** Initial value applied by `DynamicFormBuilderService.buildControls`. */
  defaultValue: unknown;

  /** Declarative validators resolved to ValidatorFn[] at build time. */
  validators?: readonly ValidatorRef[];

  /**
   * Conditional visibility predicate. Pure function over the current
   * form value snapshot. Returns true → field rendered; false → hidden.
   * Omit for always-visible fields.
   */
  showWhen?: (snapshot: FormValueSnapshot<TKey>) => boolean;

  /** Inline hint rendered below the input. */
  hint?: string;

  /** Optional unit suffix shown by InputNumber widgets. */
  suffix?: string;

  /** Optional min/max bounds for numeric widgets. */
  min?: number;
  max?: number;

  /** Responsive column span — defaults to `{ md: 12, lg: 12 }`. */
  colSpan?: FieldColSpan;

  /**
   * Slot discriminator for `kind: 'array'`. When present, the renderer
   * projects content from `[slot=array-{arrayKind}]`; otherwise it uses
   * `[slot=array-{key}]`. Lets one schema declare multiple distinct
   * FormArray slots (e.g. `arrayKind: 'sizes'` vs `'modifier-groups'`).
   */
  arrayKind?: string;

  /** Optional options for dropdown-style widgets. */
  options?: readonly { label: string; value: unknown }[];
}

/**
 * Section group — corresponds to a collapsible block in the rendered form.
 * Owns a list of fields and an optional section-wide visibility predicate
 * (e.g. capability-gated: `() => tenantContext.supportsMemberships()`).
 */
export interface SectionDescriptor<TKey extends string = string> {
  /** Stable id used for section state (open/closed) and ARIA labelling. */
  id: string;

  /** Visible section title. */
  title: string;

  /** PrimeIcons class for the section header icon. */
  icon?: string;

  /** Whether the section starts expanded. Defaults to true if omitted. */
  defaultOpen?: boolean;

  /**
   * Whole-section visibility predicate. Pure function over the value
   * snapshot. Omit for always-visible sections. Returns false → section
   * is not rendered at all (no header, no wrapper, no fields).
   */
  showSection?: (snapshot: FormValueSnapshot<TKey>) => boolean;

  /** Fields rendered inside this section, in declaration order. */
  fields: readonly FieldDescriptor<TKey>[];
}

/**
 * Top-level form schema. One per variant the consumer wants to render.
 *
 * Consumers can build a per-variant registry locally:
 * ```
 * const SCHEMAS: Record<MyVariant, DynamicFormSchema<MyFieldKey>> = { … };
 * ```
 * The shared library does not prescribe a registry type — that decision
 * is per-consumer.
 */
export interface DynamicFormSchema<TKey extends string = string> {
  sections: readonly SectionDescriptor<TKey>[];
}
