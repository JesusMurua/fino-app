/**
 * Resolves a list of `AsyncValidatorRef` into ready-to-use
 * `AsyncValidatorFn[]`. Each ref's `service` is fetched from the
 * injector at resolution time; the resulting function delegates
 * validation to `service.check(control, context)`.
 *
 * Defensive behavior: if the injector cannot resolve a service token,
 * the underlying `Injector.get` throws — surfaces missing-service
 * errors loudly rather than producing a silently-failing validator.
 */

import { Injector } from '@angular/core';
import { AsyncValidatorFn } from '@angular/forms';

import { AsyncValidatorRef } from './async-validator.types';

export function resolveAsyncValidators(
  refs: readonly AsyncValidatorRef[],
  injector: Injector,
): AsyncValidatorFn[] {
  return refs.map((ref) => {
    const service = injector.get(ref.service);
    return (control) => service.check(control, ref.context);
  });
}
