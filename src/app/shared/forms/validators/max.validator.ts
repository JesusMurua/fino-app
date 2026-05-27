/**
 * Max-value validator factory — wraps Angular's `Validators.max`.
 *
 * Emits `{ max: { max, actual } }` when control value is above `n`.
 */

import { Validators, ValidatorFn } from '@angular/forms';

export const maxValidator = (n: number): ValidatorFn => Validators.max(n);
