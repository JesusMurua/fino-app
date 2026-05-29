import { FormControl } from '@angular/forms';

import { positiveNumberValidator } from './positive-number.validator';

describe('positiveNumberValidator', () => {

  it('emits { positiveNumber: true } when value is negative', () => {
    const control = new FormControl(-1, positiveNumberValidator);
    expect(control.errors).toEqual({ positiveNumber: true });
  });

  it('returns null when value is zero', () => {
    const control = new FormControl(0, positiveNumberValidator);
    expect(control.errors).toBeNull();
  });

  it('returns null when value is null/undefined/empty string (tolerance — empty fields handled by required)', () => {
    expect(new FormControl(null, positiveNumberValidator).errors).toBeNull();
    expect(new FormControl(undefined, positiveNumberValidator).errors).toBeNull();
    expect(new FormControl('', positiveNumberValidator).errors).toBeNull();
  });

});
