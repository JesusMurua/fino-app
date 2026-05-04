# FDD-024 — POS Multi-Giro Neutrality (UI/UX & Routing)

**Status:** Read-only audit + Design Doc. No files modified. Awaiting confirmation before implementation.
**Date:** 2026-05-04
**Branch:** `fix/giro-ux`
**Author:** Audit pair-prog session
**Scope:** POS Module (`src/app/modules/pos/`)

---

## 1. Executive Summary

**Problem.** The POS module ships a multi-giro shell (Retail / F&B / Counter / Quick / Services) but its UI and routing still carry F&B-specific assumptions: a hardcoded "K" brand mark in the category sidebar, restaurant-flavored copy ("¿Qué vendiste?", "Notas para cocina"), and a routing flow that **unconditionally** sends every product through `/pos/add-meal/:id` — including memberships, services, and items that have no sizes or modifiers to customize.

**Solution.** Three coordinated, surgical changes: (a) remove the "K" brand mark from the category sidebar without replacement, preserving the 8 px spacing scale; (b) replace F&B copy with vertical-neutral wording driven by `TenantContextService.currentMacro()`; (c) gate the `/pos/add-meal/:id` navigation behind a clear, explicit `Product.requiresCustomization` rule — adding the flag to the API contract if (and only if) the existing properties cannot answer it without inference.

**User impact.** Cashiers in non-F&B verticals (gym mensualidad, retail stock, services) tap a product → it goes directly into the cart, no irrelevant detail page, no kitchen-notes textarea. Multi-giro tenants see neutral copy. Layout density and spacing are preserved.

---

## 2. Current State Analysis

### 2.1 Components involved

| Component | File | Role |
|---|---|---|
| `CategorySidebarComponent` | [category-sidebar.component.html:4](../src/app/modules/pos/components/category-sidebar/category-sidebar.component.html#L4) | Vertical icon-rail with category filters. **Contains the "K" brand mark.** |
| `KeypadStageComponent` | [keypad-stage.component.html:9, :66](../src/app/modules/pos/components/keypad-stage/keypad-stage.component.html#L9) | Calculator stage of the Chameleon shell. Manual-entry input + catalog search. |
| `ProductGridInnerComponent` | [product-grid-inner.component.ts:112-113](../src/app/modules/pos/components/product-grid-inner/product-grid-inner.component.ts#L112-L113) | Catalog stage of the Chameleon. **Unconditionally navigates to `/pos/add-meal/:id` on tap.** |
| `ProductGridComponent` (legacy) | [product-grid.component.ts:186-194](../src/app/modules/pos/components/product-grid/product-grid.component.ts#L186-L194) | F&B takeout flow. **Bug: both branches of `hasOptions` navigate to `add-meal`.** |
| `UnifiedPosComponent` | [unified-pos.component.ts:146-149](../src/app/modules/pos/components/unified-pos/unified-pos.component.ts#L146-L149) | Chameleon shell. Already gates `add-meal` by `hasOptions`. **Reference implementation.** |
| `ProductDetailComponent` | [product-detail.component.html:85-90](../src/app/modules/pos/components/product-detail/product-detail.component.html#L85-L90) | Page rendered by `/pos/add-meal/:id`. Hardcodes "Notas para cocina" textarea regardless of vertical. |
| `RestaurantHubComponent` | [restaurant-hub.component.html:32-34](../src/app/modules/pos/pages/restaurant-hub/restaurant-hub.component.html#L32-L34) | F&B-only shell. Empty-state copy mentions "Uber Eats, Rappi, DiDi Food" verbatim. |

### 2.2 Current UX pain points

1. **Visual noise.** "K" sits at the top of the category rail in the Chameleon shell. It is text content, not a logo asset, and the rail already has the brand identity in the topbar above. Removing it tightens the rail and recovers ~32 px of vertical space.
2. **Restaurant copy in non-F&B contexts.** A Gym tenant adding a "Mensualidad" sees "¿Qué vendiste?" and, if the product happens to have any size/modifier, "Notas para cocina (opcional)". A retail tenant sees the same.
3. **Forced detail page for trivial products.** A membership product with no sizes and no modifiers still navigates to `/pos/add-meal/:id`, requiring the cashier to confirm + return — for zero customization value.
4. **`product-grid` bug.** [Lines 186-194](../src/app/modules/pos/components/product-grid/product-grid.component.ts#L186-L194) have an `if (hasOptions) … else …` whose two branches are byte-identical (both call `router.navigate(['/pos/add-meal', id])`). This was introduced silently and is dead-code conditional masking the bypass intent.
5. **No semantic API contract.** Whether a product needs the detail page is currently inferred from `sizes.length > 0 || modifierGroups?.length > 0`. That inference is correct for F&B, but for memberships/retail it conflates two unrelated concepts (customization vs. notes-for-kitchen).

### 2.3 Inventory of F&B-specific copy

| File:Line | Current | Context |
|---|---|---|
| [keypad-stage.component.html:9](../src/app/modules/pos/components/keypad-stage/keypad-stage.component.html#L9) | `¿Qué vendiste?` | Manual entry placeholder |
| [keypad-stage.component.html:66](../src/app/modules/pos/components/keypad-stage/keypad-stage.component.html#L66) | `Buscar producto del catálogo...` | Catalog search placeholder |
| [product-detail.component.html:85](../src/app/modules/pos/components/product-detail/product-detail.component.html#L85) | `Notas para cocina (opcional)` | Heading for textarea |
| [product-detail.component.html:90](../src/app/modules/pos/components/product-detail/product-detail.component.html#L90) | `Sin cebolla, extra picante…` | Textarea placeholder |
| [restaurant-hub.component.html:32](../src/app/modules/pos/pages/restaurant-hub/restaurant-hub.component.html#L32) | `Órdenes de Delivery` | Empty-state heading (F&B-only — out of scope) |
| [restaurant-hub.component.html:34](../src/app/modules/pos/pages/restaurant-hub/restaurant-hub.component.html#L34) | `Aquí aparecerán las órdenes externas de Uber Eats, Rappi y DiDi Food...` | Empty-state body (F&B-only — out of scope) |
| [product-grid.component.ts:173](../src/app/modules/pos/components/product-grid/product-grid.component.ts#L173) | Toast: `"${code}" — ve al catálogo para asignarlo a un producto` | Barcode-not-found toast (already neutral, minor edit) |

> **Out of scope.** `restaurant-hub.component.html` lines 32-34 are F&B-shell-only (the F&B Hub is a bounded context per [AUDIT-052](AUDIT-052-restaurant-hub-chameleon.md)) and remain F&B-flavored intentionally. Mention here for completeness; not changed in this FDD.

### 2.4 Routing flow today

```
User taps a Product card in /pos/sell (Chameleon, Retail/Services/Counter/Quick)
   │
   ├── ProductGridInnerComponent.onProductSelected()  ── always ──>  Router.navigate(['/pos/add-meal', id])
   │
   └── ProductDetailComponent renders:
       ├── Sizes (if product.sizes.length > 0)
       ├── Modifier groups (if product.modifierGroups?.length > 0)
       └── Textarea "Notas para cocina (opcional)"   ── ALWAYS rendered
```

Membership products typically have **no sizes** and **no modifiers** — yet still take the detour.

### 2.5 Product model gap

[`product.model.ts`](../src/app/core/models/product.model.ts) does not expose:
- `productType` (good / service / membership)
- `requiresKitchenNotes` (boolean)
- `requiresCustomization` (boolean / derived)
- `macroCategory` (per-product override of tenant macro)

Today the system answers these implicitly:
- **"Is it a membership?"** → `product.metadata.membershipDurationDays != null` (Gym-specific, via free-form metadata)
- **"Does it need kitchen notes?"** → `product.printingDestinationId != null` (proxy, inconsistent — not all kitchen-bound products have a printer assigned)
- **"Does it need customization?"** → `product.sizes.length > 0 || product.modifierGroups?.length > 0` (correct heuristic for the "should I open the detail page" question, but not semantic)

**This FDD treats the heuristic `sizes.length > 0 || modifierGroups?.length > 0` as the correct, sufficient signal for "open the detail page".** It does *not* require a new API flag. The detail page itself, however, must conditionally render the kitchen-notes textarea — and *that* gate uses the `TenantContextService.currentMacro()` for `FoodBeverage` OR the existing `tenantContext.hasKitchen()` flag (whichever the existing kitchen-printing toggle uses; see §7.1).

---

## 3. Requirements

### 3.1 Functional Requirements

- **FR-001 — Remove "K" brand mark.** As a cashier in any vertical, I want a clean category rail without a placeholder brand letter, so that the rail shows only actionable content.
- **FR-002 — Vertical-neutral manual-entry placeholder.** As a cashier in a non-F&B vertical, I want the manual-entry input placeholder to describe a generic transaction (e.g. "Concepto y monto"), so that the copy does not assume I sold food.
- **FR-003 — Vertical-neutral catalog search placeholder.** As a cashier in any vertical, I want the search placeholder to read "Buscar en catálogo…" (already nearly neutral, minor edit), so that wording is uniform.
- **FR-004 — Conditional kitchen-notes textarea.** As a cashier in a non-F&B vertical, I want the product detail page to hide the "Notas para cocina" textarea when my tenant is not a kitchen-bound vertical, so that I am not asked for irrelevant input.
- **FR-005 — Bypass `/pos/add-meal` for trivial products.** As a cashier in any vertical, I want products with neither sizes nor modifier groups to be added directly to the cart on tap (no detail-page detour), so that I save 1-2 taps per simple product.
- **FR-006 — Fix the `product-grid` dead-conditional.** Remove the if/else whose branches are identical and apply the same `requiresCustomization` gating as `UnifiedPosComponent`.
- **FR-007 — Toast copy neutrality.** As a cashier scanning an unknown barcode, I want the toast to say "regístralo en el catálogo" (action-oriented, neutral), not "ve al catálogo para asignarlo a un producto".

### 3.2 Non-Functional Requirements

- **NFR-001 — Zero technical debt.** No frontend hacks (e.g. `if (categoryName === 'Membresía')`). Branching uses `TenantContextService` (existing) and explicit Product fields (existing: `sizes`, `modifierGroups`).
- **NFR-002 — Bundle neutral.** No new dependencies. No new lazy modules.
- **NFR-003 — Backwards compatible.** Existing F&B flow (`RestaurantHubComponent`, takeout via `ProductGridComponent`) keeps current behavior; only the dead-conditional bug is corrected.
- **NFR-004 — Spacing scale preserved.** Removing the "K" must not break the 8-px scale — the `gap`, `padding`, and `flex` rules of `.cat-sidebar` already carry the rail layout.
- **NFR-005 — A11y preserved.** All ARIA labels and keyboard navigation remain (the "K" was visual-only, no `aria-label`, no `role`).
- **NFR-006 — Render performance unchanged.** No additional change-detection cycles introduced.

---

## 4. Component Architecture

### 4.1 Affected Components

```
PosModule
├── CategorySidebarComponent              [edit HTML — remove brand mark]
├── KeypadStageComponent                  [edit HTML — placeholder copy]
├── ProductGridInnerComponent             [edit TS — gate add-meal navigation]
├── ProductGridComponent (legacy/F&B)     [edit TS — fix dead conditional]
├── ProductDetailComponent                [edit HTML/TS — gate kitchen-notes]
└── UnifiedPosComponent                   [no change — already correct]
```

### 4.2 Component Specifications (deltas only)

#### 4.2.1 `CategorySidebarComponent`

- **Type:** Dumb / Standalone.
- **Change:** Remove the line `<div class="cat-sidebar__brand">K</div>` from the template. Remove the corresponding `.cat-sidebar__brand` rule from the SCSS *only if no other selector references it* (verify before delete).
- **Inputs / Outputs:** Unchanged.
- **Justification:** The brand mark adds no functional or wayfinding value; the topbar already carries the brand identity for the shell.

#### 4.2.2 `KeypadStageComponent`

- **Type:** Dumb / Standalone.
- **Change:** Replace placeholder strings with vertical-neutral copy:
  - Manual-entry input: `"¿Qué vendiste?"` → `"Concepto y monto"` (or computed from `tenantContext.currentMacro()` — see §6.1).
  - Catalog search: `"Buscar producto del catálogo..."` → `"Buscar en catálogo..."`.
- **Inputs / Outputs:** Unchanged.

#### 4.2.3 `ProductGridInnerComponent`

- **Type:** Smart / Standalone.
- **Change:** Replace `onProductSelected` (currently unconditional `router.navigate`) with a 2-branch method:
  - If `productRequiresDetailPage(product)` is `true` → navigate to `/pos/add-meal/:id`.
  - Otherwise → call `cartService.addItem(product)` directly.
- **New helper (private, in same file):** `productRequiresDetailPage(p: Product): boolean` returns `(p.sizes?.length ?? 0) > 0 || (p.modifierGroups?.length ?? 0) > 0`.
- **Inputs / Outputs:** Unchanged.
- **Justification:** Mirrors the existing logic in `UnifiedPosComponent` (lines 146-149), which is the reference implementation.

#### 4.2.4 `ProductGridComponent` (legacy F&B)

- **Type:** Smart / Standalone.
- **Change:** Replace the dead `if (hasOptions) { navigate(...) } else { navigate(...) }` ([lines 186-194](../src/app/modules/pos/components/product-grid/product-grid.component.ts#L186-L194)) with the same 2-branch logic above. Reuse the `hasOptions` local; do not duplicate the helper — keep the helper inside `ProductGridInnerComponent` and inline the check here (these two components do not share a base class today; introducing one is out of scope).
- **Inputs / Outputs:** Unchanged.
- **Justification:** Bug fix + parity with `UnifiedPosComponent`.

#### 4.2.5 `ProductDetailComponent`

- **Type:** Smart / Standalone.
- **Change:**
  - In the TS, expose a computed signal `showsKitchenNotes` derived from `tenantContext.currentMacro() === MacroCategoryType.FoodBeverage` OR `tenantContext.hasKitchen()` (decision: §7.1).
  - In the HTML, wrap the existing `<label>` + `<textarea>` block ([lines 85-93 approx.](../src/app/modules/pos/components/product-detail/product-detail.component.html#L85)) in `@if (showsKitchenNotes()) { … }`.
- **Inputs / Outputs:** Unchanged.
- **Justification:** Avoids forcing a "Notes for kitchen" field on Gym/Retail/Services tenants. Reuses existing tenant-context plumbing — no new API field.

### 4.3 Component Communication

No changes. All edits stay within each component's existing public surface.

---

## 5. State Management

### 5.1 Component State

| Component | New state? |
|---|---|
| `CategorySidebarComponent` | None — pure markup deletion. |
| `KeypadStageComponent` | None — string literal change. (If we drive placeholder by macro, see §6.1, a `manualEntryPlaceholder` computed signal is added, sourced from `tenantContext.currentMacro()`.) |
| `ProductGridInnerComponent` | None — new private method only. |
| `ProductGridComponent` | None — bug fix, no new state. |
| `ProductDetailComponent` | New computed signal `showsKitchenNotes: Signal<boolean>`. |

### 5.2 Reactive Patterns

- `tenantContext.currentMacro()` is already a signal (used across the admin and POS). No new subjects, no new subscriptions, no `takeUntilDestroyed` needed.
- The kitchen-notes gate in `ProductDetailComponent` re-evaluates only when the tenant macro changes, which is effectively per-session — change-detection neutral.

### 5.3 Form State

`ProductDetailComponent` has a FormGroup for sizes/modifiers/notes. The `notes` control remains in the FormGroup but is conditionally bound in the template. **Decision needed (§7.2):** when `showsKitchenNotes` is `false`, do we (a) leave the control in the FormGroup with a default empty string, or (b) remove it from the group entirely? Recommendation: **(a)** for simplicity — the empty string serializes to nothing on cart-line creation.

---

## 6. UI/UX Specifications

### 6.1 Manual-entry placeholder copy strategy

Two options. Recommendation: **Option A** for this FDD; defer Option B as a follow-up.

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A. Single neutral string** | `"Concepto y monto"` for all verticals. | Zero new code. Aligns with the "neutral copy" goal. | Slightly less personalized. |
| B. Macro-aware computed | Compute placeholder from `currentMacro()` (e.g. F&B: `"¿Qué vendiste?"`, Retail: `"Producto y monto"`, Services: `"Servicio y monto"`). | Personalized. | Adds a constant table + computed signal for marginal UX gain. Risk of mistranslation for tenants whose macro is set imprecisely. |

### 6.2 Layout / spacing impact (FR-001)

Removing `<div class="cat-sidebar__brand">K</div>`:
- The `.cat-sidebar` flex column has an existing `gap` (verified in [category-sidebar.component.scss](../src/app/modules/pos/components/category-sidebar/category-sidebar.component.scss)). Removing one child does not collapse the layout.
- The 8-px scale is preserved because no padding or gap rules change.
- `aria-label="Categorías"` on the parent `<nav>` is unchanged.
- The "Todos" button becomes the first focusable element — improves Tab order.

### 6.3 PrimeNG components

No changes. All edits are to existing markup; no new PrimeNG components are introduced. `pInputText`, `pButton`, and dialog/route remain as-is.

### 6.4 Visual states

- **Loading:** unchanged (catalog still streams via existing `ProductService`).
- **Empty:** unchanged.
- **Error:** unchanged.
- **Success (cart add directly without detail page):** existing toast / cart animation in `CartService.addItem` already covers this path (used today by `UnifiedPosComponent`).

---

## 7. Data Flow & Open Decisions

### 7.1 Decision — kitchen-notes gate source

> **Question:** Should the kitchen-notes textarea visibility depend on `tenantContext.currentMacro() === FoodBeverage`, or on the existing `tenantContext.hasKitchen()` flag?

**Recommendation:** `tenantContext.hasKitchen()`.
- A Quick-Service tenant (`MacroCategoryType.QuickService`) with `hasKitchen: true` (e.g. fonda) **does** want kitchen notes. A Quick-Service tenant without a kitchen (e.g. nieves) does **not**.
- `hasKitchen` is the existing, semantic flag. Macro alone is too coarse.
- This matches the existing pattern in `product-form.component` where `hasModifiersSection()` gates the Modifiers section by `tenantContext.hasKitchen()`.

### 7.2 Decision — `notes` form control

See §5.3. Recommendation: leave in FormGroup as empty string when hidden. **No API contract change**.

### 7.3 Decision — Do we add `Product.requiresKitchenNotes` or `Product.productType` to the API?

> **Recommendation: No, not in this FDD.**

The existing signals (`sizes`, `modifierGroups`, `tenantContext.hasKitchen()`) answer every question this FDD raises. Adding a new API flag now would be speculative. **Defer until a real product-level case appears** (e.g. a single product within an F&B tenant that should bypass kitchen — a sealed bottled drink). When such a case arises, the cleanest extension is `Product.requiresKitchenNotes?: boolean` (tri-state: undefined = inherit from `tenantContext.hasKitchen()`). That is a future FDD.

### 7.4 No new API integrations

This FDD does not call any new endpoints, does not change request/response shapes, and does not require a backend deploy.

---

## 8. Performance Optimization

- **Rendering:** removing the `K` div removes 1 DOM node. Negligible positive.
- **Signal granularity:** `showsKitchenNotes` reads `tenantContext` once per render of `ProductDetailComponent`. The component only renders when the user navigates to `/pos/add-meal/:id` — this is on-demand, not in a hot path.
- **Bundle size:** identical (string changes, deletion, no imports).
- **Change detection:** unchanged (no new subscriptions).

---

## 9. Error Handling

No new error paths. Existing `cartService.addItem` toasts (success + duplicate-line consolidation) cover the direct-add path. The barcode-not-found toast wording is updated; behavior is unchanged.

---

## 10. Accessibility

- **A11y-001.** `cat-sidebar` keeps `aria-label="Categorías"`. Removing the "K" div improves Tab order (no decorative non-focusable text node before the first button).
- **A11y-002.** The kitchen-notes `<textarea>` had a `<label>` association; gating both behind a single `@if` preserves the association.
- **A11y-003.** No keyboard shortcuts changed.
- **A11y-004.** No screen-reader live regions added or removed.

---

## 11. Testing Requirements

### 11.1 Unit tests

| Component | New test scenarios |
|---|---|
| `ProductGridInnerComponent` | (a) tap on product with `sizes.length > 0` navigates to `/pos/add-meal/:id`; (b) tap on product with `modifierGroups.length > 0` navigates; (c) tap on product with neither → calls `cartService.addItem(product)` once, never navigates. |
| `ProductGridComponent` | Same three scenarios; assert no navigation in case (c). |
| `ProductDetailComponent` | (a) when `tenantContext.hasKitchen()` returns `true`, the textarea is rendered and bound; (b) when `false`, the textarea is *not* in the DOM. |

### 11.2 E2E / manual regression

1. **Gym (Services + hasKitchen=false).** Open `/pos/sell`, tap a "Mensualidad" product → confirm card lands directly in the cart with no detour.
2. **Restaurante (F&B + hasKitchen=true).** Open `/pos`, tap a product with sizes → confirm `/pos/add-meal/:id` opens with the kitchen-notes textarea visible.
3. **Abarrotes (Retail).** Open `/pos/sell`, tap a product with neither sizes nor modifiers → directly to cart. Tap a product with sizes (e.g. "Refresco — 600 ml / 1 L") → detail page opens, but kitchen-notes textarea is **hidden**.
4. **Category rail visual.** Confirm "K" is gone, the "Todos" button is the first item, vertical spacing matches the 8-px scale (no extra gap, no collapsed gap).

---

## 12. Implementation Phases

> **Phasing rationale.** Each phase is independently shippable and reversible. Recommended order: 1 → 2 → 3. Phases 1 and 2 are low-risk visual/copy edits; phase 3 is the routing change.

### Phase 1 — Brand mark removal (visual only)

| File | Change |
|---|---|
| [`category-sidebar.component.html`](../src/app/modules/pos/components/category-sidebar/category-sidebar.component.html) | Delete line 4. |
| [`category-sidebar.component.scss`](../src/app/modules/pos/components/category-sidebar/category-sidebar.component.scss) | Delete `.cat-sidebar__brand` rule **only if no other selector targets it**. |

**Validation:** visual diff in `/pos/sell` Chameleon shell. Confirm sidebar gap consistent.

### Phase 2 — Copy neutralization

| File | Change |
|---|---|
| [`keypad-stage.component.html`](../src/app/modules/pos/components/keypad-stage/keypad-stage.component.html) | `placeholder="¿Qué vendiste?"` → `placeholder="Concepto y monto"` (line 9). `placeholder="Buscar producto del catálogo..."` → `placeholder="Buscar en catálogo..."` (line 66). |
| [`product-detail.component.html`](../src/app/modules/pos/components/product-detail/product-detail.component.html) | Wrap label + textarea (lines ~85-93) with `@if (showsKitchenNotes()) { … }`. Heading text unchanged inside the gate. |
| [`product-detail.component.ts`](../src/app/modules/pos/components/product-detail/product-detail.component.ts) | Inject `TenantContextService`. Add `showsKitchenNotes = computed(() => this.tenantContext.hasKitchen())`. |
| [`product-grid.component.ts:173`](../src/app/modules/pos/components/product-grid/product-grid.component.ts#L173) | Toast detail copy neutralization (minor). |

**Validation:** open Gym tenant → open `/pos/sell` keypad stage; confirm new placeholders. Open `/pos/add-meal/:id` for a Gym product with sizes (if any) → confirm textarea hidden.

### Phase 3 — Routing gate (`add-meal` bypass)

| File | Change |
|---|---|
| [`product-grid-inner.component.ts:112-114`](../src/app/modules/pos/components/product-grid-inner/product-grid-inner.component.ts#L112) | Replace `onProductSelected` body with the 2-branch logic. Add private helper `productRequiresDetailPage`. |
| [`product-grid.component.ts:186-194`](../src/app/modules/pos/components/product-grid/product-grid.component.ts#L186) | Replace the dead `if/else` with the same 2-branch logic. |

**Validation:**
- Gym Mensualidad (no sizes, no modifiers) → direct to cart.
- F&B product with sizes → detail page.
- Retail product with sizes → detail page (no kitchen-notes thanks to Phase 2).
- Retail product without sizes → direct to cart.
- Confirm `UnifiedPosComponent` flow is unchanged.

---

## 13. Out of Scope (explicit)

- F&B-specific copy in `RestaurantHubComponent` (delivery section). The F&B Hub is bounded-context F&B per [AUDIT-052](AUDIT-052-restaurant-hub-chameleon.md); this FDD does not touch it.
- New i18n framework. No `ngx-translate` or `@angular/localize`. Strings stay hardcoded in Spanish; refactor to i18n is a separate FDD if/when localization becomes a requirement.
- Product-level `requiresKitchenNotes` flag on the API. Not added; rationale in §7.3.
- Refactoring `ProductGridComponent` and `ProductGridInnerComponent` into a shared base. Their roles already diverge (legacy F&B takeout vs. Chameleon catalog stage); merging is out of scope.

---

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A product with no sizes/modifiers in F&B context (e.g. a sealed water bottle) bypasses kitchen-notes capture, but the cashier *needed* to write a note. | Low | Low | The cashier can edit the cart line's notes from the cart panel (existing UX). If this becomes a recurring complaint, FDD-XXX adds `Product.requiresKitchenNotes`. |
| Removing `.cat-sidebar__brand` from SCSS breaks an external selector. | Very low | Low | Phase 1 instructs to delete only after grep confirms no consumers. |
| `tenantContext.hasKitchen()` returns `false` for an F&B tenant that does have a kitchen but hasn't toggled the setting. | Low (existing config issue) | Medium | Existing settings UX surfaces this toggle; not a regression caused by this FDD. |
| Manual-entry placeholder change reduces clarity for legacy F&B users. | Low | Low | "Concepto y monto" is at least as clear; if pushback, fallback to Option B (macro-aware) in a follow-up. |

---

## 15. Acceptance Criteria

This FDD is considered implemented when **all** of the following are observable on a fresh build:

- [ ] No "K" character is visible in the category rail of `/pos/sell` for any tenant macro.
- [ ] `/pos/sell` keypad-stage manual-entry input shows `Concepto y monto` placeholder.
- [ ] `/pos/sell` keypad-stage catalog search shows `Buscar en catálogo...` placeholder.
- [ ] `/pos/add-meal/:id` does not render the kitchen-notes textarea when `tenantContext.hasKitchen()` is `false`.
- [ ] Tapping a product with **no** sizes and **no** modifier groups in `/pos/sell` adds it directly to the cart (no `/pos/add-meal/:id` navigation).
- [ ] Tapping a product **with** sizes or modifiers navigates to `/pos/add-meal/:id`.
- [ ] `ProductGridComponent` (legacy F&B takeout flow) no longer has the dead `if/else` and uses the same gate.
- [ ] All existing tests pass; new unit tests added per §11.1 pass.
- [ ] `ng build` is clean.

---

## Approval Checklist

- [ ] §6.1 — Pick **Option A** (neutral string) or **Option B** (macro-aware) for keypad placeholder.
- [ ] §7.1 — Confirm `tenantContext.hasKitchen()` is the right gate for the kitchen-notes textarea.
- [ ] §7.3 — Confirm we are *not* adding `Product.requiresKitchenNotes` to the API in this FDD.
- [ ] §12 — Confirm phase order (1 → 2 → 3) and willingness to merge per phase.
