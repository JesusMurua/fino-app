import { FormControl } from '@angular/forms';

import { minValidator } from './min.validator';

describe('minValidator', () => {

  it('emits min error when value is below limit', () => {
    const control = new FormControl(0, minValidator(1));
    expect(control.errors?.['min']).toBeTruthy();
  });

  it('returns null when value meets minimum', () => {
    const control = new FormControl(1, minValidator(1));
    expect(control.errors).toBeNull();
  });

});
