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
3. **reservation-form migration** (Phase 3): 1 form con custom widgets (`chip-select`, `customer-autocomplete`), async validator (availability check), cross-field validator (date-range), y consumer-side `ReservationAvailabilityService`.

Más cleanup en Phase 4 (ESLint allow-list reduction + product-form shim TODO comments).

**Estimación:** 5-5.5 días sequencial, **~4-4.5 días con Phase 1+2 paralelizables**.

### Closes / Related

- Resuelve [FDD-031 OQ1](FDD-031-forms-platform-extensions.md#open-questions) — cross-field error surfacing → entregado vía `<app-print-form-error>` banner.
- Resuelve [FDD-031 OQ2](FDD-031-forms-platform-extensions.md#open-questions) — async debounce → entregado vía `FieldDescriptor.updateOn` descriptor field.
- Corrige [FDD-029 §12 (d)](FDD-029-metadata-driven-forms.md#sub-phase-d--existing-consumer-migration-product-form) — el shim del product-form NO se dissolverá en FDD-030; sobrevive hasta que migre el template del product-form. Se actualizan los TODO comments en Phase 4.
- Materializa [AUDIT-059 §4.2](AUDIT-059-forms-and-ui-consistency.md#42--admin-devices-component--validates-tenant-gating) y [§4.3](AUDIT-059-forms-and-ui-consistency.md#43--reservation-form-component--stretches-the-abstraction).
- Cierre formal de **F2 — Adoption** per AUDIT-059 §6 phase plan.

### Scope rationale — triple-delivery FDD

A diferencia de FDD-031 (puro platform) o FDD-030 (puro consumer), FDD-032 mezcla platform extension + 2 consumer migrations. Razón:

- El `<app-print-form-error>` banner es necesario **por** reservation-form (cross-field errors). Splittear lo metería en un FDD intermedio que co-evoluciona con reservation-form — overhead.
- admin-devices + reservation-form son la totalidad del backlog de F2 consumer migrations. Splittearlos en FDDs separados dejaría F2 perpetuamente abierto sin ganancia.

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

[src/app/modules/admin/components/reservations/reservation-form.component.ts](../src/app/modules/admin/components/reservations/reservation-form.component.ts). Estado actual:

- **1 form** hand-rolled.
- **Custom UI patterns no soportados por F1**:
  - **Chip selector** para tables agrupadas por zona — current usa `<div class="chip">` ad-hoc.
  - **Customer autocomplete** — usa el existing `CustomerSelectorComponent`.
- **Availability check** ad-hoc dentro de `saveReservation()` (no como validator).
- **Cross-field constraints** (date-range, time-window) validadas manualmente.
- **Signals**: `tables`, `selectedTableId`, `noTableAssigned`, `availabilityWarning`, `zoneGroups`, `selectedCustomer`, `isSaving`.

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
- **F-4** reservation-form: 1 form migrado con custom widgets (chip-select, customer-autocomplete), async validator (availability), cross-field validator (date-range).
- **F-5** Custom widgets registrados via `provideFormWidget` en el reservation-form component's standalone providers.
- **F-6** `ReservationAvailabilityService` implementa `AsyncValidatorService` con providedIn: 'root', lee sibling controls vía `control.parent`.
- **F-7** Banner integration con DynamicForm.submit() focus management: focus el banner cuando hay formValidator errors pero no individual control invalid (ver §10 para priority rule).
- **F-8** ESLint allow-list reducida en Phase 4 (eliminar admin-devices + reservation-form entries).
- **F-9** product-form shim TODO comments actualizadas en Phase 4 (eliminar referencia stale a FDD-030).

### 3.2 Non-functional requirements

- **NF-1** Zero behavioral regression en admin-devices + reservation-form (smoke gate manual).
- **NF-2** F1 + FDD-031 specs (71 total) deben seguir pasando post-refactor del PrintControlError catalog extraction. Phase 1 acceptance criterion explícito.
- **NF-3** Custom widgets siguen el touch-target floor (`$touch-target-pos` = 48px) y consumen tokens del `_variables.scss`.
- **NF-4** Async validators usan `updateOn: 'blur'` para evitar API spam — enforced vía descriptor field, no manual.
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
@for (group of resolvedGroups(); track group.groupLabel) {
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
- `chip.value` type matches el control's expected value type. Para reservation-form tableId: `number | null`.

**Estimated LOC:** ~80.

### 4.3 `customer-autocomplete` widget (THIN WRAPPER)

Lives at: [src/app/modules/admin/components/reservations/widgets/customer-autocomplete.widget.ts](../src/app/modules/admin/components/reservations/widgets/customer-autocomplete.widget.ts).

Wrappea [src/app/shared/components/customer-selector/customer-selector.component.ts](../src/app/shared/components/customer-selector/customer-selector.component.ts) preserved as-is.

```ts
@Component({
  selector: 'app-customer-autocomplete',
  standalone: true,
  imports: [CustomerSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerAutocompleteWidget implements FormWidget, OnInit {
  @Input({ required: true }) descriptor!: FieldDescriptor;
  @Input({ required: true }) control!: AbstractControl;
  @Input({ required: true }) formId!: string;

  preselected: Customer | null = null;
  private readonly customerService = inject(CustomerService);

  ngOnInit(): void {
    // Edit-mode hydration: if control.value (Customer.id) is non-null,
    // fetch the Customer and pass as pre-selected to the inner component.
    const customerId = this.control.value as number | null;
    if (customerId !== null) {
      this.customerService.findById(customerId).subscribe(c => this.preselected = c);
    }
  }

  onCustomerSelected(customer: Customer | null): void {
    // Store ONLY the id in the form value — keeps payload JSON-serializable.
    this.control.setValue(customer?.id ?? null);
  }
}
```

**Template:**
```html
<app-customer-selector
  [preselected]="preselected"
  (customerSelected)="onCustomerSelected($event)"
/>
```

**Estimated LOC:** ~30.

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
| `tables`, `selectedTableId` | **MOVED INTO FORM** | control bound a chip-select widget |
| `availabilityWarning` | **ELIMINATED** | surfaced vía async validator + banner |
| `zoneGroups` computed | **PRESERVED** | passes a chip-select options Signal |
| `selectedCustomer` | **ELIMINATED** | control.value = Customer.id. Save flow: si backend payload necesita el Customer completo, consumer llama `customerService.findById(formGroup.value['customerId'])` antes de ensamblar payload |
| `isSaving` | **PRESERVED** | UI toggle |
| `noTableAssigned` | **PRESERVED OUTSIDE FORM** | UI checkbox que hides/shows chip-select via @if en template; NO un form-value field |

### 5.3 FormGroup ownership preserved

Mismo patrón que F1 / FDD-030:
- Consumer construye el FormGroup vía `DynamicFormBuilderService.buildFormGroup(schema)` (reservation-form needs cross-field validators + async — buildFormGroup applies them all).
- admin-devices usa `buildControls()` + manual `fb.group()` (no formValidators, simpler).
- `<app-dynamic-form>` consume el FormGroup pasado por reference.

---

## 6. UI/UX

### 6.1 Banner visual placement

```html
<!-- Reservation-form template (illustrative): -->
<app-print-form-error [formGroup]="reservationForm" [formId]="'reservation-form'" />
<app-dynamic-form
  [schema]="schema"
  [formGroup]="reservationForm"
  [formId]="'reservation-form'"
  ...
/>
```

- Banner ABOVE the form, full-width.
- admin-devices: **NO banner** (no formValidators).
- reservation-form: banner + inline PrintControlError on individual controls. Usuario ve ambos: form-level errors (banner) + field-level errors (inline below field).

### 6.2 Custom widgets visual style

- `chip-select`: PrimeFlex-friendly, chip-style buttons agrupados por section. Active state via `$color-primary` background + white text.
- `customer-autocomplete`: hereda el visual del existing `CustomerSelectorComponent`.
- Touch target: `min-height: $touch-target-pos` (48px) en chip + autocomplete input.

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

```
1. ReservationAvailabilityService.check(control, context):
   - Read sibling values via control.parent:
       const start = control.parent?.get('startsAt')?.value;
       const end = control.parent?.get('endsAt')?.value;
       const tableId = control.parent?.get('tableId')?.value;
   - Bail out if any required value missing:
       if (!start || !end || !tableId) return of(null);  // inactive
   - Call backend:
       return reservationService
         .checkAvailability(start, end, tableId, currentReservationId)
         .pipe(map(free => free ? null : { availability: true }));

2. FormControl tiene updateOn: 'blur' (vía descriptor.updateOn — D6).
   → Validator NO corre per keystroke, solo al blur.

3. control.errors === { availability: true } → PrintControlError surfaces "No disponible".
```

### 7.3 reservation-form submit con form-level error sequence

```
1. User clicks Save → DynamicForm.submit().
2. markAllAsTouched() → re-evaluate validators.
3. Branch based on error type (priority rule — Section 10):

   Priority 1: Individual control invalid → existing FDD-029 focus-first-invalid logic.
     - Sync errors on controls AND async errors that already resolved → focus the field.

   Priority 2: ONLY formGroup.errors (cross-field) but every control is valid →
     focus the BANNER via document.getElementById(`${formId}-form-error`).
     Banner has tabindex="-1" → focus works programmatically.

   Both paths: (submitted) NOT emitted.

4. If valid (no errors anywhere): (submitted) emits → consumer's
   onFormSubmitted handles save.
```

---

## 8. Performance

- **Banner**: minimal — un solo subscriber a `formGroup.statusChanges` via `takeUntilDestroyed`. OnPush detects on signal change.
- **chip-select**: O(zones × tables) render. Para reservation-form típico (≤5 zones × ≤10 tables each = ≤50 chips), perf negligible.
- **customer-autocomplete**: inherits CustomerSelectorComponent perf characteristics (debounced search, virtual scroll si aplica).
- **Async availability**: rate-limited vía `updateOn: 'blur'` (descriptor field — D6). Sin spam de API on each keystroke.

---

## 9. Error Handling

### 9.1 Compile-time

- `<app-print-form-error>` Inputs marcados `{ required: true }` — fallar al pasar formGroup o formId surfaces como TypeScript error.
- `chip-select` `ChipGroup` interface tipa los options — typos en property names caught at compile.
- `FieldDescriptor.updateOn` is a literal union — agent IDE auto-complete preserves valid values.

### 9.2 Runtime

- **Banner sin formGroup**: defensive guard — si `formGroup` undefined al inicio (race condition), renderiza empty silently.
- **chip-select setValue(unknown)** con value que NO existe en options: log warning en dev mode (`console.warn('[chip-select] setValue with unknown value:', value)`), retain the value (don't reset). Permite cases edge (control.value pre-existing antes que options carguen).
- **customer-autocomplete edit hydration race**: si `findById` falla, el wrapper retains `preselected = null` y el inner component shows empty — user puede re-seleccionar.
- **Async validator service token missing**: `injector.get` throws (FDD-031 defensive behavior preserved).

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

### 10.3 customer-autocomplete

Inherits `CustomerSelectorComponent` a11y — unchanged.

### 10.4 Focus management priority on submit invalid

**Locked priority rule** (Phase 1 acceptance criterion):

1. **Individual control invalid wins**: si hay AL MENOS UN control invalid (sync OR async error resolved), focus va al **primer control invalid** (existing FDD-029 §10 behavior preserved).
2. **Banner solo cuando puro form-level**: si TODOS los controls son valid PERO `formGroup.errors` está presente (cross-field validator failed), focus va al **banner** vía `document.getElementById`.

Rationale: el control-level error es más actionable (user sabe qué arreglar). Form-level errors son contextuales (start/end no encajan) — el banner contextualiza pero requiere ver ambos campos.

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

1. **Happy path create**: seleccionar customer + table + date + time → save → reservation aparece en la lista.
2. **Customer autocomplete search**: typear en el autocomplete → dropdown shows matches → seleccionar → `formGroup.value.customerId === customer.id`.
3. **Customer autocomplete edit mode**: open existing reservation → autocomplete prepopulated con el customer (hydration via `findById`).
4. **Chip-select tables grouped**: tables aparecen agrupadas por zona, click selecciona → `formGroup.value.tableId === table.id`. Active chip highlighted.
5. **`noTableAssigned` toggle**: marcar checkbox → chip-select desaparece (consumer `@if`), save funciona sin table.
6. **Async availability validator**: seleccionar table + date + time que conflicta con reservation existente → blur → PrintControlError shows "No disponible" debajo del field. (No spamea backend on each keystroke — verify Network tab.)
7. **Cross-field date-range**: ingresar startsAt > endsAt → click save → **BANNER muestra** "Fecha de inicio debe ser anterior a la de fin", form NO submits.
8. **Submit with form-level error focuses banner**: trigger date-range error → click save → banner recibe focus (verify con TAB-into vs document.activeElement).

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

**customer-autocomplete integration specs (2):**
1. Init con `control.value` non-null → `findById` called → `preselected` set.
2. `customerSelected` event → `control.setValue(customer.id)`.

**updateOn extension specs (2):**
1. `updateOn: 'blur'` applied to FormControl construction.
2. Default 'change' when descriptor.updateOn omitted.

**Async validator integration specs** (in existing builder spec file, 1):
1. Async validator on a descriptor with `updateOn: 'blur'` doesn't fire on `setValue` programmatically — only on actual blur event (or via `markAsTouched` + `updateValueAndValidity({ emitEvent })`).

**ReservationAvailabilityService specs (2):**
1. Returns null when any sibling value missing (inactive).
2. Maps backend response correctly: free → null, conflict → `{ availability: true }`.

**Banner integration con DynamicForm.submit() (2):**
1. Submit with formValidator failure (no control errors) → banner.focus() called.
2. Submit with control errors only → existing focus-first-invalid behavior preserved (banner NOT focused).

**Total new specs**: **20** (5 banner + 6 chip-select + 2 customer-autocomplete + 2 updateOn + 1 async-blur + 2 availability service + 2 banner-DynamicForm integration).

### 11.3 F1 + FDD-031 regression gate

**71 specs must continue passing** post-refactor del PrintControlError catalog extraction. Phase 1 acceptance criterion explícito — si alguno falla, el refactor introdujo drift observacional.

**Total combined specs target**: 71 + 20 = **91 specs**.

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

### Phase 3 — reservation-form migration

**Goal**: replace hand-rolled reservation-form with full extension surface (custom widgets, async, cross-field).

**Files create:**
- `src/app/modules/admin/components/reservations/reservation-form.form.ts`
- `src/app/modules/admin/components/reservations/widgets/chip-select.widget.ts`
- `src/app/modules/admin/components/reservations/widgets/customer-autocomplete.widget.ts`
- `src/app/modules/admin/components/reservations/services/reservation-availability.service.ts`

**Files modify:**
- `src/app/modules/admin/components/reservations/reservation-form.component.ts` — agregar standalone providers:

```ts
@Component({
  selector: 'app-reservation-form',
  standalone: true,
  imports: [
    DialogModule,
    DynamicFormComponent,
    PrintFormErrorComponent,
    // ...
  ],
  providers: [
    provideFormWidget('chip-select', ChipSelectWidget),
    provideFormWidget('customer-autocomplete', CustomerAutocompleteWidget),
  ],
  // ...
})
```

- `src/app/modules/admin/components/reservations/reservation-form.component.html` — replace form block con banner + dynamic-form composition.
- `src/app/modules/admin/components/reservations/reservation-form.component.scss` — cleanup BEM redundancies (mismo patrón que admin-users en FDD-030).

**Schema highlights:**

```ts
export const RESERVATION_FORM_SCHEMA: DynamicFormSchema<ReservationFormKey> = {
  sections: [
    {
      id: 'customer',
      title: 'Cliente',
      fields: [
        { key: 'customerId', kind: 'customer-autocomplete', label: 'Cliente',
          defaultValue: null, validators: ['required'] },
      ],
    },
    {
      id: 'when',
      title: 'Fecha y hora',
      fields: [
        { key: 'startsAt', kind: 'text', label: 'Inicio', defaultValue: '',
          validators: ['required'] },
        { key: 'endsAt', kind: 'text', label: 'Fin', defaultValue: '',
          validators: ['required'] },
      ],
    },
    {
      id: 'table',
      title: 'Mesa',
      showSection: (s) => /* gated by noTableAssigned consumer-side */,
      fields: [
        { key: 'tableId', kind: 'chip-select', label: 'Mesa', defaultValue: null,
          updateOn: 'blur',  // critical for async validator
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
  formValidators: [
    { kind: 'date-range', startKey: 'startsAt', endKey: 'endsAt' },
  ],
};
```

**Acceptance criteria:**
- Form rendered via `<app-dynamic-form>` + banner above.
- Custom widgets registered + rendered.
- Async validator fires on blur (not on each keystroke).
- Cross-field validator surfaces in banner.
- Submit with form-level error focuses banner.
- Smoke checklist (b) passes — zero behavioral regression.
- `ng build` zero new errors.

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
| Custom widget kinds | **CRITICAL** — chip-select + customer-autocomplete. 2 widgets to ship. |
| Reactive options | Required — chip-select option list (zoneGroups signal). |
| Async validators | **CRITICAL** — availability check against existing reservations. |
| Cross-field validators | **CRITICAL** — date-range. |
| Forms per component | 1, con all 4 extension types active. |
| `updateOn` requirement | **CRITICAL** — sin `updateOn: 'blur'`, async availability spammea backend per keystroke. |
| Banner usage | Yes — surfaces cross-field errors. |
| **Risk** | **MEDIUM-HIGH** — first stress test of widget registry + async validators + banner + updateOn in production. |

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

OQ2. **`$color-error-bg` token**: banner necesita un background light-red para visibility. Propuesta: agregar `$color-error-bg: #FEE2E2` a `_variables.scss`. **VERIFICAR PRIMERO** si PrimeNG ya expone `--red-50` o `--surface-50` equivalente — si sí, consumirlo en vez de extender el token file.

OQ3. **Time-window vs date-range**: si reservation-form's `startsAt`/`endsAt` son full timestamps (recommended), `date-range` built-in validator suffices. Si fueran fields separados (date + time), usar `custom` kind con validator function. **RECOMMENDATION**: full timestamps + date-range — match con backend representation existente.

OQ4. **`updateOn: 'blur'` enforcement**: descriptor field shipped (D6) pero no enforce que consumers usen `'blur'` para descriptors con `asyncValidators`. Lint rule custom podría detectar mismatch — fuera de scope F2. Deferred a FDD-033+.

OQ5. **`provideFormWidget` deduplication scope**: registration component-level (D11) significa que cada consumer registra sus widgets. Si 2+ consumers necesitan el mismo widget (e.g., dos features con chip-select), refactor a shared per Rule of 3. Deferred a evaluation post-F2 deployment.

OQ6. **Catalog extraction Rule-of-3**: shared `error-catalog.ts` entre PrintControlError + PrintFormError (D4) — locked en Phase 1. Si un tercer consumer del catalog surge (e.g., toast service), refactor adicional acceptable.

---

## Known Deviations / Corrections

- **FDD-029 §12 (d) shim deletion target**: prematurely targeted FDD-030. Corregido: shim survives until product-form TEMPLATE migrates (no target FDD set). TODO comments updated en Phase 4 implementation.
- **FDD-031 OQ1 (cross-field surfacing)** deferred a FDD-032 → RESOLVED vía `<app-print-form-error>` banner shipped en Phase 1.
- **FDD-031 OQ2 (async debounce)** deferred → RESOLVED vía `FieldDescriptor.updateOn` descriptor field shipped en Phase 1 (small platform extension dentro del scope de FDD-032).

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
**Created (4):**
- `src/app/modules/admin/components/reservations/reservation-form.form.ts`
- `src/app/modules/admin/components/reservations/widgets/chip-select.widget.ts`
- `src/app/modules/admin/components/reservations/widgets/customer-autocomplete.widget.ts`
- `src/app/modules/admin/components/reservations/services/reservation-availability.service.ts`

**Modified (3):**
- `src/app/modules/admin/components/reservations/reservation-form.component.{ts,html,scss}`

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
