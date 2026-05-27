/**
 * Public surface of the shared dynamic-form library.
 *
 * Consumers should import from this barrel — reaching into individual
 * files inside the library is discouraged so future internal refactors
 * don't break downstream imports.
 */

// Schemas / types
export type {
  FieldDescriptor,
  FieldColSpan,
  FormValueSnapshot,
  SectionDescriptor,
  DynamicFormSchema,
} from './schemas/dynamic-form.schema';
export type { FieldKind, ValidatorRef } from './schemas/dynamic-form.types';

// Async + cross-field validator types (FDD-031 §4.3)
export type { AsyncValidatorService, AsyncValidatorRef } from './validators/async-validator.types';
export type { CrossFieldValidatorRef } from './validators/cross-field-validator.types';

// Widget registry (FDD-031 §4.1)
export type { FormWidget } from './widgets/form-widget.interface';
export type { FormWidgetRegistration } from './widgets/form-widget.tokens';
export { FORM_WIDGETS, provideFormWidget } from './widgets/form-widget.tokens';

// Service
export { DynamicFormBuilderService } from './services/dynamic-form-builder.service';

// Components
export { DynamicFormComponent } from './components/dynamic-form.component';
export { FormSectionComponent } from './components/form-section.component';
export { FormFieldComponent } from './components/form-field.component';
export { PrintControlErrorComponent } from './components/print-control-error.component';
export { PrintFormErrorComponent } from './components/print-form-error.component';

// Validators (re-export from validators barrel)
export {
  requiredValidator,
  nonBlankValidator,
  positiveNumberValidator,
  maxLengthValidator,
  minLengthValidator,
  minValidator,
  maxValidator,
  resolveValidators,
  resolveAsyncValidators,
  resolveCrossFieldValidators,
} from './validators';
