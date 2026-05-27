import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { FormSectionComponent } from './form-section.component';
import { SectionDescriptor } from '../schemas/dynamic-form.schema';

type TestKey = 'a' | 'b' | 'flag';

@Component({
  standalone: true,
  imports: [FormSectionComponent],
  template: `
    <app-form-section
      [section]="section"
      [formGroup]="formGroup"
      [formId]="'form-x'"
      [valueSnapshot]="snapshot"
    />
  `,
})
class HostComponent {
  section!: SectionDescriptor<TestKey>;
  formGroup = new FormGroup({
    a: new FormControl('valueA'),
    b: new FormControl('valueB'),
    flag: new FormControl(false),
  });
  snapshot = signal<Partial<Record<TestKey, unknown>>>({});
}

describe('FormSectionComponent', () => {

  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('emits the prescribed PrimeFlex wrapper "p-fluid p-formgrid grid"', () => {
    host.section = {
      id: 'main',
      title: 'Main',
      fields: [
        { key: 'a', kind: 'text', label: 'A', defaultValue: '' },
      ],
    };
    fixture.detectChanges();

    const wrapper = fixture.debugElement.query(By.css('.p-fluid.p-formgrid.grid'));
    expect(wrapper).not.toBeNull();
  });

  it('filters fields by showWhen(snapshot) predicate', () => {
    host.section = {
      id: 'main',
      title: 'Main',
      fields: [
        { key: 'a', kind: 'text', label: 'A', defaultValue: '' },
        {
          key: 'b',
          kind: 'text',
          label: 'B',
          defaultValue: '',
          showWhen: (snapshot) => snapshot['flag'] === true,
        },
      ],
    };
    host.snapshot.set({ flag: false });
    fixture.detectChanges();

    let inputs = fixture.debugElement.queryAll(By.css('input[type="text"]'));
    expect(inputs.length).toBe(1); // Only 'a' rendered.

    host.snapshot.set({ flag: true });
    fixture.detectChanges();

    inputs = fixture.debugElement.queryAll(By.css('input[type="text"]'));
    expect(inputs.length).toBe(2); // Both rendered.
  });

  it('emits both md:col-X and lg:col-X classes for colSpan (defaults to 12/12)', () => {
    host.section = {
      id: 'main',
      title: 'Main',
      fields: [
        {
          key: 'a',
          kind: 'text',
          label: 'A',
          defaultValue: '',
          colSpan: { md: 6, lg: 4 },
        },
        {
          key: 'b',
          kind: 'text',
          label: 'B',
          defaultValue: '',
          // no colSpan → defaults to { md: 12, lg: 12 }
        },
      ],
    };
    fixture.detectChanges();

    const wrappers = fixture.debugElement.queryAll(By.css('.p-fluid.p-formgrid.grid > div'));
    expect(wrappers.length).toBe(2);

    const cls0 = (wrappers[0].nativeElement as HTMLElement).className;
    expect(cls0).toContain('field');
    expect(cls0).toContain('col-12');
    expect(cls0).toContain('md:col-6');
    expect(cls0).toContain('lg:col-4');

    const cls1 = (wrappers[1].nativeElement as HTMLElement).className;
    expect(cls1).toContain('md:col-12');
    expect(cls1).toContain('lg:col-12');
  });

});
