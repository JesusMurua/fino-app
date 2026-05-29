/**
 * Built-in cross-field validator implementations per FDD-031 §4.3.
 *
 * Each function operates on a FormGroup and returns either null
 * (valid) or a ValidationErrors object keyed by the ref's `errorKey`.
 *
 * Tolerance: if any referenced control value is null or undefined,
 * the validator returns null (inactive). Consumers should pair with
 * `required` validators on individual controls to enforce non-empty
 * values — cross-field validators focus solely on inter-field
 * relationships.
 */

import { FormGroup, ValidationErrors } from '@angular/forms';

import { CrossFieldValidatorRef } from './cross-field-validator.types';

/**
 * Returns ValidationErrors when `startKey >= endKey`, else null.
 * Works for both `Date` instances (compared via timestamp) and ISO
 * date strings (lexicographic order matches chronological for `YYYY-MM-DD`
 * and `YYYY-MM-DDTHH:mm:ss` formats).
 */
export function validateDateRange(
  group: FormGroup,
  ref: Extract<CrossFieldValidatorRef, { kind: 'date-range' }>,
): ValidationErrors | null {
  const start = group.controls[ref.startKey]?.value;
  const end = group.controls[ref.endKey]?.value;

  if (start === null || start === undefined) return null;
  if (end === null || end === undefined) return null;

  if (start < end) return null;

  const errorKey = ref.errorKey ?? 'dateRange';
  return { [errorKey]: { start, end } };
}

/**
 * Returns ValidationErrors when any value among `keys` differs from
 * the first. Strict equality via `Object.is`.
 */
export function validateMatchingFields(
  group: FormGroup,
  ref: Extract<CrossFieldValidatorRef, { kind: 'matching-fields' }>,
): ValidationErrors | null {
  if (ref.keys.length < 2) return null;

  const values = ref.keys.map((k) => group.controls[k]?.value);

  // Inactive if any value is null/undefined.
  if (values.some((v) => v === null || v === undefined)) return null;

  const first = values[0];
  const allMatch = values.every((v) => Object.is(v, first));
  if (allMatch) return null;

  const errorKey = ref.errorKey ?? 'matchingFields';
  return { [errorKey]: { keys: ref.keys, values } };
}
