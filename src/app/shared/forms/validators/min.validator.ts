/**
 * Min-value validator factory — wraps Angular's `Validators.min`.
 *
 * Emits `{ min: { min, actual } }` when control value is below `n`.
 */

import { Validators, ValidatorFn } from '@angular/forms';

export const minValidator = (n: number): ValidatorFn => Validators.min(n);
