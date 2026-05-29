import { FormControl, FormGroup } from '@angular/forms';

import { CrossFieldValidatorRef } from './cross-field-validator.types';
import { resolveCrossFieldValidators } from './resolve-cross-field-validators';

function makeGroup(values: Record<string, unknown>): FormGroup {
  const controls: Record<string, FormControl> = {};
  for (const [k, v] of Object.entries(values)) {
    controls[k] = new FormControl(v);
  }
  return new FormGroup(controls);
}

describe('resolveCrossFieldValidators', () => {

  it('date-range: valid case (start < end) returns null', () => {
    const refs: CrossFieldValidatorRef[] = [
      { kind: 'date-range', startKey: 'start', endKey: 'end' },
    ];
    const [fn] = resolveCrossFieldValidators(refs);
    const group = makeGroup({
      start: new Date('2024-01-01'),
      end: new Date('2024-12-31'),
    });
    group.setValidators(fn);
    group.updateValueAndValidity();
    expect(group.errors).toBeNull();
  });

  it('date-range: invalid case (start >= end) emits dateRange error', () => {
    const refs: CrossFieldValidatorRef[] = [
      { kind: 'date-range', startKey: 'start', endKey: 'end' },
    ];
    const [fn] = resolveCrossFieldValidators(refs);
    const start = new Date('2024-12-31');
    const end = new Date('2024-01-01');
    const group = makeGroup({ start, end });
    group.setValidators(fn);
    group.updateValueAndValidity();
    expect(group.errors?.['dateRange']).toBeTruthy();
    expect(group.errors?.['dateRange']).toEqual({ start, end });
  });

  it('matching-fields: valid case (all values equal) returns null', () => {
    const refs: CrossFieldValidatorRef[] = [
      { kind: 'matching-fields', keys: ['a', 'b', 'c'] },
    ];
    const [fn] = resolveCrossFieldValidators(refs);
    const group = makeGroup({ a: 'foo', b: 'foo', c: 'foo' });
    group.setValidators(fn);
    group.updateValueAndValidity();
    expect(group.errors).toBeNull();
  });

  it('matching-fields: invalid case emits matchingFields error', () => {
    const refs: CrossFieldValidatorRef[] = [
      { kind: 'matching-fields', keys: ['a', 'b', 'c'] },
    ];
    const [fn] = resolveCrossFieldValidators(refs);
    const group = makeGroup({ a: 'foo', b: 'foo', c: 'bar' });
    group.setValidators(fn);
    group.updateValueAndValidity();
    expect(group.errors?.['matchingFields']).toBeTruthy();
    expect(group.errors?.['matchingFields']).toEqual({
      keys: ['a', 'b', 'c'],
      values: ['foo', 'foo', 'bar'],
    });
  });

  it('custom kind: valid case (validate returns true) returns null', () => {
    const refs: CrossFieldValidatorRef[] = [
      {
        kind: 'custom',
        errorKey: 'positiveX',
        validate: (g) => (g.value.x as number) > 0,
      },
    ];
    const [fn] = resolveCrossFieldValidators(refs);
    const group = makeGroup({ x: 1 });
    group.setValidators(fn);
    group.updateValueAndValidity();
    expect(group.errors).toBeNull();
  });

  it('custom kind: invalid case (validate returns false) emits errorKey', () => {
    const refs: CrossFieldValidatorRef[] = [
      {
        kind: 'custom',
        errorKey: 'positiveX',
        validate: (g) => (g.value.x as number) > 0,
      },
    ];
    const [fn] = resolveCrossFieldValidators(refs);
    const group = makeGroup({ x: 0 });
    group.setValidators(fn);
    group.updateValueAndValidity();
    expect(group.errors?.['positiveX']).toBe(true);
  });

});
