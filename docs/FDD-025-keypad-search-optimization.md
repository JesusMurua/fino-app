# FDD-025 — KeypadStageComponent Search Optimization & Manual-Entry Removal

**Status:** Design Doc. Read-only. Awaiting confirmation before implementation.
**Date:** 2026-05-04
**Branch:** `fix/giro-ux`
**Scope:** `src/app/modules/pos/components/keypad-stage/`
**Related:** FDD-024 (POS multi-giro neutrality), AUDIT-052 (POS bounded contexts)

---

## 1. Executive Summary

**Problem.** `KeypadStageComponent` carries two flows that no longer align with enterprise BI integrity and the reactive-component standard. First, a free-form "manual entry" pair (description + price) emits cart lines without a `ProductId`, breaking product-level analytics. Second, the catalog search is a hand-rolled `<input>`-with-button-list that lacks debounce, keyboard navigation, ARIA, and empty states. Beneath the surface, a constructor `effect` writes signals (`allowSignalWrites: true`) and races a redundant `ngOnInit` catalog load, async cart writes swallow rejections silently, and the component runs default change detection.

**Solution.** Eliminate the manual-entry flow entirely so every cart line carries a catalog `ProductId`. Replace the search with PrimeNG 17 `<p-autocomplete>` for built-in debounce, keyboard navigation, ARIA, and empty templates. Replace the constructor `effect` with a single `toObservable(activeBranchId)` reactive chain ending in `takeUntilDestroyed()`. Adopt `OnPush` change detection. Wrap async cart writes in `try/catch` with `MessageService` toast feedback. Persist recent items to `localStorage` keyed by branch. Extract magic numbers into named constants.

**User impact.** Cashiers gain a faster, accessible catalog search with full keyboard support and clear empty states. Sales analytics gain integrity — every line is product-attributed. Engineering gains a single reactive loading pipeline, OnPush rendering on a hot POS surface, and surfaced error feedback.

---

## 2. Current State Analysis

### 2.1 Components Involved

| Component | Role |
|---|---|
| `KeypadStageComponent` | Calculator stage of the Chameleon shell at `/pos/sell` (keypad view mode) |
| `UnifiedPosComponent` | Parent shell that mounts this component |
| `ProductService` | Source of catalog `Signal<Product[]>` |
| `CartService` | Recipient of `addItem(product)` and (currently) `addQuickItem(description, priceCents)` |
| `AuthService` | Source of `activeBranchId` signal |
| `MessageService` (PrimeNG) | Global toast surface (currently unused by this component) |

### 2.2 Current UX & Engineering Pain Points

| ID | Symptom | Reference |
|---|---|---|
| P-1 | Manual entry produces cart lines without `ProductId` → BI analytics gap | `addQuickItem`, `parsePriceCents` (TS lines 114-125, 158-163) |
| P-2 | Search is plain `<input>` + button list — no keyboard nav, no ARIA, no empty state | HTML lines 60-87 |
| P-3 | Zero feedback when search returns no matches with `term.length >= 2` | `catalogResults` returns `[]` silently |
| P-4 | Catalog loaded twice on first mount (effect + ngOnInit) | TS lines 81-85, 91-93 |
| P-5 | `allowSignalWrites: true` is an unjustified escape hatch | TS line 84 |
| P-6 | `addCatalogProduct` and `addRecentItem` swallow `cartService` rejections silently | TS lines 128-138 |
| P-7 | Recents lost on F5, route change, shift handoff | In-memory signal only |
| P-8 | Default change detection on a hot, signal-driven component | Decorator at TS line 25 |
| P-9 | Magic number `slice(0, 10)` for catalog cap; `slice(0, 5)` for recents cap | TS lines 70, 154 |

### 2.3 Performance Baseline

| Metric | Current | Notes |
|---|---|---|
| Catalog filter cost per keystroke | O(n) `Array.filter` over `products()` | Synchronous, no debounce |
| Re-render trigger | Default change detection on every signal change | `OnPush` would skip cousin trees |
| Catalog load on first mount | 2 calls (effect + ngOnInit) | Should be 1 |
| Time-to-interactive | Not measured | Out of scope to benchmark in this FDD |

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | User Story |
|---|---|---|
| FR-001 | Manual entry must not exist in any rendered state. | As a BI consumer, I require every cart line to reference a catalog `ProductId` so that revenue analytics by product are reliable. |
| FR-002 | Catalog search uses `<p-autocomplete>` with built-in keyboard navigation. | As a cashier, I want to navigate suggestions with Arrow Down/Up and confirm with Enter so that I never need to leave the keyboard. |
| FR-003 | Search debounce equals 300 ms. | As a cashier, I want fluid typing without intermediate filter flickers. |
| FR-004 | Search shows suggestions only when query length is 2 or more. | As a cashier, I want to avoid noisy single-character matches. |
| FR-005 | Search shows "Sin resultados" when 0 matches with query length >= 2. | As a cashier, I want clear feedback that my term has no hit. |
| FR-006 | `[forceSelection]="true"` so the input cannot accept a freeform value. | Aligns with FR-001 — only `ProductId`-bound selections. |
| FR-007 | Selecting a suggestion adds the product to the cart and clears the input. | As a cashier, I want one action to add and continue. |
| FR-008 | Recent items persist per branch across reloads via `localStorage`. | As a cashier, I want my last 5 quick re-adds to survive an F5. |
| FR-009 | Async failures from cart writes surface as a `MessageService` toast (severity `error`). | As a cashier, I want to know when an add fails. |
| FR-010 | Catalog loads exactly once when `activeBranchId` first becomes truthy and again only on subsequent change. | Engineering correctness — no duplicate fetches. |
| FR-011 | Search matches by `name` and `barcode`, diacritic-insensitive, case-insensitive. | As a cashier with a barcode scanner that types digits into the search field, I want the product to match without me knowing the name. |

### 3.2 Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-001 | Change detection strategy | `OnPush` |
| NFR-002 | Subscription cleanup | `takeUntilDestroyed()` only — no manual `Subject<void>` |
| NFR-003 | No `allowSignalWrites: true` anywhere in the component | Hard rule |
| NFR-004 | Bundle delta | Adds `AutoCompleteModule`. Estimated under 15 kB gzipped, joins existing POS lazy chunk |
| NFR-005 | Spacing scale | 8 px scale preserved (existing `$space-1` … `$space-5` tokens) |
| NFR-006 | Border treatment | Soft shadow only — no hard 1 px borders. Inherited from PrimeNG theme overrides in `styles.scss` |
| NFR-007 | Accessibility | WCAG 2.1 Level AA — proper labels, ARIA roles via PrimeNG defaults, focus management |
| NFR-008 | Browser support | Same as project baseline (modern evergreen) |
| NFR-009 | Render budget | No new render per keystroke beyond what `<p-autocomplete>` performs internally |

---

## 4. Component Architecture

### 4.1 Component Hierarchy (post-refactor)

```
UnifiedPosComponent
└── KeypadStageComponent
    ├── (PrimeNG) p-autoComplete           ← catalog search surface
    └── Recents list                       ← <button> repeater (persisted)
```

The "Cobro rápido" title block is retained. The manual-entry row, price input, and "AGREGAR AL CARRITO" CTA are removed.

### 4.2 Component Specifications

| Property | Value |
|---|---|
| **Name** | `KeypadStageComponent` |
| **Type** | Standalone, smart container |
| **Selector** | `app-keypad-stage` |
| **Change Detection** | `OnPush` |
| **Imports (Angular/PrimeNG)** | `AutoCompleteModule`, `PricePipe` |
| **Template-only imports retired** | None tied directly to manual entry are template-only — the row removal eliminates them entirely |
| **Inputs** | None |
| **Outputs** | None |
| **Direct dependencies (DI)** | `AuthService`, `CartService`, `ProductService`, `MessageService` |
| **DI style** | `inject()` only (project convention for this component preserved) |

### 4.3 Component Communication

| Direction | Mechanism |
|---|---|
| Parent → Child | None (no `@Input`) |
| Child → Parent | None (no `@Output`) |
| Cross-component | `CartService` (signal-based shared state) |
| Global | `MessageService` (PrimeNG toast) |
| Reactive source | `AuthService.activeBranchId` (signal → observable via `toObservable`) |

---

## 5. State Management

### 5.1 Component State (post-refactor)

| Property | Type | Initial Value | Purpose | Notes |
|---|---|---|---|---|
| `products` | `Signal<Product[]>` | from `ProductService.products` | Source array for autocomplete suggestions | Read-only re-export |
| `catalogSelected` | `Signal<Product \| null>` | `null` | Two-way binding target for `<p-autocomplete>` | Reset to `null` after `(onSelect)` completes |
| `catalogSuggestions` | `Signal<Product[]>` | `[]` | Filtered list populated by `(completeMethod)` | Capped at `MAX_AUTOCOMPLETE_RESULTS` |
| `recentItems` | `Signal<RecentItem[]>` | hydrated from `localStorage` for current branch | Last `MAX_RECENT_ITEMS` added items, deduped | Persisted on every mutation |
| `hasCatalog` | `Signal<boolean>` (computed) | derived | True iff `products().length > 0` | Drives empty-catalog hint visibility |

### 5.2 Removed State (manual-entry kill)

| Removed | Reason |
|---|---|
| `quickDescription` signal | Manual entry removed |
| `quickPricePesos` signal | Manual entry removed |
| `canAddQuick` computed | Manual entry removed |
| `descriptionInput` viewChild | DOM ref no longer needed |
| `catalogSearch` signal | Replaced by autocomplete model |
| `catalogResults` computed | Replaced by `(completeMethod)` populating `catalogSuggestions` |

### 5.3 Reactive Patterns (post-refactor)

| Source | Pipeline | Subscription |
|---|---|---|
| `toObservable(authService.activeBranchId)` | `distinctUntilChanged()` → `filter(id => id !== null && id !== undefined)` → `switchMap(() => from(productService.loadCatalog()))` | `takeUntilDestroyed()` — declared in field initializer or `ngOnInit` body |

| Removed Pattern | Reason |
|---|---|
| `effect(() => { … loadCatalog() }, { allowSignalWrites: true })` | Replaced by the observable chain (no signal writes inside) |
| `ngOnInit { await loadCatalog() }` | Redundant — observable chain fires on first emission of `activeBranchId` |

### 5.4 Form State

Not applicable. After manual-entry removal the component carries no form. `<p-autocomplete>` operates as a controlled selector and is not a `FormGroup`.

### 5.5 Constants

| Name | Value | Purpose |
|---|---|---|
| `MAX_RECENT_ITEMS` | `5` | Cap on persisted recents list |
| `MAX_AUTOCOMPLETE_RESULTS` | `10` | Cap on suggestions returned by `(completeMethod)` |
| `RECENTS_STORAGE_KEY_PREFIX` | `'pos_keypad_recents:'` | Joined with `branchId` to form the per-branch storage key |

### 5.6 Persistence Decision (O.5 resolution)

> **Decision: persist `recentItems` to `localStorage`, scoped per branch.**

| Option | Decision | Rationale |
|---|---|---|
| Session-only (status quo) | Rejected | Cashier shifts span hours; F5 / route change loses recents and erodes trust |
| `sessionStorage` | Rejected | Survives reload but not tab-close; ambiguous lifecycle for a long-running shift |
| `localStorage`, branch-scoped key | **Selected** | Matches the existing `pos_view_mode` precedent in `ProductGridInnerComponent`; trivial footprint (<500 bytes per branch); branch isolation prevents cross-branch leakage when staff switches |
| Server-side per-cashier | Rejected | Out of scope; offline-first POS prioritizes local persistence |

Storage key format: `pos_keypad_recents:{branchId}`. Schema: `RecentItem[]` JSON-serialized. On read, validate shape and discard if corrupted; clear the corrupt key.

---

## 6. UI/UX Specifications

### 6.1 Layout Structure

| Region | Description | Visibility |
|---|---|---|
| Title | "Cobro rápido" header | Always |
| Search | Single full-width `<p-autocomplete>` row replacing the entire prior manual-entry row + legacy search input | Always |
| Recents | Vertical list of `<button>` rows below the search | When `recentItems().length > 0` |
| Catalog-empty hint | Inline text shown when `hasCatalog()` is false after the initial load completes | When applicable |

| Spacing | Token | Use |
|---|---|---|
| Outer section padding | inherited from `.keypad-stage` | Unchanged |
| Vertical gap between regions | `$space-4` (16 px) | Title ↔ search ↔ recents |
| Recents inner row gap | `$space-2` (8 px) | Between recents rows |

### 6.2 PrimeNG Components

| Component | Configuration | Templates | Events |
|---|---|---|---|
| `p-autoComplete` | `optionLabel="name"`, `[delay]="300"`, `[minLength]="2"`, `[forceSelection]="true"`, `[emptyMessage]="'Sin resultados'"`, `[suggestions]` bound to `catalogSuggestions()`, `[(ngModel)]` bound to `catalogSelected`, `placeholder="Buscar en catálogo..."`, `[styleClass]="'w-full'"`, `[ariaLabel]="'Buscar en catálogo'"` | Custom `pTemplate="item"` rendering product name on the left and price (via `PricePipe`) on the right | `(completeMethod)` populates `catalogSuggestions`; `(onSelect)` invokes `addCatalogProduct(event.value)` |
| `p-toast` | Global instance assumed mounted at app root. This component injects `MessageService` only. | n/a | n/a |

### 6.3 Visual States

| State | Surface | Trigger |
|---|---|---|
| Empty catalog (initial load incomplete) | Search hidden, inline hint "Cargando catálogo…" | `!hasCatalog() && productService.isLoading()` |
| Empty catalog (load complete, zero products) | Inline empty-state "Aún no hay productos en este catálogo." | `!hasCatalog() && !productService.isLoading()` |
| Search idle | `<p-autocomplete>` with placeholder, no panel open | `catalogSelected() === null` and no input |
| Search no-results | "Sin resultados" via `[emptyMessage]` | Query length >= 2 and zero matches |
| Selection success | Toast severity `success`, summary "Producto agregado", detail = product name | After `addCatalogProduct` resolves |
| Selection failure | Toast severity `error`, summary "No se pudo agregar el producto" | When `cartService.addItem` rejects |
| Recents present | Vertical list, capped at `MAX_RECENT_ITEMS` | `recentItems().length > 0` |
| Recents empty | Section hidden | `recentItems().length === 0` |

### 6.4 User Interactions

| Interaction | Effect |
|---|---|
| Type 2+ chars in search | After 300 ms debounce, suggestions populate |
| Arrow Down / Up | Navigate suggestions (PrimeNG built-in) |
| Enter on highlighted suggestion | `(onSelect)` fires → adds to cart, clears input |
| Click suggestion row | Same as Enter |
| Esc | Closes suggestion panel (PrimeNG built-in) |
| Click recent item | Re-adds via `addRecentItem(item)` (always a new line, no merge) |
| Tab from search | Moves focus to first recent button if present, else next focusable in shell |

---

## 7. Data Flow

### 7.1 API Integration

No new API calls. Catalog hydration continues to flow through `ProductService.loadCatalog()` (existing).

| Call | Trigger | Parameters | Response handling | Error handling |
|---|---|---|---|---|
| `productService.loadCatalog()` | Emission of `activeBranchId` via observable chain | none | Service updates its own `products` signal | Service-internal — surfaces a toast through its existing path |
| `cartService.addItem(product)` | `(onSelect)` of `<p-autocomplete>` | `Product` | `recentItems` append + dedupe + persist; success toast | `try/catch` → `MessageService.add` severity `error` |
| `cartService.addQuickItem(...)` | **Removed** | — | — | — |

### 7.2 Data Transformation

| Source | Transformation | Sink |
|---|---|---|
| `(completeMethod)` event with `.query` | Trim, lowercase, normalize diacritics; substring match against `name` and `barcode`; filter by `isAvailable`; cap at `MAX_AUTOCOMPLETE_RESULTS` | `catalogSuggestions` signal |
| Selected `Product` | `calcUnitPriceCents(product)` → `RecentItem { name, priceCents }` | `recentItems` signal + `localStorage` |
| `localStorage` JSON on mount | `JSON.parse` → shape validation → array of `RecentItem` | `recentItems` signal |

### 7.3 Data Refresh Strategy

| Trigger | Effect |
|---|---|
| Initial mount with truthy `activeBranchId` | Observable emits → `loadCatalog()` runs once |
| `activeBranchId` changes | `distinctUntilChanged` lets through; `switchMap` cancels in-flight load and starts new one |
| Manual refresh | Out of scope — not required by the feature |

---

## 8. Performance Optimization

### 8.1 Rendering Optimization

| Tactic | Application |
|---|---|
| `ChangeDetectionStrategy.OnPush` | Component decorator |
| Signal-driven inputs | All template bindings read from signals |
| `track` in recents `@for` | Replace `track item.name + ':' + item.priceCents` with `track $index` (recents are positionally stable) |
| Suggestion list cap | `MAX_AUTOCOMPLETE_RESULTS` |
| Recents cap | `MAX_RECENT_ITEMS` |

### 8.2 Data Optimization

- Suggestions remain sourced from in-memory `products()` — no network on keystroke.
- `(completeMethod)` runs a single `Array.filter` per call; PrimeNG's `[delay]="300"` provides the debounce.
- No virtual scrolling required at the proposed cap.

### 8.3 Bundle Optimization

- `AutoCompleteModule` joins the existing POS lazy chunk; no new lazy boundary.
- Manual-entry SCSS removal recovers some bytes; net delta is import-dominated.
- Standalone-component imports continue to enable tree-shaking.

---

## 9. Error Handling

### 9.1 Error Types

| Error | Surface | Severity |
|---|---|---|
| `cartService.addItem` rejection | Toast — "No se pudo agregar el producto" | `error` |
| `cartService.addItem` rejects with stock-out (if service surfaces structured error) | Toast — pass through service-provided message | `warn` |
| `localStorage` write quota exceeded | Silent fallback to in-memory; wrapped in try/catch | none |
| `localStorage` read parse error | Silent fallback to empty array; clear the corrupt key | none |
| `productService.loadCatalog` rejection | Already handled by the service; no additional surface in this component | n/a |

### 9.2 User Feedback

| Surface | Use |
|---|---|
| `MessageService` toast | Add success / add failure |
| Inline text | Catalog-empty / loading hints |
| `<p-autocomplete>` `[emptyMessage]` | Search no-results |
| Disabled state | Not applicable — no buttons remain (CTA removed) |

---

## 10. Accessibility

### 10.1 Keyboard Navigation

| Key | Behavior |
|---|---|
| Arrow Down / Up | Move highlight in suggestion panel (PrimeNG default) |
| Enter | Select highlighted suggestion |
| Esc | Close suggestion panel (PrimeNG default) |
| Tab | Move to first recent item if present, else next focusable in shell |
| Shift+Tab | Move to previous focusable in shell |

### 10.2 Screen Reader Support

| Element | Requirement |
|---|---|
| `<p-autocomplete>` | `[ariaLabel]="'Buscar en catálogo'"` |
| Suggestion panel | Inherits `role="listbox"` + `role="option"` from PrimeNG defaults |
| Recents button | Each `<button>` carries `[attr.aria-label]` describing item name and price |
| Empty-state texts | Plain text inside semantic `<p>` — read in document order |

### 10.3 Live Regions

A single `aria-live="polite"` announcement of "Producto agregado: {name}" after each successful add. Implementation choice (toast vs dedicated `sr-only` region) deferred to the build phase.

---

## 11. Testing Requirements

### 11.1 Unit Tests

| Subject | Scenarios |
|---|---|
| Component initialization | (a) Mounts with `activeBranchId` truthy → catalog load called once; (b) Mounts with branch null → no load until branch becomes truthy; (c) Branch changes → catalog reloads with new context |
| `(completeMethod)` filtering | (a) Query length < 2 → empty suggestions; (b) Query matches by `name` → product included; (c) Query matches by `barcode` → product included; (d) Diacritic-insensitive match (e.g., "cafe" matches "Café"); (e) `MAX_AUTOCOMPLETE_RESULTS` cap respected; (f) `isAvailable: false` excluded |
| `(onSelect)` → cart add | (a) Success → `cartService.addItem` called, recents updated, persisted, toast success; (b) Rejection → toast severity error, recents not updated |
| Recents persistence | (a) Mount reads `localStorage` for current branch; (b) Branch change reads different key; (c) Corrupted JSON → fallback to empty + key cleared |
| Manual-entry removal regression | DOM contains no element matching the prior manual-entry selectors (description input, price input, "AGREGAR AL CARRITO" button) |

### 11.2 E2E / Manual Regression

| Path | Expected |
|---|---|
| Open `/pos/sell` keypad mode | Title visible, autocomplete visible, no manual-entry inputs |
| Type "ag" | After 300 ms, suggestions show products containing "ag" |
| Type "xyz" | "Sin resultados" shown |
| Select first suggestion | Cart line added, success toast, search clears |
| Reload page | Recents preserved for the same branch |
| Switch branch | Recents update to that branch's stored list |
| Force `cartService.addItem` to reject (test hook) | Error toast surfaces, recents unchanged |

---

## 12. Implementation Phases

| Phase | Goal | Files Touched | Validation |
|---|---|---|---|
| 1 | Remove manual-entry surface | `keypad-stage.component.html` (delete description+price row, "AGREGAR AL CARRITO" button); `keypad-stage.component.ts` (delete signals, methods, viewChild listed in §5.2); `keypad-stage.component.scss` (delete orphan rules `__row`, `__field`, `__field--desc`, `__field--price`, `__price`, `__price-currency`, `__add`, `__add--disabled` after grep confirms zero external consumers) | Build clean; manual-entry DOM nodes absent in dev preview |
| 2 | Migrate search to `<p-autocomplete>` | `keypad-stage.component.ts` (add `AutoCompleteModule` import, `catalogSelected`, `catalogSuggestions`, `(completeMethod)` handler, `(onSelect)` handler, `MAX_AUTOCOMPLETE_RESULTS` constant); `keypad-stage.component.html` (replace legacy search markup with `<p-autocomplete>` + item template); `keypad-stage.component.scss` (remove `__catalog-search`, `__catalog-input`, `__catalog-icon`, `__catalog-results`, `__catalog-chip`, `__catalog-name`, `__catalog-price` rules superseded by PrimeNG defaults) | Keyboard navigation works; "Sin resultados" appears for unknown term; selection adds and clears |
| 3 | Reactive load + OnPush + error toasts + recents persistence + constants | `keypad-stage.component.ts` (replace `effect` and `ngOnInit` load with `toObservable` chain; add `OnPush`; wrap async cart writes in try/catch; add `MAX_RECENT_ITEMS` and `RECENTS_STORAGE_KEY_PREFIX` constants; add `localStorage` hydrate + persist helpers keyed by branch); inject `MessageService` | No double-load on first mount; OnPush enabled; failure toast surfaces on simulated rejection; recents survive an F5 |

### Dependencies between phases

| From → To | Reason |
|---|---|
| Phase 1 → Phase 2 | Removing the manual-entry row first simplifies the markup site where `<p-autocomplete>` is inserted |
| Phase 2 → Phase 3 | `(onSelect)` handler from Phase 2 is the call site wrapped by Phase 3's try/catch |

### Out of Scope (explicit)

| Item | Reason |
|---|---|
| Removing `CartService.addQuickItem()` itself | Method may have other callers or planned uses; orphan-method audit is a separate FDD. Flag as follow-up if grep confirms zero callers post-Phase 1. |
| Migrating recents to a service for cross-component sharing | No other component renders recents today |
| Virtual scroll on `<p-autocomplete>` | Cap at 10 makes it unnecessary |
| Telemetry events for search no-results | Separate observability FDD |
| Replacing the recents `track` expression beyond `track $index` | Trivial, rolled into Phase 3 |
| Reactive-Forms migration of any remaining inputs | None remain post-Phase 1 |

### Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cashiers used to manual entry will lose the workflow | Medium | Medium | Communicate change in release notes; the catalog now accepts every BI-eligible item |
| `[forceSelection]="true"` rejects partial-typed text | Low | Low | Documented behavior; this is the intended invariant aligned with FR-001 |
| `localStorage` blocked in private mode | Low | Low | try/catch falls back to in-memory; recents simply do not persist this session |
| Stock-out rejection now surfaces as a toast and may feel noisy on retry | Low | Low | Severity `warn` for stock-out; severity `error` only for unexpected rejections |
| Service `addQuickItem` becomes orphaned | Medium | Low | Tracked as out-of-scope follow-up; does not block this FDD |

### Acceptance Criteria

- [ ] No manual-entry inputs render in any path of `KeypadStageComponent`.
- [ ] `<p-autocomplete>` is the sole search surface; `[delay]="300"`, `[minLength]="2"`, `[forceSelection]="true"`, `[emptyMessage]="'Sin resultados'"` configured.
- [ ] Catalog loads exactly once when `activeBranchId` first becomes truthy and again only on subsequent change.
- [ ] No `allowSignalWrites: true` remains in the file.
- [ ] Component decorator declares `changeDetection: ChangeDetectionStrategy.OnPush`.
- [ ] `try/catch` wraps every async call to `cartService.*`; rejections surface as `MessageService` toasts.
- [ ] `recentItems` round-trip survives a page reload, scoped per branch via `localStorage`.
- [ ] `MAX_RECENT_ITEMS`, `MAX_AUTOCOMPLETE_RESULTS`, `RECENTS_STORAGE_KEY_PREFIX` exist as named constants.
- [ ] Unit tests in §11.1 pass.
- [ ] `ng build` is clean.

### Approval Checklist

- [ ] §3.1 FR-006 — Confirm `[forceSelection]="true"` is the desired contract (no freeform).
- [ ] §5.6 — Confirm `localStorage` per-branch key is the right persistence choice.
- [ ] §6.4 — Confirm Tab from search → recents focus order.
- [ ] §7.1 — Confirm `CartService.addQuickItem` is *not* removed in this FDD (deferred to follow-up).
- [ ] §12 — Confirm phase order (1 → 2 → 3) and merge cadence (per-phase commits or single combined commit).
