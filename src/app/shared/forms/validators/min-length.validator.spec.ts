import { FormControl } from '@angular/forms';

import { minLengthValidator } from './min-length.validator';

describe('minLengthValidator', () => {

  it('emits minlength error when value is shorter than limit', () => {
    const control = new FormControl('ab', minLengthValidator(3));
    expect(control.errors?.['minlength']).toBeTruthy();
    expect(control.errors?.['minlength']?.requiredLength).toBe(3);
  });

  it('returns null when value meets minimum length', () => {
    const control = new FormControl('abc', minLengthValidator(3));
    expect(control.errors).toBeNull();
  });

  it('returns null for empty string baseline (Angular built-in tolerance — pair with required if needed)', () => {
    const control = new FormControl('', minLengthValidator(3));
    expect(control.errors).toBeNull();
  });

});
