# FDD-033 — Design System Extension (F3)

**Fecha:** 2026-05-28
**Branch:** `development`
**Status:** Design — pending implementation approval
**Alcance:** Frontend (Angular 18 + PrimeNG 17 + PrimeFlex 3). Presentation-layer only.
Cierra la fase **F3 — Extension** de [AUDIT-059 §6](AUDIT-059-forms-and-ui-consistency.md#sección-6--resumen-ejecutivo).

---

## 1. Executive Summary

FDD-033 ejecuta la fase **F3 — Extension** del plan de AUDIT-059 §6. Per el phase
plan, F3 = los **P2 items** de AUDIT-059 §"Roadmap": (a) reservation-form
migration, (b) cleanup de BEM duplicado, (c) hex literales en `styles.scss`.

reservation-form ya se migró en FDD-032 (fue absorbido a F2 — Adoption). Por lo
tanto, el scope REMANENTE de F3 es:

1. **Token vocabulary completion** — agregar los primitivos que faltan a
   `_variables.scss` (grays + semantic warning/info) que hoy viven como hex
   literales repetidos. Esto establece el vocabulario que el codemod de F4
   (FDD-034) mapeará. **Sin esto, F4 no tiene targets.**
2. **BEM consolidation** ([AUDIT-059 §2.2](AUDIT-059-forms-and-ui-consistency.md)) —
   crear `src/styles/_components.scss` y promover las redeclaraciones duplicadas
   de `.btn-primary` (11 files) a single source. **`.form-field` queda EXCLUIDO**
   — el shared `<app-form-field>` (FDD-029) ya es su single source of truth; los
   8 redeclaradores legacy son consumer-migration territory (§3.3), no CSS
   consolidation.
3. **`styles.scss` hex tokenization** ([AUDIT-059 §3.2](AUDIT-059-forms-and-ui-consistency.md)) —
   reemplazar los ~15 `#16A34A` / `#15803D` / etc. en **`styles.scss` únicamente**
   por `$color-primary` / `var(--primary-color)`.

### Scope boundary — qué NO es F3 (defer a FDD-034 / F4 — Sweep)

AUDIT-059 §6 separa explícitamente **F3 — Extension** de **F4 — Sweep**. Este
FDD es F3. El siguiente FDD-034 será F4 y ejecutará:

- El mass hex sweep de los ~1,500 literales en los **78 component .scss files**
  (más allá de `styles.scss`) → codemod hex→token.
- El spacing off-scale sweep (~249 ocurrencias) → codemod a la escala `$space-*`.
- El sub-16px font audit (~608 ocurrencias) → auditar legítimos (badges/captions)
  vs violaciones.

F3 (este doc) hace el trabajo **hand-craftable y de vocabulario**; F4 (FDD-034)
corre los **codemods masivos** contra el vocabulario que F3 completa. Esta
separación es deliberada: un codemod sin vocabulario destino completo produce
mappings inconsistentes.

### Correcciones al prompt original (audit findings)

Este FDD corrige tres errores del prompt de ejecución original que motivó su
redacción:

- **"Extension API" no es un deliverable de F3.** El widget extension API se
  shippeó en FDD-031 (FORM_WIDGETS + provideFormWidget). El label "Extension"
  de AUDIT-059 §6 F3 se refiere a *extender la consistencia del design system*,
  no a una API nueva. No hay deliverable de "Extension API" en F3.
- **El token system YA EXISTE.** `_variables.scss` tiene la escala 8px
  (`$space-1`…`$space-8`) y los tokens de color (`$color-primary`,
  `$color-text-title`, etc.) consumidos en 78+ files. F3 **extiende** ese
  sistema (agrega los primitivos faltantes), NO crea uno paralelo. Se prohíbe
  introducir nombres nuevos (`xs/sm/md/lg/2xl`) que compitan con `$space-*`.
- **`--surface-ground` / `--text-color` ya existen** (provistos por el theme
  PrimeNG, consumidos en `styles.scss` html/body). No se re-crean.

---

## 2. Current State

### 2.1 Token system — existe pero se aplica inconsistentemente

`src/styles/_variables.scss` define:

- **Spacing 8px scale**: `$space-1: 4px` … `$space-8: 64px` + aliases semánticos
  (`$section-gap`, `$card-gap`, `$card-padding`, `$field-gap`).
- **Color tokens**: `$color-primary` (#16A34A), `$color-primary-light` (#F0FDF4),
  `$color-error` (#DC2626), `$color-error-bg` (#FEE2E2), `$color-text-title`
  (#111827), `$color-text-sub` (#6B7280), `$color-bg-page` (#F8FAFC),
  `$color-border-soft` (#F1F5F9), price/badge/out-of-stock, delivery-platform
  colors, shadows (`$shadow-card`…), radii (`$radius-card/button/pill`).

El gap NO es ausencia de tokens — es **aplicación inconsistente**: 117 hex únicos
en ~1,616 ocurrencias, donde los más repetidos YA tienen token pero se escriben
raw:

| Hex (freq) | Token existente | Estado |
|---|---|---|
| `#dc2626` (110×) | `$color-error` | raw — debe usar token |
| `#16a34a` (89×) | `$color-primary` / `var(--primary-color)` | raw |
| `#15803d` (84×) | `var(--primary-700)` | raw |
| `#f0fdf4` (51×) | `$color-primary-light` | raw |
| `#6b7280` (46×) | `$color-text-sub` | raw |
| `#111827` (34×) | `$color-text-title` | raw |

### 2.2 Grays + semantics SIN token (el vocabulary gap que F3 cierra)

Los siguientes hex de alta frecuencia NO tienen token y se repiten en decenas de
files. Son los primitivos que F3 debe agregar:

| Hex (freq) | Rol | Token propuesto (F3) | Fuente |
|---|---|---|---|
| `#e5e7eb` (140×) | Border estándar | `$color-border` | — |
| `#f3f4f6` (76×) | Hover / subtle surface | `$color-surface-hover` | — |
| `#d1d5db` (62×) | Input border (más fuerte) | `$color-border-strong` | — |
| `#d97706` (62×) | Warning | `$color-warning` | CLAUDE.md (#D97706) |
| `#f9fafb` (38×) | Muted surface | `$color-surface-muted` | — |
| `#9ca3af` (35×) | Muted / placeholder text | `$color-text-muted` | — |
| `#374151` (22×) | Body text | `$color-text-body` | CLAUDE.md (#374151) |
| `#2563eb` (21×) | Info / link | `$color-info` | — |

### 2.3 BEM duplication

[AUDIT-059 §2.2](AUDIT-059-forms-and-ui-consistency.md): primitivas de layout
redeclaradas idénticamente en múltiples component files:

- `.btn-primary { ... }` redeclarado en **11 .scss files**. No hay shared button
  component — es una utility class legítima. **Target de consolidación F3.**
- `.form-field { ... }` redeclarado en **8 .scss files** (admin-branches,
  admin-inventory, admin-products, product-form, admin-promotions,
  admin-settings, printer-settings, admin-tables). **NO es target F3** — ver nota.

> **Nota crítica (corrección post-audit del propio FDD)**: el AUDIT-059 §2.2
> recomendó consolidar `.form-field` a `_components.scss`, pero ese audit es
> **anterior** a la adopción de `<app-form-field>` (FDD-029…032). El shared
> `FormFieldComponent` YA es el single source of truth de `.form-field__label`
> / `.form-field__hint` (estilos scoped en `form-field.component.scss`). Los 8
> redeclaradores legacy usan raw `.form-field` en templates NO migrados —
> consolidarlos a un global crearía una TERCERA definición compitiendo con el
> componente, y sería trabajo desechable cuando esos componentes migren a
> `<app-form-field>`. Por eso `.form-field` se EXCLUYE de F3 (ver §3.3
> deferral). Solo `.btn-primary` se consolida.

No existe `src/styles/_components.scss`. Cada feature redeclara `.btn-primary` →
deuda lineal (AUDIT-059 §6 "Disciplina diluida").

### 2.4 `styles.scss` hex literals

`src/styles.scss` (global) contiene ~15 `#16A34A` + variantes hover (`#15803D`,
`#166534`) + `rgba(22, 163, 74, ...)` hardcoded en los PrimeNG overrides
(buttons, radio, checkbox, inputtext, tabview). Cambiar el brand color hoy =
editar ~50 líneas.

---

## 3. Requirements

### 3.1 Functional

- **F-1** Agregar los 8 tokens de §2.2 a `_variables.scss`, siguiendo la
  convención `$color-*` existente (NO nombres nuevos paralelos).
- **F-2** Crear `src/styles/_components.scss`, importado por `styles.scss`,
  con una definición única de `.btn-primary` (+ cualquier otra primitiva NO
  cubierta por un shared component con ≥3 redeclaraciones idénticas detectada
  en el audit de fase 2). **`.form-field` NO va aquí** — su single source of
  truth es el shared `<app-form-field>` (ver §2.3 nota + §3.3).
- **F-3** Eliminar las redeclaraciones locales de `.btn-primary` (11 files) que
  sean idénticas a la versión global. Las que difieran (override legítimo) se
  preservan con un comentario `// local override:`.
- **F-4** Reemplazar los hex literales de `styles.scss` por tokens
  (`$color-primary` / `var(--primary-color)` / `var(--primary-700)`).
- **F-5** Establecer una query reproducible de detección (grep documentado)
  que sirva como "definition of done" para F3 y como input del codemod de F4.

### 3.2 Non-functional

- **NF-1** Presentation-layer ONLY. CERO cambios a TS / forms AST / validation
  logic asegurada en FDD-029…032. Ningún `.ts` se toca.
- **NF-2** Zero visual regression. Cada token nuevo DEBE resolver al MISMO valor
  hex que reemplaza (`$color-border: #E5E7EB` = el literal). No hay re-design de
  valores en F3 — solo indirección. (El re-design minimalist/Linear es un
  esfuerzo posterior, fuera de F3/F4.)
- **NF-3** `ng build` + `npm run lint` sin nuevos errores. Spec count sin cambios
  (88, presentation-layer no toca specs).
- **NF-4** Convención: extender `$color-*` / `$space-*` existente. PROHIBIDO
  introducir `xs/sm/md/lg/2xl` o `--surface-ground`/`--text-color` nuevos
  (estos últimos ya los provee PrimeNG).
- **NF-5** Visual gate manual: `npm start` + revisar las superficies de mayor
  blast-radius (admin dashboard, POS sell, checkout, reservation dialog) antes
  de merge. Documentado en smoke checklist.

### 3.3 Out of Scope (defer explícito a FDD-034 / F4 — Sweep)

- Mass hex sweep de los ~1,500 literales en los 78 component .scss files (codemod).
- Spacing off-scale sweep (~249 ocurrencias) — codemod a `$space-*`.
- Sub-16px font audit (~608 ocurrencias) — legit vs violación. **Autoridad
  para F4**: CLAUDE.md ("minimum 16px for body, absolute minimum 16px") es la
  regla; las excepciones legítimas son micro-labels (badges, captions,
  `__hint`, `__sub`, `$font-size-label` 14px). El prompt original decía
  "14px or 16px minimum" — CLAUDE.md (16px body min) prevalece.
- Re-design de valores (minimalist/Linear aesthetic): F3 es indirección a igual
  valor; cambiar la paleta es un esfuerzo de diseño separado, no un sweep.
- PrimeNG `p-card` / `p-panel` global override (soft shadows over borders): este
  es un *cambio de valores visuales*, no tokenization — se evalúa post-F4 cuando
  el vocabulary esté completo y el blast radius sea inventariable.
- **Migración de los 8 `.form-field` legacy a `<app-form-field>`**: estos
  componentes (admin-branches, admin-inventory, admin-products, product-form,
  admin-promotions, admin-settings, printer-settings, admin-tables) usan raw
  `.form-field` CSS porque sus templates aún no adoptan `<app-form-field>`. La
  migración correcta es consumer-migration (como admin-users/admin-devices/
  reservation-form en FDD-030…032), NO consolidación CSS. Es trabajo de un FDD
  de adopción futuro (FDD-035+ o ad-hoc cuando se toque cada componente), fuera
  de F3 (Extension) y F4 (Sweep de codemods). Consolidar su CSS ahora sería
  desechable.

---

## 4. Token Architecture

### 4.1 Additions to `_variables.scss`

Bajo el bloque "POS Color overrides" existente, agregar (cada token = valor
idéntico al literal que reemplaza, NF-2):

```scss
// Neutral grays — promoted from repeated hex literals (FDD-033 §2.2)
$color-border:          #E5E7EB;  // standard border (140 raw occurrences)
$color-border-strong:   #D1D5DB;  // input / control border (62)
$color-surface-hover:   #F3F4F6;  // hover + subtle surface (76)
$color-surface-muted:   #F9FAFB;  // lightest gray surface (38)
$color-text-body:       #374151;  // body text — CLAUDE.md (22)
$color-text-muted:      #9CA3AF;  // muted / placeholder text (35)

// Semantic accents
$color-warning:         #D97706;  // warning / caution — CLAUDE.md (62)
$color-info:            #2563EB;  // info / link — recurring literal, NOT in CLAUDE.md palette (21)
```

**Nota sobre `$color-info`**: `#2563EB` no está en la paleta de CLAUDE.md
(que define Primary/Error/Warning/Neutral). Es un literal recurrente (21×,
usado para links/info badges). Se tokeniza para consistencia, pero queda como
OQ si CLAUDE.md debe adoptarlo formalmente o si esos 21 usos deben re-mapearse
a un color sancionado.

**Naming rationale**: extiende la familia `$color-*` existente.
`$color-border` (estándar) vs `$color-border-soft` (#F1F5F9, ya existe, más
claro) vs `$color-border-strong` (#D1D5DB, más oscuro) forman una escala
coherente. `$color-surface-hover` / `-muted` siguen el patrón `$color-bg-page`.

### 4.2 No-create list (ya existen — no duplicar)

- `--surface-ground`, `--text-color`, `--surface-card`, `--primary-*` →
  provistos por el theme PrimeNG (`styles.scss` :root + lara theme). Consumir,
  no recrear.
- `$space-1`…`$space-8` + aliases → escala 8px completa. Consumir.
- `$color-primary/error/text-title/text-sub/bg-page/border-soft` → consumir.

---

## 5. BEM Consolidation (`_components.scss`)

### 5.1 New file

`src/styles/_components.scss`, importado en `styles.scss` después de
`@use 'styles/variables'` (para que pueda consumir tokens). Contiene ÚNICAMENTE
`.btn-primary` (NO `.form-field` — ver §2.3 nota):

```scss
@use 'variables' as *;

// Single source of truth for button primitives redeclared across features.
// Promoted from 11 per-component redeclarations (AUDIT-059 §2.2 / FDD-033 §5).
// NOTE: .form-field is intentionally NOT here — the shared <app-form-field>
// component (FDD-029) owns it. Legacy raw .form-field usages migrate to the
// component, not to this file (§3.3 deferral).

.btn-primary {
  // canonical definition reconciled from the 11 redeclarations
  // (exact ruleset finalized during Phase 2 audit — see §7 detection)
}
```

### 5.2 Migration approach

1. **Audit** las 11 `.btn-primary` redeclaraciones: diff cada una contra la
   versión canónica (la forma más común).
2. **Idénticas** → eliminar la local, hereda de `_components.scss`.
3. **Divergentes** → preservar la local con `// local override: <reason>` y
   surface en el wrap-up para decidir si la divergencia es intencional.
4. NO forzar consolidación de divergencias en F3 — solo eliminar duplicación
   exacta. Las divergencias reales son decisiones de diseño, no deuda.

---

## 6. `styles.scss` Hex Tokenization

Reemplazar en `src/styles.scss` ÚNICAMENTE:

- `#16A34A` → `var(--primary-color)` (en contextos CSS-var-friendly) o
  `$color-primary` (en contextos SCSS).
- `#15803D` → `var(--primary-700)`.
- `#166534` → `var(--primary-800)`.
- `rgba(22, 163, 74, X)` → mantener (es un alpha del primary; tokenizar el alpha
  es over-engineering — documentar como excepción intencional).
- Grays (`#6B7280`, `#374151`, `#E5E7EB`, `#F3F4F6`, etc.) → los tokens de §4.1.

**Scope estricto**: SOLO `styles.scss`. Los component .scss files son F4.

---

## 7. Detection Queries (reproducible — "definition of done")

Commiteadas en este doc para que F3 sea verificable y F4 tenga input:

```bash
# Hex literals (6-digit) across all scss — F4 universe
grep -rEoh "#[0-9a-fA-F]{6}\b" src --include="*.scss" | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn

# Hex literals in styles.scss ONLY — F3 §6 target
grep -nE "#[0-9a-fA-F]{3,6}\b" src/styles.scss

# .form-field redeclarations — INFORMATIONAL ONLY (NOT an F3 target).
# Documents the 8 legacy consumers for the future <app-form-field> migration (§3.3 / OQ6).
grep -rl "\.form-field\s*{" src --include="*.scss"

# .btn-primary redeclarations — F3 §5 target
grep -rl "\.btn-primary\s*{" src --include="*.scss"

# off-scale spacing (F4 — informational here)
grep -rEoh "(margin|padding|gap)[^:]*:\s*[0-9]*[13579]px" src --include="*.scss" | wc -l

# sub-16px fonts (F4 — informational here)
grep -rEoh "font-size:\s*1[0-5]px|font-size:\s*[0-9]px" src --include="*.scss" | wc -l
```

**F3 definition of done**:
- §6 query (styles.scss hex) returns only documented exceptions (rgba alphas,
  PrimeNG ramp in :root).
- §5 query: `.btn-primary` appears in `_components.scss`; only divergent locals
  remain (each commented). `.form-field` is NOT consolidated (§2.3 nota) — its
  query stays informational for the future component migration.
- §4 tokens (the 8 of §4.1) exist in `_variables.scss`.

---

## 8. Implementation Phases

Bounded, secuenciales, cada una con verification gate.

### Phase 1 — Token vocabulary completion (`_variables.scss`)
**Files modify (1):** `src/styles/_variables.scss`.
Add the 8 tokens of §4.1. Zero consumers yet → pure addition.
**Gate**: `ng build` verde (sass compiles). No visual change (no consumer).

### Phase 2 — BEM consolidation (`_components.scss`)
**Files create (1):** `src/styles/_components.scss`.
**Files modify:** `styles.scss` (add `@use`), + the 11 `.btn-primary` component
.scss files (remove exact-duplicate redeclarations). **`.form-field` files are
NOT touched** — deferred to consumer migration (§3.3).
**Gate**: `ng build` verde; visual check of a sample of affected buttons
(one admin surface, one POS surface). Divergent locals surfaced in wrap-up.

### Phase 3 — `styles.scss` hex tokenization
**Files modify (1):** `src/styles.scss`.
Replace hex per §6. Each replacement = identical resolved value (NF-2).
**Gate**: `ng build` verde; visual check of buttons/inputs/tabs (the PrimeNG
overrides live here) — brand green must look identical pre/post.

### Sequencing
Phase 1 antes de 2/3 (tokens deben existir antes de consumirse). Phase 2 y 3
son independientes entre sí. Cada fase = 1 commit atómico.

---

## 9. Verification Gates

- **Build**: `npx ng build` zero new errors after each phase.
- **Lint**: `npm run lint` — delta gate (the project has a known pre-existing
  baseline of ~115 errors / 82 warnings unrelated to F3; F3 must NOT increase
  the count). No `.ts` touched → no new TS lint.
- **Specs**: 88 unchanged (presentation-layer; no spec files touched).
- **Visual (NF-5, manual `npm start`)**: per-phase blast-radius surfaces —
  Phase 2: admin form + POS surface; Phase 3: PrimeNG buttons/inputs/tabs/radio/
  checkbox (brand green parity). Documented in `docs/FDD-033-smoke-checklist.md`
  (created during Phase 3 or pre-merge).

---

## 10. Open Questions

OQ1. **`$color-border` vs `$color-border-soft` naming**: existing `-soft`
(#F1F5F9) is lighter than new `$color-border` (#E5E7EB). Confusing? Alternative:
rename existing to `$color-border-subtle` and use `$color-border` for the common
case. DEFERRED — renaming an existing token touches its current consumers
(F4 territory). For F3, add `$color-border` alongside; reconcile naming in F4.

OQ2. **`.btn-primary` canonical ruleset**: 11 redeclarations likely diverge in
padding / min-height. The canonical version in `_components.scss` must be the
most-common shape; divergent locals get `// local override`. The exact canonical
ruleset is finalized during Phase 2 audit (can't prescribe before diffing all 11).

OQ3. **rgba(primary) alphas**: `styles.scss` uses `rgba(22, 163, 74, 0.2)` for
focus rings. Tokenizing alpha variants (`$color-primary-alpha-20`) is likely
over-engineering for ≤5 occurrences. DEFERRED — documented as intentional
exception unless F4 finds the pattern recurs broadly.

OQ4. **PrimeNG `p-card`/`p-panel` soft-shadow redesign**: the original prompt
wanted "soft shadows over hard borders". That's a VALUE redesign, not
tokenization — out of F3/F4 scope (which preserve values, NF-2). Needs its own
design effort with full visual-regression inventory. Flagged for a future FDD.

OQ5. **`$color-info` (#2563EB) no está en la paleta CLAUDE.md**: se tokeniza por
consistencia (21 usos recurrentes para links/info), pero CLAUDE.md solo sanciona
Primary/Error/Warning/Neutral. Decisión pendiente: (a) adoptar #2563EB
formalmente en CLAUDE.md design system, o (b) re-mapear los 21 usos a un color
sancionado durante F4. Por ahora se agrega el token con el comentario de
no-sanción; no bloquea F3.

OQ6. **Las 8 `.form-field` legacy migran al componente, no a CSS**: confirmado
que el shared `<app-form-field>` (FDD-029) es el single source of truth. La
migración de los 8 consumers legacy (admin-branches, etc.) a `<app-form-field>`
no tiene FDD asignado todavía. ¿Se agenda como FDD-035 (adopción fase 2) o
ad-hoc cuando se toque cada componente? Deferido — no es F3 ni F4.

---

## 11. Known Deviations / Corrections

- **Original execution prompt conflated F3 + F4 + invented "Extension API"**:
  corrected per AUDIT-059 §6 (F3 = BEM + styles.scss hex; F4 = mass codemod
  sweep). "Extension API" was already shipped in FDD-031. This doc scopes F3
  precisely and defers F4 to FDD-034.
- **Token system pre-exists**: F3 extends `$color-*` / `$space-*`, does not
  create a parallel `xs/sm/md/lg` system. `--surface-ground` / `--text-color`
  already provided by PrimeNG.
- **Cited counts reconciled against real grep** (2026-05-28): 1,616 hex (claim
  1,414), 608 sub-16px (claim 614), 117 unique hex. Reproducible queries in §7.
- **Values preserved, not redesigned (NF-2)**: F3 is pure indirection (token =
  same hex). The minimalist/Linear aesthetic redesign the prompt described is a
  separate future effort, not a sweep.
- **`.form-field` BEM consolidation dropped from F3 (self-audit correction,
  2026-05-28)**: AUDIT-059 §2.2 recommended consolidating `.form-field` +
  `.btn-primary` to `_components.scss`. Verification against production showed
  the shared `<app-form-field>` (FDD-029) already owns `.form-field__label`/
  `__hint` as scoped styles. The 8 legacy `.form-field` redeclarers are
  non-migrated consumers — consolidating their CSS to a global would create a
  third competing definition and be throwaway when they adopt `<app-form-field>`.
  F3 consolidates ONLY `.btn-primary` (no shared component exists for it). Legacy
  `.form-field` migration deferred to consumer-migration territory (§3.3, OQ6).
  Same "verify against production before finalizing" lesson as FDD-032 Phase 3.

---

## 12. Changelog

### 2026-05-28 — Initial design
- Scoped F3 — Extension per AUDIT-059 §6: token vocabulary completion + BEM
  consolidation + styles.scss hex tokenization.
- Deferred F4 — Sweep (mass codemods) to FDD-034.
- 8 new tokens proposed (§4.1), all value-preserving (NF-2).
- BEM consolidation via new `_components.scss` (§5).
- Reproducible detection queries committed (§7).
- 4 Open Questions; corrected 4 errors from the original execution prompt.

### 2026-05-28 — Self-audit corrections (3 findings)
- **`.form-field` consolidation dropped (major)**: verified the shared
  `<app-form-field>` (FDD-029) already owns `.form-field` scoped styles.
  Consolidating the 8 legacy redeclarers to a global would be throwaway +
  competing. F3 now consolidates ONLY `.btn-primary` (11 files). Legacy
  `.form-field` → consumer-migration deferral (§3.3 + OQ6). Updated §1, §2.3,
  §3.1, §3.3, §5, §8 Phase 2, §11.
- **`$color-info` source mislabel (minor)**: §4.1 comment grouped it under
  "CLAUDE.md design system" but #2563EB is NOT in CLAUDE.md's palette. Corrected
  the comment + added OQ5.
- **Day-estimates removed**: this workflow executes per-session, not per-day.
  AUDIT-059's day estimates were human-team artifacts and do not apply. Phases
  are bounded by file-scope + verification gate + atomic commit, not duration.
