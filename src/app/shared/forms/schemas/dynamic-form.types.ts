/**
 * Atomic type definitions for the shared dynamic-form library.
 *
 * Promoted from the product-form POC (AUDIT-058 Vector B / FDD-029 F1).
 * The shared library exposes the GENERIC subset of widget kinds and
 * validator refs; consumers extend these unions locally when they need
 * additional domain-specific kinds (e.g. product-form keeps
 * `'array-sizes'`, `'array-modifier-groups'`, picker kinds in its own
 * local FieldKind union).
 */

/**
 * Generic widget kinds supported out-of-the-box by `<app-form-field>`.
 * Each kind maps to a single PrimeNG widget in the renderer's switch.
 *
 * `'array'` is the generic FormArray slot — consumers project their own
 * sub-form via `<ng-content select="[slot=array-{key}]" />`. The optional
 * `arrayKind` discriminator on `FieldDescriptor` lets one schema declare
 * multiple distinct array slots in a single form.
 *
 * Adding a built-in kind here forces the renderer's switch to handle it
 * (TypeScript exhaustivity).
 *
 * The `(string & {})` tail is INTENTIONAL. The intersection with the
 * empty object preserves IDE auto-complete for the listed kinds while
 * also accepting arbitrary strings — this is what allows custom widget
 * kinds registered via `provideFormWidget(name, component)` to type
 * cleanly in field descriptors without extending this union. DO NOT
 * "simplify" to bare `string`: that drops the auto-complete on the
 * known kinds.
 *
 * Consumers with their own extended union (e.g. product-form's local
 * `FieldKind = SharedFieldKind | 'array-sizes' | ...`) continue to
 * type-check correctly because `(string & {})` accepts any string,
 * including literal union members.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'currency'
  | 'number'
  | 'integer'
  | 'switch'
  | 'dropdown'
  | 'array'
  | (string & {});

/**
 * Declarative reference to a validator. Mix of string keys (for no-arg
 * validators) and parameterized object refs (for factory validators).
 *
 * Resolved at form-build time by `resolveValidators(refs)` into a
 * `ValidatorFn[]` ready for FormControl construction.
 *
 * Adding a new generic validator: extend the union, add a case in
 * `resolveValidators`, and ship the corresponding ValidatorFn under
 * `validators/`.
 */
export type ValidatorRef =
  | 'required'
  | 'nonBlank'
  | 'positiveNumber'
  | { key: 'maxLength' | 'minLength' | 'min' | 'max'; n: number };
