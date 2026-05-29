# FDD-031 — Forms Platform Extensions

**Fecha:** 2026-05-26
**Branch:** `development`
**Status:** Design — pending implementation approval
**Alcance:** Frontend (Angular 18 + PrimeNG 17). Extensions al shared dynamic-form library shippeado en FDD-029 F1 — necesarias para destrabar las migrations complejas (`admin-devices`, `reservation-form`) que el FDD-032 (siguiente) entregará.

---

## 1. Executive Summary

Extender la plataforma `src/app/shared/forms/` con **3 capacidades nuevas** que los consumers complejos requieren — sin migrar consumers todavía. Pure platform work, isolated from consumer risk.

**Deliverables (3 piezas, scope cerrado):**

1. **Widget Registry**: API DI-based `provideFormWidget(name, component)` que permite a consumers registrar custom widget kinds (e.g. `category-picker`, `chip-select`, `customer-autocomplete`) sin tocar el `<app-form-field>` switch.
2. **Reactive Options**: `FieldDescriptor.options` acepta `Signal<readonly Option[]>` además del array estático actual. Habilita dropdowns con opciones tenant-feature-gated o computed desde services.
3. **Async + Cross-field Validators**: `FieldDescriptor.asyncValidators` (control-level async) + `DynamicFormSchema.formValidators` (form-level cross-field). Habilita reservation-form availability checks y date-range validations.

**Estimación:** 2.5-3 días (las 3 sub-phases son **paralelizables** — sin cross-dependencies).

### Closes / Related

- Materializa [FDD-029 §6.3 "Custom widget kinds extension API"](FDD-029-metadata-driven-forms.md#63-extension-points-out-of-scope-f1-documented-for-f2f3) — diferido a FDD-030 originalmente, reasignado acá per scope split.
- Materializa [FDD-029 Open Question 2](FDD-029-metadata-driven-forms.md#open-questions) — widget kind extension API.
- Materializa [FDD-029 Open Question 3](FDD-029-metadata-driven-forms.md#open-questions) — async validators support.
- Materializa [FDD-030 Open Question 2](FDD-030-forms-adoption-admin-users.md#open-questions) — reactive options pattern (admin-users punteó con construction-time patch; admin-devices/reservation-form necesitan reactive).
- Materializa [AUDIT-059 §4.3 "stretches the abstraction"](AUDIT-059-forms-and-ui-consistency.md#43--reservation-form-component--stretches-the-abstraction) — extension API que reservation-form requiere.
- Precede a **FDD-032** (admin-devices + reservation-form consumer migrations, depende de este FDD estable).
- Cross-link: el scope split FDD-031 (platform) + FDD-032 (consumers) corrige la sugerencia original de combinar todo en un solo FDD (rejected per scope creep risk).

---

## 2. Current State

### 2.1 Shared library shippeado (F1 + F2-parte-1)

Commits:
- `6295b9c` — FDD-029 a+b: PrintControlError + Core Abstractions.
- `eeaf15c` — FDD-029 c+d: DynamicForm + Section + Field + product-form shim.
- *(pending)* — FDD-030 a+b+c+d: admin-users migration + ESLint rule.

API actual (vía [src/app/shared/forms/index.ts](../src/app/shared/forms/index.ts)):

- `FieldKind` (8 closed): `'text' | 'textarea' | 'currency' | 'number' | 'integer' | 'switch' | 'dropdown' | 'array'`.
- `ValidatorRef` (sync only): `'required' | 'nonBlank' | 'positiveNumber' | { key: 'maxLength'|'minLength'|'min'|'max'; n }`.
- `FieldDescriptor.options`: `readonly { label, value }[]` (static array only).
- `<app-form-field>`: switch sobre `FieldKind` literal cases + `<ng-content>` slot para `array`.

### 2.2 Lo que cada consumer pendiente necesita

| Consumer | Custom kinds | Reactive options | Async validators | Cross-field validators |
|---|---|---|---|---|
| `admin-devices` (FDD-032 sub-phase) | — (uses generic kinds) | ✅ mode dropdown filtered por tenant features + cash register filtered por branch | — | — |
| `reservation-form` (FDD-032 sub-phase) | ✅ chip-select (zones+tables), customer-autocomplete | ✅ tables por zona + customer search | ✅ availability check (date+time+tableId vs existing reservations) | ✅ date-range, time-window |

Sin estas 4 capacidades, los 2 consumers no pueden migrar. Por eso FDD-031 es **prerequisite blocker** para FDD-032.

### 2.3 Decisiones diferidas en FDD-029

- **OQ2 (widget extension API)**: *"diferido a FDD-030"* — re-ubicado acá per scope split.
- **OQ3 (async validators)**: *"ningún consumer en F1 lo requiere, pero reservation-form (F2 candidate) lo necesitará. Reserve `asyncValidators` key en `FieldDescriptor` ahora aunque sea unused?"* — diferido entonces, entregado acá.
- **OQ4 (`valueSnapshot` typing)**: ya resuelto en FDD-029 F1 c+d con `Signal<Partial<Record<TKey, unknown>>>`.

---

## 3. Requirements

### 3.1 Functional requirements

- **F-1** Custom widget kind registration via `provideFormWidget(name: string, component: Type<FormWidget>)` Angular DI provider. Multi-provider — multiple kinds register in one module.
- **F-2** `<app-form-field>` resolves custom kinds dynamically: si `descriptor.kind` no match el switch closed set, busca en widget registry. Si no hay match, falls through al existing `<ng-content>` slot (graceful degradation).
- **F-3** `FieldDescriptor.options` acepta `readonly Option[]` (static, current) O `Signal<readonly Option[]>` (reactive, new).
- **F-4** `<app-form-field>` para `kind: 'dropdown'` resuelve options dinámicamente al render time. Cambios en el signal disparan re-render via OnPush + signal reactivity.
- **F-5** `FieldDescriptor.asyncValidators: readonly AsyncValidatorRef[]` — control-level async validators. Resueltos al build time vía Angular DI (service injection per ref).
- **F-6** `DynamicFormSchema.formValidators: readonly CrossFieldValidatorRef<TKey>[]` — form-level cross-field validators. Applied to FormGroup, not FormControl.
- **F-7** `DynamicFormBuilderService.buildControls()` aplica async validators y form validators automáticamente.
- **F-8** `<app-print-control-error>` cataloga error keys nuevos: `availability` → "No disponible", `dateRange` → "Fecha inválida", `matchingFields` → "Los valores no coinciden". Override pattern (via `messages` input) preservado.

### 3.2 Non-functional requirements

- **NF-1** Widget registry: tree-shakable. Si ningún consumer registra un kind, el componente no entra al bundle.
- **NF-2** Reactive options backward compatible: consumers existentes (admin-users) usan static arrays sin cambio.
- **NF-3** Async validators usan `@angular/core` `inject()` para resolver services — sin coupling al sistema de DI propio del shared library.
- **NF-4** Cross-field validators son **pure functions** sobre `FormGroup` — no inyectan services (mantiene determinism). Si un cross-field validator necesita un service, debe wrapearse como async validator at form-level (escope del FDD-031, but worth documenting limit).
- **NF-5** Type-safety: `CrossFieldValidatorRef<TKey>` parametrizado sobre el TKey union del schema, así referencias a keys son type-checked.
- **NF-6** OnPush change detection en componentes nuevos.

### 3.3 Out of Scope

Defer explícito:

- **Consumer migrations**: admin-devices y reservation-form → **FDD-032 (Complex Adoption)**.
- **`product-form` shim dissolution**: la promesa de FDD-029 §12 (d) ("delete in FDD-030 once admin-users + admin-devices migrate") fue **prematura** — el shim no puede dissolverse hasta que el template del product-form migre. Cuando FDD-032 migre admin-devices, los TODO comments del shim se actualizan apuntando a un FDD futuro (cuando el product-form template migre). Documentado como corrección al FDD-029 §12 (d) en el changelog de FDD-032.
- **BEM duplication cleanup global** → FDD-033 (F3 Extension).
- **Hex literal sweep / spacing codemods** → FDD-034+ (F4 Sweep).
- **Custom validator DI for cross-field** (cross-field necesita service injection): documentado como Open Question, no entregado en F2.
- **Widget kind hot-reload at runtime**: registry es immutable post-bootstrap. Re-registración requeriría restart.
- **`<app-dynamic-form>` API surface changes**: el orchestrator NO cambia. Solo se extienden los descriptors + el FormField switch.

---

## 4. Component Architecture

### 4.1 Sub-phase (a) — Widget Registry

**Files to create:**
- `src/app/shared/forms/widgets/form-widget.interface.ts` — contract that custom widgets implement.
- `src/app/shared/forms/widgets/form-widget.tokens.ts` — `FORM_WIDGETS` InjectionToken + `provideFormWidget()` factory.
- `src/app/shared/forms/widgets/form-widget.tokens.spec.ts` — DI multi-provider behavior.

**Files to modify:**
- `src/app/shared/forms/components/form-field.component.{ts,html,spec.ts}` — extend switch + ng-container dynamic resolution + spec.
- `src/app/shared/forms/schemas/dynamic-form.types.ts` — relax `FieldKind` to accept arbitrary string while preserving auto-complete for known kinds.
- `src/app/shared/forms/index.ts` — re-export new tokens.

**Type definitions:**

```ts
// form-widget.interface.ts
export interface FormWidget {
  /** The descriptor declaring this field. */
  descriptor: FieldDescriptor;

  /** The control bound to this widget. */
  control: AbstractControl;

  /** The form id namespace (for input id pairing). */
  formId: string;
}

// form-widget.tokens.ts
export interface FormWidgetRegistration {
  name: string;
  component: Type<FormWidget>;
}

export const FORM_WIDGETS = new InjectionToken<readonly FormWidgetRegistration[]>(
  'FormWidgets',
  { providedIn: 'root', factory: () => [] },
);

export function provideFormWidget(
  name: string,
  component: Type<FormWidget>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: FORM_WIDGETS, useValue: { name, component }, multi: true },
  ]);
}
```

**Consumer usage pattern** (product-form module, FDD-032 example):

```ts
// product-form.module-providers.ts (FDD-032 sub-phase, illustrative)
providers: [
  provideFormWidget('category-picker', CategoryPickerWidgetComponent),
  provideFormWidget('printer-picker', PrinterPickerWidgetComponent),
  provideFormWidget('tax-picker',     TaxPickerWidgetComponent),
  provideFormWidget('sat-code',       SatCodeWidgetComponent),
],
```

**FieldKind relaxation:**

```ts
// dynamic-form.types.ts — updated
/**
 * Built-in widget kinds. Consumers can extend by registering custom
 * kinds via `provideFormWidget` — the union allows any string for
 * forward compat. Auto-completion still surfaces the known kinds.
 */
export type FieldKind =
  | 'text' | 'textarea' | 'currency' | 'number' | 'integer'
  | 'switch' | 'dropdown' | 'array'
  | (string & {});  // intersection-with-empty-object preserves
                    // auto-complete while accepting custom strings
```

**FormFieldComponent switch (extended):**

```html
@switch (descriptor.kind) {
  @case ('text') { ... }
  @case ('textarea') { ... }
  ... (8 built-in cases unchanged) ...
  @default {
    @if (resolveCustomWidget(descriptor.kind); as customType) {
      <ng-container
        *ngComponentOutlet="
          customType;
          inputs: { descriptor, control, formId }
        "
      />
    } @else {
      <!-- Fallback: graceful degradation to slot.
           Same pattern as `array` kind — consumer projects content. -->
      <ng-content />
    }
  }
}
```

**Component logic:**

```ts
private readonly widgets = inject(FORM_WIDGETS);

resolveCustomWidget(kind: string): Type<FormWidget> | undefined {
  return this.widgets.find(w => w.name === kind)?.component;
}
```

### 4.2 Sub-phase (b) — Reactive Options

**Files to modify:**
- `src/app/shared/forms/schemas/dynamic-form.schema.ts` — extend `FieldDescriptor.options` type.
- `src/app/shared/forms/components/form-field.component.{ts,html,spec.ts}` — resolve options at render time.

**Type extension:**

```ts
// FieldDescriptor (extended)
options?:
  | readonly { label: string; value: unknown }[]
  | Signal<readonly { label: string; value: unknown }[]>;
```

**Resolver:**

```ts
// form-field.component.ts
get resolvedOptions(): readonly Option[] {
  const opts = this.descriptor.options;
  if (!opts) return [];
  return typeof opts === 'function' ? opts() : opts;
}
```

**Template:**

```html
@case ('dropdown') {
  <p-dropdown
    [inputId]="inputId"
    [options]="resolvedOptions"
    [formControl]="formControl"
    [placeholder]="descriptor.placeholder ?? ''"
    optionLabel="label"
    optionValue="value"
  />
}
```

Because `<app-form-field>` is OnPush, signal-typed options trigger CD automatically when `.set()` / `.update()` fires elsewhere — Angular 18's signal reactivity.

**Consumer pattern** (admin-devices, FDD-032 example):

```ts
// admin-devices.component.ts (illustrative, FDD-032)
readonly availableCashRegisterOptions = computed(() => [
  { label: '— No vincular caja —', value: null },
  ...this.cashRegisters().filter(/* ... */).map(/* ... */),
]);

// in schema authoring:
{
  key: 'cashRegisterId',
  kind: 'dropdown',
  label: 'Caja registradora',
  defaultValue: null,
  options: this.availableCashRegisterOptions,  // Signal<readonly Option[]>
}
```

### 4.3 Sub-phase (c) — Async + Cross-field Validators

**Files to create:**
- `src/app/shared/forms/validators/async-validator.types.ts` — `AsyncValidatorRef` union + `AsyncValidatorService` interface.
- `src/app/shared/forms/validators/resolve-async-validators.ts` + spec.
- `src/app/shared/forms/validators/cross-field-validator.types.ts` — `CrossFieldValidatorRef<TKey>` union.
- `src/app/shared/forms/validators/cross-field-validators.ts` — built-in cross-field validator implementations.
- `src/app/shared/forms/validators/resolve-cross-field-validators.ts` + spec.

**Files to modify:**
- `src/app/shared/forms/schemas/dynamic-form.schema.ts` — add `asyncValidators?` to FieldDescriptor + `formValidators?` to DynamicFormSchema.
- `src/app/shared/forms/services/dynamic-form-builder.service.{ts,spec.ts}` — apply async + cross-field validators in build.
- `src/app/shared/forms/components/print-control-error.component.ts` — catalog entries for new error keys.
- `src/app/shared/forms/validators/index.ts` — re-export new validators.

**Async validator types:**

```ts
// async-validator.types.ts
export interface AsyncValidatorService {
  /**
   * @param control The control being validated.
   * @param context Optional context payload from the AsyncValidatorRef.
   * @returns Observable that resolves to null (valid) or
   *          a ValidationErrors object (invalid).
   */
  check(
    control: AbstractControl,
    context?: Record<string, unknown>,
  ): Observable<ValidationErrors | null>;
}

export interface AsyncValidatorRef {
  /** Error key emitted when validation fails — drives PrintControlError lookup. */
  key: string;

  /** Provider token of the service that implements `AsyncValidatorService`. */
  service: ProviderToken<AsyncValidatorService>;

  /** Optional context payload forwarded to the service. */
  context?: Record<string, unknown>;
}
```

**Resolver:**

```ts
// resolve-async-validators.ts
export function resolveAsyncValidators(
  refs: readonly AsyncValidatorRef[],
  injector: Injector,
): AsyncValidatorFn[] {
  return refs.map(ref => {
    const service = injector.get(ref.service);
    return (control: AbstractControl) =>
      service.check(control, ref.context);
  });
}
```

**Cross-field validator types:**

```ts
// cross-field-validator.types.ts
export type CrossFieldValidatorRef<TKey extends string = string> =
  | {
      kind: 'date-range';
      startKey: TKey;
      endKey: TKey;
      errorKey?: string;  // defaults to 'dateRange'
    }
  | {
      kind: 'matching-fields';
      keys: readonly TKey[];
      errorKey?: string;  // defaults to 'matchingFields'
    }
  | {
      kind: 'custom';
      errorKey: string;
      validate: (group: FormGroup) => boolean;  // true = valid
    };
```

**Resolver:**

```ts
// resolve-cross-field-validators.ts
export function resolveCrossFieldValidators<TKey extends string>(
  refs: readonly CrossFieldValidatorRef<TKey>[],
): ValidatorFn[] {
  return refs.map(ref => (group: AbstractControl) => {
    if (!(group instanceof FormGroup)) return null;
    return applyCrossFieldRef(group, ref);
  });
}

function applyCrossFieldRef<TKey extends string>(
  group: FormGroup,
  ref: CrossFieldValidatorRef<TKey>,
): ValidationErrors | null {
  switch (ref.kind) {
    case 'date-range': return validateDateRange(group, ref);
    case 'matching-fields': return validateMatchingFields(group, ref);
    case 'custom': return ref.validate(group) ? null : { [ref.errorKey]: true };
  }
}
```

**Schema extensions:**

```ts
// dynamic-form.schema.ts (extended)
export interface FieldDescriptor<TKey extends string = string> {
  // ... existing fields ...
  asyncValidators?: readonly AsyncValidatorRef[];
}

export interface DynamicFormSchema<TKey extends string = string> {
  sections: readonly SectionDescriptor<TKey>[];
  formValidators?: readonly CrossFieldValidatorRef<TKey>[];
}
```

**Builder service update:**

```ts
// dynamic-form-builder.service.ts (extended)
buildFormGroup<TKey extends string>(
  schema: DynamicFormSchema<TKey>,
): FormGroup {
  const controls = this.buildControls(schema);

  // Apply async validators per control.
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (!field.asyncValidators?.length) continue;
      const ctrl = controls[field.key];
      if (!ctrl) continue;
      ctrl.setAsyncValidators(
        resolveAsyncValidators(field.asyncValidators, this.injector),
      );
    }
  }

  const group = this.fb.group(controls);

  // Apply form-level cross-field validators.
  if (schema.formValidators?.length) {
    group.setValidators(resolveCrossFieldValidators(schema.formValidators));
  }

  return group;
}
```

**PrintControlError catalog extension:**

```ts
// print-control-error.component.ts default catalog (extended)
case 'availability': return 'No disponible';
case 'dateRange':    return 'Fecha de inicio debe ser anterior a la de fin';
case 'matchingFields': return 'Los valores no coinciden';
```

---

## 5. State Management

### 5.1 Widget Registry — DI-based, immutable post-bootstrap

- `FORM_WIDGETS` token providedIn root con factory returning empty array.
- `provideFormWidget(name, component)` returns `EnvironmentProviders` con `multi: true`.
- Module/feature consumers register their custom widgets in their providers list.
- `<app-form-field>` injects `FORM_WIDGETS` once at construction.

Tree-shakable: if a feature module doesn't register a kind, its widget component is never imported into the shared bundle.

### 5.2 Reactive Options — Signal-based, OnPush-native

- `descriptor.options: Signal<readonly Option[]>` is a callable that returns the current array.
- FormField reads via `typeof opts === 'function' ? opts() : opts` type guard.
- Signal updates trigger CD on the OnPush component automatically (Angular 18 signal-aware CD).
- No subscriptions, no cleanup — signals handle lifecycle.

### 5.3 Async Validators — DI-based service injection

- `AsyncValidatorRef.service` is a `ProviderToken<AsyncValidatorService>`.
- Builder injects via `Injector.get(token)` at build time.
- Service implementations live in consumers (e.g. `ReservationAvailabilityService` for reservation-form).
- Standardized `AsyncValidatorService.check()` contract returns `Observable<ValidationErrors | null>`.

### 5.4 Cross-field Validators — Pure functions on FormGroup

- Stateless: no injection, no signals, no async.
- Applied via `formGroup.setValidators(...)` after construction.
- Builder service composes the resolver output with any existing validators.

---

## 6. UI/UX

No user-visible changes from F2-part-2. The 3 extensions are platform-level — visible only when consumers (FDD-032) use them. Specifically:

- Widget Registry: enables custom widgets that look identical to built-ins from the user's perspective (only consumer-specific UX changes).
- Reactive Options: dropdown list updates as underlying state changes. Visually identical to a static dropdown that happens to have new options.
- Async Validators: validation feedback surfaces via existing `<app-print-control-error>` UI. Possibly delayed by 100-500ms vs sync validators (network latency).
- Cross-field Validators: errors surface on the FormGroup, which means `<app-print-control-error>` for individual controls does NOT show them. **Worth flag:** form-level error display is a gap — see Open Questions.

---

## 7. Data Flow

### 7.1 Custom widget render flow

```
Consumer module providers:
  provideFormWidget('category-picker', CategoryPickerComponent)
                     ↓
FORM_WIDGETS injection: [..., { name: 'category-picker', component: CategoryPickerComponent }]
                     ↓
Schema authoring: { key: 'categoryId', kind: 'category-picker', ... }
                     ↓
<app-form-field> render:
  - descriptor.kind === 'category-picker' → no built-in case match
  - resolveCustomWidget('category-picker') → CategoryPickerComponent
  - <ng-container *ngComponentOutlet="CategoryPickerComponent; inputs: {descriptor, control, formId}" />
                     ↓
CategoryPickerComponent receives descriptor + control + formId. Renders custom UI.
                     ↓
User interacts → control.setValue(...) → FormGroup updates.
```

### 7.2 Reactive options flow

```
Consumer service updates state:
  this.tenantService.refresh()
                     ↓
Consumer's computed signal updates:
  this.availableModeOptions = computed(() =>
    this.allModes().filter(m => this.tenantContext.hasFeature(m.feature))
  )
                     ↓
descriptor.options (Signal) emits new value
                     ↓
<app-form-field> OnPush CD triggered (Angular 18 signal reactivity)
                     ↓
Template re-renders with new options.
```

### 7.3 Async validator flow

```
User types in control → control.valueChanges
                     ↓
Async validator runs: resolveAsyncValidators returns AsyncValidatorFn[]
                     ↓
Each AsyncValidatorFn calls service.check(control, context):
  return service.check(control, ref.context);
                     ↓
service.check returns Observable<ValidationErrors | null>
  - subscribes to the API
  - 100-500ms later, emits result
                     ↓
control.errors updates → <app-print-control-error> re-evaluates → message renders.
```

### 7.4 Cross-field validator flow

```
User types in any field → group.valueChanges
                     ↓
group's validator (cross-field) runs:
  validateDateRange(group, { startKey, endKey })
                     ↓
group.errors updates if invalid
                     ↓
Worth flag: <app-print-control-error> bound to a single CONTROL does NOT see
group-level errors. Consumer must surface group-level errors separately
(e.g., a banner above the form). See Open Questions.
```

---

## 8. Performance

- Widget Registry: O(N) linear search per render in worst case (N = registered kinds). For typical N ≤ 10, negligible. Could memoize via Map if hot path emerges.
- Reactive Options: Signal-based, OnPush — only re-renders when signal value identity changes. No CD overhead vs static.
- Async Validators: rate-limited via Angular's `updateOn: 'blur'` pattern (consumer choice). Default `updateOn: 'change'` may issue many API calls — consumer should debounce externally if expensive.
- Cross-field Validators: synchronous, pure, fast. Run on every group value change. Negligible.

---

## 9. Error Handling

### 9.1 Compile-time

- `FieldKind` relaxed to `(string & {})` — known kinds preserve auto-complete; custom strings accepted without error.
- `AsyncValidatorRef.service` typed as `ProviderToken<AsyncValidatorService>` — typo on token caught at compile.
- `CrossFieldValidatorRef<TKey>.startKey`/`endKey`/`keys` typed against schema's TKey union.

### 9.2 Runtime

- **Unknown widget kind**: `resolveCustomWidget(kind)` returns undefined → FormField falls through to `<ng-content>` slot. If no projected content, renders empty (logged as warning in dev mode via `console.warn`).
- **Async validator service missing**: `injector.get(token)` throws — surfaces as build-time error visible in console + form is unusable. Worth flag in spec.
- **Cross-field validator on non-FormGroup**: defensive type guard returns `null` (validator inactive).

### 9.3 Error catalog updates

`<app-print-control-error>` default catalog gains 3 entries:
- `availability` → "No disponible"
- `dateRange` → "Fecha de inicio debe ser anterior a la de fin"
- `matchingFields` → "Los valores no coinciden"

Override pattern (via `messages` input) unchanged.

---

## 10. Accessibility

- Custom widgets must implement `FormWidget` contract — interface documents that the widget should:
  - Pair `<label htmlFor>` with input `id` using `${formId}-${descriptor.key}` pattern.
  - Wire `aria-invalid`, `aria-required`, `aria-describedby` to a `<app-print-control-error>` instance.
- Documented in `form-widget.interface.ts` JSDoc as authoring guideline.
- Async validators: `<app-print-control-error>` uses existing `aria-live="polite"` — async error appears after network latency without re-announcing during typing.
- Cross-field errors: NOT surfaced by per-control `<app-print-control-error>`. Worth flag — see Open Questions.

---

## 11. Testing

### 11.1 Unit specs (24 new specs)

- **Widget Registry** (6 specs):
  1. `provideFormWidget` registers single widget.
  2. `provideFormWidget` multi-provider — 3 registrations coexist.
  3. `FORM_WIDGETS` default factory returns empty array.
  4. `FormFieldComponent.resolveCustomWidget` finds registered.
  5. `FormFieldComponent` renders custom widget via `*ngComponentOutlet`.
  6. `FormFieldComponent` falls through to `<ng-content>` when kind not registered.

- **Reactive Options** (4 specs):
  1. Static array options resolve directly.
  2. Signal options resolve via call.
  3. Signal updates trigger FormField re-render (verify via DOM query post-update).
  4. Undefined options resolve to empty array.

- **Async Validators** (6 specs):
  1. `AsyncValidatorRef` resolves to AsyncValidatorFn via Injector.
  2. Service returning null marks control valid.
  3. Service returning ValidationErrors marks control invalid with the ref's error key.
  4. Multiple async validators all run in parallel.
  5. Missing service throws on resolution (defensive).
  6. Async validator wired through builder appears on control.

- **Cross-field Validators** (5 specs):
  1. `date-range` valid case (start < end).
  2. `date-range` invalid case (start >= end).
  3. `matching-fields` valid case (all match).
  4. `matching-fields` invalid case.
  5. `custom` ref with custom validator function.

- **Builder service integration** (3 specs):
  1. `buildFormGroup` applies async validators per descriptor.
  2. `buildFormGroup` applies form validators on the group.
  3. `buildFormGroup` returns FormGroup with composed validators (sync + async + cross-field).

### 11.2 NO in scope

- Consumer integration specs — those belong to FDD-032 (admin-devices, reservation-form spec coverage).
- E2E tests — deferred.
- Widget Registry hot-reload spec — out of scope (immutable registry).

---

## 12. Implementation Sub-phases

> **Naming clarification**: F2 — Adoption phase per AUDIT-059 §6 splits across **FDD-030 (admin-users + ESLint, shipped/pending)** + **FDD-031 (this — Platform Extensions)** + **FDD-032 (Complex Consumer Migration, pending)**. Internal sub-phases of FDD-031: (a), (b), (c) — fully parallelizable, no cross-dependencies.

### Dependency graph

```
  ┌──────────────────────────────┐
  │ (a) Widget Registry          │── independent ──┐
  └──────────────────────────────┘                 │
                                                   │
  ┌──────────────────────────────┐                 ├──→ FDD-032 unblocked
  │ (b) Reactive Options         │── independent ──┤
  └──────────────────────────────┘                 │
                                                   │
  ┌──────────────────────────────┐                 │
  │ (c) Async + Cross-field      │── independent ──┘
  │     Validators               │
  └──────────────────────────────┘
```

All 3 sub-phases can be developed and shipped in parallel. They modify disjoint subsets of the shared library API. FDD-032 (consumer migrations) starts after all 3 have landed and `ng test` is green across the shared library.

### Sub-phase (a) — Widget Registry

**Goal:** ship `provideFormWidget` + `FORM_WIDGETS` token + FormField dynamic resolution.

**Acceptance:**
- Files created: 3 (interface, tokens, spec).
- Files modified: 4 (form-field.component.{ts,html,spec.ts}, dynamic-form.types.ts, index.ts).
- 6 specs passing.
- `FieldKind` accepts custom strings without TS error.
- Custom widget renders via `*ngComponentOutlet` when registered.
- Falls through to `<ng-content>` when not registered.

**Estimate:** 1 day.

### Sub-phase (b) — Reactive Options

**Goal:** extend `FieldDescriptor.options` to accept signals + update FormField dropdown rendering.

**Acceptance:**
- Files modified: 3 (dynamic-form.schema.ts, form-field.component.ts, form-field.component.spec.ts).
- 4 specs passing.
- Static array options still work (backward compat).
- Signal options re-render dropdown when signal updates.

**Estimate:** 0.5 day.

### Sub-phase (c) — Async + Cross-field Validators

**Goal:** ship async validator infrastructure + cross-field validator infrastructure + builder integration.

**Acceptance:**
- Files created: 5 (async types + resolver + spec, cross-field types + impls + resolver + spec).
- Files modified: 3 (dynamic-form.schema.ts, dynamic-form-builder.service.ts + spec, print-control-error.component.ts catalog).
- 14 specs passing (6 async + 5 cross-field + 3 builder integration).
- `FieldDescriptor.asyncValidators` typed and applied.
- `DynamicFormSchema.formValidators` typed and applied.
- PrintControlError catalog includes 3 new error keys.

**Estimate:** 1-1.5 days.

### Total estimate

| Sub-phase | Estimate | Parallel? |
|---|---|---|
| (a) Widget Registry | 1 day | with (b) and (c) |
| (b) Reactive Options | 0.5 day | with (a) and (c) |
| (c) Async + Cross-field Validators | 1-1.5 days | with (a) and (b) |
| **Total wall-clock (1 dev sequential)** | **2.5-3 days** | — |
| **Total wall-clock (3 devs parallel)** | **1-1.5 days** | (a)+(b)+(c) overlap |

Matches AUDIT-059 §6 F2 estimate slice for platform extensions portion (the AUDIT estimated 3-4 days for full F2; F2 was later split into FDD-030 + FDD-031 + FDD-032 so each FDD takes a fraction).

---

## Complexity / Risk Analysis (admin-devices vs reservation-form preview)

The actual migrations live in **FDD-032**, but FDD-031 must ship the right primitives. Risk comparison summary:

### admin-devices (FDD-032 sub-phase)

| Dimension | Detail |
|---|---|
| Custom widget kinds | None — uses generic kinds (text, dropdown, switch). |
| Reactive options | **Critical** — mode dropdown filtered by tenant features, cash register list filtered by branch + linkability. Both reactive via consumer computed signals. |
| Async validators | None — all validations sync. |
| Cross-field validators | None. |
| Forms per component | 2 (activation code generator + fleet edit dialog) — needs 2 distinct `formId`s, separate schemas, no shared state. |
| Estimated complexity | Medium. Bottleneck = reactive options pattern (Phase b above). |
| Risk | Low if Phase b is solid. |

### reservation-form (FDD-032 sub-phase)

| Dimension | Detail |
|---|---|
| Custom widget kinds | **Critical** — `chip-select` for zones+tables, `customer-autocomplete` for guest selector. 2+ custom widgets to register (Phase a). |
| Reactive options | Tables computed per zone, customer search results — both reactive (Phase b). |
| Async validators | **Critical** — availability check against existing reservations (Phase c async). |
| Cross-field validators | **Critical** — date < end-date, time-window validation (Phase c cross-field). |
| Forms per component | 1, but with 4+ widget kinds + cross-field + async. |
| Estimated complexity | High. Touches all 3 extensions of FDD-031. |
| Risk | Medium-high — first stress test of widget registry + async validators in production. |

**Implication for FDD-032 sequencing:** migrate `admin-devices` first (validates Phase b in production, less surface area), then `reservation-form` (stress tests Phases a + c).

---

## Open Questions

1. **Cross-field error surfacing — where do form-level errors render?**
   `<app-print-control-error>` is bound to a single control. Form-level errors (date-range mismatch, matching-fields) live on the FormGroup, not on any individual control. Where does the user see them?
   *Options:*
   - (a) New `<app-print-form-error>` component that takes a FormGroup + renders group-level errors as a banner.
   - (b) Surface the error on the FIRST related control (e.g., for date-range on startKey).
   - (c) Consumer wraps the orchestrator with its own banner.
   *Recommendation:* defer (a) to a follow-up (FDD-032 has a real use case in reservation-form — design decision lives there).

2. **Async validator debouncing — default vs consumer-owned?**
   Angular's `updateOn` controls when validators run (`'change'` | `'blur'` | `'submit'`). Async validators on `'change'` can spam API calls.
   *Options:*
   - (a) Document that consumers should set `updateOn: 'blur'` for async validators.
   - (b) FDD-031 ships a `debounceMs?` field on AsyncValidatorRef.
   - (c) AsyncValidatorService implementations debounce internally.
   *Recommendation:* (a) — document, no infra change. Service implementations can debounce when needed.

3. **Widget Registry naming conflicts — first-write-wins or error?**
   If two consumers register kind `'category-picker'` (e.g. one in product-form, one in admin-products), what happens?
   *Options:*
   - (a) Last registration wins (current Map.set behavior in resolver).
   - (b) Throw at bootstrap if duplicate detected.
   - (c) Namespace kinds (e.g. `product:category-picker` vs `admin:category-picker`).
   *Recommendation:* (b) — throw on duplicate at injection time (defensive: prevents accidental override). Implement in `FORM_WIDGETS` factory or in FormFieldComponent constructor.

4. **`AsyncValidatorService.check` API — Observable vs Promise?**
   Angular's AsyncValidatorFn returns `Promise | Observable`. We standardized on Observable. Promise feels simpler for one-shot async checks.
   *Options:*
   - (a) Stick with Observable (current design — more Angular-idiomatic, supports cancellation).
   - (b) Accept both — let service implementer choose.
   *Recommendation:* (a) — single API surface. Promise implementations wrap via `from(promise)`.

---

## Apéndice — Files created / modified

### Created in FDD-031
- `docs/FDD-031-forms-platform-extensions.md` (this doc)
- `src/app/shared/forms/widgets/form-widget.interface.ts`
- `src/app/shared/forms/widgets/form-widget.tokens.ts`
- `src/app/shared/forms/widgets/form-widget.tokens.spec.ts`
- `src/app/shared/forms/validators/async-validator.types.ts`
- `src/app/shared/forms/validators/resolve-async-validators.ts`
- `src/app/shared/forms/validators/resolve-async-validators.spec.ts`
- `src/app/shared/forms/validators/cross-field-validator.types.ts`
- `src/app/shared/forms/validators/cross-field-validators.ts`
- `src/app/shared/forms/validators/resolve-cross-field-validators.ts`
- `src/app/shared/forms/validators/resolve-cross-field-validators.spec.ts`

### Modified in FDD-031
- `src/app/shared/forms/schemas/dynamic-form.types.ts` (FieldKind relaxation)
- `src/app/shared/forms/schemas/dynamic-form.schema.ts` (asyncValidators, formValidators, options Signal)
- `src/app/shared/forms/services/dynamic-form-builder.service.ts` (apply new validators)
- `src/app/shared/forms/services/dynamic-form-builder.service.spec.ts`
- `src/app/shared/forms/components/form-field.component.ts` (custom widget resolution + reactive options)
- `src/app/shared/forms/components/form-field.component.html`
- `src/app/shared/forms/components/form-field.component.spec.ts`
- `src/app/shared/forms/components/print-control-error.component.ts` (catalog extension)
- `src/app/shared/forms/index.ts` (re-export new APIs)

### Out of Scope (FDD-032 onwards)
- admin-devices consumer migration → FDD-032 sub-phase.
- reservation-form consumer migration → FDD-032 sub-phase.
- product-form shim dissolution semantic correction → FDD-032 changelog.
- ESLint allow-list updates for the migrated consumers → FDD-032 same commit.

---

## Changelog

### 2026-05-26 — Initial design

- Vector P1 (Platform Extensions) — fully designed.
- 3 independent sub-phases (a/b/c) all parallelizable.
- 4 Open Questions documented (cross-field surfacing, async debounce, registry conflicts, async API shape).
- Scope split: FDD-031 cubre platform-only; consumer migrations diferidas a FDD-032.
- Corrige el deferral target del extension API (FDD-029 §6.3 dijo "FDD-030" pero se reasigna acá per scope split).
- Documenta que la promesa de FDD-029 §12 (d) ("delete shim in FDD-030") fue prematura — corrección formal en FDD-032 changelog cuando admin-devices migre.
- Estimate: 2.5-3 días wall-clock secuencial, 1-1.5 días con 3 devs paralelos.
