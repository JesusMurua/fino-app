/**
 * DI tokens and provider factory for the form widget registry.
 *
 * Consumers register custom widget kinds at the module / feature level
 * via `provideFormWidget(name, component)`. `FormFieldComponent`
 * injects `FORM_WIDGETS` at construction and resolves custom kinds
 * dynamically.
 *
 * Tree-shakable: if no consumer registers a kind, the corresponding
 * widget component is never imported into the shared bundle.
 */

import {
  EnvironmentProviders,
  InjectionToken,
  Type,
  makeEnvironmentProviders,
} from '@angular/core';

import { FormWidget } from './form-widget.interface';

/** Single widget registration entry. */
export interface FormWidgetRegistration {
  /** Unique kind name. Matched against `FieldDescriptor.kind`. */
  name: string;

  /** Component type that renders the widget. Must implement `FormWidget`. */
  component: Type<FormWidget>;
}

/**
 * Multi-provider DI token. Default factory returns an empty array so
 * apps that don't register any custom widgets still resolve cleanly.
 */
export const FORM_WIDGETS = new InjectionToken<readonly FormWidgetRegistration[]>(
  'FORM_WIDGETS',
  { providedIn: 'root', factory: () => [] },
);

/**
 * Registers a custom widget kind with the shared dynamic-form library.
 * Uses `makeEnvironmentProviders` to return a strongly-typed
 * `EnvironmentProviders` token — the modern Angular 14+ idiomatic
 * pattern. Do NOT return raw `Provider[]` from this function; the
 * type narrowing helps catch misuse at the call site.
 *
 * @param name      Unique kind name. If two `provideFormWidget` calls
 *                  register the same name, `FormFieldComponent` will
 *                  throw on construction (loud surface vs silent
 *                  last-write-wins).
 * @param component Component class implementing `FormWidget`.
 */
export function provideFormWidget(
  name: string,
  component: Type<FormWidget>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: FORM_WIDGETS,
      useValue: { name, component } satisfies FormWidgetRegistration,
      multi: true,
    },
  ]);
}
