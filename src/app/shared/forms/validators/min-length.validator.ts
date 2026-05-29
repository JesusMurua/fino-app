/**
 * Min-length validator factory — wraps Angular's `Validators.minLength`.
 *
 * Note: Angular's built-in returns null when value is empty string —
 * combine with `required` if empty values should error.
 */

import { Validators, ValidatorFn } from '@angular/forms';

export const minLengthValidator = (n: number): ValidatorFn =>
  Validators.minLength(n);
