import { FormControl } from '@angular/forms';

import { nonBlankValidator } from './non-blank.validator';

describe('nonBlankValidator', () => {

  it('emits { nonBlank: true } when value is whitespace-only string', () => {
    const control = new FormControl('   ', nonBlankValidator);
    expect(control.errors).toEqual({ nonBlank: true });
  });

  it('returns null when value contains non-whitespace characters', () => {
    const control = new FormControl('x', nonBlankValidator);
    expect(control.errors).toBeNull();
  });

  it('returns null when value is not a string (defensive tolerance)', () => {
    const control = new FormControl(42, nonBlankValidator);
    expect(control.errors).toBeNull();
  });

});
