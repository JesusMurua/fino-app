# AUDIT-050 — POS Enterprise UX: "Invisible Chameleon" strategy

**Date:** 2026-05-03
**Branch:** `fix/giro-ux`
**Scope:** Read-only audit of the POS module to design a unified, premium POS experience that absorbs the current `quick-pos` (calculator/keypad) and `retail-pos` (catalog) screens into a single component with a sleek view-mode toggle — modelled after Square / Shopify POS.
**Output:** Findings + Phase 1/2/3 action plan. **No code is being changed in this audit.**

---

## 1 — Current POS components inventory

### 1.1 Routing surface ([pos.routes.ts](src/app/modules/pos/pos.routes.ts))

| Path | Component | Purpose |
|---|---|---|
| `/pos` | [restaurant-hub.component.ts](src/app/modules/pos/pages/restaurant-hub/restaurant-hub.component.ts) | F&B omni-channel hub: Mesas / Para Llevar / Delivery via PrimeNG SelectButton — embeds `<app-tables>` + `<app-product-grid>`. |
| `/pos/quick-service` | [product-grid.component.ts](src/app/modules/pos/components/product-grid/product-grid.component.ts) | Counter / quick-service variant. Visual product grid + categories + scanner + `<app-cart-panel>`. |
| `/pos/retail` | [retail-pos.component.ts](src/app/modules/pos/components/retail-pos/retail-pos.component.ts) | Retail variant. Category sidebar + dense table layout + **inline** cart (does not use `<app-cart-panel>`). |
| `/pos/quick` | [quick-pos.component.ts](src/app/modules/pos/components/quick-pos/quick-pos.component.ts) | Services / Gym variant. Manual keypad calculator with description + price input + bill denominations + **inline** cart. |
| `/pos/waiter` | [waiter-pos.component.ts](src/app/modules/pos/components/waiter-pos/waiter-pos.component.ts) | Waiter app — feature-gated. |
| `/pos/add-meal/:id` | [product-detail.component.ts](src/app/modules/pos/components/product-detail/product-detail.component.ts) | Sizes + extras customization. |
| `/pos/checkout` | [checkout.component.ts](src/app/modules/pos/components/checkout/checkout.component.ts) | Final payment + ticket flow. |

### 1.2 The route resolver — [device-routing.service.ts:113-141](src/app/core/services/device-routing.service.ts#L113-L141)

`resolvePosRoute()` already maps `PosExperience` → route:

```
'Restaurant'         → /pos                  (RestaurantHub)
'Retail'             → /pos/retail           (RetailPosComponent — table layout)
'Counter'            → /pos/quick-service    (ProductGridComponent — visual grid)
'Quick' | 'Services' → /pos/quick            (QuickPosComponent — calculator)
fallback             → /pos/quick
```

This means a Gym (`Services`) tenant lands on the **calculator-only** `quick-pos`, with no Product Grid mode — even though the Catalog Search at the bottom of `quick-pos` already proves the cashier sometimes needs to add cataloged products (water, supplements, merch).

### 1.3 Does a Product Grid component already exist?

**Yes — and it is the strongest reusable asset in the module.**

- [product-grid.component.ts](src/app/modules/pos/components/product-grid/product-grid.component.ts) — fully featured, signal-based, with:
  - Category sidebar ([category-sidebar.component](src/app/modules/pos/components/category-sidebar/)).
  - Tile / list view-mode toggle persisted in `localStorage` under `pos_view_mode` ([product-grid.component.ts:46-66](src/app/modules/pos/components/product-grid/product-grid.component.ts#L46-L66)) — exactly the persistence pattern we want for the new keypad/grid toggle.
  - Barcode scanner integration via `ScannerService`.
  - Delivery panel + cart panel composition.
  - Loading + seed-fixture fallback.

`retail-pos` is essentially **a parallel re-implementation** of the same idea (catalog + add-to-cart + payment) but rendered as a dense table instead of tiles. It has its own search, its own scanner listener, its own bill-denomination logic, its own inline cart, and its own checkout dialog. **Significant duplication with `product-grid` + `cart-panel`.**

### 1.4 Cart / Ticket sidebar reuse

`<app-cart-panel>` ([cart-panel.component.ts](src/app/modules/pos/components/cart-panel/cart-panel.component.ts)) is a **standalone component** wired to the shared `CartService`, with ~480 lines covering:
- Coupon validation, rejected-promo display, cart evaluation.
- Table assignment + "adding to existing order" flow (`OrderContextService`).
- Send-to-kitchen flow (`hasKitchen` + `isFoodAndBeverage` gates).
- Membership beneficiary picker (Gym vertical) — gated by `metadata.membershipDurationDays`.
- Kitchen / checkout double-tap guards.

**It is currently consumed by exactly one place: `product-grid.component`** ([product-grid.component.ts:29](src/app/modules/pos/components/product-grid/product-grid.component.ts#L29)).

| POS variant | Cart implementation | CartService used? |
|---|---|---|
| `product-grid` (Counter / Restaurant Hub) | `<app-cart-panel>` ✅ | ✅ shared |
| `retail-pos` | Inline `<aside>` in template | ✅ shared (`this.cartService.items`) |
| `quick-pos` | Inline `<aside>` + **local** `cartItems = signal<CartItem[]>([])` | ❌ — does **not** use `CartService` |
| `waiter-pos` | (feature-gated) | — |

> **Risk:** `quick-pos` rolls its own cart signal ([quick-pos.component.ts:106](src/app/modules/pos/components/quick-pos/quick-pos.component.ts#L106)), so coupons, membership beneficiaries, table assignment, kitchen flow, stock-exceeded toasts, and offline persistence are all silently disabled in `Services` mode. This will need to be reconciled when unifying.

---

## 2 — Proposed unified architecture (the "Invisible Chameleon")

### 2.1 Goal

A single `<app-unified-pos>` component that ALL non-restaurant verticals route to. The component decides at runtime whether to render **Grid Mode**, **Keypad Mode**, or both side-by-side, driven by tenant `PosExperience` + an explicit user toggle. The Restaurant Hub remains separate because mesas/cocina/delivery is a fundamentally different orchestration shell.

### 2.2 Component composition

```
<app-unified-pos>
  ├── <app-pos-header>                        (already shared)
  ├── <section class="catalog-stage">
  │     ├── [view = 'grid']    → <app-product-grid-inner>   (extracted from product-grid)
  │     ├── [view = 'keypad']  → <app-keypad-stage>         (extracted from quick-pos)
  │     └── [view = 'split']   → both, with keypad on the right (tablet+ only)
  ├── <app-cart-panel>                        (already shared, single source of truth)
  └── <app-shift-panel>                       (already shared, mounted by header)
```

Implementation notes:

- **Extract `keypad-stage` from `quick-pos`** as a standalone component that only knows: description input, price input, recents, bill denominations, "add quick item" emit. It must call `cartService.addItem()` (or a new `cartService.addQuickItem(name, priceCents)`) so the cart unifies across modes.
- **Extract `product-grid-inner` from `product-grid.component`** — separate the "shell" (header, scanner listener, cart panel) from the "stage" (category sidebar + tiles/list grid). The shell becomes `unified-pos`; the stage becomes the swappable inner.
- **Retire `retail-pos`**: its dense-table layout becomes a third `viewMode = 'list'` of `product-grid-inner` (already supported by `ProductCardViewMode`). The inline cart is replaced by `<app-cart-panel>`. The bill-denomination dialog is replaced by the existing checkout flow.

### 2.3 The View-Toggle UI — three options ranked

| Rank | Pattern | Pros | Cons |
|---|---|---|---|
| ✅ **Recommended** | Segmented control (PrimeNG `SelectButton` or custom CSS pill) sitting in the header next to the "Turno abierto" chip — three icons: Grid, Keypad, Split | Always visible, one tap, no hidden state, Square-like feel. Discoverable. | Takes header real estate. |
| | Floating Action toggle (bottom-right circular FAB cycling Grid → Keypad) | Out of the way. | Hidden state — cashier doesn't know mode exists until they discover the FAB. |
| | Per-row tab strip above the catalog | Clear. | Wastes a full row of vertical space. |

**Persist the user choice** in `localStorage` under a per-experience key (e.g. `pos_view_mode_services`) using the same pattern as the existing `pos_view_mode` for grid/list.

### 2.4 Default-view rules driven by `PosExperience`

| `PosExperience` | Default view | Toggle visible? | Why |
|---|---|---|---|
| `Retail` | `grid` (tiles) | ✅ all 3 modes | Retail almost always sells from a catalog; keypad is the exception (open box, custom price). |
| `Counter` (QuickService macro) | `grid` | ✅ | Same as Retail — fixed menu, fast tap. |
| `Services` (Gyms, salones, talleres) | `keypad` | ✅ | Services are mostly bespoke prices, but the catalog matters for water/supplements. |
| `Quick` (legacy alias) | `keypad` | ✅ | Same as Services. |
| `Restaurant` | (does not use unified-pos — keeps `restaurant-hub`) | n/a | Mesas/cocina/delivery is its own shell. |

The default should be readable as: `defaultView = experience === 'Services' || experience === 'Quick' ? 'keypad' : 'grid'` — but **always overridable** by the user via the toggle, and the override takes precedence on next mount.

### 2.5 Routing impact

Update `device-routing.service.ts` to:

```
'Retail'             → /pos/sell            (UnifiedPosComponent, defaults to grid)
'Counter'            → /pos/sell            (UnifiedPosComponent, defaults to grid)
'Quick' | 'Services' → /pos/sell            (UnifiedPosComponent, defaults to keypad)
'Restaurant'         → /pos                 (RestaurantHubComponent — unchanged)
```

Old routes (`/pos/quick`, `/pos/quick-service`, `/pos/retail`) become 301-style redirects to `/pos/sell` for one release, then are deleted.

---

## 3 — Shift Panel auto-open behaviour: state-machine verification

### 3.1 What the user observed

> *"the shift panel didn't auto-open"*

### 3.2 Current state machine

[cash-register.service.ts:85-86, 604-617](src/app/core/services/cash-register.service.ts#L85-L86)

```ts
private readonly _isPanelOpen = signal(false);          // starts closed
readonly  isPanelOpen        = this._isPanelOpen.asReadonly();
openPanel():    void { this._isPanelOpen.set(true); }
closePanel():   void { this._isPanelOpen.set(false); }
togglePanel():  void { this._isPanelOpen.update(v => !v); }
```

There is **no `effect()` that observes `hasOpenSession()` and calls `openPanel()`** when the session flips to closed. The panel is **only** opened by:

1. The chip click in the header → `cashRegisterService.togglePanel()` ([pos-header.component.html:34](src/app/modules/pos/components/pos-header/pos-header.component.html#L34)).
2. (Nothing else — there is no auto-trigger anywhere.)

### 3.3 What DOES gate the cashier when shift is closed

A **separate** full-screen `session-blocker` overlay ([pos-header.component.ts:597-622](src/app/modules/pos/components/pos-header/pos-header.component.ts#L597-L622)). Its `setupState()` emits one of `'loading' | 'needsLinking' | 'needsOpening' | 'isOpen'`, and the blocker is shown whenever `!hasOpenSession()`. From the blocker's "Abrir Turno" CTA, `requestOpenDialog()` triggers the shared `<app-shift-management>` open-shift dialog **directly** — bypassing the right-side `shift-panel` sidebar entirely.

So today there are two distinct UX paths and they don't meet:

- **No session** → full-screen blocker → opens dialog directly.
- **Has session** → chip in header → `togglePanel()` → right-side shift sidebar.

### 3.4 What the prompt asked us to confirm vs reality

> *"Confirm that the Shift Sidebar correctly auto-opens ONLY when `ShiftState === 'closed'`, and remains accessible via a click on the 'Turno abierto' pill when open."*

**Reality:** half-true.

✅ The pill is correctly clickable and toggles the sidebar in both states (the chip is rendered for `--open` and `--closed` variants — see [pos-header.component.html:30-46](src/app/modules/pos/components/pos-header/pos-header.component.html#L30-L46)).

❌ The sidebar does **not auto-open** on `closed`. The full-screen blocker absorbs that responsibility by jumping straight to the open-shift dialog. Whether that is a bug or a feature is a product decision:

- **Argument to keep current behaviour:** the blocker forces the cashier to act *now* (no session → can't sell), and the shift sidebar's other actions (movements, partial close) are irrelevant when no session exists. Auto-opening the sidebar would just add a step.
- **Argument to add auto-open:** consistency with the prompt's description, and a single mental model ("the sidebar is where shift lives, period").

**Recommendation (Phase 2):** keep the blocker as the primary "no-session" gate, but add an `effect()` that calls `openPanel()` exactly once whenever `hasOpenSession()` transitions `false → true` so the cashier sees the freshly opened shift summary at a glance. That gives the panel a moment in the spotlight without competing with the blocker.

---

## 4 — UI/UX modernization (Dribbble / Enterprise quality)

### 4.1 PrimeFlex usage audit (sampled)

- `quick-pos.component.html` and `retail-pos.component.html` use **bespoke CSS Grid / flex** at the page level, not PrimeFlex utilities. That is fine for layout shells (PrimeFlex is utility-class noise at that scale) but it does mean each shell reinvents responsive breakpoints.
- `pos-header.component.scss` has 270+ lines of bespoke styling for the chip, sync indicator, divider, kiosk banner — well-organized but heavy.
- The `pos-header__divider`, `shift-chip__amount`, and pulse animation are good signals that the team is **already** investing in micro-polish; we should build on that.

**Verdict:** PrimeFlex is used appropriately (small surfaces, not page shells). The bigger opportunity is **shared design tokens** for the unified component — spacing scale, elevation tiers, motion timing — sourced from `_variables.scss`.

### 4.2 Three high-impact UI refinements

#### Refinement A — Cart-panel "glass" elevation + sticky total drawer

The current cart is a vertical column flush against the right edge. To feel premium:

- Switch the cart background to a layered surface: `background: rgba(255, 255, 255, 0.72); backdrop-filter: blur(20px) saturate(160%);` over a faint `linear-gradient` page background.
- Sticky **total drawer** at the bottom (`position: sticky; bottom: 0;`) with a subtle top shadow, so the running total is always visible during long lists. Use `box-shadow: 0 -8px 24px -16px rgba(17,24,39,0.18)` for the elevation.
- Empty-state illustration + microcopy: "Sin productos. Toca un artículo o usa el teclado para empezar." with a small pulsing chevron pointing left at the catalog. Today it's just an empty white area.

#### Refinement B — Add-to-cart micro-animation (FLIP)

When a product tile is tapped:

1. Capture the tile's bounding rect.
2. Clone it visually, animate it flying toward the cart panel (200ms, cubic-bezier(0.4, 0, 0.2, 1)).
3. Pulse the cart-item count badge (`scale(1) → 1.18 → 1`, 180ms) on landing.

This single piece of feedback is what distinguishes "demo POS" from "Square POS" in user perception. The `amountPulseKey` pattern already in `pos-header.component.ts:586-595` shows the team already knows the technique — extend it to the cart count.

#### Refinement C — Touch targets, density, and the keypad

Compliance with the project's own non-negotiable (`.claude/CLAUDE.md`: 64×64 minimum, 120×120 for product cards) needs an automated audit. Spot-check candidates that may be under-target:
- `retail-pos`'s dense table rows — likely <64px row height.
- Bill denomination buttons in `quick-pos` and `retail-pos`.
- Numpad in `pin-overlay` (PIN dialog).

Additional polish:
- Replace the bill-denomination buttons with a **horizontally scrollable strip of "currency cards"** (each showing the bill artwork or color-coded chip) — feels physical, faster to recognize than text-only `$200`.
- The keypad mode in `quick-pos` should expose a large, calculator-style price display (right-aligned, monospaced tabular numerals, ~56px font) instead of the current inline input. Linear / Stripe style.
- Use `prefers-reduced-motion` to disable the FLIP animation gracefully.

---

## 5 — Action plan

### Phase 1 — Foundations (no user-visible refactor) — ~1 day

- [ ] **P1.1 — `quick-pos` joins `CartService`.** Replace the local `cartItems` signal with `this.cartService.items`. Add a `cartService.addQuickItem(description, priceCents)` helper that wraps the virtual-product construction currently inlined at [quick-pos.component.ts:184-211](src/app/modules/pos/components/quick-pos/quick-pos.component.ts#L184-L211). This unblocks coupons, membership beneficiaries, table assignment, and offline persistence in Services mode.
- [ ] **P1.2 — Extract `keypad-stage` and `product-grid-inner`** as standalone child components consumed by the existing `quick-pos` and `product-grid` shells. Pure mechanical refactor, no UX change. Tests stay green.
- [ ] **P1.3 — Add an `effect()` in `cash-register.service.ts`** that calls `openPanel()` once on `hasOpenSession()` `false → true` transition (the "freshly opened shift" summary). Verifies the panel state-machine claim and gives the right-side panel a meaningful moment.

### Phase 2 — Unify into `UnifiedPosComponent` — ~2 days

- [ ] **P2.1 — Create `<app-unified-pos>`** at `modules/pos/components/unified-pos/`. Imports `pos-header`, `keypad-stage`, `product-grid-inner`, `cart-panel`, `shift-panel`. Owns the `viewMode = 'grid' | 'keypad' | 'split'` signal with localStorage persistence, keyed by `PosExperience`.
- [ ] **P2.2 — Add the segmented view toggle** in `pos-header` (or as a sibling pill next to the shift chip). Three icons. Default driven by `posExperience()`.
- [ ] **P2.3 — Re-route**: add `'/pos/sell'` route → `UnifiedPosComponent`. Update `device-routing.service.ts:resolvePosRoute()` for `Retail | Counter | Quick | Services`. Keep old routes as redirects for one release.
- [ ] **P2.4 — Retire `retail-pos.component`.** Its dense-table view becomes `viewMode='list'` of `product-grid-inner` (already supported by `ProductCardViewMode`). Inline checkout dialog → existing `/pos/checkout` flow. Bill denominations live only in keypad mode.

### Phase 3 — Premium polish — ~1.5 days

- [ ] **P3.1 — Glass cart + sticky total drawer** (Refinement A). Add `_glass.scss` mixin in `styles/`.
- [ ] **P3.2 — FLIP add-to-cart animation + count pulse** (Refinement B). Reuse the `amountPulseKey` pattern from `pos-header`. Respect `prefers-reduced-motion`.
- [ ] **P3.3 — Touch-target audit** of the unified component using a visual-regression script (Playwright + `getBoundingClientRect`). Enforce the 64/120 minimums in CI.
- [ ] **P3.4 — Calculator-style price display in keypad mode** + currency-card bill strip (Refinement C).
- [ ] **P3.5 — Empty-state polish**: catalog empty state, cart empty state, "no results" search state — all with subtle illustration + microcopy.

### Out of scope for this audit / not yet decided

- Whether `restaurant-hub` should also gain a unified-pos pane for "Para llevar" — likely yes in a future phase, but it brings table/kitchen interactions into the equation and deserves its own audit.
- The waiter-pos surface (feature-gated, mostly orthogonal).
- Backend changes — none are required; this is a pure frontend consolidation.

---

**Author:** Claude (AUDIT-050)
**Status:** Draft — awaiting user review before any code change.
