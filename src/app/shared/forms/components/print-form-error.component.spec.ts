import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { PrintFormErrorComponent } from './print-form-error.component';

/**
 * Host wrapper mirrors the consumer placement pattern:
 *   <app-print-form-error [formGroup] [formId] [messages?] />
 * It owns the FormGroup so specs can mutate errors / touched state.
 */
@Component({
  standalone: true,
  imports: [PrintFormErrorComponent],
  template: `
    <app-print-form-error
      [formGroup]="formGroup"
      [formId]="formId"
      [messages]="messages"
    />
  `,
})
class HostComponent {
  formGroup!: FormGroup;
  formId = 'form-test';
  messages?: Record<string, string>;
}

describe('PrintFormErrorComponent', () => {

  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  function bannerText(): string {
    const el = fixture.debugElement.query(By.css('app-print-form-error'))
      .nativeElement as HTMLElement;
    return el.textContent?.trim() ?? '';
  }

  function bannerHost(): HTMLElement {
    return fixture.debugElement.query(By.css('app-print-form-error'))
      .nativeElement as HTMLElement;
  }

  it('renders empty when formGroup is valid', () => {
    host.formGroup = new FormGroup({ name: new FormControl('ok') });
    host.formGroup.markAllAsTouched();
    fixture.detectChanges();

    expect(bannerText()).toBe('');
  });

  it('renders empty when formGroup is untouched (even with errors set)', () => {
    host.formGroup = new FormGroup({ name: new FormControl('ok') });
    host.formGroup.setErrors({ dateRange: true });
    // Deliberately do NOT markAllAsTouched.
    fixture.detectChanges();

    expect(bannerText()).toBe('');
  });

  it('renders the catalog message when invalid + touched', () => {
    host.formGroup = new FormGroup({ name: new FormControl('ok') });
    host.formGroup.setErrors({
      dateRange: { start: new Date(), end: new Date() },
    });
    host.formGroup.markAllAsTouched();
    fixture.detectChanges();

    expect(bannerText()).toBe('Fecha de inicio debe ser anterior a la de fin');
  });

  it('renders the override message when messages input provides one', () => {
    host.formGroup = new FormGroup({
      name: new FormControl('', Validators.required),
    });
    host.formGroup.setErrors({ dateRange: true });
    host.formGroup.markAllAsTouched();
    host.messages = { dateRange: 'Rango inválido (override)' };
    fixture.detectChanges();

    expect(bannerText()).toBe('Rango inválido (override)');
  });

  it('host element exposes the required ARIA attributes + tabindex + id', () => {
    host.formGroup = new FormGroup({ name: new FormControl('ok') });
    fixture.detectChanges();

    const el = bannerHost();
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('aria-atomic')).toBe('true');
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.getAttribute('id')).toBe('form-test-form-error');
  });

});
