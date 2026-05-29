import { FormControl } from '@angular/forms';

import { maxValidator } from './max.validator';

describe('maxValidator', () => {

  it('emits max error when value is above limit', () => {
    const control = new FormControl(11, maxValidator(10));
    expect(control.errors?.['max']).toBeTruthy();
  });

  it('returns null when value is at or below max', () => {
    const control = new FormControl(10, maxValidator(10));
    expect(control.errors).toBeNull();
  });

});
