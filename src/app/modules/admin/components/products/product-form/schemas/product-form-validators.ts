// LEGACY SHIM — survives until the product-form template migrates
// to <app-dynamic-form>. No target FDD yet — see FDD-031 §3.3 for context.
// This file rebinds the POC's string-keyed FIELD_VALIDATORS to the shared
// validator implementations from `src/app/shared/forms`. The string-key
// layer (`'required' | 'maxLength60' | ...`) is preserved so the POC
// registry literals keep working without rewrite. Consumers that adopt
// `<app-dynamic-form>` use the shared `ValidatorRef` union directly.

import { ValidatorFn } from '@angular/forms';

import {
  maxLengthValidator,
  maxValidator,
  minValidator,
  nonBlankValidator,
  positiveNumberValidator,
  requiredValidator,
} from '../../../../../../shared/forms';
import { FieldValidatorKey } from './product-form.schema';

/**
 * Central registry mapping `FieldValidatorKey` strings to real
 * `ValidatorFn` instances. Values now resolve from the shared library
 * (FDD-029 §12 (d) sub-phase d migration). Behavior is observationally
 * equivalent to the prior POC implementation — `positiveNumber` and
 * `nonBlank` are the same custom functions, now shared; `required`,
 * `maxLength60`, `min1`, `max3650` delegate to factories.
 */
export const FIELD_VALIDATORS: Record<FieldValidatorKey, ValidatorFn> = {
  required:       requiredValidator,
  maxLength60:    maxLengthValidator(60),
  positiveNumber: positiveNumberValidator,
  min1:           minValidator(1),
  max3650:        maxValidator(3650),
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
