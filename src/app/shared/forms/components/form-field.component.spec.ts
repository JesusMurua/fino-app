import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FormFieldComponent } from './form-field.component';
import { FieldDescriptor } from '../schemas/dynamic-form.schema';

/** Test host that projects a marker into the `array` slot. */
@Component({
  standalone: true,
  imports: [FormFieldComponent],
  template: `
    <app-form-field
      [descriptor]="descriptor"
      [control]="control"
      [formId]="formId"
    >
      <div data-test="projected-array-content">array slot content</div>
    </app-form-field>
  `,
})
class HostComponent {
  descriptor!: FieldDescriptor;
  control!: FormControl;
  formId = 'form-abc';
}

describe('FormFieldComponent', () => {

  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function build(descriptor: FieldDescriptor, value: unknown = null): void {
    host.descriptor = descriptor;
    host.control = new FormControl(value, descriptor.validators?.includes('required' as never) ? Validators.required : null);
    fixture.detectChanges();
  }

  it('renders text kind with label + input + paired ids', () => {
    build({
      key: 'name',
      kind: 'text',
      label: 'Nombre',
      defaultValue: '',
    });

    const labelEl = fixture.debugElement.query(By.css('label.form-field__label'));
    const inputEl = fixture.debugElement.query(By.css('input[type="text"]'));

    expect(labelEl).not.toBeNull();
    expect(labelEl.nativeElement.textContent.trim()).toBe('Nombre');
    expect(inputEl).not.toBeNull();
    expect(inputEl.attributes['id']).toBe('form-abc-name');
    expect(labelEl.attributes['for']).toBe('form-abc-name');
  });

  it('renders dropdown kind with PrimeNG p-dropdown', () => {
    build({
      key: 'category',
      kind: 'dropdown',
      label: 'Categoría',
      defaultValue: null,
      options: [{ label: 'A', value: 1 }],
    });

    const dropdownEl = fixture.debugElement.query(By.css('p-dropdown'));
    expect(dropdownEl).not.toBeNull();
  });

  it('renders switch kind with PrimeNG p-inputSwitch', () => {
    build({
      key: 'isActive',
      kind: 'switch',
      label: 'Activo',
      defaultValue: false,
    });

    const switchEl = fixture.debugElement.query(By.css('p-inputSwitch'));
    expect(switchEl).not.toBeNull();
  });

  it('short-circuits array kind to <ng-content /> slot', () => {
    build({
      key: 'sizes',
      kind: 'array',
      label: 'Tamaños',
      defaultValue: null,
    });

    const projectedEl = fixture.debugElement.query(
      By.css('[data-test="projected-array-content"]'),
    );
    expect(projectedEl).not.toBeNull();
    expect(projectedEl.nativeElement.textContent.trim()).toBe('array slot content');

    // No widget input rendered for array kind.
    const inputEl = fixture.debugElement.query(By.css('input[type="text"]'));
    expect(inputEl).toBeNull();
  });

  it('pairs label htmlFor with input id and wires aria-describedby to print-control-error', () => {
    build({
      key: 'name',
      kind: 'text',
      label: 'Nombre',
      defaultValue: '',
      validators: ['required'],
    });

    const labelEl = fixture.debugElement.query(By.css('label.form-field__label'));
    const inputEl = fixture.debugElement.query(By.css('input[type="text"]'));
    const errorEl = fixture.debugElement.query(By.css('app-print-control-error'));

    expect(labelEl.attributes['for']).toBe('form-abc-name');
    expect(inputEl.attributes['id']).toBe('form-abc-name');
    expect(inputEl.attributes['aria-describedby']).toBe('form-abc-name-error');
    expect(inputEl.attributes['aria-required']).toBe('true');
    expect(errorEl.attributes['id']).toBe('form-abc-name-error');
  });

});
