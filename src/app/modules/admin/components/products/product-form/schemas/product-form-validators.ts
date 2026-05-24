import { AbstractControl, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';

import { FieldValidatorKey } from './product-form.schema';

/**
 * Trims the value and fails when the result is empty — guards against
 * users typing only whitespace and bypassing `Validators.required`.
 * Mirrors `AdminDevicesComponent.nonBlankValidator` pattern.
 */
const nonBlankValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (typeof value !== 'string') return null;
  return value.trim().length === 0 ? { nonBlank: true } : null;
};

/**
 * Positive-number validator — accepts 0 only when `min` allows it.
 * Used by price / quantity fields that must not be negative.
 */
const positiveNumberValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'number' && value >= 0 ? null : { positiveNumber: true };
};

/**
 * Central registry mapping `FieldValidatorKey` strings to real
 * `ValidatorFn` instances. Keeping validators registered here (and
 * referenced by name in the schema) lets the schema stay serializable
 * and free of `@angular/forms` imports.
 */
export const FIELD_VALIDATORS: Record<FieldValidatorKey, ValidatorFn> = {
  required:       Validators.required,
  maxLength60:    Validators.maxLength(60),
  positiveNumber: positiveNumberValidator,
  min1:           Validators.min(1),
  max3650:        Validators.max(3650),
  nonBlank:       nonBlankValidator,
};

/**
 * Resolves a list of validator keys to their corresponding
 * `ValidatorFn[]`. Unknown keys are skipped silently (defensive — the
 * schema's union type already prevents typos at compile time, but
 * runtime guard avoids crashes if a schema is hand-edited).
 *
 * @param keys Optional list of named validators from a `FieldDescriptor`.
 */
export function resolveValidators(keys?: readonly FieldValidatorKey[]): ValidatorFn[] {
  if (!keys || keys.length === 0) return [];
  const resolved: ValidatorFn[] = [];
  for (const key of keys) {
    const fn = FIELD_VALIDATORS[key];
    if (fn) resolved.push(fn);
  }
  return resolved;
}
