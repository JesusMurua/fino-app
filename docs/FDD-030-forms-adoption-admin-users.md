# FDD-030 — Forms Adoption (admin-users + ESLint enforcement)

**Fecha:** 2026-05-26
**Branch:** `development`
**Status:** Design — pending implementation approval
**Alcance:** Frontend (Angular 18 + PrimeNG 17 + PrimeFlex 3). Primera migración de un consumer real al shared dynamic-form library + custom ESLint rule que bloquea `<form>` hand-rolled en el módulo admin.

---

## 1. Executive Summary

Migrar el **primer consumer real** (`admin-users.component`) del módulo admin al shared library `<app-dynamic-form>` shippeado en FDD-029 F1, y plantar la **regla ESLint** que previene la erosión del patrón en futuras features. El form de admin-users ya es candidato top per [AUDIT-059 §4.1](AUDIT-059-forms-and-ui-consistency.md#41--admin-users-component--highest-roi) ("Highest ROI") — 280-line dialog, 6 atomic fields, 4 conditional branches, 0 validation feedback.

**Deliverables (3 piezas, scope cerrado):**

1. **Schema autoría**: `admin-users.form.ts` declara los 6 fields + branch assignment como `kind: 'array'` slot.
2. **Component refactor**: `admin-users.component.{ts,html}` consume `DynamicFormBuilderService` + renderiza vía `<app-dynamic-form>`. Branch assignment como sub-form proyectado en el slot.
3. **ESLint rule**: `@angular-eslint/template/no-raw-form` custom rule prohíbe `<form>` element fuera de un allow-list configurable.

**Scope NO incluido en este FDD (rebalanceo respecto a AUDIT-059 §6 F2):**
- `admin-devices` migration — diferido a **FDD-031** (requiere extensions al shared library: `options: Signal<...>` reactivas para dynamic dropdown filtering por tenant features). Su scope ameritó separación.
- `reservation-form` migration — diferido a FDD-031+ (introduce custom widget kinds — extension API queda diferida).

**Estimación:** 1.5–2 días (a + b: ~1 día, c: ~0.5 día, smoke gate manual: ~0.25 día).

### Closes / Related

- Materializa [AUDIT-059 §4.1 "admin-users — Highest ROI"](AUDIT-059-forms-and-ui-consistency.md#41--admin-users-component--highest-roi) y [§5 P1 item "ESLint rule custom"](AUDIT-059-forms-and-ui-consistency.md#sección-5--action-plan-priorizado).
- Materializa [FDD-029 §3.3 Out of Scope](FDD-029-metadata-driven-forms.md#33-out-of-scope): "Custom ESLint rule → FDD-030" y "Migration of 13 hand-rolled forms → FDD-030".
- Precede a **FDD-031** (admin-devices con extensions del shared library) y **FDD-032** (BEM cleanup / hex sweep).
- **No** dissolve el shim del product-form (`product-form-validators.ts` + `product-form.schema.ts`) — diferido hasta que el template del product-form migre a `<app-dynamic-form>` (FDD-031+).

---

## 2. Current State

### 2.1 admin-users form shape (status pre-F2)

[src/app/modules/admin/components/users/admin-users.component.ts:66-73](../src/app/modules/admin/components/users/admin-users.component.ts#L66-L73) — FormGroup actual:

```ts
readonly userForm: FormGroup = this.fb.group({
  name:     ['', [Validators.required, Validators.maxLength(100)]],
  roleId:   [UserRoleId.Cashier, Validators.required],
  pin:      [''],
  email:    [''],
  password: [''],
  isActive: [true],
});
```

[src/app/modules/admin/components/users/admin-users.component.html:125-263](../src/app/modules/admin/components/users/admin-users.component.html#L125-L263) — dialog template, 139 líneas de scaffolding repetido:

- 6 atomic fields × ~12 líneas cada uno.
- 4 conditional `@if` branches: `usesPin()`, `usesEmail()`, `editingUser()`, `isOwner() && editingUser()`.
- Branch assignment como `<p-table>` inline con 3 columns (checkbox, branch name + matrix badge, radio for default).
- **Zero validation feedback** — solo `[disabled]="userForm.invalid"` en submit. El usuario no ve qué campo falta.

### 2.2 Conditional logic actual (template `@if` → schema `showWhen`)

| Condition actual (template) | Source signal | Migration target (schema) |
|---|---|---|
| `@if (usesPin())` | computed sobre `selectedRole()` | `showWhen: (s) => POS_ROLES_WITH_PIN.has(s['roleId'] as UserRoleId)` |
| `@if (usesEmail())` | computed sobre `selectedRole()` | `showWhen: (s) => POS_ROLES_WITH_EMAIL.has(s['roleId'] as UserRoleId)` |
| `@if (editingUser())` | signal `editingUser` | NO migra al schema — es UI state que vive en el consumer. `isActive` field gated via `showWhen` reading consumer-provided snapshot extension |
| `@if (isOwner() && editingUser() && availableBranches().length > 0)` | computed + signals | NO migra — branch assignment es kind:'array' slot, consumer proyecta condicionalmente |

### 2.3 F1 Platform delivered (input ready)

Confirmado vía `git log` post-FDD-029 F1:
- `6295b9c feat(forms): add shared platform — PrintControlError + core abstractions (FDD-029 a+b)`
- `eeaf15c feat(forms): add DynamicForm orchestrator + migrate product-form validators to shared (FDD-029 c+d)`

Shared API disponible (vía [src/app/shared/forms/index.ts](../src/app/shared/forms/index.ts)):

- Types: `DynamicFormSchema<TKey>`, `FieldDescriptor<TKey>`, `SectionDescriptor<TKey>`, `ValidatorRef`, `FormValueSnapshot<TKey>`.
- Service: `DynamicFormBuilderService.buildControls<TKey>(schema)`.
- Components: `<app-dynamic-form>`, `<app-form-section>`, `<app-form-field>`, `<app-print-control-error>`.
- Validators: `requiredValidator`, `nonBlankValidator`, `positiveNumberValidator`, `maxLengthValidator(n)`, `minLengthValidator(n)`, `minValidator(n)`, `maxValidator(n)`, `resolveValidators(refs)`.

---

## 3. Requirements

### 3.1 Functional requirements

- **F-1** `admin-users` dialog renderiza enteramente vía `<app-dynamic-form>` para los 6 atomic fields.
- **F-2** Conditional rendering (usesPin / usesEmail) reemplazado por `showWhen` predicates en el schema.
- **F-3** Branch assignment subform proyectado en `kind: 'array'` slot. Consumer mantiene ownership del state (`selectedBranchIds`, `defaultBranchId` signals) + del rendering del `<p-table>`.
- **F-4** Edit-mode hydration vía `formGroup.patchValue(...)` — mismo patrón que el POC product-form (no cambia).
- **F-5** Validation feedback **nuevo** — cada field muestra error vía `<app-print-control-error>` (mejora user-facing real vs pre-F2).
- **F-6** `(submitted)` Output dispara `saveUser()` actual del consumer. Submit invalid → focus al primer field invalid (per FDD-029 §10 / WCAG 3.3.1).
- **F-7** Custom ESLint rule `@angular-eslint/template/no-raw-form` bloquea `<form>` element en `.component.html` files dentro del módulo `src/app/modules/admin/`. Allow-list inicial vacía para admin (todo migrar progresivamente).

### 3.2 Non-functional requirements

- **NF-1** Zero behavioral regression en admin-users — smoke gate manual verifica create + edit + role-switch + branch assignment.
- **NF-2** Schema typed con literal union `AdminUsersFormKey` para preservar TypeScript exhaustivity per field key.
- **NF-3** Schema autoría en archivo separado (`admin-users.form.ts`) — NO inline en component file (preserva la separación de capas del patrón POC).
- **NF-4** SCSS del component dialog content puede dropearse (`.form-field`, `.form-field__label`, `.form-field__input` re-declaraciones) — el shared library las provee. CleanupBEM duplicate scope.
- **NF-5** Tokens-only SCSS para cualquier styling residual.
- **NF-6** ESLint rule pluggable via config `allowList: string[]` de globs.

### 3.3 Out of Scope

Defer explícito:

- **admin-devices migration** → FDD-031 (requiere shared library extension: `options` reactivo basado en signals — feature gating + cash-register filtering).
- **reservation-form migration** → FDD-031+ (introduce custom widget kinds para chip-select de mesas).
- **`registerWidgetKind` extension API** → diferido más allá de FDD-031.
- **Async validators** → diferido.
- **product-form shim dissolution** → diferido a FDD-032+ cuando el template del product-form migre.
- **BEM duplication cleanup global** (`.form-field`, `.btn-primary`, `.settings-card`) → FDD-032 (F3 Extension).
- **Hex literal sweep** en `styles.scss` y component SCSS → FDD-032.
- **Off-scale spacing + sub-16px font-size codemods** → FDD-033 (F4 Sweep).
- **Unit specs para admin-users component** — smoke manual sigue siendo verification gate. Spec coverage en F4 Sweep.

---

## 4. Component Architecture

### 4.1 Schema authoring — `admin-users.form.ts`

Nuevo archivo: [src/app/modules/admin/components/users/admin-users.form.ts](../src/app/modules/admin/components/users/admin-users.form.ts) (a crear).

```ts
import { DynamicFormSchema } from 'src/app/shared/forms';
import { UserRoleId } from '../../../../core/enums';

/** Closed union of fields managed by the dynamic form. Branch
 *  assignment is NOT here — it lives in the consumer as a separate
 *  FormArray-like state surface, projected into the array slot. */
export type AdminUsersFormKey =
  | 'name'
  | 'roleId'
  | 'pin'
  | 'email'
  | 'password'
  | 'isActive';

/** Roles that authenticate via 4-digit PIN. */
const PIN_ROLES: ReadonlySet<UserRoleId> = new Set([
  UserRoleId.Cashier,
  UserRoleId.Waiter,
  UserRoleId.Host,
]);

/** Roles that authenticate via email + password. */
const EMAIL_ROLES: ReadonlySet<UserRoleId> = new Set([
  UserRoleId.Owner,
  UserRoleId.Manager,
]);

export const ADMIN_USERS_FORM_SCHEMA: DynamicFormSchema<AdminUsersFormKey> = {
  sections: [
    {
      id: 'identity',
      title: 'Identidad',
      icon: 'pi pi-user',
      defaultOpen: true,
      fields: [
        {
          key: 'name',
          kind: 'text',
          label: 'Nombre',
          placeholder: 'Nombre completo',
          defaultValue: '',
          validators: ['required', { key: 'maxLength', n: 100 }],
        },
        {
          key: 'roleId',
          kind: 'dropdown',
          label: 'Rol',
          defaultValue: UserRoleId.Cashier,
          validators: ['required'],
          // options resolved by consumer at runtime — see component refactor below
        },
      ],
    },
    {
      id: 'credentials',
      title: 'Credenciales',
      icon: 'pi pi-key',
      defaultOpen: true,
      fields: [
        {
          key: 'pin',
          kind: 'text',
          label: 'PIN (4 dígitos)',
          placeholder: '4 dígitos',
          defaultValue: '',
          showWhen: (s) => PIN_ROLES.has(s['roleId'] as UserRoleId),
        },
        {
          key: 'email',
          kind: 'text',
          label: 'Email',
          placeholder: 'correo@ejemplo.com',
          defaultValue: '',
          showWhen: (s) => EMAIL_ROLES.has(s['roleId'] as UserRoleId),
        },
        {
          key: 'password',
          kind: 'text',
          label: 'Contraseña',
          placeholder: 'Mínimo 6 caracteres',
          defaultValue: '',
          showWhen: (s) => EMAIL_ROLES.has(s['roleId'] as UserRoleId),
        },
      ],
    },
    {
      id: 'status',
      title: 'Estado',
      icon: 'pi pi-circle',
      defaultOpen: true,
      // The whole section only renders in edit mode — consumer surfaces
      // `editingUser` flag in the snapshot under a reserved key `_edit`.
      showSection: (s) => s['_edit'] === true,
      fields: [
        {
          key: 'isActive',
          kind: 'switch',
          label: 'Activo',
          defaultValue: true,
        },
      ],
    },
  ],
};
```

**Decisión: roleOptions desde consumer, no schema.** Los `dropdown` options para `roleId` son product-specific (`UserRoleId` enum con labels en español + emoji icons + colors). Se inyectan en runtime del schema via patching pre-render — ver §4.2.

**Decisión: `_edit` reserved key.** El consumer expande el snapshot con un flag `_edit: boolean` para que `showSection` del status section pueda gatear. Pattern documentado: el snapshot puede contener keys reservadas con prefix `_` que el consumer alimenta separado del FormGroup. Worth flag — esto se ve mejor como un input separado `formMode` o similar; ver Open Questions.

### 4.2 Consumer refactor — `admin-users.component.ts`

Cambios principales:

```ts
// Add to imports
import { DynamicFormBuilderService, DynamicFormSchema, DynamicFormComponent } from 'src/app/shared/forms';
import { ADMIN_USERS_FORM_SCHEMA, AdminUsersFormKey } from './admin-users.form';

@Component({
  // …
  imports: [
    DialogModule,
    DynamicFormComponent,
    // existing imports that are STILL needed for non-form surfaces:
    InputSwitchModule, // toggle on user cards
    TableModule,       // branch assignment + user cards table
    // REMOVED: ReactiveFormsModule, DropdownModule, InputTextModule, PasswordModule
    //         (now consumed inside <app-dynamic-form>)
  ],
})
export class AdminUsersComponent implements OnInit {
  private readonly builder = inject(DynamicFormBuilderService);

  // Replace the manual fb.group(...) with:
  readonly userForm: FormGroup = this.fb.group(
    this.builder.buildControls<AdminUsersFormKey>(ADMIN_USERS_FORM_SCHEMA),
  );

  // Schema with role options injected at runtime — TypeScript exhaustive
  // patching, no mutation of the imported constant.
  readonly schema: DynamicFormSchema<AdminUsersFormKey> = this.injectRoleOptions(
    ADMIN_USERS_FORM_SCHEMA,
    this.roleOptions,
  );

  // Snapshot pipeline: merges FormGroup.value with `_edit` flag from
  // `editingUser` signal.
  readonly formSnapshot = computed<Record<string, unknown>>(() => ({
    ...this.userForm.value,
    _edit: this.editingUser() !== null,
  }));

  @ViewChild(DynamicFormComponent) private dynamicForm!: DynamicFormComponent<AdminUsersFormKey>;

  // Triggered by user clicking "Guardar" — delegates to DynamicForm.
  onSaveClick(): void {
    this.dynamicForm.submit();
  }

  // (submitted) handler receives validated value.
  onFormSubmitted(value: Record<AdminUsersFormKey, unknown>): void {
    // existing saveUser logic unchanged — reads from value instead of this.userForm.value
    // …
  }

  private injectRoleOptions(
    base: DynamicFormSchema<AdminUsersFormKey>,
    options: RoleOption[],
  ): DynamicFormSchema<AdminUsersFormKey> {
    return {
      sections: base.sections.map(section => ({
        ...section,
        fields: section.fields.map(field =>
          field.key === 'roleId' ? { ...field, options } : field
        ),
      })),
    };
  }
}
```

### 4.3 Consumer template refactor — `admin-users.component.html`

Reemplaza el `<form>` actual (líneas 125-264) por:

```html
<p-dialog ...>
  <app-dynamic-form
    [schema]="schema"
    [formGroup]="userForm"
    [formId]="'admin-users-form'"
    [valueSnapshot]="formSnapshot"
    (submitted)="onFormSubmitted($event)"
  >
    <!-- Branch assignment subform projected via array slot. -->
    <!-- NOTE: schema currently does NOT declare branchAssignment as a -->
    <!--       kind: 'array' field. Decision below in Open Questions. -->
  </app-dynamic-form>

  <!-- Branch assignment lives OUTSIDE the dynamic form for F2 — -->
  <!-- consumer-owned <p-table> rendered conditionally below the form. -->
  @if (isOwner() && editingUser() && availableBranches().length > 0) {
    <div class="branch-assignment">
      <h3>Sucursales asignadas</h3>
      <p-table [value]="availableBranches()" dataKey="id">
        <!-- existing branch-table template, unchanged from current implementation -->
      </p-table>
    </div>
  }

  <ng-template pTemplate="footer">
    <button type="button" class="btn-ghost" (click)="showDialog.set(false)">Cancelar</button>
    <button
      type="button"
      class="btn-primary"
      [disabled]="userForm.invalid || savingUser()"
      (click)="onSaveClick()"
    >
      @if (savingUser()) { <i class="pi pi-spin pi-spinner"></i> }
      Guardar
    </button>
  </ng-template>
</p-dialog>
```

### 4.4 ESLint rule — `eslint-plugin-local/no-raw-form.ts`

Custom Angular template rule. Implementation outline:

```ts
import { TmplAstElement } from '@angular/compiler';
import { TemplateRuleListener, TemplateRuleMetaData } from '@angular-eslint/utils';

export const noRawFormRule: TemplateRuleMetaData = {
  name: 'no-raw-form',
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid <form> elements outside the allow-list (use <app-dynamic-form> instead).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowList: { type: 'array', items: { type: 'string' } },
        },
      },
    ],
    messages: {
      rawFormForbidden:
        '<form> is forbidden here. Use <app-dynamic-form> from src/app/shared/forms instead. File matched no entry in allowList.',
    },
  },
  create(context): TemplateRuleListener {
    const allowList: string[] = context.options[0]?.allowList ?? [];
    const filename = context.getFilename();
    const allowed = allowList.some(glob => micromatch.isMatch(filename, glob));
    if (allowed) return {};

    return {
      Element$1(node: TmplAstElement) {
        if (node.name === 'form') {
          context.report({
            node: node as any,
            messageId: 'rawFormForbidden',
          });
        }
      },
    };
  },
};
```

**Allow-list inicial** (`.eslintrc.json` config):

```json
{
  "@angular-eslint/template/no-raw-form": [
    "error",
    {
      "allowList": [
        "**/login/**/*.component.html",
        "**/register/**/*.component.html",
        "**/pin/**/*.component.html",
        "**/product-form/**/*.component.html",
        "**/admin-devices/**/*.component.html",
        "**/reservation-form/**/*.component.html",
        "**/admin-promotions/**/*.component.html",
        "**/kiosk/**/*.component.html",
        "**/product-detail/**/*.component.html"
      ]
    }
  ]
}
```

Justification:
- Auth surfaces (login, register, pin) — defer migration indefinitely (low ROI, isolated pattern).
- product-form, admin-devices, reservation-form — pending FDD-031+ migrations.
- Other forms in `kiosk/`, `admin-promotions/`, `product-detail/` — pending audit + classification.

As each form migrates, its allow-list entry is removed in the same commit. Lock-in: a NEW form cannot be added with raw `<form>` because no allow-list entry exists for it.

---

## 5. State Management

### 5.1 FormGroup ownership flow (per FDD-029 §5.1)

```
admin-users.component (consumer)
  │
  │  1. builder.buildControls(SCHEMA) → atomic FormControls map
  │  2. fb.group(...) → FormGroup
  │  3. patchValue(existingUser) in openEditDialog()
  │
  ▼
<app-dynamic-form [schema] [formGroup] [formId] [valueSnapshot]>
  │ passes FormGroup by reference (no clone)
  ▼
sections + fields + print-control-error
```

### 5.2 Snapshot pipeline

`formSnapshot: Signal<Record<string, unknown>>` computed from:
- `this.userForm.value` (form state)
- `this.editingUser()` (UI state — surface as `_edit` flag)

Pass via `[valueSnapshot]="formSnapshot"`. `showSection` / `showWhen` predicates read `_edit` to gate the status section.

### 5.3 Branch assignment — OUTSIDE the dynamic form

Branch assignment state (`selectedBranchIds`, `defaultBranchId`, `availableBranches` signals) **stays in the consumer**. The branch `<p-table>` renders adjacent to the dynamic form, gated by the same conditions as today. NOT projected into a dynamic-form array slot for F2 (worth migrating in a follow-up FDD if patterns emerge).

Rationale: branch assignment uses a `<p-table>` with row-level state (checkbox + radio per row), which doesn't map cleanly to a `kind: 'array'` slot without bespoke wrapping. Forcing it into the dynamic form would require either a new widget kind or a complex projection contract. Both exceed F2 scope.

---

## 6. UI/UX

### 6.1 Visual diff vs pre-F2

| Surface | Before (POC hand-rolled) | After (F2 migrated) |
|---|---|---|
| Field layout | Custom `.form-field` BEM, vertical stack, ad-hoc spacing | PrimeFlex grid (`p-fluid p-formgrid grid` + `field col-12 md:col-12 lg:col-12`) |
| Validation feedback | None — submit button disabled silently | `<app-print-control-error>` below each input |
| Touch targets | Mixed (44px inputs in places) | `min-height: $touch-target-pos` (48px) on every input via shared SCSS |
| Section structure | None (flat fields) | Accordion-style `<details>/<summary>` sections (Identidad / Credenciales / Estado) |
| Conditional fields | `@if` blocks in template | `showWhen` predicates in schema |
| ARIA wiring | Manual / partial | Automatic (`aria-required`, `aria-invalid`, `aria-describedby`) |

### 6.2 Token consumption

All styling sourced from `_variables.scss` via the shared library. The consumer's `.scss` shrinks by ~100 lines:

- DELETE `.form-field`, `.form-field__label`, `.form-field__input`, `.user-form` (redundant — shared library declares equivalents).
- KEEP `.user-card`, `.stats-row`, `.stat-card`, `.role-badge`, `.status-badge`, `.toggle-wrap` etc. (these are list/card UI, NOT form-field UI).

---

## 7. Data Flow

```
1. AdminUsersComponent constructor:
   - inject DynamicFormBuilderService
   - build userForm via builder.buildControls(SCHEMA)

2. ngOnInit:
   - subscribe userForm.roleId.valueChanges → update selectedRole signal
     (UNCHANGED — drives consumer UI like role badges; the schema's
     showWhen reads roleId directly from snapshot)

3. openNewDialog():
   - editingUser.set(null)
   - userForm.reset(defaults from schema)
   - selectedBranchIds / defaultBranchId reset
   - showDialog.set(true)

4. openEditDialog(user):
   - editingUser.set(user)
   - userForm.patchValue({ name, roleId, pin: '', email, password: '', isActive })
   - loadUserBranches(user.id) if isOwner
   - showDialog.set(true)

5. User types into form fields:
   - FormControl.valueChanges → toSignal in DynamicForm → snapshot updates
   - showWhen predicates re-evaluate → conditional fields appear/disappear
   - Validation errors surface via <app-print-control-error>

6. User clicks "Guardar":
   - Consumer calls this.dynamicForm.submit()
   - DynamicForm marks all touched, checks validity
     - valid → emits (submitted) with typed value
     - invalid → focuses first invalid input, NO emit

7. onFormSubmitted(value):
   - existing saveUser logic, reading from `value` (not this.userForm.value)
   - if Owner → branch assignment async save via userService.assignBranches
   - reload users + close dialog
```

---

## 8. Performance

- `<app-dynamic-form>` OnPush (already shipped in F1). admin-users component itself stays OnPush.
- Snapshot signal computed from `userForm.valueChanges` (via toSignal inside DynamicForm).
- Schema authoring is one-shot at module load — no per-render overhead.
- Role dropdown options injected once at construction — no per-render mutation.
- Per AUDIT-058 §3.1: no spec coverage for admin-users — no perf benchmark to compare against. Smoke gate manual is the only acceptance signal.

---

## 9. Error Handling

### 9.1 Compile-time

- TypeScript exhaustivity over `AdminUsersFormKey` — adding a field requires extending the union.
- Schema `validators` array uses `ValidatorRef` union — typos caught at compile.

### 9.2 Runtime

- Per-field validation via `<app-print-control-error>` (shared library default catalog: `required` → "Campo requerido", `maxlength` → "Máximo N caracteres", etc.).
- Form-level invalid on submit → no emit, focus first invalid (per FDD-029 §10).
- Save API failure → existing toast pattern preserved (`MessageService.add({ severity: 'error', summary: 'Error al guardar usuario' })`).

### 9.3 ESLint rule failures

- Detected at lint time (pre-commit hook or CI). Build does NOT block — eslint runs as separate step.
- Failure message: `'<form> is forbidden here. Use <app-dynamic-form> from src/app/shared/forms instead.'`

---

## 10. Accessibility

Improvements vs pre-F2:

- `htmlFor` ↔ `id` paired automatically by `FormFieldComponent` (was manual in POC, partial in admin-users).
- `aria-required` derived from `validators` array containing `'required'`.
- `aria-invalid` reactive to control state.
- `aria-describedby` wired to `<app-print-control-error>` id.
- Focus management on submit invalid (FDD-029 §10 / WCAG 3.3.1) — admin-users had NONE pre-F2.
- Touch target floor (48px) on every input.

---

## 11. Testing

### 11.1 Smoke verification (manual, pre-merge)

Mirror del patrón establecido en [FDD-029 smoke checklist](FDD-029-smoke-checklist.md). New `docs/FDD-030-smoke-checklist.md` to ship alongside the migration commit:

- Happy path: create user with Cashier role → PIN field visible → save → user appears.
- Role switch: change Cashier → Manager → expect PIN field hidden, email + password visible.
- Validation: leave name empty → expect "Campo requerido" inline + submit focuses name field.
- Validation: name >100 chars → expect "Máximo 100 caracteres".
- Edit mode: open existing user → status section visible → toggle isActive → save → persistence.
- Branch assignment: Owner editing user → branch table renders outside dynamic form → check/radio interactions work.

### 11.2 ESLint rule unit tests

Custom rule ships with spec file:
- Valid: `<form>` in allowed path → no error.
- Invalid: `<form>` in disallowed path → error reported.
- Valid: `<app-dynamic-form>` in any path → no error.
- Config validation: allow-list missing → default empty (all forbidden).

### 11.3 NO in scope

- Unit specs for admin-users component — deferred to F4 Sweep (AUDIT-058 §3.1 documents 1 spec in src/, full coverage is a separate initiative).
- E2E test for admin-users dialog — deferred.

---

## 12. Implementation Sub-phases

> **Naming clarification**: F2 — Adoption phase per AUDIT-059 §6 splits across **FDD-030 (this doc)** + **FDD-031 (admin-devices, pending)**. Internal sub-phases of FDD-030: (a) → (b) → (c) → (d).

### Dependency graph

```
  ┌──────────────────────────────┐
  │ (a) Schema authoring         │── independent ──┐
  └──────────────────────────────┘                 │
                                                   ▼
  ┌──────────────────────────────┐         ┌──────────────────┐
  │ (b) Consumer refactor        │── ── ── ─│ (c) ESLint rule  │
  │     admin-users.component    │         │                  │
  └──────────────────────────────┘         └──────────────────┘
                                                   │
                                                   ▼
                                          ┌──────────────────┐
                                          │ (d) Smoke gate    │
                                          │     (manual)      │
                                          └──────────────────┘
```

**(a) and (c) parallelizable** with each other — schema authoring has no dependency on the ESLint rule. **(b)** depends on (a). **(d)** depends on (b) + (c) landed.

### Sub-phase (a) — Schema authoring (`admin-users.form.ts`)

**Goal:** ship the type-safe schema describing the form structure.

**Files created:**
- `src/app/modules/admin/components/users/admin-users.form.ts`

**Acceptance:**
- Exports `ADMIN_USERS_FORM_SCHEMA: DynamicFormSchema<AdminUsersFormKey>`.
- Exports `AdminUsersFormKey` literal union.
- 3 sections (identity, credentials, status).
- 6 atomic fields (name, roleId, pin, email, password, isActive).
- `showWhen` predicates for pin, email, password.
- `showSection` for status (gated on `_edit` snapshot key).
- `ng build` passes (validators array compiles against `ValidatorRef` union).

**Estimate:** 0.5 day.

### Sub-phase (b) — Consumer refactor

**Goal:** replace hand-rolled dialog form with `<app-dynamic-form>`.

**Files modified:**
- `src/app/modules/admin/components/users/admin-users.component.ts`
- `src/app/modules/admin/components/users/admin-users.component.html`
- `src/app/modules/admin/components/users/admin-users.component.scss`

**Acceptance:**
- Imports `DynamicFormBuilderService`, `DynamicFormComponent`, `ADMIN_USERS_FORM_SCHEMA`, `AdminUsersFormKey`.
- FormGroup built via `builder.buildControls(SCHEMA)` (no manual `fb.group({ ... })`).
- Template dialog body replaced with `<app-dynamic-form>` element.
- Branch assignment `<p-table>` stays outside the form, conditionally rendered.
- Submit button calls `dynamicForm.submit()` instead of `saveUser()` direct.
- `onFormSubmitted(value)` handler replaces direct read of `this.userForm.value`.
- SCSS file: delete redundant `.form-field`, `.form-field__label`, `.form-field__input`, `.user-form` rules (≈100 lines removed).
- `ng build` passes.

**Estimate:** 0.5 day.

### Sub-phase (c) — ESLint rule

**Goal:** ship custom `no-raw-form` rule + wire into project lint config.

**Files created:**
- `eslint-rules/no-raw-form.ts` (new — local rules folder)
- `eslint-rules/no-raw-form.spec.ts`
- Update `.eslintrc.json` to register the rule + add allow-list config.

**Plug-in approach:** use `eslint-plugin-local` or inline rule via `--rulesdir` flag. The rule itself imports `@angular-eslint/utils` to handle template AST.

**Acceptance:**
- Rule detects `<form>` element in any `.component.html` file.
- Allow-list config supports glob patterns.
- Spec tests cover allowed + forbidden cases.
- `npm run lint` runs the rule across the codebase. Expect zero errors initially (allow-list covers all current `<form>` occurrences).
- A test PR that adds `<form>` to a new component (outside allow-list) triggers a lint error.

**Estimate:** 0.5 day.

### Sub-phase (d) — Smoke gate (manual)

**Goal:** verify zero behavioral regression in admin-users via the smoke checklist (see §11.1).

**File created:**
- `docs/FDD-030-smoke-checklist.md` (mirror of FDD-029's smoke checklist pattern).

**Acceptance:**
- All 6 checklist items pass.
- If any fails: hot-fix or revert sub-phase (b) commit.

**Estimate:** 0.25 day.

### Total estimate

| Sub-phase | Estimate | Parallel? |
|---|---|---|
| (a) Schema authoring | 0.5 day | with (c) |
| (b) Consumer refactor | 0.5 day | sequential after (a) |
| (c) ESLint rule | 0.5 day | with (a) |
| (d) Smoke gate | 0.25 day | sequential after (b) + (c) |
| **Total wall-clock (1 dev)** | **1.5-1.75 days** | — |

Slightly below AUDIT-059 §6 F2 estimate (3-4 days) because admin-devices is deferred to FDD-031.

---

## Open Questions

1. **`_edit` reserved snapshot key vs explicit `formMode` Input on `<app-dynamic-form>`**
   The schema uses `s['_edit']` to gate the status section. This works but smells — reserved-key conventions invite collisions with real field keys. Cleaner alternative: add an optional `formMode: 'create' | 'edit'` Input to `<app-dynamic-form>` that flows down to predicates as a separate context object.
   *Recommendation:* defer — implement with `_edit` reserved key now, refactor to `formMode` Input if a second consumer needs it (Rule of 3 again).

2. **Role options injection — schema mutation vs runtime patching**
   Current design injects roleOptions via `injectRoleOptions(SCHEMA, options)` at construction. Functional but creates a shallow-clone of the schema. Alternative: `<app-form-field>` could accept a `[optionsOverrides]: Record<TKey, readonly Option[]>` input that overrides descriptor options at render time. More invasive change to F1 surface.
   *Recommendation:* go with the construction-time patch for F2. Revisit if more consumers need dynamic options (admin-devices in FDD-031 has the same need + reactive).

3. **Allow-list maintenance burden**
   ESLint rule's allow-list will accumulate entries as features land. Each entry removed in its migration commit. Risk: drift between allow-list and reality. Could be mitigated by lint rule warning when an allow-listed file has NO `<form>` in it (telling us it can be removed).
   *Recommendation:* ship without the "stale allow-list" warning. Re-evaluate in F3.

4. **Branch assignment subform — `kind: 'array'` slot vs adjacent**
   F2 puts branch assignment OUTSIDE the dynamic form. Could be inside via array slot + custom subform. Tradeoff: inside means visually unified, outside means consumer-owned state stays cleaner.
   *Recommendation:* keep outside for F2. Revisit when multi-row complex array UIs become a recurring pattern.

---

## Apéndice — Archivos creados / modificados

### Nuevos en FDD-030
- `docs/FDD-030-forms-adoption-admin-users.md` (this doc)
- `src/app/modules/admin/components/users/admin-users.form.ts`
- `eslint-rules/no-raw-form.ts` (or equivalent local-plugin file)
- `eslint-rules/no-raw-form.spec.ts`
- `docs/FDD-030-smoke-checklist.md`

### Modificados en FDD-030
- `src/app/modules/admin/components/users/admin-users.component.ts`
- `src/app/modules/admin/components/users/admin-users.component.html`
- `src/app/modules/admin/components/users/admin-users.component.scss`
- `.eslintrc.json` (register rule + allow-list)

### Fuera de scope (próximos FDDs)
- `admin-devices` migration with shared library extensions (reactive options) → FDD-031.
- `reservation-form` migration with custom widget kinds → FDD-031+.
- product-form template migration → FDD-032+.
- BEM/hex/spacing/font-size sweeps → FDD-032 / FDD-033 (F3 + F4).

---

## Changelog

### 2026-05-26 — Initial design

- Vector P1 (admin-users + ESLint rule) — fully designed.
- Vector P1 admin-devices — deferred to FDD-031 (requires shared library extensions).
- 4 sub-phases (a/b/c/d) with parallelization hints.
- 4 Open Questions documented (`_edit` reserved key, options injection, allow-list maintenance, branch subform location).
- Migration smoke gate inherits pattern from FDD-029.
- Estimate: 1.5-1.75 days wall-clock with (a)+(c) parallelized.
