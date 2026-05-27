/**
 * Resolves a list of `CrossFieldValidatorRef` into ready-to-use
 * `ValidatorFn[]` applied at the FormGroup level. Per FDD-031 §4.3:
 * pure functions only — no DI surface at cross-field layer.
 *
 * Each returned ValidatorFn is defensive: it type-guards the incoming
 * control against `FormGroup` and returns null when called on a
 * non-FormGroup (control or array). This handles the case where
 * Angular applies validators upward in nested form trees.
 */

import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';

import { CrossFieldValidatorRef } from './cross-field-validator.types';
import {
  validateDateRange,
  validateMatchingFields,
} from './cross-field-validators';

export function resolveCrossFieldValidators<TKey extends string = string>(
  refs: readonly CrossFieldValidatorRef<TKey>[],
): ValidatorFn[] {
  return refs.map((ref) => (control: AbstractControl) => {
    if (!(control instanceof FormGroup)) return null;
    return applyCrossFieldRef(control, ref);
  });
}

function applyCrossFieldRef<TKey extends string>(
  group: FormGroup,
  ref: CrossFieldValidatorRef<TKey>,
): ValidationErrors | null {
  switch (ref.kind) {
    case 'date-range':
      return validateDateRange(group, ref);
    case 'matching-fields':
      return validateMatchingFields(group, ref);
    case 'custom':
      return ref.validate(group) ? null : { [ref.errorKey]: true };
  }
}
