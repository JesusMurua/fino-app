# FDD-026 — Customer Creation Contract Fix and Modal UX Cleanup

**Status:** Design Doc. Read-only. Awaiting confirmation before implementation.
**Date:** 2026-05-04
**Branch:** `fix/giro-ux`
**Scope:** [`src/app/core/models/customer.model.ts`](../src/app/core/models/customer.model.ts), [`src/app/core/services/customer.service.ts`](../src/app/core/services/customer.service.ts), [`src/app/shared/components/customer-selector/`](../src/app/shared/components/customer-selector/), [`src/app/core/services/database.service.ts`](../src/app/core/services/database.service.ts), plus a new shared pipe and any consumer that renders a customer name.
**Related:** [AUDIT-054](AUDIT-054-customer-modal-ui.md) (root-cause analysis); FDD-024 / FDD-025 (recent POS UX work in the same branch).

---

## 1. Executive Summary

**Problem.** The "Nuevo cliente" quick-create modal in the POS is unusable: the API rejects every save with a 400 Bad Request because the frontend sends `{ name, phone }` while the backend requires `firstName`. The error is silenced by an empty catch block so the cashier sees no feedback. Layered on top, the `<p-dialog>` is anchored inside the cart-panel sidebar (no `appendTo="body"`), and the "Nombre" / "Teléfono" inputs carry redundant placeholders that duplicate their labels. AUDIT-054 documented the four findings.

**Solution.** Realign the frontend contract to the backend in a single coordinated refactor: split `Customer.name` and `CreateCustomerRequest.name` into `firstName` (required) and `lastName` (optional). Introduce a `CustomerNamePipe` so every existing consumer can render the full name without inline concatenation. Refactor the `<p-dialog>` markup to two inputs with proper labels (no placeholders), and add `appendTo="body"`. Bump the Dexie schema, dropping cached customers and re-fetching on next mount. Wire `MessageService` into `saveNewCustomer` with a real `try/catch` so 400 errors surface as a toast.

**User impact.** Cashiers can create customers again. Errors are visible. The modal centers on screen instead of clipping inside the sidebar. The model finally matches the backend.

---

## 2. Current State Analysis

### 2.1 Components and files involved

| File | Role |
|---|---|
| [`customer.model.ts`](../src/app/core/models/customer.model.ts) | `Customer` interface (read shape) and `CreateCustomerRequest` (write shape). Both currently use `name`. |
| [`customer.service.ts`](../src/app/core/services/customer.service.ts) | `createCustomer`, `searchByPhoneOrName`, `loadCustomers`. Sorts and filters by `name`. |
| [`customer-selector.component.ts`](../src/app/shared/components/customer-selector/customer-selector.component.ts) | Smart shared component owning the search dropdown and quick-create dialog. |
| [`customer-selector.component.html`](../src/app/shared/components/customer-selector/customer-selector.component.html) | Markup of the chip, search input, dropdown rows, and `<p-dialog>` "Nuevo cliente". |
| [`database.service.ts`](../src/app/core/services/database.service.ts) | Dexie schema declarations, including the `customers` object store and its indexes. |
| Cart panel and any admin customer surface | Consumers of `customer.name` for display. |

### 2.2 Pain points (from AUDIT-054)

| ID | Symptom | Severity |
|---|---|---|
| A | `POST /customers` payload is `{ name, phone }`; backend requires `firstName`. 400 on every save. | Critical |
| B | `<p-dialog>` lacks `appendTo="body"` and is clipped inside the parent's stacking context. | High |
| C | Inputs in the dialog have placeholders ("Juan Pérez", "6671234567") that duplicate their labels. | Low |
| D | `try/catch` in `saveNewCustomer` swallows the 400; the comment promises a service-level toast that does not exist. | High |
| F | The read shape (`Customer.name`) likely also diverges from the backend. | Medium (depends on backend) |

### 2.3 Display sites that read `customer.name` today

The audit identified at least four call sites in `customer-selector.component.html` (chip avatar `charAt`, chip name, dropdown avatar, dropdown name). Other consumers (cart-panel chip, admin tables, ticket renderer, kitchen display) likely exist; the implementer enumerates them via a project-wide grep before Phase 4.

### 2.4 Open assumption (verify on deploy)

The backend response of `GET /customers` is assumed to return `{ firstName, lastName, ... }`. If the response still contains `name`, the read-path portion of this FDD is wrong and rollback is required. Acceptance criterion §15 captures this.

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | User Story |
|---|---|---|
| FR-001 | `Customer` and `CreateCustomerRequest` use `firstName` (required) and optional `lastName`. The `name` field is removed. | As a frontend developer, I need the model to match the backend so that integration is correct by construction. |
| FR-002 | The "Nuevo cliente" dialog has two text inputs with explicit labels: "Nombre(s) *" and "Apellido(s)". No placeholders on either. | As a cashier, I want labeled fields without redundant placeholder text so the form feels uncluttered. |
| FR-003 | The `<p-dialog>` declares `appendTo="body"` so it renders at document root and centers on screen regardless of ancestor stacking contexts. | As a cashier, I want the dialog visible and centered when the cart-panel triggers it. |
| FR-004 | A new standalone `CustomerNamePipe` (selector `customerName`, pure) returns the full display name from a `Customer`. | As a developer, I want a single source of truth for the customer display string so all consumers update mechanically. |
| FR-005 | All existing display sites that read `customer.name` are migrated to the pipe. Avatars that render the first initial read `customer.firstName.charAt(0)` directly. | As a cashier, I see the same names I saw before; the change is invisible. |
| FR-006 | `openCreate()` seeds the new form by mapping the current search query verbatim to `firstName`; `lastName` starts empty. | As a cashier, I want the name I typed to carry over without the system guessing where to split. |
| FR-007 | `saveNewCustomer` validates that `firstName.trim()` and `phone.trim()` are non-empty. `lastName` is optional. | As a cashier, I should not be blocked by an apellido I do not know. |
| FR-008 | API errors during create surface as a `MessageService` toast (severity `error`) with a human-readable summary and detail. | As a cashier, I need to know when a save fails. |
| FR-009 | The Dexie schema is bumped. The customers object store is dropped on the version upgrade and re-hydrated from the API on the next mount. | As a developer, I need a clean migration without writing a string-split migration helper. |
| FR-010 | `searchByPhoneOrName`, `loadCustomers`, and `createCustomer` operate on the new field shape end-to-end. Sort uses the full display name. | As a cashier, search and ordering work the same as before. |

### 3.2 Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-001 | All new and modified code, comments, and JSDoc are in English. | Hard rule |
| NFR-002 | The `CustomerNamePipe` is `pure: true` and standalone. | Hard rule |
| NFR-003 | No string-split heuristics anywhere in the codebase (e.g., `split(' ')[0]`). The contract is now structural. | Hard rule |
| NFR-004 | The `<p-dialog>` ARIA semantics and focus trap are preserved (PrimeNG defaults). | Pass |
| NFR-005 | Bundle delta is negligible. The pipe is a few lines; no new PrimeNG modules beyond what the component already imports. | < 1 KB gzipped |
| NFR-006 | No regressions in offline-first behavior. The Dexie schema bump intentionally drops cached rows; the next online sync rehydrates. | Documented |
| NFR-007 | Toast surface dependency is documented. The customer-selector relies on an ancestor (e.g., `UnifiedPosComponent`) rendering `<p-toast />`. New consumers must satisfy this. | Documented |

---

## 4. Component Architecture

### 4.1 Component Hierarchy (post-refactor)

```
<consumer that mounts <p-toast/>>          ← e.g., UnifiedPosComponent
└── <consumer of customer-selector>         ← e.g., cart-panel
    └── CustomerSelectorComponent           ← shared component, edited
        ├── search input + dropdown
        └── <p-dialog header="Nuevo cliente" appendTo="body">
            ├── input "Nombre(s) *"        (firstName)
            └── input "Apellido(s)"        (lastName)
```

### 4.2 Component Specifications

| Component / Pipe | Type | Selector | Change Detection | Public API delta |
|---|---|---|---|---|
| `CustomerSelectorComponent` | Standalone, smart | `app-customer-selector` | Unchanged (default — out of scope for this FDD) | No `@Input` / `@Output` change |
| `CustomerNamePipe` (new) | Standalone, pure pipe | `customerName` | n/a | `transform(c: Customer \| null \| undefined): string` |

### 4.3 Component Communication

| Direction | Mechanism | Change |
|---|---|---|
| Parent → CustomerSelectorComponent | `selectedCustomer` (`model<Customer | null>`), `placeholder` (`input<string>`), `compact` (`input<boolean>`) | None |
| CustomerSelectorComponent → Parent | `customerChanged` (`output<Customer | null>`) | None |
| Cross-component | `CustomerService` signals (`customers`, `selectedCustomer`) | Internal model shape changes; signal types update mechanically |
| Global | `MessageService` injected; `<p-toast />` is provided by an ancestor | New dependency |

---

## 5. State Management

### 5.1 Component State (post-refactor)

| Property | Type | Purpose | Notes |
|---|---|---|---|
| `query` | `Signal<string>` | Search input value | Unchanged |
| `results` | `Signal<Customer[]>` | Dropdown items | Type changes mechanically (new `Customer` shape) |
| `showDropdown` | `Signal<boolean>` | Dropdown visibility | Unchanged |
| `isSearching` | `Signal<boolean>` | Search-in-flight indicator | Unchanged |
| `showCreateDialog` | `Signal<boolean>` | Dialog visibility | Unchanged |
| `isSavingNew` | `Signal<boolean>` | Save-in-flight indicator | Unchanged |
| `createForm` | `CreateCustomerRequest` | Quick-create form model | **Shape change** — see §5.3 |
| `debounceTimer` | `ReturnType<typeof setTimeout> | null` | Manual debounce | Unchanged |

### 5.2 Reactive Patterns

No new patterns. Existing manual `setTimeout`-based debounce in the search remains as-is (out of scope; could be migrated to RxJS in a follow-up similar to FDD-025).

### 5.3 Form State (the change)

| Field | Before | After |
|---|---|---|
| `name` | `string` (required) | **Removed** |
| `firstName` | — | `string` (required) |
| `lastName` | — | `string` (optional, defaults to empty) |
| `phone` | `string` (required) | Unchanged |
| Other optional fields (`email`, `rfc`, `notes`, `creditLimitCents`) | Unchanged | Unchanged |

`createForm` initial value becomes `{ firstName: '', lastName: '', phone: '' }`. `openCreate(query)` seeds `firstName = query.trim()`, `lastName = ''`, `phone = ''`. The save guard checks `firstName.trim() && phone.trim()`.

### 5.4 Customer Read Model

| Field | Before | After |
|---|---|---|
| `name` | `string` (required) | **Removed** |
| `firstName` | — | `string` (required) |
| `lastName` | — | `string \| undefined` (optional) |
| All other fields | Unchanged | Unchanged |

---

## 6. UI/UX Specifications

### 6.1 Layout Structure

The dialog body becomes a vertical stack of three labeled fields (Nombre(s), Apellido(s), Teléfono) instead of two. Spacing remains consistent with the existing `cs-create-form__field` rules.

### 6.2 PrimeNG Components

| Component | Configuration | Change |
|---|---|---|
| `p-dialog` "Nuevo cliente" | header, `[(visible)]`, `[modal]="true"`, `[draggable]="false"`, `[style]="{ width: '360px' }"`, `styleClass="cs-create-dialog"` | **Add `appendTo="body"`**. All other attributes preserved. |
| `pInputText` for "Nombre(s)" | `<label for="cs-first-name">Nombre(s) *</label>`, `id="cs-first-name"`, `[(ngModel)]="createForm.firstName"`, `class="cs-create-form__input"`, no placeholder | **New input** |
| `pInputText` for "Apellido(s)" | `<label for="cs-last-name">Apellido(s)</label>`, `id="cs-last-name"`, `[(ngModel)]="createForm.lastName"`, `class="cs-create-form__input"`, no placeholder | **New input** |
| `pInputText` for "Teléfono" | Existing `id="cs-phone"`, `[(ngModel)]="createForm.phone"`, `maxlength="10"`, `type="tel"`. **Placeholder removed.** | Modified |

### 6.3 Visual States

| State | Surface | Trigger |
|---|---|---|
| Dialog open, idle | Three empty (or seeded) inputs, "Crear y seleccionar" disabled until `firstName` and `phone` are non-empty | Default |
| Saving | Spinner inside the primary button; button disabled | `isSavingNew()` true |
| Save success | Dialog closes; selected customer becomes the chip | Promise resolves |
| Save failure (400 or other) | Toast severity `error`, dialog stays open with current values | Promise rejects |

### 6.4 User Interactions

| Interaction | Effect |
|---|---|
| Type in search, then click "+" | Dialog opens; `firstName` pre-filled with the trimmed search query, `lastName` empty |
| Type in any input | `[(ngModel)]` updates `createForm` |
| Click "Crear y seleccionar" with valid input | Calls `customerService.createCustomer(createForm)` |
| Click "Cancelar" or backdrop / Esc | Closes dialog without save |
| Save fails | Toast surfaces error; user can fix and retry |

### 6.5 Copy Inventory (final)

| Surface | Copy |
|---|---|
| Dialog header | "Nuevo cliente" (unchanged) |
| Label firstName | "Nombre(s) *" |
| Label lastName | "Apellido(s)" |
| Label phone | "Teléfono *" (unchanged) |
| Cancel button | "Cancelar" (unchanged) |
| Save button | "Crear y seleccionar" (unchanged) |
| Toast error summary | "No se pudo crear el cliente" |
| Toast error detail | API-provided message when present, else "Revisa los datos e inténtalo de nuevo." |

---

## 7. Data Flow

### 7.1 API Integration

| Call | Trigger | Request body | Response | Error handling |
|---|---|---|---|---|
| `POST /customers` | `saveNewCustomer()` | `{ firstName, lastName?, phone, ... }` | `Customer` (new shape) | `try/catch` in component, toast on rejection |
| `GET /customers` | `loadCustomers()` (existing trigger) | n/a | `Customer[]` (new shape) | Existing offline-fallback logic preserved |
| `GET /customers/:id` | `refreshCustomer(id)` (existing) | n/a | `Customer` (new shape) | Unchanged |

### 7.2 Data Transformation

No frontend mapping layer is added. The form binds directly to the backend's contract — that is the entire point of the refactor.

| Stage | Transformation |
|---|---|
| Template → `createForm` | Direct `[(ngModel)]` to `firstName` / `lastName` / `phone` |
| `createForm` → `customerService.createCustomer` | Pass-through (object is already the API shape) |
| `customerService.createCustomer` → `api.post` | Pass-through |
| `api.post` response → Dexie | Direct `db.customers.put(customer)` |
| Dexie → display | `CustomerNamePipe` renders the full name |

### 7.3 Dexie Migration Strategy

The Dexie schema version is incremented. The `customers` object store is dropped (its index on `name` becomes invalid) and recreated with new indexes: `branchId`, `firstName`, `phone`, `lastVisitAt` (or whichever indexes the existing schema declared, mapped onto the new shape). On next mount, `loadCustomers()` re-fetches from the API and populates the store.

| Concern | Decision |
|---|---|
| Existing cached rows | Dropped on version upgrade (no in-place migration). |
| Offline at deploy time | Edge case. The next online sync repopulates. The customer-selector shows an empty dropdown until then; existing transactions are unaffected. |
| Index used for sort | Sorting is now done JS-side on the materialized array using the pipe-equivalent `${firstName} ${lastName}` for `localeCompare`. |

---

## 8. Performance Optimization

| Tactic | Application |
|---|---|
| Pure pipe | `CustomerNamePipe` memoizes per `Customer` reference, avoiding repeat string concatenation in dropdowns and chips |
| Dexie indexes | Updated to match the new field names; phone-prefix and branch-scoped queries continue to use indexes |
| Pipe vs inline expression | Pipe avoids rebuilding strings on every change-detection cycle in non-OnPush consumers |
| Bundle | One small standalone pipe added; one PrimeNG `appendTo` attribute added; no new modules |

---

## 9. Error Handling

### 9.1 Error Types

| Error | Surface | Severity |
|---|---|---|
| `POST /customers` rejection (any status) | Toast — summary "No se pudo crear el cliente", detail from API message when available | `error` |
| Validation failure (firstName or phone empty) | Save button disabled; no toast | n/a |
| Dexie write failure (post-success) | Console warning; the in-memory signal still updates so the UI stays consistent for this session | n/a |

### 9.2 User Feedback

| Surface | Use |
|---|---|
| `MessageService` toast | API failures during create |
| Disabled save button | Prevents submission of invalid forms |
| Inline label asterisk | Required-field hint on `firstName` and `phone` |
| Dialog stays open on failure | Lets the cashier fix and retry without re-typing |

### 9.3 Toast Renderer Dependency

The customer-selector injects `MessageService` and assumes an ancestor renders `<p-toast />`. Known mounts:

| Consumer | Toast available? |
|---|---|
| `UnifiedPosComponent` (POS shell) | Yes — `<p-toast />` already mounted |
| `cart-panel` (within `UnifiedPosComponent`) | Inherits |
| Admin customer surfaces (if any) | Implementer verifies during Phase 4 grep |

If a future consumer mounts the customer-selector outside a toast-bearing ancestor, the toast is silently dropped. This dependency is documented in the component JSDoc.

---

## 10. Accessibility

### 10.1 Labels and Required Indicators

| Field | Required indicator | Label association |
|---|---|---|
| `firstName` | "Nombre(s) *" + `aria-required="true"` on the input | `<label for="cs-first-name">` |
| `lastName` | None (optional) | `<label for="cs-last-name">` |
| `phone` | "Teléfono *" + `aria-required="true"` on the input | `<label for="cs-phone">` |

### 10.2 Focus Management

| Behavior | Source |
|---|---|
| Dialog open → first input receives focus | PrimeNG `<p-dialog>` default |
| Tab order: firstName → lastName → phone → Cancelar → Crear y seleccionar | DOM order |
| Esc closes the dialog | PrimeNG default |
| Focus returns to the trigger button on close | PrimeNG default |

### 10.3 Screen Reader Support

PrimeNG `<p-dialog>` provides `role="dialog"`, `aria-modal="true"`, and reads the `header` text. Inputs inherit accessible names from their explicit `<label for>` associations.

---

## 11. Testing Requirements

### 11.1 Unit Tests

| Subject | Scenarios |
|---|---|
| `CustomerNamePipe` | (a) firstName + lastName → "First Last"; (b) firstName only → "First"; (c) `null` / `undefined` → empty string; (d) lastName empty string → "First"; (e) trimming whitespace |
| `CustomerSelectorComponent.saveNewCustomer` | (a) Valid form → service called with payload, dialog closes, customer auto-selected; (b) Service rejects → toast severity `error` surfaced, dialog stays open; (c) `firstName` empty → save button disabled; (d) `phone` empty → save button disabled; (e) `lastName` empty → save proceeds with empty `lastName` |
| `CustomerSelectorComponent.openCreate` | Search query "Juan Pérez" → dialog opens with `firstName = "Juan Pérez"`, `lastName = ""`, `phone = ""` |
| `CustomerService.createCustomer` | Posts the new payload shape; Dexie put receives the new shape |
| `CustomerService.searchByPhoneOrName` | Continues to match against firstName + lastName concatenation (or whichever search semantics the implementation chooses) |

### 11.2 E2E / Manual Regression

| Path | Expected |
|---|---|
| Open cart-panel beneficiary selector for a Gym membership | Customer search opens |
| Type "Juan" → click "+" | Dialog opens centered on screen, `firstName` pre-filled with "Juan" |
| Type lastName "Pérez" and phone "6671234567" → save | Customer created, dialog closes, chip shows "Juan Pérez" |
| Save with backend offline / forced 500 | Toast severity `error`, dialog stays open, fields preserved |
| Reload after creation | Customer persists (re-fetched from API into refreshed Dexie store) |

---

## 12. Implementation Phases

> **Phasing note.** Phases are an organizational aid for review; the implementation should land as a single atomic commit (or PR) because intermediate phases leave the model and templates desynced and would produce runtime errors mid-deploy.

| Phase | Goal | Files | Validation |
|---|---|---|---|
| 1 | Model alignment | `customer.model.ts` (split fields on `Customer` and `CreateCustomerRequest`, drop `name`) | Type-check passes after dependent files are updated in subsequent phases |
| 2 | Service alignment | `customer.service.ts` (update `searchByPhoneOrName` to match against firstName + lastName concatenation; replace `sortBy('name')` with `toArray() + JS sort` over the pipe-equivalent display string; update sort in `createCustomer` and `loadCustomers`) | Build clean; Dexie reads/writes use new shape |
| 3 | Dexie schema bump | `database.service.ts` (increment version, drop `customers` store, recreate with new indexes: `branchId`, `phone`, `firstName`) | App boots cleanly; new schema visible in DevTools → Application → IndexedDB |
| 4 | New display pipe | `customer-name.pipe.ts` (new file, standalone, pure, `transform(c: Customer \| null \| undefined): string`) | Pipe unit tests pass |
| 5 | Component refactor | `customer-selector.component.ts` (split `createForm` shape; update `openCreate` seed; inject `MessageService`; rewrite `saveNewCustomer` with try/catch + toast); `customer-selector.component.html` (split inputs, drop placeholders, add `appendTo="body"`); `customer-selector.component.scss` (add a rule for the second input row if needed; preserve existing `__field` styles) | Manual: dialog centers; both inputs render with labels; placeholder noise gone |
| 6 | Display consumer migration | Project-wide grep for `customer.name`. Replace each with `\| customerName` in templates. Replace avatar-letter sites (`customer.name.charAt(0)`) with `customer.firstName.charAt(0)`. Component imports updated to include the pipe. | No runtime "undefined.charAt" errors anywhere |

### Dependencies between phases

| From → To | Reason |
|---|---|
| 1 → 2, 3, 5, 6 | Model is the source of truth; everything else compiles against it |
| 4 → 6 | The pipe must exist before consumers import it |
| 2, 3 → 5 | Service and Dexie must accept the new shape before the component writes it |
| All → atomic commit | Mid-deploy runtime errors otherwise |

### Out of Scope (explicit)

| Item | Reason |
|---|---|
| Migrating `[(ngModel)]` to Reactive Forms | Audit hallazgo E; same gray area as keypad-stage; project-wide convention not enforced |
| Adding RxJS debounce to the search input | Already documented as a follow-up; not part of this fix |
| Backwards-compatible read of legacy `name` from cached Dexie rows | Schema drop is intentional; offline-at-deploy is an accepted edge case |
| Server-side concatenation as an alternative | Backend changes are not in scope for this FE FDD |
| Telemetry on customer-create failures | Separate observability work |

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Backend `GET /customers` actually returns `{name}` (assumption fails) | Low | High | Pre-deploy verification (see §15 acceptance); rollback if mismatch |
| A consumer not enumerated in Phase 6 still reads `customer.name` | Medium | Medium | Project-wide grep is mechanical; TypeScript compiler will flag every static reference once `name` is removed from the interface |
| Toast does not appear because the ancestor lacks `<p-toast />` | Low | Low | Document the dependency in JSDoc; verify cart-panel path; existing `UnifiedPosComponent` already provides it |
| Dexie schema bump causes a one-time empty dropdown post-deploy | Medium | Low | Acceptable; next online `loadCustomers()` rehydrates |
| Cashier creates a single-name customer and search by lastName fails | Low | Low | Search logic explicitly concatenates with optional lastName; matches first-name-only customers |

---

## 13. Acceptance Criteria

- [ ] `customer.model.ts` exposes `firstName` (required) and `lastName` (optional) on both `Customer` and `CreateCustomerRequest`. `name` is gone.
- [ ] `POST /customers` request body matches the backend contract; 400 errors no longer occur for valid input.
- [ ] The `<p-dialog>` declares `appendTo="body"` and centers on screen even when invoked from the cart-panel sidebar.
- [ ] No `placeholder` attribute remains on the inputs inside the "Nuevo cliente" dialog.
- [ ] `openCreate(query)` produces `{ firstName: query, lastName: '', phone: '' }`.
- [ ] `saveNewCustomer` rejection path surfaces a `MessageService` toast (severity `error`) and leaves the dialog open with values preserved.
- [ ] `CustomerNamePipe` exists, is standalone, is pure, and handles null inputs.
- [ ] Every prior call site that read `customer.name` now uses `| customerName` (or `customer.firstName.charAt(0)` for avatars).
- [ ] Dexie schema version is incremented; the `customers` store is recreated.
- [ ] Backend response shape verification: a manual call to `GET /customers` shows `{ firstName, lastName, ... }` records.
- [ ] `ng build` is clean.

---

## 14. Approval Checklist

- [ ] §5.4 — Confirm `lastName: string | undefined` (instead of `string` with empty default) on the read model.
- [ ] §6.5 — Confirm copy: "Nombre(s) *", "Apellido(s)", "No se pudo crear el cliente".
- [ ] §7.3 — Confirm Dexie strategy: drop and re-fetch (no in-place migration).
- [ ] §9.3 — Confirm toast renderer dependency: rely on parent `<p-toast />` rather than mounting one in the customer-selector.
- [ ] §12 — Confirm phased organization with atomic single-commit merge.
- [ ] §13 — Confirm pre-deploy backend verification step is acceptable as the bar for shipping.
