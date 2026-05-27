import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ValidationErrors } from '@angular/forms';
import { Observable, of } from 'rxjs';

import { DynamicFormBuilderService } from './dynamic-form-builder.service';
import { DynamicFormSchema } from '../schemas/dynamic-form.schema';
import { AsyncValidatorService } from '../validators/async-validator.types';

type TestKey = 'name' | 'price' | 'sizes';

const TEST_SCHEMA: DynamicFormSchema<TestKey> = {
  sections: [
    {
      id: 'main',
      title: 'Main',
      fields: [
        {
          key: 'name',
          kind: 'text',
          label: 'Name',
          defaultValue: 'default',
          validators: ['required'],
        },
        {
          key: 'price',
          kind: 'currency',
          label: 'Price',
          defaultValue: 0,
          validators: [{ key: 'min', n: 0 }],
        },
        {
          key: 'sizes',
          kind: 'array',
          label: 'Sizes',
          defaultValue: [],
        },
      ],
    },
  ],
};

describe('DynamicFormBuilderService', () => {

  let service: DynamicFormBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DynamicFormBuilderService);
  });

  it('buildControls returns a map keyed by descriptor.key', () => {
    const controls = service.buildControls(TEST_SCHEMA);
    expect(Object.keys(controls).sort()).toEqual(['name', 'price']);
  });

  it('buildControls skips kind: array fields', () => {
    const controls = service.buildControls(TEST_SCHEMA);
    expect((controls as Record<string, unknown>)['sizes']).toBeUndefined();
  });

  it('buildControls applies defaultValue per descriptor', () => {
    const controls = service.buildControls(TEST_SCHEMA);
    expect(controls.name.value).toBe('default');
    expect(controls.price.value).toBe(0);
  });

  it('buildControls applies resolved validators', () => {
    const controls = service.buildControls(TEST_SCHEMA);
    // 'name' has required validator → setting to '' should be invalid.
    controls.name.setValue('');
    expect(controls.name.errors?.['required']).toBeTruthy();

    // 'price' has min(0) validator → -1 should be invalid.
    controls.price.setValue(-1);
    expect(controls.price.errors?.['min']).toBeTruthy();
  });

  it('buildFormGroup returns a FormGroup wrapping buildControls output', () => {
    const group = service.buildFormGroup(TEST_SCHEMA);
    expect(group).toBeInstanceOf(FormGroup);
    expect(group.get('name')).toBeInstanceOf(FormControl);
    expect(group.get('sizes')).toBeNull();
  });

});

// ------------------------------------------------------------------
// FDD-031 §4.3 — builder integration (async + cross-field validators)
// ------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
class AvailabilityCheckService implements AsyncValidatorService {
  check(): Observable<ValidationErrors | null> {
    return of({ availability: true });
  }
}

type IntegrationKey = 'name' | 'start' | 'end';

const ASYNC_SCHEMA: DynamicFormSchema<IntegrationKey> = {
  sections: [
    {
      id: 'main',
      title: 'Main',
      fields: [
        {
          key: 'name',
          kind: 'text',
          label: 'Name',
          defaultValue: 'foo',
          asyncValidators: [{ key: 'availability', service: AvailabilityCheckService }],
        },
        {
          key: 'start',
          kind: 'text',
          label: 'Start',
          defaultValue: '2024-01-01',
        },
        {
          key: 'end',
          kind: 'text',
          label: 'End',
          defaultValue: '2024-12-31',
        },
      ],
    },
  ],
  formValidators: [
    { kind: 'date-range', startKey: 'start', endKey: 'end' },
  ],
};

describe('DynamicFormBuilderService — FDD-031 integration', () => {

  let service: DynamicFormBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DynamicFormBuilderService);
  });

  it('buildFormGroup applies async validators per descriptor', () => {
    const group = service.buildFormGroup(ASYNC_SCHEMA);
    const name = group.get('name') as FormControl;
    expect(name.asyncValidator).not.toBeNull();
  });

  it('buildFormGroup applies formValidators on the FormGroup', () => {
    // ASYNC_SCHEMA defaults: start < end → valid (no dateRange error).
    const group = service.buildFormGroup(ASYNC_SCHEMA);
    expect(group.errors).toBeNull();

    // Flip values so start > end → dateRange error appears.
    group.patchValue({ start: '2024-12-31', end: '2024-01-01' });
    expect(group.errors?.['dateRange']).toBeTruthy();
  });

  it('buildFormGroup composes sync + async + cross-field correctly', () => {
    // Schema with all 3 validator types active:
    //   sync (required on name) + async (availability) + cross-field (date-range)
    const composedSchema: DynamicFormSchema<IntegrationKey> = {
      sections: [
        {
          id: 'main',
          title: 'Main',
          fields: [
            {
              key: 'name',
              kind: 'text',
              label: 'Name',
              defaultValue: '',
              validators: ['required'],
              asyncValidators: [
                { key: 'availability', service: AvailabilityCheckService },
              ],
            },
            { key: 'start', kind: 'text', label: 'Start', defaultValue: '2024-12-31' },
            { key: 'end', kind: 'text', label: 'End', defaultValue: '2024-01-01' },
          ],
        },
      ],
      formValidators: [
        { kind: 'date-range', startKey: 'start', endKey: 'end' },
      ],
    };

    const group = service.buildFormGroup(composedSchema);
    const name = group.get('name') as FormControl;

    // Sync validator: required fires immediately on empty default.
    expect(name.errors?.['required']).toBeTruthy();
    // Async validator was wired (its actual error key surfaces async,
    // but the validator presence is verifiable now).
    expect(name.asyncValidator).not.toBeNull();
    // Cross-field validator: date-range invalid on default values.
    expect(group.errors?.['dateRange']).toBeTruthy();
  });

});
