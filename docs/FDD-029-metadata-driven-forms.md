# FDD-029 — Metadata-Driven Forms (F1 — Platform)

**Fecha:** 2026-05-26
**Branch:** `development`
**Status:** Design — pending implementation approval
**Alcance:** Frontend (Angular 18 + PrimeNG 17 + PrimeFlex 3). Diseño de la plataforma compartida para forms metadata-driven. **No incluye implementación.**

---

## 1. Executive Summary

Promover el POC schema-driven validado en `product-form` a una librería compartida en `src/app/shared/forms/` para detener el crecimiento de forms hand-rolled (+18% en 5 días según AUDIT-059) y materializar los standards prescritos en `.claude/html-standards.md` que nunca aterrizaron (PrimeFlex layout + `<app-print-control-error>`).

**Deliverables (3 piezas, scope cerrado):**

1. **Schema/registry/builder promovidos** a `src/app/shared/forms/` con field key genérico `<TKey extends string>` (no más binding a `ProductFormFieldKey`).
2. **`<app-dynamic-form>`** — smart component top-level que orquesta sections, fields y form state desde un schema.
3. **`<app-print-control-error>`** — presentational component prescrito en standards pero ausente del repo (0 matches).

**Estimación:** 2-3 días (per AUDIT-059 §6 F1 — Platform).

### Closes / Related

- Cierra [AUDIT-058 §2.2 "Forms estáticos, no metadata-driven"](AUDIT-058-domain-flexibility-and-testability.md#22-forms-estáticos-no-metadata-driven-partially-resolved--product-form-poc-only) (PARTIALLY RESOLVED → RESOLVED al completar este FDD).
- Materializa [AUDIT-059 §1.5 "Viabilidad metadata-driven"](AUDIT-059-forms-and-ui-consistency.md#15-viabilidad-metadata-driven-alta) y [§2.3 "Validation widget prescrito y ausente"](AUDIT-059-forms-and-ui-consistency.md#23-validation-widget-prescrito-y-ausente).
- Trigger formal de la **Rule of 3** documentada en AUDIT-058 §2.2 (admin-users + admin-devices + reservation-form pendientes en backlog = 3 forms justifican generalización).
- Precede a **FDD-030** (F2 — Adoption) y **FDD-031** (F3 — Extension), que están fuera de scope acá.

---

## 2. Current State

### 2.1 POC architecture (3-layer) ya validada

[src/app/modules/admin/components/products/product-form/](../src/app/modules/admin/components/products/product-form/) implementa la arquitectura objetivo, scoped a un solo feature:

```
product-form/
├── schemas/
│   ├── product-form.schema.ts            # Layer 1 — type definitions
│   ├── product-form.registry.ts          # Layer 2 — per-vertical descriptors
│   └── product-form-validators.ts        # Layer 3a — ValidatorFn resolution
├── services/
│   └── product-form-builder.service.ts   # Layer 3b — FormGroup factory
└── components/
    ├── form-field.component.ts           # Layer 3c — atomic widget switch
    ├── form-section.component.ts         # Layer 3c — section orchestration
    └── product-preview.component.ts      # Layer 3d — domain-specific preview
```

### 2.2 Cobertura actual y trigger

| Métrica | Valor |
|---|---|
| Forms hand-rolled en el repo | 13 |
| Forms schema-driven | 1 (`product-form`) |
| `FormBuilder/FormGroup/FormControl/FormArray` refs | 181 |
| Crecimiento vs AUDIT-058 (5 días) | +18% (153 → 181) |
| Templates usando `p-fluid p-formgrid grid` (standard) | 0 |
| Templates usando `class="field"` | 1 |
| Files referenciando `<app-print-control-error>` | 0 (componente no existe) |

### 2.3 Por qué este FDD ahora

- POC validado en producción (FDD-028 F5 shipped).
- Rule of 3 satisfecha (3 candidatos en backlog: admin-users, admin-devices, reservation-form per AUDIT-059 §4).
- Cada semana de no-promoción agrega ~20 refs hand-rolled a la deuda.

---

## 3. Requirements

### 3.1 Functional requirements

- **F-1** El builder produce un `FormGroup` válido a partir de un schema declarativo, sin que el consumer cree manualmente `FormControl`s atómicos.
- **F-2** Cada field descriptor declara: `key`, `kind`, `label`, `defaultValue`, `validators` (lista de keys-string), `showWhen` (predicate opcional), `hint` opcional, parámetros widget-specific (`min`/`max`/`maxLength`/etc.).
- **F-3** Las sections declaran: `id`, `title`, `icon`, `defaultOpen`, `showSection` (predicate opcional), `fields[]`.
- **F-4** `<app-dynamic-form>` recibe un `schema` + `formGroup` y renderiza el árbol completo sin que el consumer toque el DOM.
- **F-5** `<app-print-control-error>` renderiza el primer error activo de un control en formato user-friendly (no técnico — "Campo requerido" en lugar de `"errors.required: true"`).
- **F-6** El consumer mantiene ownership de FormArrays complejos (`array-*` field kinds short-circuiteanen al sub-form componente del consumer) — preserva el patrón ya establecido en el POC.
- **F-7** `showWhen` / `showSection` predicates son **puros** y reactivos al value snapshot — implementados con signals para evitar `subscribe()` manual.

### 3.2 Non-functional requirements

- **NF-1** Field key es genérico `<TKey extends string>` — no binding a un union concreto (D2).
- **NF-2** Validators genéricos (`required`, `maxLength*`, `positiveNumber`, `nonBlank`, etc.) viven en `shared/forms/validators/`. Validators domain-specific (ej. SAT codes) quedan en el feature del consumer.
- **NF-3** Layout emitido por `<app-form-field>` cumple [.claude/html-standards.md §"Form Structure"](../.claude/html-standards.md): `<div class="p-fluid p-formgrid grid">` wrapper + `<div class="field col-12 lg:col-X md:col-X gap-2">` per field.
- **NF-4** OnPush change detection en los 4 componentes nuevos.
- **NF-5** Visual tokens consumidos desde [_variables.scss](../src/styles/_variables.scss) — cero hex literales, cero off-scale spacing en los componentes nuevos.
- **NF-6** El shared library NO importa nada de `src/app/modules/` (regla de capas).

### 3.3 Out of Scope

Defer explícito según AUDIT-059 §5 phase classification:

- **Migración de los 13 forms hand-rolled** → FDD-030 (F2 — Adoption, P1 en AUDIT-059).
- **Custom ESLint rule** prohibiendo `<form>` sin `<app-dynamic-form>` → FDD-030 (F2 — Adoption, P1 en AUDIT-059 §5).
- **BEM duplication cleanup** (`.form-field`, `.btn-primary`, `.settings-card` redeclaradas) → FDD-031 (F3 — Extension, P2).
- **Hex literal sweep** en `styles.scss` y component SCSS → FDD-031 (F3 — Extension, P2).
- **Off-scale spacing codemod** (249 ocurrencias) → FDD-032 (F4 — Sweep, P3).
- **Sub-16px font-size audit** (614 ocurrencias) → FDD-032 (F4 — Sweep, P3).
- **Async cross-field validators** (ej. reservation availability) — FDD-029 cubre sync validators únicamente; el extension API se documenta como Open Question.
- **Tax engine / business logic** — unrelated.

---

## 4. Component Architecture

### 4.1 Component tree

```
<app-dynamic-form>                   smart — orchestrator
  └── <app-form-section> *           presentational — section accordion
        └── <app-form-field> *       presentational — widget switch
              └── <app-print-control-error>   presentational — validation feedback
```

`*` = repeated per section / field.

### 4.2 `DynamicFormComponent` (smart)

```ts
@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DynamicFormComponent<TKey extends string = string> {
  /** Schema describing sections + fields. Required. */
  @Input({ required: true }) schema!: DynamicFormSchema<TKey>;

  /** FormGroup owned by the consumer (built via `DynamicFormBuilderService`). */
  @Input({ required: true }) formGroup!: FormGroup;

  /** Optional value snapshot for showWhen predicates. Defaults to formGroup.value. */
  @Input() valueSnapshot?: Signal<Record<TKey, unknown>>;

  /** Emits once the form passes validation and the user submits. */
  @Output() submit = new EventEmitter<Record<TKey, unknown>>();
}
```

Responsabilidades:
- Iterar `schema.sections`, filtrar por `showSection(snapshot)`, renderizar `<app-form-section>` por cada.
- Pasar el `FormGroup` por reference down al tree (no clonado).
- Exponer `submit` que dispara `formGroup.markAllAsTouched()` + valida + emite si valid.

NO responsabilidades:
- Construir el `FormGroup` (eso lo hace `DynamicFormBuilderService`, owned por el consumer).
- Patch values en edit-mode (consumer hace `formGroup.patchValue(snapshot)`).
- Manejar FormArrays (consumer renderiza sub-forms para `array-*` kinds).

### 4.3 `FormSectionComponent` (presentational)

```ts
@Component({
  selector: 'app-form-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormSectionComponent<TKey extends string = string> {
  @Input({ required: true }) section!: SectionDescriptor<TKey>;
  @Input({ required: true }) formGroup!: FormGroup;
  @Input() valueSnapshot?: Signal<Record<TKey, unknown>>;
}
```

Responsabilidades:
- Renderizar header (icon + title) y body (collapsible).
- Iterar `section.fields`, filtrar por `showWhen(snapshot)`, renderizar `<app-form-field>` por cada.
- Emite el wrapper PrimeFlex prescrito: `<div class="p-fluid p-formgrid grid">…</div>`.

### 4.4 `FormFieldComponent` (presentational)

```ts
@Component({
  selector: 'app-form-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormFieldComponent<TKey extends string = string> {
  @Input({ required: true }) descriptor!: FieldDescriptor<TKey>;
  @Input({ required: true }) control!: AbstractControl;
}
```

Responsabilidades:
- Switch sobre `descriptor.kind` y renderizar el widget PrimeNG correspondiente (`pInputText`, `<p-dropdown>`, `<p-inputSwitch>`, etc.).
- Emitir `<label htmlFor>` + `<input id>` paired correctamente.
- Renderizar `<app-print-control-error>` debajo del input.
- Short-circuit en `array-*` kinds — emite un `<ng-content>` slot para que el consumer inyecte el sub-form.

Widget kinds soportados en F1 (mismos que el POC — sin agregar nuevos):
- `text` → `<input pInputText>`
- `textarea` → `<textarea pInputTextarea>`
- `currency` → `<p-inputNumber mode="currency">`
- `number` → `<p-inputNumber>`
- `integer` → `<p-inputNumber [showButtons]="true">`
- `switch` → `<p-inputSwitch>`
- `dropdown` → `<p-dropdown>`
- `array-*` → `<ng-content select="[slot=…]">`

Custom widget kinds (chip-select, customer-autocomplete, etc.) **fuera de scope** — documented as extension point en §6.

### 4.5 `PrintControlErrorComponent` (presentational)

```ts
@Component({
  selector: 'app-print-control-error',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintControlErrorComponent {
  @Input({ required: true }) control!: AbstractControl;

  /** Optional override map: { errorKey: userMessage }. */
  @Input() messages?: Record<string, string>;
}
```

Responsabilidades:
- Suscribirse a `control.statusChanges` + `control.valueChanges`.
- Renderizar el **primer error activo** del control si `control.invalid && (control.dirty || control.touched)`.
- Resolver `errorKey` → user-friendly message vía:
  1. `messages` input override (highest priority).
  2. Default catalog interno (`required` → "Campo requerido", `maxlength` → "Máximo N caracteres", etc.).
  3. Fallback genérico ("Valor inválido") si la key no está en el catalog.

Visual contract (grounded en tokens):
- Color: `var(--red-600)` o equivalente del theme PrimeNG (gap: no hay `$color-error` en `_variables.scss` — flag como Open Question).
- Spacing: `margin-top: $space-1` debajo del input.
- Font-size: `$font-size-label` (14px).
- Animación: ninguna — aparece/desaparece sin transition (simplicidad, evitar layout shift).

---

## 5. State Management

### 5.1 FormGroup ownership flow

```
Consumer (e.g. AdminUsersComponent)
  │
  │  1. injects DynamicFormBuilderService
  │  2. builds atomic controls from schema
  │  3. wraps in FormGroup (+ FormArrays owned by consumer)
  │  4. patches edit-mode values
  │
  ▼
DynamicFormComponent (smart)
  │  passes FormGroup by reference, never clones
  ▼
FormSectionComponent
  │  passes FormGroup by reference
  ▼
FormFieldComponent
  │  extracts control via formGroup.get(descriptor.key)
  ▼
PrintControlErrorComponent
   subscribes to control.statusChanges
```

**Ownership rule:** el consumer **siempre** posee el `FormGroup`. La librería compartida nunca crea, clona ni muta el FormGroup directamente — solo lo lee.

### 5.2 Signals vs Reactive Forms boundary

- **Reactive Forms (Angular Forms API):** validación, value tracking, dirty/touched state. Source of truth para el form state.
- **Signals:** `showWhen` / `showSection` predicates reactivos al value snapshot. El orchestrator deriva un `Signal<Record<TKey, unknown>>` desde `formGroup.valueChanges` vía `toSignal()` para alimentar los predicates.
- **No mixing:** los components no leen `FormGroup.value` directo — solo a través del computed signal (consistent CD behavior con OnPush).

### 5.3 Consumer responsibilities (preserved del POC)

- Build the FormGroup (vía `buildControls()`).
- Patch values for edit mode (`formGroup.patchValue(productSnapshot)`).
- Own and render FormArrays (e.g. `sizes`, `modifierGroups`).
- Handle submit (subscribe to `(submit)` output).
- Resolve dynamic dropdown options (e.g. `optionsProvider` que injecta services).

---

## 6. UI/UX

### 6.1 PrimeFlex layout primitives emitidos

`FormSectionComponent` emite el wrapper prescrito por [.claude/html-standards.md §"Form Structure"](../.claude/html-standards.md):

```html
<div class="p-fluid p-formgrid grid">
  @for (field of visibleFields(); track field.key) {
    <div class="field col-12 lg:col-{{ field.colSpan ?? 12 }} gap-2">
      <app-form-field [descriptor]="field" [control]="control(field.key)" />
    </div>
  }
</div>
```

- `colSpan` es nuevo en `FieldDescriptor` — opcional, default `12` (full width).
- El wrapper section emite el `p-fluid p-formgrid grid` UNA vez, no cada field — consistent con el HTML standard.

### 6.2 `<app-print-control-error>` visual contract

Grounded en tokens de [_variables.scss](../src/styles/_variables.scss):

| Property | Token / Value |
|---|---|
| `color` | **`$color-error` — FLAG: token no existe en `_variables.scss`. Decision needed: agregar `$color-error: #DC2626` (color de error de CLAUDE.md design system) o usar `var(--red-600)` de PrimeNG.** |
| `margin-top` | `$space-1` (4px) |
| `font-size` | `$font-size-label` (14px) |
| `font-weight` | 400 |
| `min-height` | `1.2em` (reserva espacio aún cuando no hay error — evita layout shift) |

**Open Question:** ¿agregar `$color-error` al design system o consumir desde PrimeNG variables? Recomendación: **agregar al token** ya que CLAUDE.md design system declara `#DC2626` como "Error / cancel" pero `_variables.scss` no lo expone como variable. Fixing this gap closes a small token completeness issue alongside this FDD.

### 6.3 Extension points (out-of-scope F1, documented for F2/F3)

- **Custom widget kinds**: `<app-form-field>` debe exponer un `widgetRegistry` que feature modules pueden extender con kinds custom (`chip-select`, `customer-autocomplete`, `time-window`). Patrón propuesto: `registerWidgetKind(name: string, component: Type<FormWidget>)` — diferido a FDD-030.
- **Async validators**: el current schema solo declara sync validators. Extension hook para `asyncValidators: AsyncValidatorKey[]` — diferido.
- **Cross-field validators**: `formGroup`-level validators (vs control-level) — diferido.

---

## 7. Data Flow

### 7.1 Schema authoring → submit

```
1. Author defines schema in feature module
   schemas/user-form.registry.ts:
     export const USER_FORM_SCHEMA: DynamicFormSchema<UserFormKey> = { sections: […] };

2. Consumer component injects DynamicFormBuilderService
   private builder = inject(DynamicFormBuilderService);

3. Consumer builds atomic controls
   const controls = this.builder.buildControls(USER_FORM_SCHEMA);

4. Consumer wraps + own FormArrays (none for users)
   this.userForm = this.fb.group({ ...controls });

5. Edit mode: patch existing values
   if (editing) this.userForm.patchValue(existingUser);

6. Template renders the form
   <app-dynamic-form
     [schema]="USER_FORM_SCHEMA"
     [formGroup]="userForm"
     (submit)="onSave($event)"
   />

7. User interacts → reactive forms tracks state
   FormControl.valueChanges → orchestrator's computed signal updates
                            → showWhen predicates re-evaluate
                            → sections/fields re-render with OnPush

8. User submits → orchestrator validates → emits (submit) with values
   onSave(values: Record<UserFormKey, unknown>) {
     this.userService.save(values).subscribe(...);
   }
```

---

## 8. Performance

- **OnPush** en los 4 componentes nuevos — re-render solo cuando signal/inputs cambian.
- **`array-*` kinds defer**: el rendering de FormArrays queda fuera del switch del `<app-form-field>` (ng-content slot) — el consumer decide cuándo renderizar (lazy en accordion-open, virtual scroll, etc.).
- **Signal-based visibility**: `showWhen` / `showSection` son computed signals — Angular CD skip cuando el snapshot no cambia.
- **No `*ngFor` con functions en bindings** (anti-pattern Angular) — usar `track` por field.key.
- **Validators resolution memoized**: `resolveValidators(['required', 'maxLength60'])` resuelve UNA vez por field, no en cada render.
- **No expected hotspot**: forms < 25 fields, no async validators en F1, no chart/heavy widgets. Perf budget no es preocupación primaria — solo evitar accidental N+1 re-renders.

---

## 9. Error Handling

### 9.1 Schema authoring errors (compile-time)

- TypeScript exhaustivity sobre `FieldKind` union — agregar un kind sin handling en el `switch` de `<app-form-field>` → build error.
- TypeScript exhaustivity sobre `FieldValidatorKey` — usar una key inexistente en `resolveValidators()` → build error.
- `<TKey extends string>` generic preserva safety per-form: `formGroup.get('typo')` → no compile error (FormGroup is loosely typed), PERO el schema authoring force keys del union literal del consumer.

### 9.2 Runtime validation errors

- Per-field: `<app-print-control-error>` muestra primer error activo del control (priority: input override → default catalog → fallback).
- Form-level (submit): `markAllAsTouched()` + `formGroup.invalid` check antes de emit. NO submit si invalid — el orchestrator NO emite `(submit)` output cuando el form está invalid.
- Toasts / global errors: **fuera de scope del shared library** — el consumer maneja success/error toasts vía `MessageService` post-submit.

### 9.3 Builder errors

- Schema referenciando un validator key no registrado → `resolveValidators()` lanza error en build (los tests unit capturan esto).
- Field con `defaultValue` mismatch del tipo del widget (ej. `kind: 'switch'` con `defaultValue: "string"`) → tipo de TS evita esto en authoring.

---

## 10. Accessibility

- **`htmlFor` paired con `id`** automático en `<app-form-field>`: `<label htmlFor="{{ formId }}-{{ descriptor.key }}">` + `<input id="{{ formId }}-{{ descriptor.key }}">`.
- **`aria-invalid="true"`** cuando `control.invalid && touched`.
- **`aria-describedby`** apuntando al `<app-print-control-error>` cuando hay error visible.
- **`aria-required="true"`** cuando el descriptor incluye `required` validator.
- **Focus management on submit error**: si submit con invalid form, foco al primer field inválido (per WCAG 3.3.1).
- **Color contrast**: el `$color-error` (#DC2626 propuesto) cumple WCAG AA contra fondos blancos (4.5:1).
- **Touch targets**: `<app-form-field>` emite inputs con `min-height: $touch-target-pos` (48px) — alineado con CLAUDE.md non-negotiable.

---

## 11. Testing

### 11.1 Unit specs en scope del shared library

| Target | Test scope |
|---|---|
| `shared/forms/validators/*.ts` | Per-validator: valid input → null, invalid → expected error key. ~10 specs. |
| `DynamicFormBuilderService` | `buildControls()` returns expected map; `array-*` kinds skipped; default values applied. ~5 specs. |
| `<app-print-control-error>` | Renders empty when valid; renders catalog message when invalid + touched; renders override message when `messages` input provided. ~6 specs. |
| Schema integrity | Type-level test (no runtime): exhaustivity over `FieldKind`. Optional — TS narrowing already enforces. |

### 11.2 NO en scope del shared library

- Integration tests con consumers (admin-users, admin-devices) — esos tests viven en cada feature module.
- E2E tests — diferidos a FDD-030 cuando haya un consumer migrado.
- Visual regression tests — fuera del scope F1.

### 11.3 Coverage target

- 80%+ statement coverage en `shared/forms/`. No hay legacy code que diluya el ratio — la librería es net-new.
- Sin coverage gate global todavía (per AUDIT-058 §3.1: 1 spec en todo `src/`) — pero el shared library debe ser modelo del estándar.

---

## 12. Implementation Sub-phases (F1 — Platform breakdown)

> **Naming clarification**: estas son sub-phases del **F1 — Platform** de AUDIT-059 §6. NO confundir con las 4 phases macro de AUDIT-059 (F1 Platform / F2 Adoption / F3 Extension / F4 Sweep).

### Dependency graph

```
  ┌────────────────────────────────┐
  │ (a) PrintControlError          │── independent ──┐
  └────────────────────────────────┘                 │
                                                     ▼
  ┌────────────────────────────────┐         ┌──────────────┐
  │ (b) Core Abstractions          │── ─ ── ─│ (c) Shared   │
  │     (schemas / registry /      │         │     Components│
  │     builder / validators split)│         └──────────────┘
  └────────────────────────────────┘                 │
                                                     ▼
                                          ┌─────────────────────┐
                                          │ (d) Consumer        │
                                          │     migration       │
                                          │     (product-form)  │
                                          └─────────────────────┘
```

**(a) and (b) may be developed in parallel** — they share no code. **(c)** depends on both. **(d)** depends on (c).

### Sub-phase (a) — Shared Validation widget

**Goal:** ship `<app-print-control-error>` as standalone reusable component.

**Files created:**
- `src/app/shared/forms/components/print-control-error.component.ts`
- `src/app/shared/forms/components/print-control-error.component.html`
- `src/app/shared/forms/components/print-control-error.component.scss`
- `src/app/shared/forms/components/print-control-error.component.spec.ts`
- (Optional design system addition) `src/styles/_variables.scss` — agregar `$color-error: #DC2626`.

**Acceptance criteria:**
- Renders nothing when control valid OR not touched.
- Renders first active error message via default catalog.
- `messages` input override works (test with custom key).
- ARIA attributes: `role="alert"` + `aria-live="polite"`.
- Visual: 14px font, 4px margin-top, error red color, min-height reserved.
- 6 unit specs passing.

**Estimate:** 0.5 day.

### Sub-phase (b) — Core Abstractions

**Goal:** promote schemas/registry/builder to `shared/forms/` with generic `<TKey>`.

**Files created:**
- `src/app/shared/forms/schemas/dynamic-form.schema.ts` (was `product-form.schema.ts`, generalized).
- `src/app/shared/forms/schemas/dynamic-form.types.ts` (FieldKind union, FieldValidatorKey union — same set as POC).
- `src/app/shared/forms/services/dynamic-form-builder.service.ts` (was `product-form-builder.service.ts`, with `<TKey>` generic).
- `src/app/shared/forms/validators/index.ts` — re-exports.
- `src/app/shared/forms/validators/required.validator.ts`
- `src/app/shared/forms/validators/max-length.validator.ts`
- `src/app/shared/forms/validators/positive-number.validator.ts`
- `src/app/shared/forms/validators/non-blank.validator.ts`
- `src/app/shared/forms/validators/resolve-validators.ts` (was `product-form-validators.ts`, only generic validators).
- `src/app/shared/forms/services/dynamic-form-builder.service.spec.ts`

**Acceptance criteria:**
- `DynamicFormSchema<TKey extends string>` typed properly.
- `DynamicFormBuilderService.buildControls<TKey>(schema)` returns `Record<TKey, FormControl<unknown>>`.
- `array-*` kinds excluded from build output (consumer owns).
- All 4 generic validators ported with specs.
- NO `import` from `src/app/modules/` (regla de capas verificada con grep/lint).
- 5 unit specs passing for builder.
- 10 unit specs passing for validators.

**Estimate:** 1-1.5 days.

### Sub-phase (c) — Shared Components (DynamicForm orchestrator + Section + Field)

**Goal:** ship the 3 shared components that consume (a) + (b).

**Files created:**
- `src/app/shared/forms/components/dynamic-form.component.ts` (+ .html + .scss + .spec)
- `src/app/shared/forms/components/form-section.component.ts` (+ .html + .scss + .spec)
- `src/app/shared/forms/components/form-field.component.ts` (+ .html + .scss + .spec)
- `src/app/shared/forms/index.ts` — barrel export.

**Acceptance criteria:**
- Component tree renders correctly: DynamicForm → Section → Field → PrintControlError.
- PrimeFlex wrapper `<div class="p-fluid p-formgrid grid">` emitted by Section.
- All 8 widget kinds supported (text, textarea, currency, number, integer, switch, dropdown, array-* slot).
- `showWhen` / `showSection` predicates wired via signals.
- `(submit)` output fires only when `formGroup.valid` after `markAllAsTouched`.
- OnPush in all 3 components.
- Tokens consumed (`$space-*`, `$font-size-*`, `$color-*`) — verified zero hex literales, zero off-scale px.
- 12 unit specs passing.

**Estimate:** 1-1.5 days.

### Sub-phase (d) — Existing consumer migration (product-form)

**Goal:** re-point `product-form` imports from local schemas to `shared/forms/`.

**Migration strategy decision: GRADUAL via re-export shim** — justified below.

**Approach:**
1. Move generic content from `product-form/schemas/product-form.schema.ts` to `shared/forms/schemas/dynamic-form.schema.ts` (already done in sub-phase b).
2. Keep `product-form/schemas/product-form.schema.ts` as a **re-export shim**:
   ```ts
   // product-form.schema.ts (legacy shim — to be deleted in FDD-030)
   export type ProductFormFieldKey = /* unchanged literal union */;
   export type {
     DynamicFormSchema as ProductFormSchema,
     FieldDescriptor,
     SectionDescriptor,
     // …
   } from 'src/app/shared/forms';
   ```
3. `product-form.registry.ts` keeps importing from the local shim path — zero changes to existing import statements.
4. `product-form-validators.ts` keeps only product-specific validators (none today, but reserved for future SAT/tax validators); generic ones import from `shared/forms/validators/`.
5. `product-form-builder.service.ts` becomes a thin wrapper over `DynamicFormBuilderService` (parameterized with `ProductFormFieldKey`).

**Why GRADUAL (vs big-bang delete-and-repoint):**

| Criterion | Gradual shim | Big-bang |
|---|---|---|
| Risk of regression | 🟢 Low (no import statements change) | 🔴 Medium (every product-form file touched) |
| Diff size | 🟢 Small (~50 lines) | 🔴 Large (~300 lines) |
| Reviewer cognitive load | 🟢 Easy (additive) | 🔴 High (substitutive) |
| Rollback if issues | 🟢 Trivial (remove shim, restore local) | 🔴 Revert PR |
| Production cleanliness | 🔴 Has shim file | 🟢 Clean tree |

The shim has a deletion date set in **FDD-030** — once admin-users and admin-devices migrate, the shim has no consumers and can be deleted in one PR. The shim is **explicitly transitional**, not architecture.

**Acceptance criteria:**
- `product-form` continues to compile + run with zero behavioral change.
- Existing product-form integration tests (if any) pass.
- Manual smoke test: create / edit / delete a product in dev — confirms no regression.
- Re-export shim documented with a TODO + deletion target (FDD-030).

**Estimate:** 0.5 day.

### Total estimate

| Sub-phase | Estimate | Parallel? |
|---|---|---|
| (a) PrintControlError | 0.5 day | with (b) |
| (b) Core Abstractions | 1-1.5 days | with (a) |
| (c) Shared Components | 1-1.5 days | sequential |
| (d) Consumer migration | 0.5 day | sequential |
| **Total wall-clock (1 dev)** | **3-4 days** | — |
| **Total wall-clock (parallel a+b)** | **2.5-3 days** | (a) + (b) overlap |

Alineado con AUDIT-059 §6 F1 estimate de 2-3 días.

---

## Open Questions

1. **`$color-error` token gap**: agregar al `_variables.scss` o consumir `var(--red-600)` de PrimeNG? Recomendación: agregar (closes design system completeness gap).
2. **Widget kind extension API**: definir `registerWidgetKind(name, component)` signature en F1 o diferir a F2? Recomendación: diferir — no consumer en F1 lo necesita.
3. **Async validators support**: ningún consumer en F1 lo requiere, pero reservation-form (F2 candidate) lo necesitará. Reserve `asyncValidators` key en `FieldDescriptor` ahora aunque sea unused?
4. **Tipo del `valueSnapshot`**: `Signal<Record<TKey, unknown>>` vs `Signal<Partial<Record<TKey, unknown>>>`? `Partial` es más sound (fields opcionales) pero más verboso para predicate authors.

---

## Apéndice — Files que serán creados / modificados

### Nuevos en F1
- `src/app/shared/forms/index.ts`
- `src/app/shared/forms/schemas/dynamic-form.schema.ts`
- `src/app/shared/forms/schemas/dynamic-form.types.ts`
- `src/app/shared/forms/services/dynamic-form-builder.service.ts` + `.spec.ts`
- `src/app/shared/forms/validators/{required,max-length,positive-number,non-blank}.validator.ts` (+ specs)
- `src/app/shared/forms/validators/resolve-validators.ts`
- `src/app/shared/forms/validators/index.ts`
- `src/app/shared/forms/components/dynamic-form.component.{ts,html,scss,spec.ts}`
- `src/app/shared/forms/components/form-section.component.{ts,html,scss,spec.ts}`
- `src/app/shared/forms/components/form-field.component.{ts,html,scss,spec.ts}`
- `src/app/shared/forms/components/print-control-error.component.{ts,html,scss,spec.ts}`

### Modificados (mínimo) en F1
- `src/styles/_variables.scss` — agregar `$color-error: #DC2626` (Open Question 1).
- `src/app/modules/admin/components/products/product-form/schemas/product-form.schema.ts` — convertir a re-export shim.
- `src/app/modules/admin/components/products/product-form/schemas/product-form-validators.ts` — drop generic validators, re-export from shared.
- `src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts` — wrap `DynamicFormBuilderService`.

### Fuera de scope F1 (próximos FDDs)
- 13 forms hand-rolled → FDD-030 (F2 Adoption).
- ESLint rule custom → FDD-030 (F2 Adoption).
- `.form-field` BEM cleanup → FDD-031 (F3 Extension).

---

## Changelog

### 2026-05-26 — Initial design

- F1 — Platform fully designed in 3 deliverables + 1 migration sub-phase.
- 4 Open Questions documented.
- Migration strategy locked: gradual re-export shim (vs big-bang).
- Estimate: 2.5-3 days wall-clock with (a) + (b) parallelized.
- Out of Scope explicitly enumerated; future FDD numbering reserved (030/031/032).
