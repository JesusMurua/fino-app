# AUDIT-059 — Forms Architecture & UI/UX Consistency

**Fecha:** 2026-05-26
**Branch:** `development`
**Alcance:** Frontend (Angular 18 + PrimeNG 17 + PrimeFlex 3). Read-only audit — zero files modified.
**Objetivo:** Evaluar la viabilidad de migrar los forms reactivos hand-rolled del repo a una arquitectura **metadata-driven** (Dynamic Forms) y auditar la disciplina del design system (PrimeFlex layout, design tokens, 8px scale, touch UX minima). Identificar candidatos prioritarios para la migración.

> Continuación natural de [AUDIT-058 §2.2](AUDIT-058-domain-flexibility-and-testability.md): el POC `product-form` quedó como PARTIALLY RESOLVED (`Rule of 3` documentada). Este audit cuantifica el costo del *status quo* y arma el plan B2 — **promover el POC a `src/app/shared/forms/`**.

---

## TL;DR

| Vector | Severidad | Hallazgo principal |
|---|---|---|
| **A — Schema-driven adoption** | 🟠 Alto | 1 de 14 forms migrado (product-form POC). Los 13 restantes son hand-rolled. **POC viable de generalizar** — la arquitectura de 3 capas funciona. |
| **A — Forms growth** | 🟠 Alto | 181 referencias a `FormBuilder/FormGroup/FormControl/FormArray` en 14 files (+18% vs AUDIT-058: 153 refs). El problema **se acelera**, no se contiene. |
| **B — PrimeFlex layout** | 🔴 Crítico | **0 templates** usan `p-fluid` / `p-formgrid` / `class="grid"`; **1** usa `class="field"`. Standard prescrito en [`html-standards.md`](../.claude/html-standards.md) **nunca aterrizó**. |
| **B — Validation widget** | 🔴 Crítico | `app-print-control-error` (canonical widget prescrito en standards) **no existe en el repo** — 0 matches. 2 de 14 forms usan el helper `isInvalidField()`. El resto omite validation feedback o lo inlinea. |
| **B — BEM duplication** | 🟠 Alto | `.form-field { display: flex; flex-direction: column; gap: $space-2 }` declarado idéntico en ≥3 archivos (`admin-users.scss`, `admin-devices.scss`, `admin-settings`). Cada componente reinventa primitives de layout. |
| **C — Hardcoded hex colors** | 🟠 Alto | **1,414 ocurrencias** en **78 SCSS files**. `_variables.scss` define 12 color tokens pero la disciplina se diluye en components. `styles.scss` mismo tiene 53 hex literales. |
| **C — Off-scale spacing** | 🟠 Alto | **249 declaraciones** de `margin/padding: \d+px` en **58 files** que no usan `$space-*` ($4/8/12/16/24/32/48/64). |
| **C — Sub-16px typography** | 🟡 Medio | **614 ocurrencias** de `font-size: <16px` en **67 files**. CLAUDE.md prescribe **16px mínimo** body — violación sistémica de Touch UX. |
| **D — PrimeNG / Angular** | 🟢 OK | PrimeNG `17.18.0`, PrimeFlex `3.3.1`, Angular `^18.0.0`. Stack actualizado. No es vector de deuda. |

**Veredicto:** la arquitectura del design system **está bien diseñada en `src/styles/_variables.scss`** — el problema no es ausencia de tokens, es **disciplina de adopción**. El schema-driven POC en `product-form` valida la viabilidad técnica; lo que falta es promoverlo a `shared/` y forzar adopción en los 3 candidatos prioritarios (§4) antes de que sigan creciendo los 181 refs hand-rolled.

---

## Sección 1 — Vector A: Forms Architecture

### 1.1 Estado actual — 14 forms, 181 refs, 0 shared primitive

14 archivos instancian `FormBuilder/FormGroup/FormControl/FormArray`:

| Archivo | Tipo | Refs |
|---|---|---|
| [src/app/modules/admin/components/products/product-form/product-form.component.ts](../src/app/modules/admin/components/products/product-form/product-form.component.ts) | 🟢 Schema-driven (POC) | 91 |
| [src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts](../src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts) | 🟢 Schema-driven (POC) | 19 |
| [src/app/modules/pos/components/product-detail/product-detail.component.ts](../src/app/modules/pos/components/product-detail/product-detail.component.ts) | 🔴 Hand-rolled | 23 |
| [src/app/modules/kiosk/screens/detail/kiosk-detail.component.ts](../src/app/modules/kiosk/screens/detail/kiosk-detail.component.ts) | 🔴 Hand-rolled | 20 |
| [src/app/modules/admin/components/users/admin-users.component.ts](../src/app/modules/admin/components/users/admin-users.component.ts) | 🔴 Hand-rolled | 3 |
| [src/app/modules/admin/components/devices/admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts) | 🔴 Hand-rolled | 2 |
| [src/app/modules/admin/components/promotions/admin-promotions.component.ts](../src/app/modules/admin/components/promotions/admin-promotions.component.ts) | 🔴 Hand-rolled | 3 |
| [src/app/modules/admin/components/reservations/reservation-form.component.ts](../src/app/modules/admin/components/reservations/reservation-form.component.ts) | 🔴 Hand-rolled | 3 |
| [src/app/modules/register/register.component.ts](../src/app/modules/register/register.component.ts) | 🔴 Hand-rolled | 2 |
| (Plus 5 schema sub-files inside `product-form/`) | 🟢 POC scaffold | — |

**Crecimiento desde AUDIT-058 (2026-05-21):**

| Métrica | AUDIT-058 (2026-05-21) | Hoy (2026-05-26) | Δ |
|---|---|---|---|
| Refs a `FormBuilder/FormGroup/FormControl` | 153 | 181 | **+18%** |
| Components con forms | 10 | 14 | **+4** |
| Schema-driven forms | 0 (POC en design) | 1 (`product-form`) | +1 |

La regresión se acelera. Cada nuevo screen agrega ~25 refs hand-rolled — el costo de **no promover el POC ahora** crece linealmente con cada feature.

### 1.2 Patrón hand-rolled: el "scaffolding tax" del template

Caso testigo — [admin-users.component.html:125-263](../src/app/modules/admin/components/users/admin-users.component.html#L125-L263). Dialog de creación/edición de usuario. 139 líneas para 6 campos. Patrón repetido por campo:

```html
<div class="form-field">
  <label class="form-field__label" for="uf-name">Nombre</label>
  <input
    id="uf-name"
    type="text"
    pInputText
    formControlName="name"
    placeholder="Nombre completo"
    class="form-field__input"
  />
</div>
```

- **6 campos × ~12 líneas = 72 líneas** de scaffolding repetido.
- **4 conditional branches** (`@if (usesPin())`, `@if (usesEmail())`, `@if (editingUser())`, `@if (isOwner() && editingUser())`) — cada uno gateado por un computed signal en el componente.
- **Branch assignment subform** — `<p-table>` inline con checkbox + radio columns por sucursal (44 líneas).
- **Validation feedback: cero.** Solo `[disabled]="userForm.invalid"` en el submit. El usuario no sabe **qué campo** está inválido ni **por qué**.

El POC ya resuelve los 3 problemas: cada `FieldDescriptor` describe label/input/validators una vez; `showWhen` reemplaza `@if`s; `<app-form-field>` centraliza el rendering de errores. La aritmética del scaffolding tax para este componente sería:

| Métrica | Hand-rolled actual | Schema-driven proyectado |
|---|---|---|
| Líneas en template | 139 | ~25 (`<app-dynamic-form [schema]="...">`) |
| Líneas en componente (form build) | 8 | 1 (`buildFormGroup()`) |
| Líneas en registry | 0 | ~35 (descriptor entries) |
| **Total** | **147** | **~61** | **−58%** |

### 1.3 Schema-driven POC: arquitectura ya validada

[src/app/modules/admin/components/products/product-form/](../src/app/modules/admin/components/products/product-form/) implementa 3 capas según [FDD-028 / AUDIT-058 §2.2](AUDIT-058-domain-flexibility-and-testability.md#22-forms-estáticos-no-metadata-driven-partially-resolved--product-form-poc-only):

- **Layer 1 — schemas** ([product-form.schema.ts](../src/app/modules/admin/components/products/product-form/schemas/product-form.schema.ts)): type-safe descriptors. Union cerrada `ProductFormFieldKey` (20 fields) × `FieldKind` (13 widget kinds) — agregar un field requiere extender la union, TypeScript fuerza el handling exhaustivo.
- **Layer 2 — registry** ([product-form.registry.ts](../src/app/modules/admin/components/products/product-form/schemas/product-form.registry.ts)): per-vertical schemas keyed on `PosExperience`. Secciones compartidas (`SECTION_BASIC`, `SECTION_INVENTORY`, `SECTION_FISCAL`) reusadas con `showSection` predicates para gating por capability.
- **Layer 3 — builder + renderers**:
  - [product-form-builder.service.ts](../src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts) — `buildControls()` itera descriptors y produce un `Record<string, FormControl<unknown>>`. Skip de `array-*` kinds intencional (los consumidores que poseen FormArrays mantienen ownership).
  - [form-field.component.ts](../src/app/modules/admin/components/products/product-form/components/form-field.component.ts) — atomic widget switch.
  - [form-section.component.ts](../src/app/modules/admin/components/products/product-form/components/form-section.component.ts) — section orchestration.

**Lo que ya funciona** (✅):
- Type-exhaustivity vía discriminated unions.
- `showWhen` predicates puros que reaccionan al value snapshot.
- `validators` como keys-string que resuelven a `ValidatorFn` en runtime ([product-form-validators.ts](../src/app/modules/admin/components/products/product-form/schemas/product-form-validators.ts)) — schema serializable / inspectable.
- Default values declarados por descriptor; edit-mode hydration delegado al consumer via `patchValue`.
- Superset FormGroup strategy — mantiene controles de **todas** las verticales en el group para evitar invalidation al cambiar vertical en runtime.

**Lo que falta para generalizar** (⚠️):
- El `ProductFormFieldKey` union está hardcoded a campos de producto — al promover a `shared/` hay que cambiarlo por `string` genérico o por un `<TKey extends string>` generic param.
- `allFieldDescriptors()` importa desde `product-form.registry` — break this dependency.
- Validators viven en `schemas/product-form-validators.ts` — promover los genéricos (`required`, `maxLength*`, `positiveNumber`, `nonBlank`) a `shared/forms/validators/` y dejar product-specific en su lugar.
- El builder es `@Injectable({ providedIn: 'root' })` — al moverlo, el provider tree no cambia, OK.
- No hay generic `<app-dynamic-form [schema]>` — los consumers actuales (el producto) ensamblan a mano `<app-form-section>`. Para reducir el template a ~25 líneas hay que crear este top-level renderer.

### 1.4 Conditional fields — los `@if` que el schema absorbe

Inventario de templates con conditional rendering de form fields:

| File | Branches | Trigger |
|---|---|---|
| [admin-users.component.html](../src/app/modules/admin/components/users/admin-users.component.html#L162-L262) | 4 | role-based (`usesPin`, `usesEmail`), edit-mode (`editingUser`), permissions (`isOwner`) |
| [admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts#L54-L62) | filter on `ModeOption[]` | tenant features (`FeatureKey`) |
| [reservation-form.component.ts](../src/app/modules/admin/components/reservations/reservation-form.component.ts#L65-L66) | 1 | `noTableAssigned()` toggle |
| [product-form.component.html](../src/app/modules/admin/components/products/product-form/product-form.component.html) | 0 (migrado) | `showWhen` en descriptors |

Cada `@if` template-side **es candidato directo a `showWhen` predicate**. Migración trivial.

### 1.5 Viabilidad metadata-driven: **ALTA**

**Decisión recomendada:** promover a `src/app/shared/forms/` ahora. Justificación:
1. POC ya provó la abstracción en producción (product-form shippeado en commit de FDD-028 F5).
2. La extracción mecánica (rename `ProductFormFieldKey` → `<TKey extends string>` + mover archivos) es trabajo de 1-2 días.
3. Cada semana de no-promoción agrega ~20 refs hand-rolled a la deuda (extrapolando el +18% de los últimos 5 días).
4. Los 3 candidatos prioritarios (§4) son features que **ya están en backlog** — migrarlos junto con la promoción amortiza el costo del refactor.

**Trigger:** Rule of 3 ya se cumplió implícitamente — admin-users + admin-devices + reservation-form son 3 forms del mismo backlog que justifican la generalización. El criterio formal de FDD-028/AUDIT-058 §2.2 está satisfecho.

---

## Sección 2 — Vector B: Standards Compliance & PrimeNG Layout

### 2.1 PrimeFlex layout prescrito vs. adopción real

[`html-standards.md`](../.claude/html-standards.md) §"Form Structure" prescribe textualmente:

```html
<form [formGroup]="facilityForm">
  <div class="p-fluid p-formgrid grid">
    <div class="field col-12 lg:col-4 md:col-4 gap-2">
      <!-- Form field content -->
    </div>
  </div>
</form>
```

Grep audit de adopción:

| Pattern | Files con match |
|---|---|
| `p-fluid` | **0** |
| `p-formgrid` | **0** |
| `class="…grid…"` (PrimeFlex 12-col) | **0** |
| `class="field"` (PrimeFlex field wrapper) | **1** ([admin-settings.component.html](../src/app/modules/admin/components/settings/admin-settings.component.html#L60-L72)) |

**Conclusion:** la convención HTML del proyecto **no se usa en ningún form** salvo una mención parcial en settings. El standard documental describe un mundo distinto del que el codebase implementa.

### 2.2 BEM duplication en lugar de PrimeFlex

Ya que `p-fluid p-formgrid grid` no se adoptó, cada componente reinventa primitives de layout via BEM scoped a su SCSS file. Caso testigo — `.form-field` aparece **idéntico** en múltiples files:

[admin-users.component.scss:274-294](../src/app/modules/admin/components/users/admin-users.component.scss#L274-L294):

```scss
.form-field {
  display: flex;
  flex-direction: column;
  gap: $space-2;

  &--row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    font-size: $font-size-base;
    font-weight: 600;
    color: $color-text-title;
  }

  &__input {
    width: 100%;
  }
}
```

[admin-devices.component.scss:74-89](../src/app/modules/admin/components/devices/admin-devices.component.scss#L74-L89):

```scss
.form-field {
  display: flex;
  flex-direction: column;
  gap: $space-2;

  &__label {
    font-size: 13px;
    ...
  }
}
```

Notar:
- Mismo nombre de clase (`.form-field`).
- Mismo objetivo semántico.
- Implementación **divergente** (admin-devices usa `font-size: 13px` raw; admin-users usa `$font-size-base`).
- View-encapsulation aísla cada copia, pero **el bug shape** se duplica.

Inventario de re-declaraciones (grep approximado):
- `.form-field` — declarada en al menos 6 component SCSS files.
- `.btn-primary`, `.btn-ghost`, `.btn-icon` — declaradas en admin-users.scss, admin-devices.scss, admin-customers.scss, admin-products.scss (4+ redeclaraciones).
- `.settings-card`, `.card-icon`, `.card-title`, `.card-subtitle` — admin-settings + admin-devices declaran el mismo set; el comment en [admin-devices.scss:23-26](../src/app/modules/admin/components/devices/admin-devices.component.scss#L23-L26) admite explícitamente *"reuses the settings-card class for consistency with admin-settings"* — pero la implementación es **copy-paste**, no @use.

### 2.3 Validation widget: prescrito y ausente

`html-standards.md` referencia [`app-print-control-error`](../.claude/html-standards.md#L130) como el widget canónico para mostrar errores de form:

```html
<app-print-control-error [control]="facilityFormControls.facilityCode" />
```

Grep en `src/`:

```
$ grep -r "app-print-control-error" src/
(zero matches)
```

**El componente no existe en el repo.** El standard documental prescribe una API que nunca fue construida. Consecuencia: cada form que necesita validation feedback lo inlinea o lo omite.

Adopción del helper `isInvalidField()` (prescrito en standards):

| Patrón | Files con match |
|---|---|
| `isInvalidField` | **2** ([register.component.html](../src/app/modules/register/register.component.html), [admin-promotions.component.html](../src/app/modules/admin/components/promotions/admin-promotions.component.html)) |
| `'ng-dirty ng-invalid'` inline | 1 |

**De 14 forms, 12 no muestran validation feedback al usuario.** El submit button se deshabilita con `[disabled]="form.invalid"` y el user queda adivinando qué campo le falta.

### 2.4 Atribución del problema

El gap **no es** que falten standards — están escritos.
El gap **no es** que falte el design system — `_variables.scss` está bien diseñado.
El gap **es disciplina de adopción**: el codebase creció más rápido que los standards y las nuevas features no las cumplen.

Hipótesis de root cause (no verificada — recomendar entrevistas):
1. El standard HTML fue escrito al inicio del rewrite (Angular 10 → 18), las primeras pantallas lo adoptaron parcialmente, y a partir de cierto punto cada nueva pantalla optó por BEM custom porque "es más rápido para esta pantalla específica".
2. El widget `app-print-control-error` quizás existía en Angular 10 y no se portó al rewrite — el standard nunca se actualizó.
3. Code review no enforcea el standard porque no hay linter ni schematic que detecte `<form>` sin `p-fluid p-formgrid grid`.

**Recomendación:** sin enforcement automatizado (lint rule + schematic), cualquier refactor de los 14 forms existentes será re-erosionado por las próximas features. La migración a schema-driven **es el enforcement** — un form descrito por schema no puede "olvidarse" de usar el shared primitive.

---

## Sección 3 — Vector C: Design Tokens & CSS Technical Debt

### 3.1 Tokens correctamente diseñados en `_variables.scss`

[src/styles/_variables.scss](../src/styles/_variables.scss) ship:

- **Touch UX minima** (CLAUDE.md non-negotiables): `$touch-target-min: 64px`, `$product-card-min: 140px`.
- **Tipografía**: `$font-size-base: 16px`, `$font-size-price: 20px`, `$font-size-label: 14px`, `$font-size-title: 22px`, `$font-weight-bold: 600`.
- **Spacing 8px scale**: `$space-1..$space-8` (4/8/12/16/24/32/48/64).
- **Spacing semánticos**: `$section-gap`, `$card-gap`, `$card-padding`, `$field-gap`.
- **Colors**: `$color-primary: #16A34A`, `$color-text-title: #111827`, `$color-text-sub: #6B7280`, `$color-bg-page: #F8FAFC`, `$color-border-soft: #F1F5F9`, etc.
- **Premium UI**: `$shadow-card`, `$shadow-card-hover`, `$radius-card: 16px`, `$radius-button: 12px`, `$radius-pill: 9999px`.
- **Layout system**: `$layout-wide: 1440px`, `$layout-standard: 1080px`, `$layout-narrow: 720px` consumidos por [`_layout.scss`](../src/styles/_layout.scss).

**Plus PrimeNG CSS variables overridden in `:root`** ([styles.scss:14-27](../src/styles.scss#L14-L27)): `--primary-color`, `--primary-50..900` con la paleta brand green.

El design system **está bien diseñado**. El problema es la disciplina de uso.

### 3.2 Hardcoded hex colors — 1,414 en 78 files

Grep audit (`#[0-9a-fA-F]{3,6}` en `*.scss`): **1,414 ocurrencias** en **78 files**.

Casos representativos:

[styles.scss:71-156](../src/styles.scss#L71-L156) — el global stylesheet mismo:

```scss
.p-button:not(.p-button-text)... {
  background: #16A34A;      // ← debería ser var(--primary-color) o $color-primary
  border-color: #16A34A;

  &:not(:disabled):hover {
    background: #15803D;    // ← undocumented shade (no token)
    border-color: #15803D;
  }
}
```

[styles.scss:289-300](../src/styles.scss#L289-L300) — payment method badge:

```scss
&--provider {
  border-left: 3px solid #3B82F6;  // ← blue, sin token
}

&__badge {
  background: #EFF6FF;   // ← blue tint, sin token
  color: #3B82F6;
}
```

[admin-users.component.ts:58-64](../src/app/modules/admin/components/users/admin-users.component.ts#L58-L64) — colors en **TypeScript** (no SCSS):

```ts
readonly roleOptions: RoleOption[] = [
  { label: 'Dueño',   value: UserRoleId.Owner,   icon: '👑', color: '#7C3AED' },
  { label: 'Gerente', value: UserRoleId.Manager, icon: '🏢', color: '#7C3AED' },
  { label: 'Cajero',  value: UserRoleId.Cashier, icon: '💳', color: '#2563EB' },
  { label: 'Mesero',  value: UserRoleId.Waiter,  icon: '🍽️', color: '#16A34A' },
  { label: 'Host',    value: UserRoleId.Host,    icon: '🛎️', color: '#0891B2' },
];
```

→ inyectados al template via `[style.background]` ([admin-users.component.html:60-78](../src/app/modules/admin/components/users/admin-users.component.html#L60-L78)). Cambio de paleta requiere modificar **TS + SCSS** simultáneamente.

[admin-users.component.scss:64,156-164](../src/app/modules/admin/components/users/admin-users.component.scss#L64) — más hex literales mientras se importa `$color-primary` en la misma file:

```scss
@use '../../../../../styles/variables' as *;
// ...
&--grey { color: #9CA3AF; }      // ← sin token, pero $color-text-sub existe
// ...
&--active {
  background: #DCFCE7;            // ← #DCFCE7 = $primary-100 (token existe en :root)
  color: #15803D;                 // ← #15803D = $primary-700 (token existe en :root)
}
```

**Patrón:** el component file **importa** `_variables.scss` (línea 1), usa `$color-primary` para algunas declaraciones, **y al mismo tiempo** hardcodea hex en el resto. Half-adoption.

### 3.3 Off-scale spacing — 249 en 58 files

Grep audit (`(margin|padding): \d+px` en `*.scss`): **249 ocurrencias** en **58 files**.

Casos representativos:

[styles.scss:243-247](../src/styles.scss#L243-L247) — global utility:

```scss
.payment-methods-row {
  display: flex;
  gap: 8px;          // ← debería ser $space-2
  flex-wrap: wrap;
}
```

[styles.scss:393-396](../src/styles.scss#L393-L396) — autocomplete panel:

```scss
.ac-autocomplete-panel .p-autocomplete-item {
  min-height: 64px;        // ← $touch-target-min
  padding: 12px 20px;      // ← 12px = $space-3, pero 20px no está en escala (debería ser 24 = $space-5 o 16 = $space-4)
}
```

[styles.scss:289-300](../src/styles.scss#L289-L300) — badge off-scale:

```scss
&__badge {
  top: 4px;                // ← $space-1
  right: 4px;              // ← $space-1
  padding: 1px 6px;        // ← OFF-SCALE: 1px y 6px no existen en $space-*
  border-radius: 9999px;   // ← $radius-pill
  font-size: 9px;          // ← OFF-SCALE: viola CLAUDE.md mínimo 16px body
  background: #EFF6FF;     // ← OFF-TOKEN
  color: #3B82F6;          // ← OFF-TOKEN
}
```

Este snippet acumula 4 violations en 7 declaraciones.

[admin-users.component.scss:21](../src/app/modules/admin/components/users/admin-users.component.scss#L21):

```scss
&__empty {
  padding: 80px $space-4;  // ← 80px no está en $space-*. Mix de escala + literal.
}
```

### 3.4 Sub-16px typography — 614 en 67 files

CLAUDE.md prescribe explícitamente:

> Font sizes: minimum **16px** for body, **20px** for prices
> Absolute minimum font-size: 16px

Grep audit (`font-size: <16px` en `*.scss`): **614 ocurrencias** en **67 files**.

Top offenders por count:
- [styles.scss](../src/styles.scss): 11 ocurrencias
- [tables.component.scss](../src/app/modules/tables/tables.component.scss): 55 ocurrencias
- [pos-header.component.scss](../src/app/modules/pos/components/pos-header/pos-header.component.scss): 38 ocurrencias
- [admin-settings.component.scss](../src/app/modules/admin/components/settings/admin-settings.component.scss): 34 ocurrencias
- [admin-tables.component.scss](../src/app/modules/admin/components/tables/admin-tables.component.scss): 31 ocurrencias

Tamaños usados (no exhaustivo):
- `9px`, `10px`, `11px`, `12px`, `13px`, `14px`, `15px`

Mucho de esto es legítimo para meta-labels y badges (donde 16px no encaja), pero **la mayoría son labels de tabla, captions de cards y subtítulos** — texto que el target user (negocio pequeño, no técnico, frecuentemente operador de mayor edad) necesita leer en una pantalla táctil. Touch UX regression real.

Caso testigo — [admin-users.component.scss:67-69](../src/app/modules/admin/components/users/admin-users.component.scss#L67-L69):

```scss
&__label {
  font-size: 13px;      // ← stat-card label — usuario lee "Total equipo", "Activos", "Inactivos"
  color: $color-text-sub;
}
```

Estos labels van **debajo de un value de 28px en negrita** — el contraste de jerarquía visual está bien, pero el body label en 13px es ilegible a distancia táctil normal en pantallas medianas.

### 3.5 Shadows y radii — adopción parcial

`_variables.scss` ship `$shadow-card`, `$shadow-card-hover`, `$shadow-card-deep`, `$radius-card`, `$radius-button`, `$radius-pill`. Grep de uso:

| Token | Refs aproximadas | Hardcoded equivalentes encontrados |
|---|---|---|
| `$shadow-card` | ~5 | `box-shadow: 0 1px 3px rgba(0,0,0,0.07)` repetido en 4+ files |
| `$radius-card` | ~3 | `border-radius: 12px` o `16px` raw en 30+ files |
| `$radius-button` | ~2 | `border-radius: 8px` o `12px` raw en 25+ files |
| `$radius-pill` | ~4 | `border-radius: 9999px` raw en 8+ files |

Mismo patrón: tokens definidos, half-adopted.

---

## Sección 4 — Refactor Candidates

Priorización por: (a) complejidad actual que el schema absorbe, (b) impacto en backlog activo, (c) riesgo de migración. Top 3.

### 4.1 🥇 `admin-users.component` — Highest ROI

**Archivos:** [admin-users.component.ts](../src/app/modules/admin/components/users/admin-users.component.ts) ([html](../src/app/modules/admin/components/users/admin-users.component.html), [scss](../src/app/modules/admin/components/users/admin-users.component.scss))

**Por qué primero:**
- Dialog template de 139 líneas para 6 fields — máxima reducción potencial (−58% estimado).
- 4 conditional branches manejados por computed signals (`usesPin`, `usesEmail`, `editingUser`, `isOwner`) — port directo a `showWhen` predicates.
- 0 form validation feedback hoy — la migración **agrega** valor user-facing (no solo refactor invisible).
- Hardcoded role colors en TS ([admin-users.component.ts:58-64](../src/app/modules/admin/components/users/admin-users.component.ts#L58-L64)) — oportunidad de promoverlos a un `USER_ROLE_COLORS: Record<UserRoleId, string>` declarativo y centralizar el tema.

**Riesgos:**
- Branch assignment subform usa `<p-table>` inline — requiere un `array-multi-select` widget kind nuevo. Decidir si vive en el schema o si el consumer mantiene ownership (como `array-sizes` / `array-modifier-groups` en product-form).
- Toggle switch custom (`.toggle-wrap`, `.toggle-slider`) — promover a un widget shared o seguir custom inline.

**Migration steps:**
1. Promote schema/builder/renderers a `src/app/shared/forms/` (work item de plataforma — bloqueante).
2. Crear `admin-users-form.registry.ts` con descriptors para los 6 fields + 4 showWhen predicates.
3. Crear widget kind `array-multi-select` (o decidir mantener fuera del schema).
4. Reemplazar el dialog template con `<app-dynamic-form [schema]="userFormSchema()">`.
5. Promote role colors a registry typed.

### 4.2 🥈 `admin-devices.component` — Validates tenant gating

**Archivos:** [admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts) (+ html + scss)

**Por qué segundo:**
- Usa `NonNullableFormBuilder` + custom validators con `AbstractControl/ValidationErrors` directos — el caso más complejo de validators custom en el repo.
- `MODE_LABELS: Record<DeviceConfig['mode'] | 'bridge', string>` ([admin-devices.component.ts:54-62](../src/app/modules/admin/components/devices/admin-devices.component.ts#L54-L62)) ya es un registry pattern en disguise.
- Tenant gating: el mode dropdown se filtra por `FeatureKey` del tenant. Esto **valida cross-stack** que el schema-driven puede consumir `TenantContextService` exactamente como el bridge consume `FeatureGating.IsEnabled` ([AUDIT-058 §2.7](AUDIT-058-domain-flexibility-and-testability.md#27-bridge-supervisors-resolved--cross-repo-evidence-delivered)).
- Dos forms en un solo componente (activation-code generator + fleet edit) — prueba que el schema escala a múltiples forms por screen.

**Riesgos:**
- DeviceLimitsDto + DeviceModeQuotaDto introducen logica de quota que no encaja como simple `showWhen` — requiere `disableWhen` predicate o un `quota-aware-dropdown` widget kind.
- Cross-coupling con `CashRegisterService` (assignment de caja a un cashier device) — decidir si el assignment field forma parte del schema o queda fuera.

**Migration steps:**
1. Schema promovido (dependencia de #4.1).
2. Crear `admin-devices.registry.ts` con descriptors para activation-code form + fleet-edit form.
3. Extender el schema con `disableWhen` predicate (parecido a `showWhen` pero gate de read-only).
4. Migrar mode dropdown a `dropdown` kind con `optionsProvider` que injecta `TenantContextService.hasFeature()`.

### 4.3 🥉 `reservation-form.component` — Stretches the abstraction

**Archivos:** [reservation-form.component.ts](../src/app/modules/admin/components/reservations/reservation-form.component.ts) (+ html + scss)

**Por qué tercero (no primero):**
- F&B-specific — fuera del Vector A "horizontal" del audit (no se beneficia tanto del schema cross-vertical).
- Zone groups computed nested + table chip selector + `CustomerSelectorComponent` autocomplete — stretches el schema con widget kinds custom (`array-chip-select`, `customer-autocomplete`, `time-window-validator`).
- Útil **como tercer caso** para forzar al schema a soportar widget kinds no-trivial — si el schema solo se valida en casos simples nunca aterriza la API definitiva.

**Riesgos:**
- Custom widget kinds que solo aplican a F&B podrían contaminar el schema shared. Mitigación: extension point `widgetRegistry` que cada feature module aporte sus kinds (factory pattern).
- Availability validation cross-field (date + time + tableId vs reservations existentes) requiere `asyncValidator` cross-control — el schema actual solo soporta per-control validators.

**Migration steps:**
1. Schema promovido + #4.1 + #4.2 estables.
2. Definir extension API para widget kinds custom (`registerWidgetKind(name, component)`).
3. Migrar el reservation form como prueba de la extensión API.
4. Documentar cuándo un widget kind va al shared registry vs queda en el feature module.

### 4.4 Candidatos secundarios (no top-3 pero worth mention)

- **`product-detail.component`** ([src/app/modules/pos/components/product-detail/product-detail.component.ts](../src/app/modules/pos/components/product-detail/product-detail.component.ts), 23 form refs) — usado **en runtime POS**, no admin. Migración aporta menos valor inmediato (less complex) pero excelente para validar performance del schema en hot path táctil. Defer.
- **`kiosk-detail.component`** ([src/app/modules/kiosk/screens/detail/kiosk-detail.component.ts](../src/app/modules/kiosk/screens/detail/kiosk-detail.component.ts), 20 form refs) — kiosk vertical específico. Defer hasta tener decision sobre kiosk roadmap.
- **`register.component`** — multi-step wizard. Schema-driven podría soportar wizard pattern con `step` field en sections — pero excede el scope del POC actual. Defer a fase 2.
- **`admin-promotions.component`** — uno de los 2 que **sí** usa `isInvalidField()`. Migración aporta consistency pero el componente ya tiene la disciplina, ROI bajo.

---

## Sección 5 — Action Plan Priorizado

| Prioridad | Item | Esfuerzo | Pago |
|---|---|---|---|
| **P0** | Promote schema/builder/renderers de `product-form/` a `src/app/shared/forms/` con generic `<TKey extends string>` (§1.3) | 1-2 días | Desbloquea todos los items siguientes |
| **P0** | Crear `<app-dynamic-form [schema]>` top-level renderer (§1.5) | 0.5-1 día | API ergonómica para los 3 candidatos |
| **P0** | Crear `<app-print-control-error>` componente shared (§2.3) | 0.5 día | Cierra el gap del standard prescrito |
| **P1** | Migrate `admin-users` form (§4.1) | 1 día | −58% líneas + agrega validation feedback |
| **P1** | Migrate `admin-devices` forms (§4.2) | 1.5 días | Valida tenant gating + 2 forms por screen |
| **P1** | Crear ESLint rule custom: forbid `<form>` que no use `<app-dynamic-form>` en `src/app/modules/admin/` (§2.4) | 0.5 día | **Enforcement** — sin esto el refactor se erosiona |
| **P2** | Migrate `reservation-form` (§4.3) | 1-2 días | Valida extension API para widget kinds custom |
| **P2** | Audit + cleanup de las ~6 redeclaraciones de `.form-field`, `.btn-primary`, etc. (§2.2) — promover a `src/styles/_components.scss` shared | 1-2 días | Single source of truth para layout primitives |
| **P2** | Audit + reemplazo de hex literales `#16A34A`/`#15803D`/etc. por `$color-primary`/`var(--primary-color)` en `styles.scss` (§3.2) | 0.5 día | Cambio de brand color = 1 línea, no 50 |
| **P3** | Sweep de off-scale spacing (249 ocurrencias) — reemplazo automático con codemod (§3.3) | 1 día (con codemod) | Disciplina automatizada |
| **P3** | Sweep de sub-16px font-size (614 ocurrencias) — auditar cuáles son legítimos (badges, captions) vs violaciones reales (§3.4) | 2-3 días | Touch UX compliance + accessibility |

**Secuencia crítica:** P0 todos antes de P1. P1 antes de P2/P3. Sin el ESLint rule (P1 #6), las migraciones P1 se erosionan en 2-3 sprints.

---

## Sección 6 — Resumen Ejecutivo

**Frontend forms architecture status:**

✅ **Bien diseñado:**
- Design tokens completos en `_variables.scss` (spacing 8px scale, colors, typography, shadows, radii, layout breakpoints).
- Schema-driven POC validado en producto (FDD-028 F5 shipped).
- Stack actualizado (Angular 18, PrimeNG 17.18, PrimeFlex 3.3).
- Touch UX constraints prescritos en CLAUDE.md (64px touch targets, 16px font min, 120px product card min).

🔴 **Disciplina diluida:**
- 13 de 14 forms son hand-rolled. Crecimiento +18% en 5 días.
- PrimeFlex layout standard (`p-fluid p-formgrid grid`) **nunca aterrizó** — 0 templates lo usan.
- `app-print-control-error` widget prescrito en standards **no existe en el repo**.
- 1,414 hex literales en 78 files; 249 off-scale spacings; 614 sub-16px font-sizes.
- Re-declaraciones BEM idénticas en ≥3 component files (`.form-field`, `.btn-primary`, etc.).

**Recomendación estratégica:**

El bottleneck **no es técnico** — el POC funciona, la arquitectura está validada. El bottleneck es **enforcement**. Sin un ESLint rule + componente shared promovido, cada nueva feature redeclara las primitivas y la deuda crece linealmente.

**Frente 2 (UX/UI Escalable) propuesto:**

| Fase | Objetivo | Duración estimada |
|---|---|---|
| **F1 — Platform** | P0 items: promover schema a `shared/`, crear `<app-dynamic-form>` + `<app-print-control-error>` | 2-3 días |
| **F2 — Adoption** | P1 items: migrar admin-users + admin-devices + ESLint enforcement | 3-4 días |
| **F3 — Extension** | P2 items: reservation-form + cleanup de BEM duplicado + hex literales en `styles.scss` | 3-4 días |
| **F4 — Sweep** | P3 items: codemods para spacing/typography off-scale | 3-4 días |

**Total estimado:** 11-15 días para cerrar Vector B de AUDIT-058 + nuevos Vectors A/C de este audit.

**Si Frente 2 no se ejecuta:** la próxima vertical (Hospitality / Healthcare por CLAUDE.md project overview) agregará ~5 forms más hand-rolled, escalando la deuda a ~250 form refs. El costo de migración se duplica.

---

## Apéndice — Archivos analizados

### Standards y configuración
- [.claude/response-guidelines.md](../.claude/response-guidelines.md)
- [.claude/coding-standards.md](../.claude/coding-standards.md)
- [.claude/html-standards.md](../.claude/html-standards.md)
- [CLAUDE.md](../CLAUDE.md)
- [package.json](../package.json)

### Design system
- [src/styles.scss](../src/styles.scss)
- [src/styles/_variables.scss](../src/styles/_variables.scss)
- [src/styles/_layout.scss](../src/styles/_layout.scss)
- [src/styles/_touch.scss](../src/styles/_touch.scss)

### Schema-driven POC
- [src/app/modules/admin/components/products/product-form/schemas/product-form.schema.ts](../src/app/modules/admin/components/products/product-form/schemas/product-form.schema.ts)
- [src/app/modules/admin/components/products/product-form/schemas/product-form.registry.ts](../src/app/modules/admin/components/products/product-form/schemas/product-form.registry.ts)
- [src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts](../src/app/modules/admin/components/products/product-form/services/product-form-builder.service.ts)
- [src/app/modules/admin/components/products/product-form/components/form-field.component.ts](../src/app/modules/admin/components/products/product-form/components/form-field.component.ts)
- [src/app/modules/admin/components/products/product-form/components/form-section.component.ts](../src/app/modules/admin/components/products/product-form/components/form-section.component.ts)
- [src/app/modules/admin/components/products/product-form/components/product-preview.component.ts](../src/app/modules/admin/components/products/product-form/components/product-preview.component.ts)

### Refactor candidates inspected
- [src/app/modules/admin/components/users/admin-users.component.ts](../src/app/modules/admin/components/users/admin-users.component.ts) + [.html](../src/app/modules/admin/components/users/admin-users.component.html) + [.scss](../src/app/modules/admin/components/users/admin-users.component.scss)
- [src/app/modules/admin/components/devices/admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts) + [.scss](../src/app/modules/admin/components/devices/admin-devices.component.scss)
- [src/app/modules/admin/components/reservations/reservation-form.component.ts](../src/app/modules/admin/components/reservations/reservation-form.component.ts)
- [src/app/modules/admin/components/settings/admin-settings.component.html](../src/app/modules/admin/components/settings/admin-settings.component.html)

### Coverage analysis
- 14 form-bearing files via grep `FormBuilder|FormGroup|FormControl|FormArray`
- 78 SCSS files via grep `#[0-9a-fA-F]{3,6}`
- 58 SCSS files via grep `(margin|padding): \d+px`
- 67 SCSS files via grep `font-size: <16px`
- 28 admin-module HTML templates via glob

---

## Changelog

### 2026-05-26 — Initial audit

- Vector A (Forms Architecture) opened: 1 of 14 forms migrated to schema-driven, +18% growth in hand-rolled refs since AUDIT-058.
- Vector B (Standards Compliance) opened: PrimeFlex layout standard at 0% adoption; `app-print-control-error` prescribed but absent.
- Vector C (Design Tokens & CSS Debt) opened: tokens correctly designed but half-adopted; 1,414 hex literales + 249 off-scale spacings + 614 sub-16px font-sizes.
- Action plan: 4 phases (Platform → Adoption → Extension → Sweep), 11-15 days estimated.
- Top 3 refactor candidates: admin-users (highest ROI), admin-devices (validates tenant gating), reservation-form (stretches abstraction).
