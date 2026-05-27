import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { DynamicFormComponent } from './dynamic-form.component';
import { DynamicFormSchema } from '../schemas/dynamic-form.schema';

type TestKey = 'name' | 'price' | 'hidden';

@Component({
  standalone: true,
  imports: [DynamicFormComponent],
  template: `
    <app-dynamic-form
      [schema]="schema"
      [formGroup]="formGroup"
      [formId]="'form-test'"
      (submitted)="onSubmit($event)"
    />
  `,
})
class HostComponent {
  @ViewChild(DynamicFormComponent) child!: DynamicFormComponent<TestKey>;

  schema!: DynamicFormSchema<TestKey>;
  formGroup!: FormGroup;
  lastSubmittedValue: Record<string, unknown> | null = null;
  submitCount = 0;

  onSubmit(value: Record<TestKey, unknown>): void {
    this.lastSubmittedValue = value;
    this.submitCount++;
  }
}

describe('DynamicFormComponent', () => {

  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('renders all sections declared in the schema', () => {
    host.schema = {
      sections: [
        {
          id: 's1',
          title: 'Section One',
          fields: [{ key: 'name', kind: 'text', label: 'Name', defaultValue: '' }],
        },
        {
          id: 's2',
          title: 'Section Two',
          fields: [{ key: 'price', kind: 'currency', label: 'Price', defaultValue: 0 }],
        },
      ],
    };
    host.formGroup = new FormGroup({
      name: new FormControl(''),
      price: new FormControl(0),
    });
    fixture.detectChanges();

    const titles = fixture.debugElement
      .queryAll(By.css('.form-section__title'))
      .map((el) => (el.nativeElement as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['Section One', 'Section Two']);
  });

  it('filters by section.showSection predicate', () => {
    host.schema = {
      sections: [
        {
          id: 'visible',
          title: 'Visible',
          fields: [{ key: 'name', kind: 'text', label: 'Name', defaultValue: '' }],
        },
        {
          id: 'hidden',
          title: 'Hidden',
          showSection: () => false,
          fields: [{ key: 'hidden', kind: 'text', label: 'Hidden', defaultValue: '' }],
        },
      ],
    };
    host.formGroup = new FormGroup({
      name: new FormControl(''),
      hidden: new FormControl(''),
    });
    fixture.detectChanges();

    const titles = fixture.debugElement
      .queryAll(By.css('.form-section__title'))
      .map((el) => (el.nativeElement as HTMLElement).textContent?.trim());
    expect(titles).toEqual(['Visible']);
  });

  it('submit marks all as touched and emits (submitted) when valid', () => {
    host.schema = {
      sections: [
        {
          id: 's1',
          title: 'S',
          fields: [{ key: 'name', kind: 'text', label: 'Name', defaultValue: '' }],
        },
      ],
    };
    host.formGroup = new FormGroup({
      name: new FormControl('hello', Validators.required),
    });
    fixture.detectChanges();

    expect(host.formGroup.controls['name'].touched).toBe(false);

    host.child.submit();

    expect(host.formGroup.controls['name'].touched).toBe(true);
    expect(host.submitCount).toBe(1);
    expect(host.lastSubmittedValue).toEqual({ name: 'hello' });
  });

  it('submit does NOT emit when invalid AND focuses the first invalid input element', () => {
    host.schema = {
      sections: [
        {
          id: 's1',
          title: 'S',
          fields: [
            { key: 'name', kind: 'text', label: 'Name', defaultValue: '', validators: ['required'] },
          ],
        },
      ],
    };
    host.formGroup = new FormGroup({
      name: new FormControl('', Validators.required),
    });
    fixture.detectChanges();

    const inputEl = fixture.debugElement.query(By.css('#form-test-name')).nativeElement as HTMLElement;
    const focusSpy = spyOn(inputEl, 'focus');

    host.child.submit();

    expect(host.submitCount).toBe(0);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

});
