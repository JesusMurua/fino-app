/**
 * Max-length validator factory — wraps Angular's `Validators.maxLength`.
 *
 * Factory pattern (per FDD-029 fix #4) replaces the POC's hardcoded
 * `maxLength60` key — callers parameterize N explicitly.
 */

import { Validators, ValidatorFn } from '@angular/forms';

export const maxLengthValidator = (n: number): ValidatorFn =>
  Validators.maxLength(n);
