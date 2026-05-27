/**
 * Async validator types for the shared dynamic-form library.
 *
 * Promoted per FDD-031 §4.3. Async validators run at the FormControl
 * level (vs cross-field validators which run at the FormGroup level —
 * see cross-field-validator.types.ts).
 *
 * Returns Observable only (OQ4 lockdown). Promise-based implementations
 * wrap with `from(promise)` from RxJS at the call site.
 *
 * Debouncing strategy (OQ2): the library does NOT throttle async
 * validators internally. Consumers configuring expensive API checks
 * should set `updateOn: 'blur'` on the FormControl to avoid spamming
 * the backend on every keystroke:
 *
 *   new FormControl('', {
 *     updateOn: 'blur',
 *     validators: [...],
 *     asyncValidators: [...],
 *   });
 */

import { AbstractControl, ValidationErrors } from '@angular/forms';
import { ProviderToken } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Contract for services implementing async validation. Implementations
 * live in the consumer feature module — the shared library invokes
 * them via DI through `resolveAsyncValidators`.
 */
export interface AsyncValidatorService {
  /**
   * @param control Control being validated.
   * @param context Optional context payload from the AsyncValidatorRef
   *                (e.g. resource identifier for an availability check).
   * @returns Observable that emits null (valid) or a ValidationErrors
   *          object (invalid). Must complete or emit a value
   *          (Angular awaits the first emission).
   */
  check(
    control: AbstractControl,
    context?: Record<string, unknown>,
  ): Observable<ValidationErrors | null>;
}

/**
 * Declarative reference to an async validator. The library resolves
 * `service` via the injector at build time and wires the resulting
 * AsyncValidatorFn onto the control.
 */
export interface AsyncValidatorRef {
  /**
   * Error key emitted when validation fails — drives
   * PrintControlError lookup. Common keys: `availability`, `unique`.
   */
  key: string;

  /** Provider token of the service implementing AsyncValidatorService. */
  service: ProviderToken<AsyncValidatorService>;

  /** Optional context payload forwarded to the service. */
  context?: Record<string, unknown>;
}
