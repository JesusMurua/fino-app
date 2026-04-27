# AUDIT-044 — Why Back Office buttons look "stretched" + Giro hardcoded copy

**Status:** Read-only audit. No files modified.
**Date:** 2026-04-26
**Branch:** `refactor/settings-and-product-ux`

---

## TL;DR

1. **The buttons are not actually stretching horizontally.** No `.p-button { width: 100% }` or `flex: 1` rule exists in the project. PrimeNG's inner `.p-button` is `display: inline-flex` (theme default), and the `<p-button>` host is treated as inline. They size to content.
2. **The real culprit is `src/styles/_touch.scss`** — a global stylesheet that bleeds POS-specific touch sizing into every `.p-button` in the app, *including Back Office*. It forces `min-height: 64px`, `min-width: 64px`, and `font-size: 16px` on every PrimeNG button, regardless of context.
3. **Layout containers around the buttons are clean.** `settings-header__row` (`flex; space-between; align-items: center`) and `admin-branches__inline-actions` (`flex; justify-content: flex-end`) are correct. The buttons ARE auto-sized; they just LOOK chunky because of the touch-target rule.
4. **The Giro description `'Estéticas, consultorios, talleres'` is a hardcoded string literal** in `AdminSettingsComponent`, not coming from `TenantContextService`. The service does expose richer data (`currentBusinessType()` and `currentSubCategory()`) that would let us replace the hardcoded list with the tenant's actual sub-category name (e.g. "Gimnasio").

---

## 1. The "stretch" diagnosis

### What the user sees vs what is actually happening

The user reports buttons "rendering massively wide/stretched". After tracing every CSS file that could affect `.p-button`, the buttons are NOT stretched horizontally. They auto-size to content. Three things conspire to make them LOOK oversized:

| Rule | Where | Effect |
|------|-------|--------|
| `min-height: 64px` | [`_touch.scss:11`](src/styles/_touch.scss#L11) | Buttons are ≥ 64 px tall — most enterprise SaaS uses 36–40 px. |
| `min-width: 64px` | [`_touch.scss:12`](src/styles/_touch.scss#L12) | Buttons are ≥ 64 px wide. Moot for labeled buttons (their content already exceeds 64 px) — but the *combined* tall+wide rectangle reads as bulky. |
| `font-size: 16px` | [`_touch.scss:13`](src/styles/_touch.scss#L13) | Bigger label text → auto-content width grows accordingly. Back Office norms are 13–14 px. |

These three rules are the right call for the POS surface (CLAUDE.md mandates 64×64 px touch targets and 16 px minimum body text). They are the wrong call for Back Office, where dense, mouse-driven layouts expect compact buttons.

### The CSS load order
[`src/styles.scss:8`](src/styles.scss#L8):

```scss
@use 'styles/touch';
```

`_touch.scss` is loaded globally, after PrimeNG's theme. Since the rule is just `.p-button { … }` with no scope, every `<p-button>` in the app inherits the touch-target sizing.

### The HTML around the unified Save button is correct

[`admin-settings.component.html:5-19`](src/app/modules/admin/components/settings/admin-settings.component.html#L5-L19):

```html
<div class="settings-header__row">
  <h1 class="settings-header__title">Configuración</h1>
  @if (activeTab() === 'business') {
    <p-button label="Guardar cambios" icon="pi pi-save" ... />
  }
</div>
```

[`admin-settings.component.scss`](src/app/modules/admin/components/settings/admin-settings.component.scss) — `settings-header__row` is:

```scss
&__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-3;
  margin-bottom: $space-4;
  flex-wrap: wrap;
}
```

`align-items: center` does **not** stretch cross-axis. `justify-content: space-between` pushes title left, button right. With `flex-wrap: wrap`, the button can drop to its own line on narrow viewports — that is correct, not a bug.

The `<p-button>` host is `display: inline` (Angular custom element default), and the inner rendered `<button class="p-button">` is `display: inline-flex` (PrimeNG theme default). Neither stretches horizontally.

### The HTML around "Nueva sucursal" is also correct

[`admin-branches.component.html:24-36`](src/app/modules/admin/components/branches/admin-branches.component.html#L24-L36):

```html
<div class="admin-branches__inline-actions">
  <span [pTooltip]="branchLimitTooltip()" tooltipPosition="left">
    <p-button label="Nueva sucursal" icon="pi pi-plus" severity="secondary"
              [outlined]="true" size="small" [disabled]="atBranchLimit()"
              (onClick)="openNewBranch()" />
  </span>
</div>
```

[`admin-branches.component.scss:38-44`](src/app/modules/admin/components/branches/admin-branches.component.scss#L38-L44):

```scss
&__inline-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: $space-3;
}
```

Single flex child (the `<span>` tooltip wrapper). With `flex: 0 1 auto` (default), the span takes auto width = its content = the p-button = its content. Nothing forces it wide.

The fact that `size="small"` is set and the button STILL appears chunky is itself a strong tell: `_touch.scss`'s `min-height: 64px` overrides PrimeNG's `size="small"` (which targets ~32 px height).

### Other places I checked and ruled out

- [`styles.scss`](src/styles.scss) — only color overrides for primary/text/outlined buttons. No width / flex rule.
- [`_variables.scss`](src/styles/_variables.scss) — design tokens; no rules.
- `admin-shell.component.scss`, all admin component SCSS files — `width: 100%` only appears on inputs (`__input`), not on `.p-button`. Verified via grep across `src/app/modules/admin`.
- The `<span>` tooltip wrapper has no SCSS targeting it.

---

## 2. The fix shape (proposal — not implemented)

The minimal-change fix: **scope the touch-target rules so they only apply on POS / kiosk / kitchen surfaces, not Back Office.**

Three viable approaches:

### Approach A — scope to a body / shell class
Wrap the touch rules in a parent selector that's only present on the POS shell. The POS shell already lives under `<router-outlet>` for `/pos`, `/kiosk`, `/kitchen`, etc. Add a class like `<body class="touch-shell">` (or a class on the POS shell host) and gate `_touch.scss`:

```scss
.touch-shell .p-button {
  min-height: $touch-target-min;
  min-width: $touch-target-min;
  font-size: $font-size-base;
}
```

Pros: surgical; doesn't change Back Office at all. Cons: requires a class hook that doesn't yet exist.

### Approach B — explicit Back Office override
Add a Back Office-scoped rule that resets the touch sizing inside `/admin`:

```scss
.admin-shell .p-button {
  min-height: 0;
  min-width: 0;
  font-size: 14px;
}
```

Pros: zero risk to existing POS UX. Cons: an "undo" rather than scoping the original.

### Approach C — narrow `_touch.scss` to icon-only / `.touch` opt-in
Drop the global `.p-button` block; require components that want touch sizing to opt in via a `.touch` modifier:

```scss
.p-button.touch,
.p-button.p-button-icon-only {
  min-height: $touch-target-min;
  min-width: $touch-target-min;
}
```

Pros: explicit at call site. Cons: requires sweeping the POS / kiosk / kitchen templates to add `styleClass="touch"` everywhere. High blast radius.

**Recommended**: **Approach A** — add a `touch-shell` class to the POS / kiosk / kitchen shell components and gate `_touch.scss` rules behind it. Back Office already uses `admin-shell`, no class collision.

After this fix:
- Buttons in Back Office naturally render at PrimeNG's default size (~38 px tall, content width).
- POS keeps the 64 px touch targets it needs.
- `size="small"` on `<p-button size="small">` works as expected in Back Office (~32 px).

---

## 3. The Giro hardcoded copy

### Current behavior
[`admin-settings.component.ts:326-336`](src/app/modules/admin/components/settings/admin-settings.component.ts#L326-L336):

```ts
readonly currentGiroInfo = computed(() => {
  const macro = this.authService.primaryMacroCategoryId();
  const map: Record<MacroCategoryType, { icon: string; name: string; description: string }> = {
    [MacroCategoryType.FoodBeverage]: { icon: '🍽️', name: MACRO_CATEGORY_LABELS[MacroCategoryType.FoodBeverage], description: 'Mesas, cocina, mesero, kiosko' },
    [MacroCategoryType.QuickService]: { icon: '☕',  name: MACRO_CATEGORY_LABELS[MacroCategoryType.QuickService], description: 'Mostrador, comandas rápidas' },
    [MacroCategoryType.Retail]:       { icon: '🛒',  name: MACRO_CATEGORY_LABELS[MacroCategoryType.Retail],       description: 'Inventario, código de barras, fiado' },
    [MacroCategoryType.Services]:     { icon: '🛠️', name: MACRO_CATEGORY_LABELS[MacroCategoryType.Services],     description: 'Estéticas, consultorios, talleres' },
  };
  if (macro === null) return { icon: '…', name: 'Cargando…', description: '' };
  return map[macro];
});
```

The `description` strings are 100% hardcoded in this component. They render in the Giro card via [`admin-settings.component.html:81-86`](src/app/modules/admin/components/settings/admin-settings.component.html#L81-L86):

```html
<div class="settings-giro-display__name">{{ currentGiroInfo().name }}</div>
<div class="settings-giro-display__desc">{{ currentGiroInfo().description }}</div>
```

So a Gym tenant sees "Estéticas, consultorios, talleres" — a list of OTHER vertical examples, which is wrong.

### What `TenantContextService` actually exposes

[`tenant-context.service.ts:31, 50, 63-67`](src/app/core/services/tenant-context.service.ts#L31-L67):

```ts
private readonly _currentSubCategory = signal<SubCategoryType | null>(null);
readonly currentSubCategory = this._currentSubCategory.asReadonly();

readonly currentBusinessType = computed<BusinessTypeCatalog | null>(() => {
  const sub = this._currentSubCategory();
  if (sub === null) return null;
  return this.catalogService.businessTypes().find(b => b.code === sub) ?? null;
});
```

`currentBusinessType()` returns a `BusinessTypeCatalog` whose schema is [`catalog.model.ts:39-47`](src/app/core/models/catalog.model.ts#L39-L47):

```ts
export interface BusinessTypeCatalog {
  id: number;
  code: string;
  name: string;          // e.g. "Gimnasio", "Restaurante", "Cafetería"
  hasKitchen: boolean;
  hasTables: boolean;
  posExperience: PosExperience;
  sortOrder: number;
}
```

There's a `name` field with the **specific** sub-category label ("Gimnasio") but **no `description`** — the catalog doesn't carry user-facing copy beyond the label.

`currentSubCategory()` returns the `SubCategoryType` enum (`Gym`, `Generic`, …). No description either.

### Three ways to make it dynamic

| Option | Change | Result for a Gym tenant |
|--------|--------|-------------------------|
| **A. Use the sub-category name as the description** | `description: tenantContext.currentBusinessType()?.name ?? ''` | Header: "🛠️ Servicios" / Sub: "Gimnasio". Compact, accurate, no hardcoded list. |
| **B. Drop the description entirely** | Remove the `__desc` div | Just the macro name + icon. Cleanest visually. |
| **C. Backend extension** | Add `description: string` to `BusinessTypeCatalog` and serve it from the backend catalog. | Header: "🛠️ Servicios" / Sub: backend-controlled copy. Maximum flexibility but requires API + DB change. |

**Recommended**: **Option A**. Zero backend work, zero new fields, replaces a misleading hardcoded list with the tenant's exact sub-category name that already lives in `currentBusinessType()`. If the sub-category hasn't loaded yet, the description gracefully falls back to empty.

Sketch (conceptual, not implemented):

```ts
readonly currentGiroInfo = computed(() => {
  const macro = this.authService.primaryMacroCategoryId();
  if (macro === null) return { icon: '…', name: 'Cargando…', description: '' };
  const subName = this.tenantContext.currentBusinessType()?.name ?? '';
  const map: Record<MacroCategoryType, { icon: string; name: string }> = {
    [MacroCategoryType.FoodBeverage]: { icon: '🍽️', name: MACRO_CATEGORY_LABELS[MacroCategoryType.FoodBeverage] },
    [MacroCategoryType.QuickService]: { icon: '☕',  name: MACRO_CATEGORY_LABELS[MacroCategoryType.QuickService] },
    [MacroCategoryType.Retail]:       { icon: '🛒',  name: MACRO_CATEGORY_LABELS[MacroCategoryType.Retail]       },
    [MacroCategoryType.Services]:     { icon: '🛠️', name: MACRO_CATEGORY_LABELS[MacroCategoryType.Services]     },
  };
  return { ...map[macro], description: subName };
});
```

---

## 4. Summary of recommended changes (not yet implemented)

| # | Area | Change | Risk |
|---|------|--------|------|
| 1 | `_touch.scss` | Scope `.p-button` rules to a `.touch-shell` parent (Approach A) | Low — additive selector |
| 2 | POS shell components (`pos-shell`, `kiosk-shell`, `kitchen-shell`) | Add `class="touch-shell"` to host | Low — pure markup |
| 3 | `admin-settings.component.ts` `currentGiroInfo` | Replace hardcoded `description` with `tenantContext.currentBusinessType()?.name` | Very low — dynamic + accurate |

No files were modified by this audit.
