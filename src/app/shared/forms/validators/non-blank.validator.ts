/**
 * Non-blank validator — fails when a string value contains only whitespace.
 *
 * Promoted from product-form POC. Defensive: returns null when the value
 * is not a string (lets the type-mismatch surface via other validators).
 *
 * Distinct from `required` — `required` fails on null/undefined/'', this
 * fails on `"   "` (whitespace-only). Both can coexist on the same control.
 */

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const nonBlankValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (typeof value !== 'string') return null;
  return value.trim().length === 0 ? { nonBlank: true } : null;
};
