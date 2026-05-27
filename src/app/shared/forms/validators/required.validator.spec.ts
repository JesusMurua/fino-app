import { FormControl } from '@angular/forms';

import { requiredValidator } from './required.validator';

describe('requiredValidator', () => {

  it('emits { required: true } when value is empty string', () => {
    const control = new FormControl('', requiredValidator);
    expect(control.errors).toEqual({ required: true });
  });

  it('returns null when value is non-empty string', () => {
    const control = new FormControl('hello', requiredValidator);
    expect(control.errors).toBeNull();
  });

});
