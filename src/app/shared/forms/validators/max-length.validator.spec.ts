import { FormControl } from '@angular/forms';

import { maxLengthValidator } from './max-length.validator';

describe('maxLengthValidator', () => {

  it('emits maxlength error when value exceeds limit', () => {
    const control = new FormControl('abcdef', maxLengthValidator(5));
    expect(control.errors?.['maxlength']).toBeTruthy();
    expect(control.errors?.['maxlength']?.requiredLength).toBe(5);
  });

  it('returns null when value is at or below limit', () => {
    const control = new FormControl('abcde', maxLengthValidator(5));
    expect(control.errors).toBeNull();
  });

});
