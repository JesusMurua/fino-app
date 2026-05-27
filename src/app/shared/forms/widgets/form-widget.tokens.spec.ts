import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FormFieldComponent } from '../components/form-field.component';
import { FieldDescriptor } from '../schemas/dynamic-form.schema';

import {
  FORM_WIDGETS,
  FormWidgetRegistration,
  provideFormWidget,
} from './form-widget.tokens';
import { FormWidget } from './form-widget.interface';

/**
 * Minimal standalone widget used as a test fixture for custom widget
 * registration. Implements the FormWidget interface and renders a
 * unique marker that specs can query for via DOM selector.
 */
@Component({
  selector: 'app-test-widget',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: '<div data-test="custom-widget">custom widget</div>',
})
class TestWidgetComponent implements FormWidget {
  @Input({ required: true }) descriptor!: FieldDescriptor;
  @Input({ required: true }) control!: AbstractControl;
  @Input({ required: true }) formId!: string;
}

@Component({
  selector: 'app-test-widget-b',
  standalone: true,
  template: '<div data-test="custom-widget-b">B</div>',
})
class TestWidgetBComponent implements FormWidget {
  @Input({ required: true }) descriptor!: FieldDescriptor;
  @Input({ required: true }) control!: AbstractControl;
  @Input({ required: true }) formId!: string;
}

/** Host wrapper used to project ng-content into FormFieldComponent. */
@Component({
  standalone: true,
  imports: [FormFieldComponent],
  template: `
    <app-form-field [descriptor]="descriptor" [control]="control" [formId]="'fid'">
      <div data-test="projected">projected</div>
    </app-form-field>
  `,
})
class HostComponent {
  descriptor!: FieldDescriptor;
  control = new FormControl('');
}

describe('FORM_WIDGETS / provideFormWidget', () => {

  it('registers a single widget via provideFormWidget', () => {
    TestBed.configureTestingModule({
      providers: [provideFormWidget('custom-kind', TestWidgetComponent)],
    });
    const widgets = TestBed.inject(FORM_WIDGETS);
    expect(widgets.length).toBe(1);
    expect(widgets[0]).toEqual({
      name: 'custom-kind',
      component: TestWidgetComponent,
    } as FormWidgetRegistration);
  });

  it('multi-provider: 3 calls of provideFormWidget all coexist', () => {
    TestBed.configureTestingModule({
      providers: [
        provideFormWidget('kind-1', TestWidgetComponent),
        provideFormWidget('kind-2', TestWidgetBComponent),
        provideFormWidget('kind-3', TestWidgetComponent),
      ],
    });
    const widgets = TestBed.inject(FORM_WIDGETS);
    expect(widgets.length).toBe(3);
    const names = widgets.map((w) => w.name).sort();
    expect(names).toEqual(['kind-1', 'kind-2', 'kind-3']);
  });

  it('default factory returns empty array when no providers given', () => {
    TestBed.configureTestingModule({});
    const widgets = TestBed.inject(FORM_WIDGETS);
    expect(widgets).toEqual([]);
  });

  it('FormFieldComponent.resolveCustomWidget returns the registered Type', async () => {
    await TestBed.configureTestingModule({
      imports: [FormFieldComponent, NoopAnimationsModule],
      providers: [provideFormWidget('custom-kind', TestWidgetComponent)],
    }).compileComponents();

    const fixture = TestBed.createComponent(FormFieldComponent);
    fixture.componentInstance.descriptor = {
      key: 'k',
      kind: 'custom-kind',
      label: 'L',
      defaultValue: null,
    };
    fixture.componentInstance.control = new FormControl('');
    fixture.componentInstance.formId = 'fid';

    expect(fixture.componentInstance.resolveCustomWidget('custom-kind'))
      .toBe(TestWidgetComponent);
    expect(fixture.componentInstance.resolveCustomWidget('unknown')).toBeUndefined();
  });

  it('FormFieldComponent renders the custom widget via *ngComponentOutlet', async () => {
    await TestBed.configureTestingModule({
      imports: [FormFieldComponent, TestWidgetComponent, NoopAnimationsModule],
      providers: [provideFormWidget('custom-kind', TestWidgetComponent)],
    }).compileComponents();

    const fixture: ComponentFixture<FormFieldComponent> =
      TestBed.createComponent(FormFieldComponent);
    fixture.componentInstance.descriptor = {
      key: 'k',
      kind: 'custom-kind',
      label: 'L',
      defaultValue: null,
    };
    fixture.componentInstance.control = new FormControl('');
    fixture.componentInstance.formId = 'fid';
    fixture.detectChanges();

    const projected = fixture.debugElement.query(By.css('[data-test="custom-widget"]'));
    expect(projected).not.toBeNull();
    expect((projected.nativeElement as HTMLElement).textContent?.trim()).toBe('custom widget');
  });

  it('FormFieldComponent falls through to <ng-content> when kind is unknown', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.descriptor = {
      key: 'k',
      kind: 'unknown-kind',
      label: 'L',
      defaultValue: null,
    };
    fixture.detectChanges();

    const projected = fixture.debugElement.query(By.css('[data-test="projected"]'));
    expect(projected).not.toBeNull();
    expect((projected.nativeElement as HTMLElement).textContent?.trim()).toBe('projected');
  });

});
