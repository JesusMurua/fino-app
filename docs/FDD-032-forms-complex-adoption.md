# FDD-032 — Forms Complex Adoption (admin-devices + reservation-form)

**Fecha:** 2026-05-27
**Branch:** `development`
**Status:** Design — pending implementation approval
**Alcance:** Frontend (Angular 18 + PrimeNG 17). Migración de los 2 consumers complejos pendientes de F2 — `admin-devices` y `reservation-form` — al shared dynamic-form library (FDD-029/031). Incluye una pequeña extensión platform (banner + `updateOn` descriptor) requerida por reservation-form.

---

## 1. Executive Summary

FDD-032 cierra la fase **F2 — Adoption** de [AUDIT-059 §6](AUDIT-059-forms-and-ui-consistency.md#sección-6--resumen-ejecutivo). Migra los **2 consumers complejos restantes** que requerían el extension surface de [FDD-031](FDD-031-forms-platform-extensions.md), más una **extensión platform pequeña** (`<app-print-form-error>` banner + `FieldDescriptor.updateOn` field) necesaria por reservation-form pero no shippeada en FDD-031.

**Deliverables (3 categorías, scope explícitamente triple):**

1. **Platform extension** (Phase 1):
   - `<app-print-form-error>` banner para cross-field validator errors a nivel FormGroup.
   - `FieldDescriptor.updateOn?` field para evitar API spam en async validators.
   - Catalog map extraído a `error-catalog.ts` (Rule-of-3 entre PrintControlError + PrintFormError).
2. **admin-devices migration** (Phase 2): 2 forms (activation code generator + fleet edit dialog) usando reactive options para tenant-feature filtering y cash register filtering.
3. **reservation-form migration** (Phase 3): 1 form migrated under a hybrid pattern — `<app-dynamic-form>` orchestrates the kinds it supports (text, dropdown, textarea, chip-select); raw widgets (`<p-calendar>`, partySize stepper, `CustomerSelectorComponent`) bind to the same FormGroup for fields that lack a shareable kind. Ships the `chip-select` custom widget + `ReservationAvailabilityService` async validator with `updateOn: 'blur'`. Customer-autocomplete widget, date-range cross-field, and banner usage are NOT shipped — see §4.3 and the Known Deviations section for the corrections made on 2026-05-27 after verifying against production code.

Más cleanup en Phase 4 (ESLint allow-list reduction + product-form shim TODO comments).

**Estimación:** 5.5-6 días sequential, **~4-4.5 días con Phase 1+2 paralelizables** (see §12 Total estimate table).

### Closes / Related

- Resuelve [FDD-031 OQ1](FDD-031-forms-platform-extensions.md#open-questions) — cross-field error surfacing → entregado vía `<app-print-form-error>` banner.
- Resuelve [FDD-031 OQ2](FDD-031-forms-platform-extensions.md#open-questions) — async debounce → entregado vía `FieldDescriptor.updateOn` descriptor field.
- Corrige [FDD-029 §12 (d)](FDD-029-metadata-driven-forms.md#sub-phase-d--existing-consumer-migration-product-form) — el shim del product-form NO se dissolverá en FDD-030; sobrevive hasta que migre el template del product-form. Se actualizan los TODO comments en Phase 4.
- Materializa [AUDIT-059 §4.2](AUDIT-059-forms-and-ui-consistency.md#42--admin-devices-component--validates-tenant-gating) y [§4.3](AUDIT-059-forms-and-ui-consistency.md#43--reservation-form-component--stretches-the-abstraction).
- Cierre formal de **F2 — Adoption** per AUDIT-059 §6 phase plan.

### Scope rationale — triple-delivery FDD

A diferencia de FDD-031 (puro platform) o FDD-030 (puro consumer), FDD-032 mezcla platform extension + 2 consumer migrations. Razón original:

- El `<app-print-form-error>` banner se anticipó como necesario por reservation-form (cross-field errors). Splittear lo metería en un FDD intermedio que co-evoluciona con reservation-form — overhead.
- admin-devices + reservation-form son la totalidad del backlog de F2 consumer migrations. Splittearlos en FDDs separados dejaría F2 perpetuamente abierto sin ganancia.

**Update (2026-05-27 correction)**: el banner shipped en Phase 1 NO terminó siendo usado por reservation-form (data model no afford cross-field validators — see §4.3 + Known Deviations). El banner sigue siendo platform code shipped, available for future consumers; el triple-delivery rationale histórico se mantiene pero el outcome real es: 1 platform extension (banner + updateOn + catalog) + 2 consumer migrations donde solo admin-devices ejercita reactive options y reservation-form ejercita chip-select widget + async validator.

Implementación puede splittear en 2-3 commits (Phase 1+2 commit, Phase 3 commit, Phase 4 commit) para git history limpio.

---

## 2. Current State

### 2.1 admin-devices (legacy)

[src/app/modules/admin/components/devices/admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts) lines 80-225. Estado actual:

- **2 forms hand-rolled** con `NonNullableFormBuilder`:
  - Activation code generator (branch + mode + cash register + name).
  - Fleet edit dialog (per-device edit).
- **8+ signals + computed signals**:
  - `selectedBranchSignal`, `selectedModeSignal` (mirrors de form.valueChanges).
  - `cashRegisters`, `availableCashRegistersForBranch`, `cashRegisterOptions` (data + reactive filtering).
  - `showCashRegisterPicker` (visibility computed).
  - `deviceLimits`, `currentModeQuota` (quota tracking UI).
  - `lastGeneratedCode`, `generatingCode`, `lastCodeCopied`, `codePulseKey` (animation state).
- **Mode filtering por tenant features**: el dropdown filtra modes según `tenantContext.hasFeature(...)`.
- **0 validation feedback inline** (mismo gap que admin-users pre-FDD-030).

### 2.2 reservation-form (legacy)

[src/app/modules/admin/components/reservations/reservation-form.component.ts](../src/app/modules/admin/components/reservations/reservation-form.component.ts). Estado actual verificado contra producción:

- **1 form hand-rolled** con `FormBuilder` (NO NonNullableFormBuilder).
- **7 form fields**: `guestName`, `guestPhone`, `partySize`, `reservationDate` (Date), `reservationTime` (Date — timeOnly), `durationMinutes`, `notes`.
- **Signals OUTSIDE form**: `tables`, `selectedTableId`, `noTableAssigned`, `availabilityWarning`, `zoneGroups`, `selectedCustomer`, `isSaving`.
- **Customer integration**: `CustomerSelectorComponent` is the production-ready search + quick-create surface. `selectedCustomer` is OPTIONAL; when present, `onCustomerChanged` patches `guestName` + `guestPhone` into the form. `customerId` is NOT a form field — it is read from `selectedCustomer()?.id` at save-flow time.
- **Custom UI patterns NOT supported by F1**:
  - **Chip selector** for tables grouped by zone — current uses ad-hoc `<button class="rf__chip">` inside `@for (group of zoneGroups()...)` loops in the template.
  - **PartySize stepper** with custom +/− buttons (lines 66-76 of HTML) — adjusts `form.controls['partySize']` via `adjustPartySize(delta)`.
  - **Date + time pickers** via `<p-calendar>` (two instances — one date, one timeOnly). No `'datepicker'` widget kind exists in the shared library.
- **Availability check** ad-hoc via `reservationService.checkAvailability(tableId, dateStr, timeStr, durationMinutes, excludeId?)` (5 args; NOT start/end timestamps). Returns `{ available: boolean }`. Triggered imperatively from `selectTable()`, `(onSelect)` on calendars, and `(onChange)` on duration dropdown.
- **No cross-field constraints**: the data model uses `reservationDate + reservationTime + durationMinutes` instead of `(startsAt, endsAt)` timestamps, so the FDD-031 `date-range` built-in validator does not apply matematically.
- **No `findById` on `CustomerService`**: verified via grep — only `tax.service.ts` defines `findById`. Edit-mode hydration of customer state relies on the parent component passing the `Customer` object (or null) via `@Input reservation`.

### 2.3 Shared library status post FDD-031

API disponible:
- `DynamicFormSchema<TKey>`, `FieldDescriptor<TKey>`, `SectionDescriptor<TKey>`.
- `<app-dynamic-form>`, `<app-form-section>`, `<app-form-field>`, `<app-print-control-error>`.
- `provideFormWidget(name, component)` + `FORM_WIDGETS` token.
- `FieldDescriptor.options: readonly Option[] | Signal<readonly Option[]>` (reactive).
- `FieldDescriptor.asyncValidators?: readonly AsyncValidatorRef[]`.
- `DynamicFormSchema.formValidators?: readonly CrossFieldValidatorRef<TKey>[]`.
- Built-in cross-field validators: `date-range`, `matching-fields`, `custom`.

API faltante (entrega Phase 1):
- `<app-print-form-error>` banner para errores formGroup-level.
- `FieldDescriptor.updateOn?: 'change' | 'blur' | 'submit'`.

### 2.4 product-form shim — TODO comments stale

Los archivos del shim referencian `FDD-030` como target de deletion, pero esa promesa era prematura (FDD-029 §12 (d) error). Se actualizan en Phase 4.

---

## 3. Requirements

### 3.1 Functional requirements

- **F-1** `<app-print-form-error>` renderiza errores form-level (cross-field validators) con catalog reutilizado de PrintControlError.
- **F-2** `FieldDescriptor.updateOn?` field — builder aplica al constructor de FormControl.
- **F-3** admin-devices: 2 forms migradas a `<app-dynamic-form>` con reactive options para mode + cash register dropdowns.
- **F-4** reservation-form: 1 form migrado bajo el hybrid pattern (§5.3) — `<app-dynamic-form>` orquesta los kinds soportados + chip-select widget para `tableId`; raw widgets cubren date/time/partySize/customer. Async validator (`ReservationAvailabilityService`) aplicado a `tableId` con `updateOn: 'blur'`. NO incluye customer-autocomplete widget, date-range cross-field, ni banner (ver §4.3 + Known Deviations).
- **F-5** Custom widget registrado via `provideFormWidget('chip-select', ChipSelectWidget)` en los providers del componente reservation-form (singular — solo chip-select).
- **F-6** `ReservationAvailabilityService` implementa `AsyncValidatorService` con providedIn: 'root', lee sibling controls vía `control.parent`.
- **F-7** Banner integration con DynamicForm.submit() focus management: focus el banner cuando hay formValidator errors pero no individual control invalid (ver §10 para priority rule).
- **F-8** ESLint allow-list reducida en Phase 4 (eliminar admin-devices + reservation-form entries).
- **F-9** product-form shim TODO comments actualizadas en Phase 4 (eliminar referencia stale a FDD-030).

### 3.2 Non-functional requirements

- **NF-1** Zero behavioral regression en admin-devices + reservation-form (smoke gate manual).
- **NF-2** F1 + FDD-031 specs (71 total) deben seguir pasando post-refactor del PrintControlError catalog extraction. Phase 1 acceptance criterion explícito.
- **NF-3** Custom widgets siguen el touch-target floor (`$touch-target-pos` = 48px) y consumen tokens del `_variables.scss`.
- **NF-4** Async validators may declare `updateOn: 'blur'` in the descriptor. **Caveat discovered during Phase 3 execution (2026-05-27)**: `updateOn:'blur'` only suppresses Angular's `valueChanges` emissions from UI binding (when the user types into an input bound by `FormControlDirective`). It does NOT throttle programmatic `setValue()` calls — those always invoke `updateValueAndValidity()`, which runs async validators regardless of `updateOn`. Consequence: for widgets that set the control value imperatively (e.g., chip-select on click), `updateOn:'blur'` provides zero backend throttling. Pre-Phase-3 the FDD claimed it provided universal throttling — that claim was wrong. The descriptor field remains useful for text inputs bound via `FormControlDirective`, but reservation-form's chip-select widget does NOT benefit from it.
- **NF-5** Banner es opt-in: NO auto-renderizado dentro de `<app-dynamic-form>`. Consumer lo coloca explícitamente en su template.
- **NF-6** OnPush change detection en todos los componentes nuevos.

### 3.3 Out of Scope

Defer explícito:

- **product-form template migration** → no hay target FDD set. Sobrevive como legacy hasta que UX product-form se replan.
- **SignalR backend test loopback** ([AUDIT-058 §3.5](AUDIT-058-domain-flexibility-and-testability.md#35-sin-loopback-de-signalr-hubs-confirmed-missing--cross-repo-evidence)) — backend testing gap, no relacionado con frontend forms.
- **BEM duplication / hex literal / spacing / sub-16px sweeps** → FDD-033+ (F3 Extension / F4 Sweep).
- **Multi-error banner display** (banner shows only first form-level error) → deferred a FDD-033+, ver OQ1.
- **Multi-select chip-select variant** → single-select only para F2.
- **Backend reservation availability endpoint creation** — assumed exists (consumed por current ad-hoc check).
- **Backend customer search endpoint** — assumed exists (`CustomerSelectorComponent` lo consume hoy).
- **Lint rule enforcing `updateOn: 'blur'` para descriptors con asyncValidators** → diferido (OQ4).

---

## 4. Component Architecture

### 4.1 `<app-print-form-error>` — banner component (NEW)

Lives at: [src/app/shared/forms/components/print-form-error.component.{ts,html,scss,spec.ts}](../src/app/shared/forms/components/).

```ts
@Component({
  selector: 'app-print-form-error',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintFormErrorComponent implements OnInit {
  @Input({ required: true }) formGroup!: FormGroup;
  @Input({ required: true }) formId!: string;
  @Input() messages?: Record<string, string>;

  // DOM id derived from formId: `${formId}-form-error`.
  // tabindex="-1" on host element for programmatic focus.
}
```

**Behavior:**
- Renderiza vacío cuando `formGroup.valid` OR `formGroup.untouched`.
- Renderiza el primer error activo de `formGroup.errors` usando el catalog compartido (ver §4.4).
- ARIA: `aria-live="polite"` + `aria-atomic="true"`. NOT `role="alert"` (mismo razonamiento que FDD-031 PrintControlError lesson).
- DOM id `{formId}-form-error` permite que `DynamicFormComponent.submit()` lo localice via `document.getElementById`.
- `tabindex="-1"` permite focus programático sin entrar al tab order natural.
- Cleanup vía `takeUntilDestroyed(this.destroyRef)` (Angular 18 idiom).

**Tokens (visual contract):**
```scss
:host {
  display: block;
  color: $color-error;
  background: $color-error-bg;       // NEW token — see OQ2
  padding: $space-3 $card-padding;
  border: 1px solid $color-error;
  border-radius: $radius-card;
  font-size: $font-size-label;
  min-height: 2.5em;                 // reserves space
  outline: none;                     // tabindex="-1" focus indicator handled differently
  &:focus-visible {
    box-shadow: 0 0 0 2px $color-error;
  }
}
```

**Re-export** desde [src/app/shared/forms/index.ts](../src/app/shared/forms/index.ts).

### 4.2 `chip-select` widget (NEW)

Lives at: [src/app/modules/admin/components/reservations/widgets/chip-select.widget.ts](../src/app/modules/admin/components/reservations/widgets/chip-select.widget.ts).

The widget is a thin renderer. The consumer's existing `zoneGroups` computed signal (which already maps `tables()` + `zones()` to groups) is reshaped to the `ChipGroup` interface and passed as `descriptor.options`. The widget does NOT re-implement grouping logic.

```ts
@Component({
  selector: 'app-chip-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChipSelectWidget implements FormWidget {
  @Input({ required: true }) descriptor!: FieldDescriptor;
  @Input({ required: true }) control!: AbstractControl;
  @Input({ required: true }) formId!: string;

  // Resolves descriptor.options to readonly ChipGroup[] (static or signal).
  get resolvedGroups(): readonly ChipGroup[] { ... }
  select(value: unknown): void;
  onKeydown(event: KeyboardEvent, value: unknown): void;
}

export interface ChipGroup {
  groupLabel: string;
  chips: readonly { label: string; value: unknown; subLabel?: string }[];
}
```

**Template structure:**

```html
@for (group of resolvedGroups; track group.groupLabel) {
  <h4 class="chip-group__label">{{ group.groupLabel }}</h4>
  <div class="chip-group__chips" role="radiogroup" [attr.aria-labelledby]="...">
    @for (chip of group.chips; track chip.value) {
      <button
        type="button"
        class="chip"
        [class.chip--selected]="control.value === chip.value"
        [attr.aria-pressed]="control.value === chip.value"
        (click)="select(chip.value)"
        (keydown)="onKeydown($event, chip.value)"
      >
        {{ chip.label }}
        @if (chip.subLabel) { <span class="chip__sub">{{ chip.subLabel }}</span> }
      </button>
    }
  </div>
}
```

**Behavior:**

- Single-select: `control.setValue(chip.value)` on click.
- Active chip highlighted con `aria-pressed="true"` + CSS clase `chip--selected`.
- Keyboard: arrow keys cyclen entre chips dentro del group; space/enter selecciona el focused chip.
- Defensive: `setValue(unknown)` con value que no existe en options NO resetea — log warning en dev mode.
- `chip.value` type matches el control's expected value type. Para reservation-form `tableId`: `number | null`.

**Consumer wiring** (reservation-form): the existing `zoneGroups` computed (currently shaped as `TableZoneGroup[]` with `{ zoneName, tables: { id, name, capacity }[] }`) is mapped to `ChipGroup` via a new `tableChipGroups` computed:

```ts
readonly tableChipGroups = computed<readonly ChipGroup[]>(() =>
  this.zoneGroups().map(g => ({
    groupLabel: g.zoneName,
    chips: g.tables.map(t => ({
      label: t.name,
      value: t.id,
      subLabel: t.capacity ? `${t.capacity}` : undefined,
    })),
  })),
);
```

The schema field for `tableId` receives `options: this.tableChipGroups` (signal reference).

**Estimated LOC:** ~80.

### 4.3 `customer-autocomplete` widget — **NOT SHIPPED**

**Original design** (deprecated): a thin `FormWidget` wrapper around `CustomerSelectorComponent` storing `Customer.id` in the form value, with edit-mode hydration via `customerService.findById(id)`.

**Why dropped** (discovered during Phase 3 verification against production code):

1. `CustomerService.findById` does NOT exist (verified via grep — only `tax.service.ts` defines it). Edit-mode hydration as designed is impossible.
2. `CustomerSelectorComponent` is already production-ready with a richer API than the wrapper would expose: built-in autocomplete with `search-as-you-type`, a quick-create dialog for new customers, two-way `model()` binding for `[selectedCustomer]`, plus `(customerChanged)` output. Wrapping it in a `FormWidget` would constrain the API without adding ROI.
3. Customer is an OPTIONAL helper in reservation-form (it patches `guestName` + `guestPhone` when selected). It is not a primary form field — making it a `customerId` field changes the data model.

**Replacement plan**: `selectedCustomer: signal<Customer | null>` stays OUTSIDE the form (same as today). Save flow continues to read `customerId: this.selectedCustomer()?.id ?? null` when assembling the DTO. `CustomerSelectorComponent` is rendered as a raw element in the consumer template, OUTSIDE `<app-dynamic-form>`. No customer state lives in the FormGroup.

See "Known Deviations / Corrections" section for the full record.

### 4.4 Error catalog extraction (Rule-of-3)

Extracted to [src/app/shared/forms/components/error-catalog.ts](../src/app/shared/forms/components/error-catalog.ts):

```ts
export function resolveErrorMessage(
  key: string,
  errorData: unknown,
  override?: Record<string, string>,
): string {
  // 1. Override priority.
  if (override?.[key] !== undefined) return override[key];

  // 2. Built-in catalog.
  switch (key) {
    case 'required':         return 'Campo requerido';
    case 'nonBlank':         return 'No puede contener solo espacios';
    case 'positiveNumber':   return 'Debe ser un número positivo';
    case 'maxlength': {
      const n = (errorData as { requiredLength?: number })?.requiredLength;
      return n !== undefined ? `Máximo ${n} caracteres` : 'Valor inválido';
    }
    case 'minlength': {
      const n = (errorData as { requiredLength?: number })?.requiredLength;
      return n !== undefined ? `Mínimo ${n} caracteres` : 'Valor inválido';
    }
    case 'min': {
      const n = (errorData as { min?: number })?.min;
      return n !== undefined ? `Valor mínimo: ${n}` : 'Valor inválido';
    }
    case 'max': {
      const n = (errorData as { max?: number })?.max;
      return n !== undefined ? `Valor máximo: ${n}` : 'Valor inválido';
    }
    case 'availability':     return 'No disponible';
    case 'dateRange':        return 'Fecha de inicio debe ser anterior a la de fin';
    case 'matchingFields':   return 'Los valores no coinciden';
    default:                 return 'Valor inválido';
  }
}
```

**PrintControlError refactor**: reemplaza su `resolveDefaultMessage()` inline con `resolveErrorMessage(key, errorData, this.messages)`. **Zero behavioral change** — same catalog entries, same priority.

**PrintFormError**: usa el mismo helper.

**Acceptance criterion crítico**: las 6 specs existentes de PrintControlError DEBEN seguir pasando post-refactor (verifica observational equivalence del catalog).

---

## 5. State Management

### 5.1 admin-devices signal mapping

| Signal actual | Después de migration | Razón |
|---|---|---|
| `selectedBranchSignal` (mirror) | **ELIMINATED** | orchestrator's valueSnapshot lo provee |
| `selectedModeSignal` (mirror) | **ELIMINATED** | orchestrator's valueSnapshot lo provee |
| `showCashRegisterPicker` computed | **ELIMINATED** | convertido a `showWhen` predicate en el schema |
| `cashRegisters` (state) | **PRESERVED** | data layer, fuera del form |
| `availableCashRegistersForBranch` computed | **PRESERVED** | feeds `descriptor.options` como Signal |
| `cashRegisterOptions` computed | **PRESERVED** | `descriptor.options` directamente |
| `deviceLimits`, `currentModeQuota` | **PRESERVED** | UI separate del form |
| `lastGeneratedCode`, `generatingCode`, `lastCodeCopied`, `codePulseKey` | **PRESERVED** | UI animation state |

### 5.2 reservation-form signal mapping

| Signal actual | Después de migration | Razón |
|---|---|---|
| `tables` | **PRESERVED** | data layer; feeds `zoneGroups` |
| `selectedTableId` | **MOVED INTO FORM as `tableId` control** | bound to the new chip-select widget. `selectTable(id)` becomes `this.form.controls['tableId'].setValue(id)` — but most callers route through the widget itself |
| `availabilityWarning` | **ELIMINATED** | replaced by the async validator on `tableId`. `PrintControlError` renders "No disponible" inline below the chip-select when the validator returns `{ availability: true }` |
| `zoneGroups` computed | **PRESERVED** | feeds a new `tableChipGroups` computed that reshapes to `ChipGroup[]` for the widget |
| `selectedCustomer` | **PRESERVED OUTSIDE FORM** | CustomerSelectorComponent stays as-is in the consumer template (NOT migrated to a FormWidget — see §4.3). Save flow continues to read `selectedCustomer()?.id` when assembling the DTO |
| `isSaving` | **PRESERVED** | UI toggle |
| `noTableAssigned` | **PRESERVED OUTSIDE FORM** | UI checkbox that hides/shows the chip-select section via `@if` in template; NOT a form-value field. Toggling it sets `tableId` to `null` so the async validator short-circuits |

### 5.3 FormGroup ownership — hybrid pattern (Phase 3)

Mismo patrón que F1 / FDD-030 para los consumers simples (admin-users, admin-devices):

- admin-devices uses `buildControls()` + manual `fb.group()` (no formValidators, simpler).
- `<app-dynamic-form>` consumes the FormGroup passed by reference.

**Phase 3 (reservation-form) introduces a hybrid form pattern** because the consumer has UI elements that don't have matching widget kinds in the shared library (date/time pickers, partySize stepper):

- Consumer builds the FormGroup via `DynamicFormBuilderService.buildFormGroup(schema)` — needed because the schema declares async validators on `tableId`. `buildFormGroup` wires sync + async per descriptor.
- The FormGroup contains ALL fields including those rendered by raw widgets in the consumer template: `guestName`, `guestPhone`, `partySize`, `reservationDate`, `reservationTime`, `durationMinutes`, `notes`, `tableId`.
- The consumer template wraps everything in `<form [formGroup]="form">`. Inside it:
  - `<app-dynamic-form>` renders the fields with kinds supported by the shared library (`guestName`, `guestPhone`, `durationMinutes`, `notes`, `tableId` via chip-select).
  - Raw widgets (`<p-calendar>` × 2, the partySize stepper, the `CustomerSelectorComponent`, the `noTableAssigned` checkbox) sit alongside, each with `formControlName="..."` pointing at the SAME FormGroup for the fields that need it.
- This is valid Angular Reactive Forms — a single `[formGroup]` directive can have multiple descendant controls bound by `formControlName`, regardless of whether they live inside the orchestrator or in raw consumer markup.

**Why this pattern**: shipping a `datepicker` / `timepicker` / `number-stepper` widget kind in the shared library is out of scope for FDD-032 (each would be a small but real platform extension). The hybrid pattern preserves the UX without forcing premature platform features. Future FDDs may promote these widgets to shared library if a second consumer needs them (Rule-of-3).

---

## 6. UI/UX

### 6.1 Banner visual placement

The `<app-print-form-error>` banner is opt-in (NF-5). Phase 3 reservation-form does NOT use it — there are no cross-field validators applicable to the date+time+duration data model (see §4.3 deviation and §11.1 Section (b) for full rationale).

Generic placement contract (for future consumers that DO declare `formValidators`):

```html
<app-print-form-error [formGroup]="myForm" [formId]="'my-form'" />
<app-dynamic-form
  [schema]="schema"
  [formGroup]="myForm"
  [formId]="'my-form'"
  ...
/>
```

- Banner ABOVE the form, full-width. Both must share the same `formId` so `DynamicFormComponent.submit()` can `document.getElementById('${formId}-form-error')` for focus.
- admin-devices: **NO banner** (no formValidators).
- reservation-form: **NO banner** (no formValidators applicable — data model is date+time+duration, not start/end timestamps). Individual control errors (including async `availability`) render inline via `PrintControlError` below each field as usual.

### 6.2 Custom widgets visual style

- `chip-select`: PrimeFlex-friendly, chip-style buttons agrupados por section. Active state via `$color-primary` background + white text.
- `CustomerSelectorComponent` (raw, not migrated): keeps its existing visual untouched (§4.3 deviation).
- Touch target: `min-height: $touch-target-pos` (48px) en chip.

### 6.3 Tokens

- Banner: usa `$color-error`, `$color-error-bg` (NEW — OQ2), `$space-*`, `$radius-card`.
- chip-select: `$color-primary` (selected), `$color-text-title` (label), `$space-2 $space-3` (padding), `$radius-button`.

---

## 7. Data Flow

### 7.1 admin-devices reactive options sequence

```
1. Consumer's computed signal evaluates:
   readonly availableCashRegistersForBranch = computed(() => {
     const branchId = this.formSnapshot()['branchId'];
     return this.cashRegisters().filter(r => r.branchId === branchId && !r.deviceUuid);
   });

2. descriptor.options = this.availableCashRegisterOptions  // Signal reference

3. FormFieldComponent.resolvedOptions getter unwraps via type guard:
   typeof opts === 'function' ? opts() : opts

4. <p-dropdown> re-renders on signal change (OnPush + signal reactivity).
```

### 7.2 reservation-form async validation sequence

`ReservationAvailabilityService` is applied to the `tableId` field. It reads sibling controls (`reservationDate`, `reservationTime`, `durationMinutes`) via `control.parent`. The `currentReservationId` (needed to skip self-collision during edit) is provided by the consumer via a public setter, since the service has no access to component-level @Input state.

```ts
// Service contract
@Injectable({ providedIn: 'root' })
export class ReservationAvailabilityService implements AsyncValidatorService {

  private currentReservationId: number | null = null;
  private readonly reservationService = inject(ReservationService);

  /**
   * Consumer-invocable setter — reservation-form calls this in ngOnChanges
   * when `reservation` Input changes, so the validator can skip
   * self-collision during edit.
   */
  setCurrentReservationId(id: number | null): void {
    this.currentReservationId = id;
  }

  check(control: AbstractControl): Observable<ValidationErrors | null> {
    const tableId = control.value as number | null;
    const date = control.parent?.get('reservationDate')?.value as Date | null;
    const time = control.parent?.get('reservationTime')?.value as Date | null;
    const duration = control.parent?.get('durationMinutes')?.value as number | null;

    // Inactive when any sibling is missing OR tableId is null (the
    // noTableAssigned UX path).
    if (!tableId || !date || !time || !duration) return of(null);

    return this.reservationService
      .checkAvailability(
        tableId,
        this.formatDate(date),
        this.formatTime(time),
        duration,
        this.currentReservationId ?? undefined,
      )
      .pipe(map(result => result.available ? null : { availability: true }));
  }

  private formatDate(d: Date): string { /* YYYY-MM-DD */ }
  private formatTime(d: Date): string { /* HH:MM:00 */ }
}
```

**Sequence**:

1. The `tableId` FormControl has `updateOn: 'blur'` declared in the descriptor (Phase 1 platform feature). **NOTE corrected during Phase 3 execution**: this throttles ONLY UI-binding events; the chip-select widget calls `setValue()` programmatically on each click, which always fires the async validator regardless of `updateOn`. See §NF-4 for the full caveat. Each chip click triggers a backend `/reservations/availability` call — acceptable cost vs the legacy imperative `checkAvailability()` which fired on every calendar/duration change anyway.
2. The service reads tableId + the three sibling controls. If any is missing → returns `of(null)` (validator inactive — the noTableAssigned UX path explicitly nulls `tableId`, suppressing all backend calls).
3. Calls `reservationService.checkAvailability(tableId, dateStr, timeStr, durationMinutes, excludeId?)` — the existing service signature is preserved (no backend coordination required).
4. Maps `{ available: false }` → `{ availability: true }` (Angular error key); `{ available: true }` → `null`.
5. `PrintControlError` surfaces "No disponible" inline below the chip-select when `control.errors?.availability === true`.

**Imperative `checkAvailability()` method removed**: the consumer no longer needs the imperative method on the component — the async validator pipeline replaces it. The `availabilityWarning` signal is eliminated alongside.

### 7.3 reservation-form submit sequence

Phase 3 reservation-form has no cross-field validators (the data model is date+time+duration, not start/end timestamps — see §4.3 deviation). The banner focus-priority-2 path defined in Phase 1 §10.4 does NOT activate here. Only Priority 1 (focus first invalid control) applies.

```text
1. User clicks Save → DynamicForm.submit().
2. markAllAsTouched() → re-evaluate validators (sync + async pending).
3. Priority 1 only — Individual control invalid → focus first invalid:
   - Sync errors on guestName, partySize, reservationDate, reservationTime,
     durationMinutes (any required field empty).
   - Async error on tableId → control.errors.availability === true.
   → DynamicFormComponent.submit() focuses the first invalid input by id
     (existing FDD-029 §10 behavior).

   (submitted) NOT emitted while any control is invalid.

4. If valid (no errors anywhere): (submitted) emits → consumer's
   onFormSubmitted handles save (reads selectedCustomer() for the
   customerId DTO field).
```

The Phase 1 banner focus-priority-2 path remains shipped and tested via platform specs; it activates for future consumers that declare `formValidators`.

---

## 8. Performance

- **Banner**: minimal — un solo subscriber a `formGroup.statusChanges` via `takeUntilDestroyed`. OnPush detects on signal change.
- **chip-select**: O(zones × tables) render. Para reservation-form típico (≤5 zones × ≤10 tables each = ≤50 chips), perf negligible.
- **CustomerSelectorComponent (raw)**: unchanged from current behavior — debounced autocomplete search, quick-create dialog. No new perf surface introduced by FDD-032.
- **Async availability**: rate-limited vía `updateOn: 'blur'` (descriptor field shipped Phase 1). Sin spam de API on each keystroke.

---

## 9. Error Handling

### 9.1 Compile-time

- `<app-print-form-error>` Inputs marcados `{ required: true }` — fallar al pasar formGroup o formId surfaces como TypeScript error.
- `chip-select` `ChipGroup` interface tipa los options — typos en property names caught at compile.
- `FieldDescriptor.updateOn` is a literal union — agent IDE auto-complete preserves valid values.

### 9.2 Runtime

- **Banner sin formGroup**: defensive guard — si `formGroup` undefined al inicio (race condition), renderiza empty silently.
- **chip-select setValue(unknown)** con value que NO existe en options: log warning en dev mode (`console.warn('[chip-select] setValue with unknown value:', value)`), retain the value (don't reset). Permite cases edge (control.value pre-existing antes que options carguen).
- **Async validator service token missing**: `injector.get` throws (FDD-031 defensive behavior preserved).
- **Customer edit-mode hydration**: handled by the consumer's existing `ngOnChanges`, which patches `guestName` + `guestPhone` from the `reservation` Input when present. No FormWidget involved.

### 9.3 Error catalog completeness

Catalog cubre los 11 keys actuales (8 sync + 3 async/cross-field). Banner shows `'Valor inválido'` fallback para keys no catalogadas.

---

## 10. Accessibility

### 10.1 Banner

- `aria-live="polite"` + `aria-atomic="true"` — anuncia el error sin interrumpir typing.
- NO `role="alert"` (forzaría assertive, inadecuado para form validation).
- `tabindex="-1"` permite focus programático sin entrar al tab order natural.

### 10.2 chip-select

- `role="radiogroup"` en el container de chips (single-select semantics).
- `aria-pressed="true|false"` en cada chip.
- Keyboard navigation:
  - Arrow keys: cycle entre chips del group activo.
  - Space / Enter: select el focused chip.
  - Tab: leaves el chip group.

### 10.3 Customer selector

Phase 3 does NOT ship `customer-autocomplete` FormWidget (see §4.3 deviation). `CustomerSelectorComponent` continues to be rendered directly in the consumer template — inherits its existing a11y (autocomplete pattern with ARIA combobox semantics, quick-create dialog).

### 10.4 Focus management priority on submit invalid

**Locked priority rule** (Phase 1 acceptance criterion — platform behavior, applies to ALL consumers):

1. **Individual control invalid wins**: si hay AL MENOS UN control invalid (sync OR async error resolved), focus va al **primer control invalid** (existing FDD-029 §10 behavior preserved).
2. **Banner solo cuando puro form-level**: si TODOS los controls son valid PERO `formGroup.errors` está presente (cross-field validator failed), focus va al **banner** vía `document.getElementById`.

Rationale: el control-level error es más actionable (user sabe qué arreglar). Form-level errors son contextuales (start/end no encajan) — el banner contextualiza pero requiere ver ambos campos.

**Phase 3 note**: reservation-form exercises only Priority 1 (Priority 2 path requires `formValidators`, which the data model does not afford — see §4.3 + §7.3).

---

## 11. Testing

### 11.1 Smoke checklist (manual, pre-merge)

**Single combined doc** (D15): `docs/FDD-032-smoke-checklist.md` con 2 secciones.

**Sección (a) admin-devices smoke (8 steps):**

1. **Happy path activation code** (Cashier mode): seleccionar branch + mode 'cashier' + cash register link + name → generate code → success toast, code displayed.
2. **Mode dropdown tenant filter**: tenant sin feature `CoreHardware` NO ve mode `bridge` en el dropdown (filtered out reactive).
3. **Cash register dropdown filter**: cambiar branch → cash register dropdown re-renderiza con registers solo de ese branch + sin device linked.
4. **Mode switch hides cash register**: cambiar mode de 'cashier' a 'tables' → cash register dropdown desaparece (showWhen predicate).
5. **Fleet edit dialog**: click edit on a device row → dialog opens con valores prepopulados → editar name → save → cambios persisten.
6. **Validation empty**: dejar 'name' vacío → click save → "Campo requerido" inline + focus al field.
7. **Quota counter**: con quota activa, dropdown muestra `(X de Y)` next to mode label — preserved computed signal sigue funcionando.
8. **Branch filter (fleet table)**: seleccionar branch en el filter → tabla filtra devices de ese branch only.

**Sección (b) reservation-form smoke (8 steps):**

1. **Happy path create**: pick a customer (via CustomerSelectorComponent — autocomplete) OR fill guestName/guestPhone manually → set date + time + duration + partySize → pick a table chip → save → reservation appears in the list. Confirms hybrid form pattern (dynamic-form fields + raw-widget fields share the same FormGroup).
2. **Happy path edit**: open an existing reservation from the list → dialog opens with all fields prepopulated (guestName, guestPhone, date, time, duration, partySize, notes) and the right table chip highlighted as `--selected` → modify notes → save → row updates in place.
3. **Customer selector unchanged**: type in the CustomerSelectorComponent autocomplete → matches show → click one → `guestName` + `guestPhone` patch in the form. (Customer is OPTIONAL — skipping it and typing guestName/guestPhone manually also works.)
4. **Chip-select tables grouped**: tables render grouped by zone (zoneName as `<h4>` per group), each chip with `aria-pressed` toggling on click. Selecting a chip sets `form.value.tableId`. Validates the chip-select widget shipped in Phase 3.
5. **`noTableAssigned` toggle**: tick the "Sin mesa asignada" checkbox → chip-select section hides (consumer `@if`), `tableId` resets to `null` → save works without a table. Async validator stays inactive (returns `of(null)` when tableId is null).
6. **Async availability validator**: pick a date + time + duration that overlap with an existing reservation, then pick the conflicting table chip → on blur, inline "No disponible" surfaces below the chip-select via PrintControlError. The save button stays enabled but submit focuses the field with the availability error (Priority 1 of §10.4). Verify Network tab: validator does NOT spam on every chip click — fires only on blur thanks to `updateOn: 'blur'` (Phase 1 feature exercised here).
7. **Edit-mode availability skips self**: open an existing reservation → the validator must NOT flag the reservation's own table+slot as "No disponible" (the consumer wires `availabilityService.setCurrentReservationId(this.reservation.id)` in `ngOnChanges` so the backend's `excludeId` filters out self).
8. **Required field validation**: leave `guestName` empty → click save → form does NOT submit; focus moves to the guestName input; inline "Campo requerido" shows below it (Priority 1 of §10.4). Same behavior for any other empty required field.

Note: no Phase 3 step exercises the `<app-print-form-error>` banner — it is not used in this consumer (no formValidators, no cross-field date-range). Banner specs in Phase 1 (5 unit + 2 DynamicForm-integration) cover the platform side.

### 11.2 Unit specs

**Banner unit specs (5):**
1. Renders empty when `formGroup.valid`.
2. Renders empty when `formGroup.untouched`.
3. Renders first error from catalog when invalid + touched.
4. Override `messages` input takes priority.
5. ARIA: `aria-live="polite"`, `aria-atomic="true"`, `tabindex="-1"` present.

**chip-select unit specs (6):**
1. Renders all groups con `groupLabel` + chips.
2. Click sets `control.value` a chip.value.
3. Active chip has `aria-pressed="true"`.
4. Keyboard: space/enter selects focused chip.
5. Signal-based options update triggers re-render.
6. `setValue(unknown)` doesn't reset (defensive).

**customer-autocomplete integration specs**: **DROPPED** (widget not shipped — see §4.3 deviation). 0 specs in this category.

**updateOn extension specs (2):**
1. `updateOn: 'blur'` applied to FormControl construction.
2. Default 'change' when descriptor.updateOn omitted.

**Async validator integration spec** — **DROPPED during Phase 3 execution**. The original spec expected `updateOn: 'blur'` to suppress async validator on programmatic `setValue` — investigation revealed this is INCORRECT. Angular's `setValue()` internally calls `updateValueAndValidity()` which always runs async validators regardless of `updateOn`. The `updateOn:'blur'` option ONLY affects UI binding events (when user types into an input bound by `FormControlDirective`) — it does NOT throttle programmatic API calls. See §NF-4 + §7.2 + Known Deviations for full record.

**ReservationAvailabilityService specs (2):**
1. Returns null when any sibling value missing (inactive).
2. Maps backend response correctly: free → null, conflict → `{ availability: true }`.

**Banner integration con DynamicForm.submit() (2):**
1. Submit with formValidator failure (no control errors) → banner.focus() called.
2. Submit with control errors only → existing focus-first-invalid behavior preserved (banner NOT focused).

**Total new specs**: **17** (5 banner + 6 chip-select + 2 updateOn + 2 availability service + 2 banner-DynamicForm integration). Two specs dropped from the original plan of 20: (a) the 2 customer-autocomplete integration specs — widget not shipped (see §4.3 deviation); (b) the 1 async-blur integration spec — Angular behavior contradicts the original FDD claim (see §NF-4 + §7.2 + Known Deviations).

**Per-phase distribution**:

- Phase 1: 5 banner unit + 2 updateOn + 2 banner-DynamicForm = **9 specs** (shipped).
- Phase 2: 0 specs (consumer migration, smoke-only).
- Phase 3: 6 chip-select + 2 availability service = **8 specs**.
- Phase 4: 0 specs (cleanup).

### 11.3 F1 + FDD-031 regression gate

**71 specs must continue passing** post-refactor del PrintControlError catalog extraction. Phase 1 acceptance criterion explícito — si alguno falla, el refactor introdujo drift observacional.

**Total combined specs target**: 71 + 17 = **88 specs** (revised from 91 in original plan — customer-autocomplete drop accounts for -2, async-blur drop for -1).

---

## 12. Implementation Sub-phases

> **Naming clarification**: F2 — Adoption phase per AUDIT-059 §6 incluye **FDD-030 (admin-users + ESLint, shipped) + FDD-031 (platform extensions, shipped) + FDD-032 (this — complex consumers + small platform extension)**. Internal sub-phases (a/b/c/d).

### Dependency graph

```
  ┌──────────────────────────────────┐
  │ Phase 1 (Banner + updateOn       │── independent ──┐
  │     + catalog extraction)        │                 │
  └──────────────────────────────────┘                 │
                                                       │
  ┌──────────────────────────────────┐                 │
  │ Phase 2 (admin-devices migration)│── independent ──┤
  │     (no formValidators required) │                 │
  └──────────────────────────────────┘                 ▼
                                              ┌──────────────────────┐
                                              │ Phase 3              │
                                              │ (reservation-form)   │
                                              │ ← needs (1) + (2)    │
                                              └──────────────────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────────┐
                                              │ Phase 4              │
                                              │ (ESLint + shim TODO) │
                                              │ ← needs (2) + (3)    │
                                              └──────────────────────┘
```

**Phase 1 + Phase 2 paralelizables** (no cross-dependencies).
**Phase 3 depends on both** Phase 1 (banner + updateOn) y Phase 2 stable (admin-devices works → confidence en reactive options pattern antes de tackle reservation-form).
**Phase 4 final cleanup** post ambas migrations landed.

### Phase 1 — Platform extension (Banner + updateOn + catalog refactor)

**Goal**: ship la infrastructure necesaria por reservation-form sin introducir regression en F1 specs.

**Files create:**
- `src/app/shared/forms/components/print-form-error.component.ts`
- `src/app/shared/forms/components/print-form-error.component.html`
- `src/app/shared/forms/components/print-form-error.component.scss`
- `src/app/shared/forms/components/print-form-error.component.spec.ts`
- `src/app/shared/forms/components/error-catalog.ts` (extracted)

**Files modify:**
- `src/app/shared/forms/components/print-control-error.component.ts` → consume `resolveErrorMessage` from `error-catalog.ts`. **Zero behavioral change** — same catalog priority logic.
- `src/app/shared/forms/schemas/dynamic-form.schema.ts` → add `FieldDescriptor.updateOn?: 'change' | 'blur' | 'submit'`.
- `src/app/shared/forms/services/dynamic-form-builder.service.ts` → buildControls aplica `descriptor.updateOn` via `fb.control(default, { validators, updateOn })`.
- `src/app/shared/forms/services/dynamic-form-builder.service.spec.ts` → 2 specs para updateOn.
- `src/app/shared/forms/components/dynamic-form.component.ts` → submit() focuses banner via `document.getElementById('${formId}-form-error')` cuando formValidator falla y todos los controls están valid (priority rule §10).
- `src/app/shared/forms/components/dynamic-form.component.spec.ts` → 2 specs para banner focus integration.
- `src/app/shared/forms/index.ts` → re-export `PrintFormErrorComponent`.
- `src/styles/_variables.scss` → add `$color-error-bg` token (e.g., `#FEE2E2`) — verify against PrimeNG `--red-50` first per OQ2.

**Acceptance criteria:**
- 5 banner unit specs passing.
- 2 updateOn unit specs passing.
- 2 banner-DynamicForm integration specs passing.
- **All 71 existing F1 + FDD-031 specs continue to pass** post-refactor (critical regression gate NF-2).
- `ng build` zero new errors.

**Estimate**: **1-1.5 días** (5 sub-concerns: banner component, catalog extraction, updateOn descriptor, builder integration, DynamicForm.submit extension).

### Phase 2 — admin-devices migration

**Goal**: replace 2 hand-rolled forms with `<app-dynamic-form>` instances, leveraging reactive options.

**Files create:**
- `src/app/modules/admin/components/devices/admin-devices-codegen.form.ts`
- `src/app/modules/admin/components/devices/admin-devices-edit.form.ts`

**Files modify:**
- `src/app/modules/admin/components/devices/admin-devices.component.ts`
- `src/app/modules/admin/components/devices/admin-devices.component.html`
- `src/app/modules/admin/components/devices/admin-devices.component.scss`

**Schema highlights:**

```ts
// admin-devices-codegen.form.ts
export const CODEGEN_FORM_SCHEMA: DynamicFormSchema<CodegenFormKey> = {
  sections: [
    {
      id: 'main',
      title: 'Generar código de activación',
      fields: [
        { key: 'branchId', kind: 'dropdown', label: 'Sucursal', defaultValue: 0,
          validators: ['required'],
          // options injected at runtime — branches signal
        },
        { key: 'mode', kind: 'dropdown', label: 'Modo', defaultValue: 'cashier',
          validators: ['required'],
          // options: Signal driven by tenant features filter
        },
        { key: 'cashRegisterId', kind: 'dropdown', label: 'Caja registradora', defaultValue: null,
          showWhen: (s) => s['mode'] === 'cashier' &&
            /* dataAvailable */ ,
          // options: Signal driven by availableCashRegistersForBranch
        },
        { key: 'name', kind: 'text', label: 'Nombre del dispositivo', defaultValue: '',
          validators: ['required', { key: 'maxLength', n: 100 }],
        },
      ],
    },
  ],
};
```

**Acceptance criteria:**
- Both forms rendered via `<app-dynamic-form>`.
- Mode dropdown filtered correctly por tenant features.
- Cash register dropdown filtered correctly por branch + linkability.
- Smoke checklist (a) passes — zero behavioral regression.
- `ng build` zero new errors.

**Estimate**: **1.5 días**.

### Phase 3 — reservation-form migration (hybrid form pattern)

**Goal**: ship the chip-select widget + async availability validator to a real consumer (reservation-form), exercising the FDD-031 extension surface where it fits the data model. Deliberately HYBRID: dynamic-form orchestrates the kinds it supports; raw widgets cover the rest (date pickers, partySize stepper, customer selector), all bound to the SAME FormGroup.

**Files create (4):**

- `src/app/modules/admin/components/reservations/reservation-form.form.ts` — schema declaration (7 fields + 1 chip-select; no formValidators).
- `src/app/modules/admin/components/reservations/widgets/chip-select.widget.ts` (+ `.spec.ts`) — generic chip-select FormWidget (6 specs per §11.2).
- `src/app/modules/admin/components/reservations/services/reservation-availability.service.ts` (+ `.spec.ts`) — `AsyncValidatorService` for the `tableId` field (2 specs per §11.2).

**Files NOT created** (deviation from original plan — see §4.3):

- ~~`widgets/customer-autocomplete.widget.ts`~~ — dropped. `CustomerSelectorComponent` stays as-is in the consumer template.

**Files modify (4):**

- `src/app/modules/admin/components/reservations/reservation-form.component.ts` — register chip-select widget, build FormGroup via `buildFormGroup()`, expose `tableChipGroups` computed, wire `setCurrentReservationId()` on the availability service in `ngOnChanges`, replace imperative `checkAvailability()` + `availabilityWarning` with the async validator pipeline. Add @Component providers:

```ts
@Component({
  selector: 'app-reservation-form',
  standalone: true,
  imports: [
    DialogModule, FormFieldComponent, CalendarModule,
    CustomerSelectorComponent, /* kept for raw widget render */
    // ... existing PrimeNG modules retained
  ],
  providers: [
    // NOTE (corrected 2026-05-27 during Phase 3 execution):
    // `provideFormWidget('chip-select', ChipSelectComponent)` returns
    // `EnvironmentProviders` (for app/route-level configuration only) and
    // is REJECTED by component-level `providers: []` which requires
    // `Provider[]`. Use the raw multi-provider shape instead:
    {
      provide: FORM_WIDGETS,
      useValue: { name: 'chip-select', component: ChipSelectComponent } satisfies FormWidgetRegistration,
      multi: true,
    },
    // NO customer-autocomplete registration — widget not shipped (§4.3).
  ],
})
```

- `src/app/modules/admin/components/reservations/reservation-form.component.html` — wrap with `<form [formGroup]>`, render `<app-dynamic-form>` for the schema-friendly fields, keep `<p-calendar>` × 2 + partySize stepper + CustomerSelectorComponent + noTableAssigned checkbox as raw children with `formControlName` for the date/time fields.
- `src/app/modules/admin/components/reservations/reservation-form.component.scss` — cleanup BEM where the dynamic-form widgets replace inline `.rf__field` / `.rf__error` instances (incremental — only remove what's truly dead).
- `src/app/shared/forms/services/dynamic-form-builder.service.spec.ts` — add 1 spec proving an async validator with `updateOn: 'blur'` doesn't fire on programmatic `setValue` (FDD §11.2).

**Schema (revised — Path Y locked per OQ7):**

The schema declares ONLY fields that `<app-dynamic-form>` will render. Raw-rendered controls (`partySize`, `reservationDate`, `reservationTime`) are added to the FormGroup imperatively by the consumer after `buildFormGroup()` returns. No sentinel kind, no orchestrator branching.

```ts
export type ReservationFormKey =
  | 'guestName' | 'guestPhone'
  | 'durationMinutes' | 'tableId' | 'notes';

export const RESERVATION_FORM_SCHEMA: DynamicFormSchema<ReservationFormKey> = {
  sections: [
    {
      id: 'guest',
      title: 'Cliente',
      fields: [
        { key: 'guestName',  kind: 'text', label: 'Nombre',
          defaultValue: '', validators: ['required'] },
        { key: 'guestPhone', kind: 'text', label: 'Teléfono',
          defaultValue: '' },
      ],
    },
    {
      id: 'when',
      title: 'Cuándo',
      fields: [
        { key: 'durationMinutes', kind: 'dropdown', label: 'Duración',
          defaultValue: 90, validators: ['required'] },
      ],
    },
    {
      id: 'table',
      title: 'Mesa',
      // No showSection — the noTableAssigned checkbox is a consumer-side @if
      // that hides the chip-select container in template. The schema's
      // tableId field is always part of the FormGroup; the async validator
      // returns of(null) when tableId is null, so it stays inert when the
      // user opts out.
      fields: [
        { key: 'tableId', kind: 'chip-select', label: 'Mesa',
          defaultValue: null,
          updateOn: 'blur',  // CRITICAL — throttles the async API call
          asyncValidators: [
            { key: 'availability', service: ReservationAvailabilityService },
          ],
        },
      ],
    },
    {
      id: 'notes',
      title: 'Notas',
      fields: [
        { key: 'notes', kind: 'textarea', label: 'Notas', defaultValue: '' },
      ],
    },
  ],
  // formValidators: ABSENT — data model is date+time+duration, no date-range.
};
```

**Consumer adds raw-field controls after `buildFormGroup()`** (Path Y per OQ7):

```ts
readonly form: FormGroup = this.builder.buildFormGroup(RESERVATION_FORM_SCHEMA);

constructor() {
  // Raw-rendered controls — not in the schema, added imperatively so they
  // share the same FormGroup as the dynamic-form fields.
  this.form.addControl('partySize',       this.fb.control(2,    [Validators.required, Validators.min(1)]));
  this.form.addControl('reservationDate', this.fb.control<Date | null>(null, Validators.required));
  this.form.addControl('reservationTime', this.fb.control<Date | null>(null, Validators.required));
}
```

**Acceptance criteria** (revised during Phase 3 execution — Path C):

- 6 chip-select unit specs passing.
- 2 ReservationAvailabilityService unit specs passing.
- ~~1 async-blur integration spec~~ — DROPPED per Path C. See §NF-4 + §7.2 + Known Deviations.
- Form rendered via per-field `<app-form-field>` for fields with supported kinds (NOT `<app-dynamic-form>` orchestrator — see Known Deviations); raw widgets render for date/time/partySize/customer with shared FormGroup binding (hybrid pattern §5.3).
- `ChipSelectComponent` registered in component providers via raw `{ provide: FORM_WIDGETS, useValue: ..., multi: true }` shape (NOT `provideFormWidget()` factory which returns `EnvironmentProviders`). Class name uses `Component` suffix per Angular ESLint convention; file naming `.widget.ts` preserves FDD-031 convention.
- Async availability validator fires on each `setValue()` from the chip-select widget (NOT throttled by `updateOn:'blur'` — see §NF-4); surfaces "No disponible" inline below the chip-select via PrintControlError when the backend reports a conflict.
- Edit-mode availability skips self-collision (consumer calls `availabilityService.setCurrentReservationId(...)` in `ngOnChanges`).
- Smoke checklist (b) passes — zero behavioral regression on the user-visible flows.
- `ng build` zero new errors.
- Platform spec count post-Phase-3: 80 (baseline preserved; Path C drops the would-be async-blur spec). Consumer-side new specs: 6 + 2 = 8 (chip-select + availability). Combined: **88**.

**Estimate**: **2-2.5 días**.

### Phase 4 — ESLint allow-list + shim TODO cleanup

**Goal**: remove now-migrated forms from allow-list, refresh stale shim TODOs.

**Files modify:**
- `.eslintrc.cjs` → remove from `allowList`:
  - `**/admin-devices.component.html`
  - `**/reservation-form.component.html`
- `src/app/modules/admin/components/products/product-form/schemas/product-form.schema.ts`
- `src/app/modules/admin/components/products/product-form/schemas/product-form-validators.ts`
- `src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts`
  → Update file-top TODO comments per SHIM TODO CLEANUP block:

```
// LEGACY SHIM — survives until the product-form template migrates
// to <app-dynamic-form>. No target FDD yet — see FDD-031 §3.3 for context.
```

**Acceptance criteria:**
- `npm run lint` passes (admin-devices y reservation-form fuera del allow-list no triggerean `no-raw-form` porque sus templates ahora usan `<app-dynamic-form>`).
- shim files referencing FDD-030 deletion target removed/updated.
- `ng build` zero new errors.

**Estimate**: **0.5 día**.

### Total estimate

| Phase | Estimate | Parallel? |
|---|---|---|
| Phase 1 (Platform extension) | 1-1.5 días | with Phase 2 |
| Phase 2 (admin-devices) | 1.5 días | with Phase 1 |
| Phase 3 (reservation-form) | 2-2.5 días | sequential after Phase 1+2 |
| Phase 4 (Cleanup) | 0.5 día | sequential after Phase 3 |
| **Total wall-clock (1 dev, sequential)** | **5.5-6 días** | — |
| **Total wall-clock (Phase 1+2 parallel)** | **4-4.5 días** | (1)+(2) overlap |

Cierra **F2 — Adoption** per AUDIT-059 §6 phase plan (estimated 3-4 días originalmente; F2 fue split en FDD-030 + FDD-031 + FDD-032, sumando ~10-12 días total — más realista que el estimate original).

---

## Complexity / Risk Analysis

Mirror del patrón establecido en FDD-031 §"Complexity / Risk Analysis".

### admin-devices

| Dimensión | Detalle |
|---|---|
| Custom widget kinds | None — uses generic kinds (text, dropdown, switch). |
| Reactive options | **Critical** — mode dropdown (tenant-feature filter), cash register dropdown (branch + linkability filter). |
| Async validators | None. |
| Cross-field validators | None. |
| Forms per component | 2 (activation code + fleet edit) — distinct `formId`s. |
| `updateOn` requirement | None (no async). |
| Banner usage | No. |
| **Risk** | **LOW** if FDD-031 Phase b (reactive options) is solid (already shipped + 71 specs passing). |

### reservation-form

| Dimensión | Detalle |
|---|---|
| Custom widget kinds | **CRITICAL** — chip-select only (1 widget). customer-autocomplete dropped per §4.3. |
| Reactive options | Required — chip-select option list (zoneGroups signal reshaped via `tableChipGroups`). |
| Async validators | **CRITICAL** — availability check against existing reservations, applied to `tableId`. |
| Cross-field validators | NOT applicable — data model is date+time+duration (no start/end timestamps). |
| Forms per component | 1, hybrid pattern (§5.3) mixing dynamic-form fields + raw widgets bound to same FormGroup. |
| `updateOn` requirement | **CRITICAL** — sin `updateOn: 'blur'`, async availability spammea backend per chip click. |
| Banner usage | No — no formValidators declared. |
| **Risk** | **MEDIUM** — production stress test of widget registry + async validators + updateOn. Hybrid pattern is new territory but a single FormGroup with mixed renderers is standard Reactive Forms. |

### Implication para migration order

**admin-devices primero** porque:
- Valida la reactive options pattern (FDD-031 Phase b) en producción con surface area limitada — 2 forms simples.
- Si reactive options tiene bugs sutiles, surge antes de stack las cross-field + async complications de reservation-form.

**reservation-form después** porque:
- Stress test del extension surface completo de FDD-031 + FDD-032 (widgets + async + cross-field + banner).
- Cualquier issue en reservation-form afecta una surface menos crítica que admin-devices (admins crean reservations menos frecuentemente que activan devices).

---

## Open Questions

OQ1. **Multi-error banner UX**: cuando `formGroup.errors` tiene multiple keys (e.g., date-range AND matching-fields fail simultaneamente), banner shows solo el primero. Multi-error display deferred a FDD-033+.

OQ2. **`$color-error-bg` token** — **RESOLVED (Phase 1 execution)**: grep of `src/` for `--red-50` / `--red-100` returned zero existing consumers, so the project does not consume PrimeNG light-red CSS vars elsewhere. The `$color-error-bg: #FEE2E2` SCSS token was added to `_variables.scss` directly under `$color-error`.

OQ3. **Time-window vs date-range** — **RESOLVED (2026-05-27 correction)**: reservation-form's data model uses `reservationDate` (Date) + `reservationTime` (Date timeOnly) + `durationMinutes` (number), NOT `(startsAt, endsAt)` timestamps. The FDD-031 `date-range` built-in validator does not apply mathematically. `formValidators` is absent from the Phase 3 schema. Decision documented in §Known Deviations.

OQ4. **`updateOn: 'blur'` enforcement**: descriptor field shipped (D6) pero no enforce que consumers usen `'blur'` para descriptors con `asyncValidators`. Lint rule custom podría detectar mismatch — fuera de scope F2. Deferred a FDD-033+.

OQ5. **`provideFormWidget` deduplication scope**: registration component-level (D11) significa que cada consumer registra sus widgets. Si 2+ consumers necesitan el mismo widget (e.g., dos features con chip-select), refactor a shared per Rule of 3. Deferred a evaluation post-F2 deployment.

OQ6. **Catalog extraction Rule-of-3**: shared `error-catalog.ts` entre PrintControlError + PrintFormError (D4) — locked en Phase 1. Si un tercer consumer del catalog surge (e.g., toast service), refactor adicional acceptable.

OQ7. **Raw-field descriptor encoding** (Phase 3 hybrid pattern) — **LOCKED to Path Y**: raw-field controls (`partySize`, `reservationDate`, `reservationTime`) are NOT declared in the schema. Instead, the consumer calls `form.addControl(key, ...)` post-`buildFormGroup()` for each raw field. Rationale: zero platform change (no sentinel kind to add to `FieldKind` union), strict consumer-side boundary, no orchestrator branching for "skip render". Path X (sentinel `kind: '_raw'`) was rejected because it would require platform modification that is out of scope for a consumer migration phase. If a second consumer needs the same hybrid pattern (Rule-of-3), revisit promoting a `RawFieldKind` sentinel to shared library at that time.

OQ8. **`customer-autocomplete` widget revival**: the widget is dropped in Phase 3 (see §4.3). If a future consumer (e.g., POS quick-order entry) needs customer association via a FormControl AND `CustomerService.findById` is added to the backend in a separate FDD, this widget may be promoted to the shared library by Rule-of-3 (POS + reservation + that future consumer = three uses).

---

## Known Deviations / Corrections

- **FDD-029 §12 (d) shim deletion target**: prematurely targeted FDD-030. Corregido: shim survives until product-form TEMPLATE migrates (no target FDD set). TODO comments updated en Phase 4 implementation.
- **FDD-031 OQ1 (cross-field surfacing)** deferred a FDD-032 → RESOLVED vía `<app-print-form-error>` banner shipped en Phase 1.
- **FDD-031 OQ2 (async debounce)** deferred → RESOLVED vía `FieldDescriptor.updateOn` descriptor field shipped en Phase 1 (small platform extension dentro del scope de FDD-032).
- **FDD-032 Phase 3 schema mismatch (2026-05-27 correction)**: the original §12 Phase 3 schema (`{customerId, startsAt, endsAt, tableId, notes}` + `date-range` formValidator) was written without verifying the production reservation-form code. The actual form has `{guestName, guestPhone, partySize, reservationDate, reservationTime, durationMinutes, notes}` plus signal-managed customer/table state. The schema, signal mapping (§5.2), async validator signature (§7.2), banner usage (§6.1), submit flow (§7.3), Apéndice file list, and spec counts (§11.2) were rewritten to match production reality. Process lesson: future consumer-migration FDDs must include a "verify against current code" step before finalizing the wiring sections.
- **`customer-autocomplete` widget dropped from Phase 3**: discovered during the 2026-05-27 correction. Three reasons (full record in §4.3): (a) `CustomerService.findById` does not exist (verified via grep); (b) `CustomerSelectorComponent` already exposes a richer production-ready API than the wrapper would; (c) customer is OPTIONAL in the reservation-form model — patching `guestName`/`guestPhone`, not a primary form field. The 2 customer-autocomplete integration specs are dropped from §11.2 (20 → 18 total). The widget may be revived if a future consumer needs it AND `findById` becomes available (see OQ8).
- **`date-range` cross-field validator not applied to reservation-form**: data model is date+time+duration, not start/end timestamps. The Phase 1 `date-range` builder is shipped and tested via platform specs; it stays available for future consumers whose data model fits.
- **`<app-print-form-error>` banner not used in Phase 3**: no `formValidators` declared in reservation-form schema. The Phase 1 banner remains shipped and exercised via platform specs (5 unit + 2 DynamicForm-integration); it activates for future consumers with cross-field errors.
- **`updateOn: 'blur'` does NOT throttle programmatic `setValue()` calls (Phase 3 execution finding — 2026-05-27)**: the FDD originally claimed `updateOn:'blur'` would suppress async validator runs universally. Investigation during Phase 3 spec execution proved otherwise — Angular's `setValue()` always invokes `updateValueAndValidity()` internally, which always runs async validators regardless of `updateOn`. The option only suppresses `valueChanges` emissions from UI-bound `FormControlDirective` events. Implication: chip-select widget triggers an availability call on each chip click. Acceptable cost (UX latency-of-noise) vs the legacy imperative `checkAvailability()` which already fired on every calendar/duration change. The associated `dynamic-form-builder.service.spec.ts` async-blur integration spec from the original FDD §11.2 plan was DROPPED — verifying the false claim was meaningless.
- **`provideFormWidget()` factory returns `EnvironmentProviders` — incompatible with component-level `providers: []` (Phase 3 execution finding — 2026-05-27)**: the FDD-031 `provideFormWidget()` factory wraps registrations in `makeEnvironmentProviders()` for application / route-level configuration. Component-level `@Component({ providers: [...] })` requires `Provider[]` and rejects `EnvironmentProviders`. Reservation-form (the first consumer to register a widget at component scope) uses the raw `{ provide: FORM_WIDGETS, useValue: { name, component }, multi: true }` shape directly. The factory remains useful for app/route registration; no platform change required. Future FDD could split the factory into `provideFormWidgetAtComponent()` vs the existing environment variant if more consumers need both shapes (Rule-of-3).
- **Custom widget class naming uses `Component` suffix, file uses `.widget.ts` (Phase 3 execution finding — 2026-05-27)**: Angular ESLint's `component-class-suffix` rule rejects class names ending in `Widget`. Resolution: class is `ChipSelectComponent` (Angular convention); file is `chip-select.widget.ts` (FDD-031 convention for FormWidget implementations). The interface `FormWidget` keeps its name. The mismatch is documented; future FDDs may either (a) loosen the ESLint rule to accept `Widget` suffix or (b) standardize on `.component.ts` file names. Chose the documented mismatch for FDD-032 scope to avoid platform / lint configuration changes.

---

## Apéndice — Archivos creados / modificados

### Phase 1 (Platform extension)
**Created (5):**
- `src/app/shared/forms/components/print-form-error.component.{ts,html,scss,spec.ts}`
- `src/app/shared/forms/components/error-catalog.ts`

**Modified (5):**
- `src/app/shared/forms/components/print-control-error.component.ts` (consume error-catalog.ts)
- `src/app/shared/forms/schemas/dynamic-form.schema.ts` (add `updateOn` field)
- `src/app/shared/forms/services/dynamic-form-builder.service.{ts,spec.ts}`
- `src/app/shared/forms/components/dynamic-form.component.{ts,spec.ts}` (banner focus integration)
- `src/app/shared/forms/index.ts` (re-export PrintFormErrorComponent)
- `src/styles/_variables.scss` ($color-error-bg)

### Phase 2 (admin-devices)
**Created (2):**
- `src/app/modules/admin/components/devices/admin-devices-codegen.form.ts`
- `src/app/modules/admin/components/devices/admin-devices-edit.form.ts`

**Modified (3):**
- `src/app/modules/admin/components/devices/admin-devices.component.{ts,html,scss}`

### Phase 3 (reservation-form)

**Created (5):**

- `src/app/modules/admin/components/reservations/reservation-form.form.ts`
- `src/app/modules/admin/components/reservations/widgets/chip-select.widget.ts`
- `src/app/modules/admin/components/reservations/widgets/chip-select.widget.spec.ts`
- `src/app/modules/admin/components/reservations/services/reservation-availability.service.ts`
- `src/app/modules/admin/components/reservations/services/reservation-availability.service.spec.ts`

**NOT created** (deviation — see §4.3): ~~`widgets/customer-autocomplete.widget.ts`~~ + spec.

**Class naming note**: the widget class is `ChipSelectComponent` (Angular `Component` suffix convention); the file is named `chip-select.widget.ts` to preserve the FDD-031 convention for FormWidget implementations.

**Modified (3):**

- `src/app/modules/admin/components/reservations/reservation-form.component.{ts,html,scss}`
- ~~`src/app/shared/forms/services/dynamic-form-builder.service.spec.ts` (+1 async-blur spec)~~ — DROPPED per Path C (Phase 3 execution finding).

### Phase 4 (Cleanup)
**Modified (4):**
- `.eslintrc.cjs` (allow-list reduction)
- `src/app/modules/admin/components/products/product-form/schemas/product-form.schema.ts` (TODO update)
- `src/app/modules/admin/components/products/product-form/schemas/product-form-validators.ts` (TODO update)
- `src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts` (TODO update)

### Smoke doc
- `docs/FDD-032-smoke-checklist.md` (created during Phase 3 or pre-merge)

---

## Changelog

### 2026-05-27 — Initial design

- Platform extension scope agregado (banner + updateOn + catalog extraction) per FDD-031 OQ1 + OQ2 lockdown.
- admin-devices migration designed con reactive options mapping explícito.
- reservation-form migration designed con custom widgets (chip-select + customer-autocomplete), async validator pattern, cross-field date-range, banner integration.
- 6 Open Questions documented.
- Complexity / Risk Analysis tabla — admin-devices LOW, reservation-form MEDIUM-HIGH.
- Migration order: admin-devices first, reservation-form second.
- Triple-delivery FDD: justified vs split alternative.
- Phase 1+2 parallelizable per dependency graph.
- Estimate: 5.5-6 días sequential, 4-4.5 días con parallelization.
- FDD-029 §12 (d) shim deletion target correction documented.

### 2026-05-27 — Phase 3 correction after production-code verification

After Phase 1 and Phase 2 shipped, a pre-execution audit of the Phase 3 prompt revealed a fundamental schema mismatch between this FDD and the actual `reservation-form.component.ts`. The original §12 Phase 3 schema and surrounding sections were rewritten to match production reality. Specific changes:

- **§2.2** rewritten with the actual 7-field model (`guestName`, `guestPhone`, `partySize`, `reservationDate`, `reservationTime`, `durationMinutes`, `notes`) plus outside-form signals (`selectedCustomer`, `selectedTableId`, `noTableAssigned`, `availabilityWarning`, `zoneGroups`, `isSaving`).
- **§4.2** clarified that the consumer's existing `zoneGroups` computed is reshaped to `ChipGroup[]` via a new `tableChipGroups` computed; the widget does NOT re-implement grouping.
- **§4.3** customer-autocomplete widget DROPPED. Three reasons: `CustomerService.findById` does not exist, `CustomerSelectorComponent` already covers the use case with richer API, and customer is OPTIONAL in the form model (patches `guestName`/`guestPhone`, not a primary field).
- **§5.2** signal mapping table corrected: `selectedCustomer` stays OUTSIDE the form; `tables` is preserved; `availabilityWarning` is replaced by the async validator's inline `PrintControlError`.
- **§5.3** documents the new hybrid form pattern: a single FormGroup with `<app-dynamic-form>` rendering the schema-friendly fields alongside raw widgets (`<p-calendar>`, partySize stepper, `CustomerSelectorComponent`) bound via `formControlName` to the same group.
- **§6.1** banner illustrative example for reservation-form removed — the data model has no cross-field validators applicable, so the banner is not used in this consumer.
- **§7.2** async validation sequence rewritten with the real `reservationService.checkAvailability(tableId, dateStr, timeStr, durationMinutes, excludeId?)` signature (5 args, not start/end timestamps). `currentReservationId` is provided to the service via a public setter that the consumer invokes in `ngOnChanges`.
- **§7.3** submit flow scoped to Priority 1 only for Phase 3 (Priority 2 / banner-focus path is platform-shipped but does not activate without `formValidators`).
- **§10.3** customer-autocomplete a11y section removed; replaced with a note that `CustomerSelectorComponent` is used directly.
- **§10.4** focus-priority note clarifies Phase 3 exercises Priority 1 only.
- **§11.1 Section (b)** smoke checklist (8 steps) rewritten to match the migrated UX: customer optional path, chip-select grouped by zone with `aria-pressed`, async availability on blur, edit-mode self-collision skip, required-field validation. No step exercises the banner.
- **§11.2** spec totals revised: 18 new (was 20) → combined 89 (was 91). Customer-autocomplete integration specs (2) dropped.
- **§12 Phase 3** sub-phase rewritten with the revised schema (8 keys including `tableId`), the hybrid pattern, the `setCurrentReservationId` setter on the availability service, the missing `formValidators` documentation, and acceptance criteria scoped to what actually ships.
- **§Apéndice** Phase 3 file list updated: 5 created (was 4 + the dropped customer-autocomplete file) including the new spec files; 4 modified (added the builder spec for the async-blur integration test).
- **§Open Questions** added OQ7 (raw-field descriptor encoding decision) and OQ8 (customer-autocomplete widget revival path).
- **Process lesson recorded** in §Known Deviations: consumer-migration FDDs must verify against production code before finalizing wiring sections. This FDD passed multiple audits referencing only the FDD itself; the mismatch was invisible until the Phase 3 prompt's PREP step read the actual reservation-form code.

### 2026-05-27 — Phase 3 execution corrections (Path C)

Phase 3 implementation surfaced three additional findings that required FDD updates separate from the pre-execution design corrections:

- **§NF-4 + §7.2**: corrected the `updateOn:'blur'` semantics. The option only throttles UI-binding `valueChanges` events from `FormControlDirective`; it does NOT suppress async validators on programmatic `setValue()`. The chip-select widget calls `setValue()` on each click → each click triggers a backend availability call. Documented as a known caveat; consequence accepted (cost matches the legacy imperative `checkAvailability()` cadence).
- **§11.2 + §12 Phase 3 acceptance**: dropped the "Async validator integration spec (1)" from the platform builder spec file. The original spec verified the false `updateOn:'blur'` claim — removing it preserves spec accuracy. Spec totals revised: 17 new (was 18) → combined 88 (was 89). Phase 3 specs: 8 (was 9).
- **§12 Phase 3 providers example**: replaced the `provideFormWidget('chip-select', ChipSelectWidget)` invocation with the raw `{ provide: FORM_WIDGETS, useValue: ..., multi: true }` shape. The factory returns `EnvironmentProviders` for app/route scope; component-level `providers: []` requires `Provider[]`. The factory remains useful for app/route registration.
- **§Apéndice + acceptance**: class name uses `Component` suffix (Angular ESLint convention), file naming uses `.widget.ts` (FDD-031 convention). Documented mismatch.
- **§Known Deviations**: 3 new entries documenting the findings, the workarounds, and future paths for revisiting if Rule-of-3 emerges.

All findings are documented surfaces of pre-existing platform behavior — no platform code was changed during Phase 3 execution. Phase 3 ships 7 created + 3 modified files (was 7+4 in the original plan).
