/**
 * Resolves declarative validator references into Angular `ValidatorFn[]`.
 *
 * Promoted from product-form POC (AUDIT-058 / FDD-029 F1). The factory
 * pattern replaces the POC's hardcoded `maxLength60` / `min1` / `max3650`
 * string keys — callers now declare `{ key: 'maxLength', n: 60 }` etc.
 *
 * Defensive: unknown refs are skipped silently. The type-level union
 * already prevents typos at compile time; the runtime guard avoids
 * crashes if a schema is hand-edited or built from untrusted JSON.
 */

import { ValidatorFn } from '@angular/forms';

import { maxLengthValidator } from './max-length.validator';
import { maxValidator } from './max.validator';
import { minLengthValidator } from './min-length.validator';
import { minValidator } from './min.validator';
import { nonBlankValidator } from './non-blank.validator';
import { positiveNumberValidator } from './positive-number.validator';
import { requiredValidator } from './required.validator';
import { ValidatorRef } from '../schemas/dynamic-form.types';

export function resolveValidators(
  refs?: readonly ValidatorRef[],
): ValidatorFn[] {
  if (!refs || refs.length === 0) return [];

  const resolved: ValidatorFn[] = [];
  for (const ref of refs) {
    if (typeof ref === 'string') {
      switch (ref) {
        case 'required':       resolved.push(requiredValidator);       break;
        case 'nonBlank':       resolved.push(nonBlankValidator);       break;
        case 'positiveNumber': resolved.push(positiveNumberValidator); break;
        // Unknown string keys are skipped silently (defensive — the union
        // type already prevents typos at compile time).
      }
    } else {
      switch (ref.key) {
        case 'maxLength': resolved.push(maxLengthValidator(ref.n)); break;
        case 'minLength': resolved.push(minLengthValidator(ref.n)); break;
        case 'min':       resolved.push(minValidator(ref.n));       break;
        case 'max':       resolved.push(maxValidator(ref.n));       break;
        // Unknown object keys are skipped silently (same rationale).
      }
    }
  }
  return resolved;
}
