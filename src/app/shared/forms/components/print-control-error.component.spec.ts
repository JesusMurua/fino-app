import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';

import { PrintControlErrorComponent } from './print-control-error.component';

describe('PrintControlErrorComponent', () => {

  let component: PrintControlErrorComponent;
  let fixture: ComponentFixture<PrintControlErrorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrintControlErrorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PrintControlErrorComponent);
    component = fixture.componentInstance;
  });

  function errorText(): string {
    const el = fixture.nativeElement.querySelector('.control-error') as HTMLElement;
    return el.textContent?.trim() ?? '';
  }

  it('renders empty when control is valid', () => {
    const control = new FormControl('value', Validators.required);
    control.markAsTouched();
    component.control = control;
    fixture.detectChanges();

    expect(errorText()).toBe('');
  });

  it('renders empty when control is invalid but pristine and untouched', () => {
    const control = new FormControl('', Validators.required);
    // Deliberately do NOT markAsTouched / markAsDirty.
    component.control = control;
    fixture.detectChanges();

    expect(errorText()).toBe('');
  });

  it('renders default catalog message when invalid + touched (required case)', () => {
    const control = new FormControl('', Validators.required);
    control.markAsTouched();
    component.control = control;
    fixture.detectChanges();

    expect(errorText()).toBe('Campo requerido');
  });

  it('renders override message when messages input provides one', () => {
    const control = new FormControl('', Validators.required);
    control.markAsTouched();
    component.control = control;
    component.messages = { required: 'Custom required message' };
    fixture.detectChanges();

    expect(errorText()).toBe('Custom required message');
  });

  it('renders fallback "Valor inválido" when error key is not in catalog', () => {
    const control = new FormControl('value');
    control.setErrors({ unknownKey: true });
    control.markAsTouched();
    component.control = control;
    fixture.detectChanges();

    expect(errorText()).toBe('Valor inválido');
  });

  it('updates rendering when control transitions valid → invalid → valid', () => {
    const control = new FormControl('hello', Validators.required);
    control.markAsTouched();
    component.control = control;
    fixture.detectChanges();

    expect(errorText()).toBe('');

    control.setValue('');
    fixture.detectChanges();
    expect(errorText()).toBe('Campo requerido');

    control.setValue('hello');
    fixture.detectChanges();
    expect(errorText()).toBe('');
  });

});
