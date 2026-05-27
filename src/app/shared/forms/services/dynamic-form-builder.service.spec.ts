import { FormControl, FormGroup, Validators } from '@angular/forms';
import { TestBed } from '@angular/core/testing';

import { DynamicFormBuilderService } from './dynamic-form-builder.service';
import { DynamicFormSchema } from '../schemas/dynamic-form.schema';

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

  it("buildControls skips kind: 'array' fields", () => {
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
