import { FormControl } from '@angular/forms';

import { resolveValidators } from './resolve-validators';

describe('resolveValidators', () => {

  it('resolves a mix of string and object refs into ValidatorFn[]', () => {
    const fns = resolveValidators([
      'required',
      'nonBlank',
      { key: 'maxLength', n: 5 },
      { key: 'min', n: 1 },
    ]);
    expect(fns.length).toBe(4);

    const control = new FormControl('hello!', fns);
    // 'hello!' is non-empty + non-blank + 6 chars (exceeds 5) + not a number
    expect(control.errors?.['maxlength']).toBeTruthy();
  });

  it('skips unknown refs silently (defensive)', () => {
    // Hand-edited JSON could produce an unknown string — exercise the
    // defensive branch via a force-cast.
    const fns = resolveValidators([
      'required',
      'unknownKey' as never,
      { key: 'unknownObjectKey' as never, n: 0 },
    ]);
    // Only the valid 'required' should be resolved.
    expect(fns.length).toBe(1);
  });

});
