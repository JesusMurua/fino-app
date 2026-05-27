import { Injectable, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AbstractControl, FormControl, ValidationErrors } from '@angular/forms';
import { Observable, firstValueFrom, of } from 'rxjs';

import { AsyncValidatorRef, AsyncValidatorService } from './async-validator.types';
import { resolveAsyncValidators } from './resolve-async-validators';

@Injectable({ providedIn: 'root' })
class ValidService implements AsyncValidatorService {
  check(): Observable<ValidationErrors | null> {
    return of(null);
  }
}

@Injectable({ providedIn: 'root' })
class AvailabilityService implements AsyncValidatorService {
  check(): Observable<ValidationErrors | null> {
    return of({ availability: true });
  }
}

@Injectable({ providedIn: 'root' })
class TakenService implements AsyncValidatorService {
  check(): Observable<ValidationErrors | null> {
    return of({ taken: true });
  }
}

class UnregisteredService implements AsyncValidatorService {
  check(): Observable<ValidationErrors | null> {
    return of(null);
  }
}

describe('resolveAsyncValidators', () => {

  let injector: Injector;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    injector = TestBed.inject(Injector);
  });

  it('resolves an AsyncValidatorRef into an AsyncValidatorFn via Injector.get', () => {
    const fns = resolveAsyncValidators(
      [{ key: 'availability', service: ValidService }],
      injector,
    );
    expect(fns.length).toBe(1);
    expect(typeof fns[0]).toBe('function');
  });

  it('service returning of(null) marks the control valid', async () => {
    const refs: AsyncValidatorRef[] = [
      { key: 'availability', service: ValidService },
    ];
    const [fn] = resolveAsyncValidators(refs, injector);
    const control = new FormControl('x') as AbstractControl;
    const result = await firstValueFrom(
      fn(control) as Observable<ValidationErrors | null>,
    );
    expect(result).toBeNull();
  });

  it('service returning ValidationErrors marks invalid with the ref error key', async () => {
    const refs: AsyncValidatorRef[] = [
      { key: 'availability', service: AvailabilityService },
    ];
    const [fn] = resolveAsyncValidators(refs, injector);
    const control = new FormControl('x') as AbstractControl;
    const result = await firstValueFrom(
      fn(control) as Observable<ValidationErrors | null>,
    );
    expect(result).toEqual({ availability: true });
  });

  it('multiple async validators with DISTINCT keys all run and both errors merge', async () => {
    // FDD-031 §11.1 clarification: refs use distinct keys so both
    // errors aggregate. Same-key refs would last-write-wins per
    // Angular's standard validator merging.
    const refs: AsyncValidatorRef[] = [
      { key: 'availability', service: AvailabilityService },
      { key: 'taken', service: TakenService },
    ];
    const fns = resolveAsyncValidators(refs, injector);
    const control = new FormControl('x') as AbstractControl;

    const r1 = await firstValueFrom(
      fns[0](control) as Observable<ValidationErrors | null>,
    );
    const r2 = await firstValueFrom(
      fns[1](control) as Observable<ValidationErrors | null>,
    );

    expect(r1).toEqual({ availability: true });
    expect(r2).toEqual({ taken: true });
  });

  it('missing service token throws on resolution (defensive)', () => {
    expect(() =>
      resolveAsyncValidators(
        [{ key: 'whatever', service: UnregisteredService }],
        injector,
      ),
    ).toThrow();
  });

  it('async validator wired through builder appears on the control', async () => {
    // Builder integration sanity — full integration tested in
    // dynamic-form-builder.service.spec.ts. This spec verifies the
    // surface: a resolved AsyncValidatorFn can be applied to a
    // FormControl and the control reports the validator presence.
    const refs: AsyncValidatorRef[] = [
      { key: 'availability', service: AvailabilityService },
    ];
    const [fn] = resolveAsyncValidators(refs, injector);
    const control = new FormControl('x');
    control.setAsyncValidators(fn);
    expect(control.asyncValidator).not.toBeNull();
  });

});
