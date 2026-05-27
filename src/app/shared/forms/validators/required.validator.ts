/**
 * Required validator — re-exports Angular's built-in `Validators.required`.
 *
 * Promoted from product-form POC `FIELD_VALIDATORS.required` mapping.
 * Behavior unchanged: emits `{ required: true }` for null/undefined/''/false,
 * otherwise null.
 */

import { Validators, ValidatorFn } from '@angular/forms';

export const requiredValidator: ValidatorFn = Validators.required;
