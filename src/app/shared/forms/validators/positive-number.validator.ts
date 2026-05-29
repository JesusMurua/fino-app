/**
 * Positive-number validator — accepts 0 and any positive number.
 *
 * Promoted from product-form POC. Tolerant of empty values (null /
 * undefined / '') — those are handled by `required` if applicable.
 * This validator focuses on the "sign / type" concern: reject negatives
 * and non-numbers, accept zero.
 */

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const positiveNumberValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'number' && value >= 0
    ? null
    : { positiveNumber: true };
};
