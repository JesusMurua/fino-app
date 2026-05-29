import { Component, Input, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AbstractControl, FormControl, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FormFieldComponent } from './form-field.component';
import { FieldDescriptor } from '../schemas/dynamic-form.schema';
import { FormWidget } from '../widgets/form-widget.interface';
import { provideFormWidget } from '../widgets/form-widget.tokens';

/** Test host that projects a marker into the named `array` slot. */
@Component({
  standalone: true,
  imports: [FormFieldComponent],
  template: `
    <app-form-field
      [descriptor]="descriptor"
      [control]="control"
      [formId]="formId"
    >
      <div data-test="projected-array-content" slot="array">array slot content</div>
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

  // --------------------------------------------------------------------
  // FDD-031 §4.2 — Reactive options
  // --------------------------------------------------------------------

  it('reactive options: static array resolves directly (typeof !== function branch)', () => {
    const opts = [{ label: 'A', value: 1 }, { label: 'B', value: 2 }];
    build({
      key: 'cat',
      kind: 'dropdown',
      label: 'Categoría',
      defaultValue: null,
      options: opts,
    });
    expect(fixture.componentInstance).toBeTruthy();
    const ff = fixture.debugElement.query(By.directive(FormFieldComponent))
      .componentInstance as FormFieldComponent;
    expect(ff.resolvedOptions).toBe(opts);
  });

  it('reactive options: signal resolves via call (typeof === function branch)', () => {
    const optsSignal = signal<readonly { label: string; value: unknown }[]>([
      { label: 'A', value: 1 },
    ]);
    build({
      key: 'cat',
      kind: 'dropdown',
      label: 'Categoría',
      defaultValue: null,
      options: optsSignal,
    });
    const ff = fixture.debugElement.query(By.directive(FormFieldComponent))
      .componentInstance as FormFieldComponent;
    expect(ff.resolvedOptions.length).toBe(1);
    expect(ff.resolvedOptions[0]).toEqual({ label: 'A', value: 1 });
  });

  it('reactive options: signal updates trigger FormFieldComponent re-render', () => {
    const optsSignal: WritableSignal<readonly { label: string; value: unknown }[]> = signal([
      { label: 'A', value: 1 },
    ]);
    build({
      key: 'cat',
      kind: 'dropdown',
      label: 'Categoría',
      defaultValue: null,
      options: optsSignal,
    });
    const ff = fixture.debugElement.query(By.directive(FormFieldComponent))
      .componentInstance as FormFieldComponent;
    expect(ff.resolvedOptions.length).toBe(1);

    optsSignal.set([
      { label: 'A', value: 1 },
      { label: 'B', value: 2 },
      { label: 'C', value: 3 },
    ]);
    fixture.detectChanges();
    expect(ff.resolvedOptions.length).toBe(3);
    expect(ff.resolvedOptions[2]).toEqual({ label: 'C', value: 3 });
  });

  it('reactive options: undefined resolves to empty array (defensive)', () => {
    build({
      key: 'cat',
      kind: 'dropdown',
      label: 'Categoría',
      defaultValue: null,
      // no `options` field
    });
    const ff = fixture.debugElement.query(By.directive(FormFieldComponent))
      .componentInstance as FormFieldComponent;
    expect(ff.resolvedOptions).toEqual([]);
  });

});

// --------------------------------------------------------------------
// FDD-031 §4.1 — Widget Registry duplicate detection (OQ3)
// --------------------------------------------------------------------
// Lives in a separate describe block because it requires distinct
// TestBed providers (duplicate provideFormWidget calls) — the main
// describe above has no widget providers and tests built-in kinds.

@Component({
  selector: 'app-test-widget-x',
  standalone: true,
  template: '',
})
class TestWidgetX implements FormWidget {
  @Input({ required: true }) descriptor!: FieldDescriptor;
  @Input({ required: true }) control!: AbstractControl;
  @Input({ required: true }) formId!: string;
}

@Component({
  selector: 'app-test-widget-y',
  standalone: true,
  template: '',
})
class TestWidgetY implements FormWidget {
  @Input({ required: true }) descriptor!: FieldDescriptor;
  @Input({ required: true }) control!: AbstractControl;
  @Input({ required: true }) formId!: string;
}

describe('FormFieldComponent — duplicate widget registration (OQ3)', () => {

  it('throws on construction when FORM_WIDGETS contains duplicate names', async () => {
    await TestBed.configureTestingModule({
      imports: [FormFieldComponent, NoopAnimationsModule],
      providers: [
        provideFormWidget('dup-kind', TestWidgetX),
        provideFormWidget('dup-kind', TestWidgetY),
      ],
    }).compileComponents();

    expect(() => TestBed.createComponent(FormFieldComponent))
      .toThrowError(/Duplicate FORM_WIDGETS registration: "dup-kind"/);
  });

});
