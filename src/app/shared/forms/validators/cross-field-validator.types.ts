/**
 * Cross-field validator reference types per FDD-031 §4.3.
 *
 * Applied at the FormGroup level (vs control-level async validators in
 * async-validator.types.ts). Pure functions only — no DI surface at
 * the cross-field layer; consumers needing service-driven cross-field
 * checks should compose at the consumer level (out of F2 scope).
 *
 * Discriminated union over `kind`:
 *   - 'date-range'      : ensures `startKey < endKey`.
 *   - 'matching-fields' : ensures all `keys` resolve to equal values.
 *   - 'custom'          : consumer-provided pure validator function.
 */

import { FormGroup } from '@angular/forms';

export type CrossFieldValidatorRef<TKey extends string = string> =
  | {
      kind:      'date-range';
      startKey:  TKey;
      endKey:    TKey;
      /** Defaults to 'dateRange' when omitted. */
      errorKey?: string;
    }
  | {
      kind:      'matching-fields';
      keys:      readonly TKey[];
      /** Defaults to 'matchingFields' when omitted. */
      errorKey?: string;
    }
  | {
      kind:     'custom';
      /** Error key emitted on failure; mandatory for custom refs. */
      errorKey: string;
      /** Pure function: returns true if the group is valid. */
      validate: (group: FormGroup) => boolean;
    };
