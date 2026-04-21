# FDD-016 — Back Office Settings Revamp (Matrix-Driven)

**Status:** Draft — awaiting approval
**Branch:** `fix/pos-to-admin-routing-auth`
**Author:** Architecture team
**Date:** 2026-04-20
**Related docs:**
- [AUDIT-033 — Back Office Settings / Configuración UI](./AUDIT-033-admin-settings-ui.md)
- [FDD-013 — Frontend Routing & Session Rehydration](./FDD-013-frontend-routing-and-session.md)
- [FDD-015 — Back Office Device Management UI](./FDD-015-admin-device-list.md)
- [.claude/business-rules-matrix.md](../.claude/business-rules-matrix.md)

---

## 1. Executive Summary

**Problem statement.** Back Office Settings ship with 8 tabs, zero feature-flag enforcement, and three structural conflicts: two competing printer tabs (Periféricos + Impresoras), a local Dispositivo tab that contradicts FDD-015's fleet management, and Owner-only Sucursales that violates FDD-013's Back Office role set. Several fields are dead (`businessPhone` never persists) or shown to tenants whose matrix doesn't unlock them (CFDI to Free, upgrade paths for macros that forbid the tier, delivery platforms without any gate).

**Proposed solution.** Collapse to 5 matrix-driven tabs (Negocio · Hardware · Seguridad · Fiscal · Facturación), move Sucursales out of Settings to a dedicated top-level `/admin/branches` route gated by `BACK_OFFICE_ROLES`, and delete the local Dispositivo tab entirely — `/admin/devices` is the single source for device management. Replace every `hasKitchen`/macro-based predicate with `TenantContextService.hasAnyFeature([...])` so the same shield used in `admin-devices` applies uniformly. Persist `businessPhone` through the existing branch config endpoint. Align DTOs with backend BDD-015 (`businessTypeIds` → `subGiroIds`) and surface 402 Payment Required via the existing interceptor toast — no bespoke error UI in Settings.

**User impact and UX goals.**
- Retail / Services owners stop seeing Cocina, Kiosko, CFDI and Enterprise upgrades that their matrix never grants.
- Admins manage devices in one place (`/admin/devices`); Settings only configures the *business*, not the *machine*.
- Managers gain access to branch CRUD, closing the gap created by FDD-013.
- Every form field saves or disappears — no silent data loss on `businessPhone` and similar dead inputs.
- Plan-limit errors (402) surface via the tenant-wide toast pattern; the user gets a consistent upgrade hint.

---

## 2. Current State Analysis

### 2.1 Existing artifacts involved

| Artifact | Current responsibility | Change scope |
|---|---|---|
| [admin-settings.component.ts](../src/app/modules/admin/components/settings/admin-settings.component.ts) | 8-tab shell, 15 signals, branch CRUD, device mode, PIN | Major rewrite — reduce surface, inject `TenantContextService`, delete device/branches regions |
| [admin-settings.component.html](../src/app/modules/admin/components/settings/admin-settings.component.html) | 8 tab buttons + 8 `@case` blocks | Remove 3 tabs, merge 2, add `@if (canSeeTab())` wrappers |
| [admin-printer-settings.component.ts](../src/app/modules/admin/components/settings/printer-settings/admin-printer-settings.component.ts) | Separate "Impresoras" tab content (print destinations) | Re-parented under the merged Hardware tab (same component, different host) |
| [admin-settings.component.scss](../src/app/modules/admin/components/settings/admin-settings.component.scss) | Tab styles | Minor — new responsive breakpoint for 5 tabs instead of 8 |
| [business-giro.model.ts](../src/app/core/models/business-giro.model.ts) | `UpdateBusinessGiroRequest` / `BusinessGiroResponse` with `businessTypeIds` | Rename field to `subGiroIds` across payload + response |
| [onboarding.component.ts](../src/app/modules/onboarding/onboarding.component.ts) | Only existing consumer of `UpdateBusinessGiroRequest` | Update `goToStep2()` to the new field name |
| [app-config.model.ts](../src/app/core/models/app-config.model.ts) | `AppConfig` shape — no `businessPhone` today | Add `businessPhone?: string` |
| [config.service.ts](../src/app/core/services/config.service.ts) | Loads `/branch/{id}/config` | Accept `businessPhone` in the response type + persist |
| [admin.routes.ts](../src/app/modules/admin/admin.routes.ts) | Admin child routes | Add `branches` child route + component |
| [admin-branches.component](../src/app/modules/admin/components/branches/) *(new)* | — | New standalone component for branch CRUD, extracted from Settings |
| [app.routes.ts](../src/app/app.routes.ts) | Top-level route table | No change — `branches` lives under `/admin/branches`, inherits `authGuard + roleGuard + adminShellGuard` |

### 2.2 Current UX pain points (from AUDIT-033)

1. **Eight tabs is too many** for horizontal nav; overflows on < 768 px viewports.
2. **Zero `TenantContextService.hasFeature` usage** across the entire settings folder.
3. **Dispositivo vs. `/admin/devices` duplication** — the Back Office and the Fleet UI disagree on who owns `mode` assignment.
4. **Periféricos vs. Impresoras duplication** — users must click twice to find all printer settings.
5. **Owner-only Sucursales** contradicts `BACK_OFFICE_ROLES = [Owner, Manager]`.
6. **Dead fields:** `businessPhone` typed in form, never POSTed.
7. **Unmasked paid features:** Fiscal tab visible on Free; billing upgrade options include Enterprise for macros that forbid it; delivery platforms hardcoded without feature gate.

### 2.3 Performance baseline

- Settings today loads `branches`, `config`, `subscriptionStatus`, `deliveryConfig` on first paint — 3-4 HTTP calls in parallel. Removing Sucursales removes `branches.getAll` from the Settings critical path (moves to `/admin/branches`), reducing initial-paint work by ~20-30 %.
- No perf regressions expected. The feature-shield computeds are constant-time reads over a `Set<FeatureKey>` already held in memory.

---

## 3. Requirements

### 3.1 Functional Requirements

**FR-001 — Consolidate to 5 tabs**
*As an admin, I want a focused settings screen with five clearly labeled tabs so I can find options without hunting.*
The UI SHALL expose exactly these tabs in this order: **Negocio · Hardware · Seguridad · Fiscal · Facturación**. Tabs hidden by the matrix do NOT shift the rendering order of the visible ones.

**FR-002 — Remove the Dispositivo tab**
*As an admin, I want a single place to manage devices (the `/admin/devices` screen from FDD-015), not two places with different rules.*
The Dispositivo tab, its template block, and its related state (`deviceConfig`, `availableModes`, `saveAndRedirect`, `updateDeviceConfig`, device-related `isSavingDevice`, `saveDeviceSuccess`) SHALL be removed from `AdminSettingsComponent`. The inline `<app-admin-devices>` page remains the sole device management surface.

**FR-003 — Merge Periféricos + Impresoras into Hardware**
*As an admin, I want every printer-related control under one tab so I stop clicking twice.*
A single Hardware tab SHALL render, in order: Thermal Printer card · Scanner card · Scale card (gated) · Print Destinations section (re-hosting `AdminPrinterSettingsComponent`). Each section is visible based on matrix rules defined in FR-005.

**FR-004 — Extract Sucursales to a top-level route**
*As a Manager with Back Office privileges, I want branch management without requiring Owner credentials.*
Branch CRUD SHALL move from the Settings tab to a new `/admin/branches` child route, guarded by the existing `authGuard + roleGuard + adminShellGuard` stack with `data.roles = [Owner, Manager]`. A new `AdminBranchesComponent` SHALL own the extracted logic. Settings SHALL have no "Sucursales" tab.

**FR-005 — Feature-shield every section**
*As a tenant, I only want to see features my plan × giro unlocks.*
Every tab and every feature-specific card SHALL consult `TenantContextService.hasAnyFeature(...)` before rendering. The full gating table:

| Surface | Visibility predicate |
|---|---|
| Tab **Negocio** | Always visible |
| Tab **Hardware** | Always visible |
| Tab **Seguridad** | Always visible |
| Tab **Fiscal** | `hasFeature(FeatureKey.CfdiInvoicing)` |
| Tab **Facturación** | Always visible |
| Card: Scale (Hardware) | `hasFeature(FeatureKey.CoreHardware)` AND `primaryMacroCategoryId === Retail` |
| Card: Print Destinations | `hasAnyFeature([KdsBasic, RealtimeKds, PrintedTickets])` |
| Section: Folio custom format (Negocio) | `hasFeature(FeatureKey.CustomFolios)` OR `hasFeature(FeatureKey.CfdiInvoicing)` |
| Section: Delivery platforms (inside Branch edit, promoted to `/admin/branches`) | `hasFeature(FeatureKey.DeliveryPlatforms)` *(new key — see §7.2)* |
| Section: Kiosko mode references | Never shown in Settings — lives only in `/admin/devices` (FR-002) |
| Billing: Upgrade options | Each option filtered by `AVAILABLE_PLANS_BY_MACRO` from the macro policy |

**FR-006 — Persist `businessPhone`**
*As an admin, I want the phone I type into Settings to survive a refresh.*
`businessPhone` SHALL become a field on `AppConfig` and travel through the existing `/branch/{id}/config` pipeline. The Negocio tab's "Guardar cambios" button SHALL save it alongside `businessName` and `locationName`. No separate endpoint.

**FR-007 — Rename `businessTypeIds` → `subGiroIds`**
*As a frontend team aligned with backend BDD-015, I want payload names consistent across the wire.*
`UpdateBusinessGiroRequest` and `BusinessGiroResponse` SHALL rename the field `businessTypeIds` to `subGiroIds`. All consumers (`onboarding.component.ts:510-514`, `business.service.ts:52`) SHALL update to the new name. No back-compat alias.

**FR-008 — 402 Payment Required handling**
*As an admin, when I try to save a setting my plan doesn't allow, I want a clear toast telling me to upgrade, not a dead form.*
The existing `authInterceptor` 402 handler (which toasts `error.message` or a default "Límite de plan alcanzado") SHALL remain the single source of 402 UX. Settings save handlers SHALL NOT add their own error toast for 402 — they SHALL only `catch` to clear their local `isSaving` flag. The confirm/success feedback stays local; the upsell message is global.

**FR-009 — Manager role parity**
*As a Manager, I want the same Back Office access Owner has, consistent with FDD-013's `BACK_OFFICE_ROLES`.*
Every `roleId === UserRoleId.Owner` guard in Settings SHALL be replaced with `isBackOfficeRole(currentUser()?.roleId)` so Manager passes. Specifically: there is no Owner-only UI remaining in Settings after the Sucursales extraction, but the Branches route MUST accept both roles.

### 3.2 Non-Functional Requirements

- **Performance:** First-paint of Settings SHALL be ≤ 400 ms p95 (down from the current ~500 ms after removing Sucursales). No new HTTP calls from Settings itself.
- **Accessibility:** WCAG 2.1 AA. Hidden tabs SHALL NOT occupy tab-stop positions (use `@if`, not CSS `display:none`). Focus order adapts to visible tabs.
- **Browser/device support:** Identical to app baseline (Chromium ≥ 110, iPad Safari ≥ 16).
- **Offline:** Graceful. 402/5xx toasts come from the interceptor; Settings reuses that behavior.
- **I18n:** Spanish only (consistent with the rest of Back Office).

---

## 4. Component Architecture

### 4.1 Component / Service hierarchy (target)

```
AdminSettingsComponent (standalone, existing, reduced scope)
├── Tab: Negocio
│   ├── BusinessInfoCard (name, location, phone) — new phone persistence
│   ├── GiroDisplayCard (read-only)
│   ├── BranchOperationalCard (read-only, gated)
│   └── FolioConfigCard (gated by CustomFolios | CfdiInvoicing)
│
├── Tab: Hardware  (merged Periféricos + Impresoras)
│   ├── ThermalPrinterCard
│   ├── ScannerCard
│   ├── ScaleCard (gated: CoreHardware + macro = Retail)
│   └── <app-admin-printer-settings />   — print destinations, gated by KDS features
│
├── Tab: Seguridad
│   └── PinChangeCard
│
├── Tab: Fiscal         — gated by CfdiInvoicing (tab + content)
│   └── FiscalConfigCard
│
└── Tab: Facturación
    ├── CurrentPlanCard
    ├── UpgradeOptionsCard (filtered by AVAILABLE_PLANS_BY_MACRO)
    └── CancelSubscriptionCard (gated by active/trialing subscription)

AdminBranchesComponent (standalone, new)
├── BranchList (table)
├── BranchEditDialog (with hasKitchen/hasTables toggles, gated)
└── DeliveryConfigCard (gated by DeliveryPlatforms) — moved from Settings

core/services/tenant-context.service.ts
└── hasFeature / hasAnyFeature / isApplicableToGiro  — existing, now consumed here

core/enums/feature-key.enum.ts
└── FeatureKey.DeliveryPlatforms  — new key (§7.2)

core/models/business-giro.model.ts
├── UpdateBusinessGiroRequest { primaryMacroCategoryId, subGiroIds, customGiroDescription? }
└── BusinessGiroResponse { primaryMacroCategoryId, subGiroIds, customGiroDescription }

core/models/app-config.model.ts
└── AppConfig.businessPhone?: string   — new optional field
```

> "Cards" listed under each tab are **template regions** inside `AdminSettingsComponent`, not separate Angular components. This mirrors FDD-015's pattern — keep state co-located unless a region has independent lifecycle. The only new component split is `AdminBranchesComponent`, which earns its own component because it now owns an independent route.

### 4.2 Component / Service Specifications

#### 4.2.1 `AdminSettingsComponent` (modified)

- **Deletions:**
  - Remove all device-related state and handlers: `deviceConfig`, `availableModes`, `saveAndRedirect`, `updateDeviceConfig`, `isSavingDevice`, `saveDeviceSuccess`, `DEFAULT_DEVICE_CONFIG` import.
  - Remove all branch-related state and handlers: `branches`, `loadingBranches`, `showBranchDialog`, `savingBranch`, `editingBranch`, `branchForm`, `copyTarget`, `showCopyDialog`, `copyingCatalog`, `loadBranches`, `openNewBranch`, `openEditBranch`, `saveBranch`, `openCopyCatalog`, `confirmCopyCatalog`.
  - Remove `activeTab` states `'device'` and `'branches'`; the literal union shrinks to `'business' | 'hardware' | 'security' | 'fiscal' | 'billing'`.
  - Remove the merged-away `'printers'` and `'peripherals'` literals — replaced by `'hardware'`.
- **Additions:**
  - Inject `TenantContextService`.
  - New computeds: `canSeeFiscal`, `canSeeScale`, `canSeePrintDestinations`, `canSeeCustomFolio`, `visibleTabs`.
  - New `saveBusinessConfig()` signature includes `businessPhone` in the payload (single save button already in place).
- **Out of scope:** the cards' internal state (fiscal RFC fields, folio prefix, PIN change) keeps their current shape.

#### 4.2.2 `AdminBranchesComponent` (new, standalone)

- **Location:** `src/app/modules/admin/components/branches/admin-branches.component.{ts,html,scss}`.
- **Responsibility:** Branch list + create/edit dialog + catalog copy + delivery config. Extracted verbatim from today's Settings with two upgrades:
  1. Delivery platforms section is wrapped in `@if (tenantContext.hasFeature(FeatureKey.DeliveryPlatforms))`.
  2. Accessible to both Owner and Manager (not Owner-only).
- **Route registration:** new child entry in `admin.routes.ts` — `{ path: 'branches', loadComponent: () => ... }`. Inherits `/admin` guards.
- **Dependencies:** `BranchService`, `BranchDeliveryConfigService`, `TenantContextService`, `MessageService`, `DialogModule`, `InputTextModule`, `TableModule`, `DropdownModule`, `DeliveryConfigCardComponent`.

#### 4.2.3 `TenantContextService` (unchanged)

- Already exposes `hasFeature(key)` and `hasAnyFeature(keys)` as signals-backed reads. Settings consumes; no new API.

#### 4.2.4 `FeatureKey` (extended)

- **New member:** `DeliveryPlatforms = 'DeliveryPlatforms'`. Added to `FOOD_AND_BEVERAGE_FEATURES` and `QUICK_SERVICE_FEATURES` in `GIRO_FEATURE_MAP`. Not applicable to Retail or Services per matrix.
- Backend coordination: the `FeatureKey` enum must be in sync server-side. This FDD depends on the backend emitting `DeliveryPlatforms` in the JWT `features` claim for eligible plans; otherwise the gate permanently hides the delivery section.

#### 4.2.5 `UpdateBusinessGiroRequest` / `BusinessGiroResponse` (renamed field)

- Rename `businessTypeIds: BusinessTypeId[]` → `subGiroIds: BusinessTypeId[]` in both interfaces.
- The `BusinessTypeId` enum values do NOT change — only the payload field name is renamed.
- Update the sole producer in `onboarding.component.ts:510-514`:
  ```text
  const subGiroIds = this.selectedSubGiroIds()
    .filter((id): id is BusinessTypeId => id !== OTRA_SUB_ID);
  const payload: UpdateBusinessGiroRequest = {
    primaryMacroCategoryId: macro,
    subGiroIds,
  };
  ```
- Update the consumer in `business.service.ts:52` (`updateGiro`) — the method body stays the same; only the typed payload shape changes.

#### 4.2.6 `AppConfig.businessPhone` (new optional field)

- Add to the interface: `businessPhone?: string;`
- Add to `DEFAULT_APP_CONFIG`: `businessPhone: ''`.
- Extend `ConfigService.load()` → `BranchConfigResponse` interface with `businessPhone?: string` and merge into the config object (same treatment as `locationName`).
- Settings' Negocio tab binds `ngModel` to `config().businessPhone` and writes via `updateConfig('businessPhone', $event)`.

### 4.3 Component communication

- **Parent → Child:** N/A in Settings; `AdminPrinterSettingsComponent` already consumes its own services.
- **Child → Parent:** N/A.
- **Cross-component:** `TenantContextService` signals drive both Settings and Branches with zero prop drilling. The 402 interceptor uses `MessageService` as a global bus.

---

## 5. State Management

### 5.1 Component state (target for `AdminSettingsComponent`)

Only showing **changes** vs. current state.

| Property | Change |
|---|---|
| `activeTab: 'business' \| 'device' \| 'peripherals' \| 'security' \| 'fiscal' \| 'branches' \| 'billing' \| 'printers'` | Shrinks to `'business' \| 'hardware' \| 'security' \| 'fiscal' \| 'billing'` |
| `deviceConfig`, `availableModes`, `isSavingDevice`, `saveDeviceSuccess` | **Removed** |
| `branches`, `loadingBranches`, `showBranchDialog`, `savingBranch`, `editingBranch`, `branchForm`, `copyTarget`, `showCopyDialog`, `copyingCatalog` | **Removed** (migrated to `AdminBranchesComponent`) |
| `businessPhone` (loose property, never persisted) | **Removed as a loose prop** — folded into `config().businessPhone` |

### 5.2 New computeds

| Computed | Body |
|---|---|
| `canSeeFiscal` | `tenantContext.hasFeature(FeatureKey.CfdiInvoicing)` |
| `canSeeScale` | `tenantContext.hasFeature(FeatureKey.CoreHardware) && authService.primaryMacroCategoryId() === MacroCategoryType.Retail` |
| `canSeePrintDestinations` | `tenantContext.hasAnyFeature([FeatureKey.KdsBasic, FeatureKey.RealtimeKds, FeatureKey.PrintedTickets])` |
| `canSeeCustomFolio` | `tenantContext.hasAnyFeature([FeatureKey.CustomFolios, FeatureKey.CfdiInvoicing])` |
| `visibleTabs` | Array of `{ id, label, icon }` built from the above gates — drives the tab bar `@for` |

### 5.3 Reactive patterns

- All new gating uses signals — no new observables.
- Existing `effect(() => { ... })` in the constructor that hydrates folio + fiscal form fields from `config()` is preserved verbatim; the new `businessPhone` read lives inside the same effect.

### 5.4 Form state

No form structure changes. `saveBusinessConfig()` includes `businessPhone` in its `AppConfig` save. The form widens by one bound `<input>` in the Negocio tab (already present in markup — only wiring changes).

---

## 6. UI/UX Specifications

### 6.1 Layout structure (new tab bar)

```
┌─ Configuración ─────────────────────────────────────────────┐
│  [ Negocio ][ Hardware ][ Seguridad ][ Fiscal* ][ Facturación ] │
│                                                             │
│  ┌─ Active tab content ───────────────────────────────────┐│
│  │  (cards, gated per §3.1 FR-005)                        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘

* Fiscal tab is hidden when the tenant lacks CfdiInvoicing.
```

- Tab order matches the visible-tabs computed; hidden tabs do not leave gaps.
- On < 640 px, the tab bar switches to a horizontal-scroll strip (already supported by the existing `.settings-tabs` SCSS).

### 6.2 PrimeNG components used (changes)

| Component | Where | Change |
|---|---|---|
| `p-dialog` (branch edit) | Was in Settings | Moves to `AdminBranchesComponent` |
| `p-table` (branches) | Was in Settings | Moves to `AdminBranchesComponent` |
| `p-radiobutton` (mode grid) | Was in Settings Dispositivo tab | Deleted |
| `p-dropdown` (regimen fiscal) | Unchanged location | Unchanged |
| `p-password` (PIN) | Unchanged location | Unchanged |
| `p-button` (save buttons) | Unchanged location | Unchanged |

### 6.3 Visual states

- **Tab gating:** Hidden tabs are removed from the DOM, not `display:none`. Switching to a gate that becomes false at runtime (e.g. plan downgrade mid-session) SHALL redirect `activeTab` to `'business'` via a guard in `setTab()`.
- **Card gating inside a tab:** Hidden cards are removed. No placeholder is shown. Rationale: Settings is for admins; ghosting locked cards adds noise, and we have the dedicated `/admin/upgrade` surface for upsell.
- **Save feedback:** Each save button SHALL keep the existing 3-second `saveSuccess` signal pattern. A shared helper `flashSuccess(signal)` can DRY the current four copies; non-blocking refactor.
- **402 handling:** No visual state inside Settings. The interceptor's global toast is the single source of feedback. Save buttons re-enable after the promise rejects; local "Guardado" indicators do NOT fire.

### 6.4 User interactions

- **Click tab:** `setTab(id)` updates `activeTab`. If the clicked tab is not in `visibleTabs()` (shouldn't happen unless a signal changed mid-frame), the call is a no-op.
- **Click "Guardar cambios" (Negocio):** POSTs full `AppConfig` (now including `businessPhone`). 402 → local save flag reset only.
- **Click "Guardar configuración fiscal":** unchanged behavior.
- **Click "Cambiar PIN":** unchanged.
- **Click "Cancelar suscripción":** unchanged.
- **Navigate to `/admin/branches`:** new sidebar entry appears alongside existing ones.

---

## 7. Data Flow

### 7.1 API integration

| Call | Trigger | Request | Response | Success handling | Error handling |
|---|---|---|---|---|---|
| `GET /api/branch/{id}/config` | `ConfigService.load()` on tab/page mount | — | `BranchConfigResponse` now includes `businessPhone` | Merge into `AppConfig`, emit `config$` | Existing silent fallback |
| `ConfigService.save(config)` (Negocio "Guardar cambios") | Click | full `AppConfig` incl. `businessPhone` | — | Flash "Guardado" locally | On 402 — rely on interceptor toast; local `isSaving` cleared |
| `PUT /api/business/giro` | Onboarding step 2 | `{ primaryMacroCategoryId, subGiroIds, customGiroDescription? }` | — | Proceed to step 2 | Existing handling |
| `GET /api/business/giro` | Onboarding re-entry | — | `{ primaryMacroCategoryId, subGiroIds, customGiroDescription }` | Hydrate | Existing handling |
| `POST /api/subscription/cancel` | Cancel dialog accept | — | — | Refresh status | Existing handling |

### 7.2 Data transformation — DTO rename `businessTypeIds → subGiroIds`

Exact shape diff:

```
Before:
  interface UpdateBusinessGiroRequest {
    primaryMacroCategoryId: MacroCategoryType;
    businessTypeIds: BusinessTypeId[];
    customGiroDescription?: string;
  }

After:
  interface UpdateBusinessGiroRequest {
    primaryMacroCategoryId: MacroCategoryType;
    subGiroIds: BusinessTypeId[];
    customGiroDescription?: string;
  }
```

Identical change to `BusinessGiroResponse`. No parallel alias, no deprecation period — the backend flipped atomically in BDD-015.

**Coordination note:** if frontend ships before backend, `PUT /api/business/giro` will fail model-binding on an unknown `subGiroIds` property. The merge order must be: backend BDD-015 → frontend FDD-016. This is documented in §12 phases.

### 7.3 Data transformation — new `FeatureKey.DeliveryPlatforms`

`feature-key.enum.ts` extended with the new key in the "Food & Beverage" section (since Retail + Services do not apply). Added to `FOOD_AND_BEVERAGE_FEATURES` and `QUICK_SERVICE_FEATURES` in `GIRO_FEATURE_MAP`. No other change.

Backend coordination: the JWT `features` claim SHALL include `'DeliveryPlatforms'` for eligible plans before this FDD ships; otherwise the branch-edit delivery section is permanently hidden.

### 7.4 Data refresh strategy

- Unchanged from today: Settings loads on mount and re-loads on manual save.
- `TenantContextService` is hydrated by `AuthService` on login / rehydration (FDD-013). Settings' computeds react to changes in that service without bespoke refresh logic.

### 7.5 402 Payment Required

- **Interceptor (existing):** `authInterceptor` catches 402 and toasts `error.message` or the default "Límite de plan alcanzado. Mejora a Pro para continuar." (`auth.interceptor.ts:72-81`).
- **Settings contract:** save handlers SHALL catch the rejection only to reset local flags (`isSaving.set(false)`) and SHALL NOT call `MessageService.add(...)` for 402. Other errors (4xx except 402, 5xx) keep their existing per-handler toast.

---

## 8. Performance Optimization

### 8.1 Rendering optimization

- `OnPush` is NOT adopted in `AdminSettingsComponent` (matches current file and FDD-015 precedent).
- Tab content is rendered lazily via `@switch` — already the case; no change.
- Hidden tabs do not pay template-instantiation cost because they live behind `@if`.

### 8.2 Data optimization

- No new HTTP calls. Extraction of Sucursales REMOVES one call from the Settings critical path.
- `visibleTabs()` computed is a 5-element array; cost is negligible.

### 8.3 Bundle optimization

- Deleting device/branches regions from `AdminSettingsComponent` reduces the component's template bundle by ~15-20 KB before tree shaking.
- `AdminBranchesComponent` becomes a separate lazy-loaded child route, so its cost is NOT paid by users who never visit it.

---

## 9. Error Handling

### 9.1 Error types

| Error | Source | UX surface |
|---|---|---|
| 402 Payment Required | Interceptor | Global toast from interceptor; Settings local flags reset only |
| 404 on save | Save handler | Toast `"No se pudo guardar"` (existing pattern) |
| 5xx on save | Save handler | Toast `"Error al guardar"` (existing pattern) |
| Validation errors | Form local | Inline `<small class="form-error">` under the failing control (existing) |
| Feature revoked mid-session | `TenantContextService` change | Current tab becomes invisible → `activeTab` auto-falls back to `'business'` |

### 9.2 User feedback

- **Toast:** `MessageService.add(...)` for success/5xx. 402 handled globally.
- **Inline:** form validation only.
- **Confirm dialog:** only the existing "Cancelar suscripción" dialog remains.

---

## 10. Accessibility

### 10.1 Keyboard navigation

- Tab bar uses buttons with `role="tab"` (existing). Hidden tabs are `@if`-excluded so they do not appear in Tab order.
- Inside each tab, Tab order is top-to-bottom, left-to-right through the visible cards.

### 10.2 Screen reader support

- Each `settings-tab` button has `aria-current="page"` when active (add via `[attr.aria-current]="activeTab() === id ? 'page' : null"`).
- Gated sections that get hidden SHALL NOT leave an empty landmark behind — the `<section>` wrapper is removed from DOM.

---

## 11. Testing Requirements

### 11.1 Unit tests

**`AdminSettingsComponent`**
- `visibleTabs` contains exactly the expected ids for a Free FoodBeverage tenant (Fiscal hidden).
- `visibleTabs` contains Fiscal for a Basic+ tenant.
- Switching the feature set at runtime (simulate `TenantContextService.setContext`) removes Fiscal and redirects `activeTab` from `'fiscal'` to `'business'`.
- Saving Negocio with a new `businessPhone` includes it in the `ConfigService.save` payload.
- 402 during `saveBusinessConfig` does NOT call `MessageService.add`; only resets `isSaving`.

**`AdminBranchesComponent`**
- Accessible to both `UserRoleId.Owner` and `UserRoleId.Manager` (guard test via mocked `AuthService`).
- Delivery section hidden when `hasFeature(FeatureKey.DeliveryPlatforms)` is false.

**`BusinessService`**
- `updateGiro({ subGiroIds: [1, 2] })` hits `PUT /api/business/giro` with the new field name.

### 11.2 E2E tests

1. **Free FoodBeverage sees 4 tabs:** Negocio · Hardware · Seguridad · Facturación. Fiscal absent.
2. **Basic FoodBeverage sees 5 tabs:** adds Fiscal.
3. **Retail tenant sees Scale card** in Hardware; FoodBeverage tenant does NOT.
4. **Branch CRUD reachable at `/admin/branches`** for both Owner and Manager.
5. **Delivery platforms hidden** for a Retail tenant; visible for FoodBeverage with the feature.
6. **businessPhone persistence:** type → save → refresh → value preserved.
7. **402 flow:** simulate a 402 on `saveBusinessConfig`; exactly ONE toast renders (global), save flag resets.
8. **Onboarding sends `subGiroIds`:** network panel shows the renamed payload on step 2 submit.

---

## 12. Implementation Phases

> All phases share the `fix/pos-to-admin-routing-auth` branch (or a successor). Each phase is a separately reviewable diff.

### Phase 1 — Foundation (non-user-visible)

**Deliverables:**
1. Add `FeatureKey.DeliveryPlatforms` to `feature-key.enum.ts` + `GIRO_FEATURE_MAP` (FoodBeverage + QuickService only).
2. Add `businessPhone?: string` to `AppConfig` and `DEFAULT_APP_CONFIG`.
3. Extend `BranchConfigResponse` in `ConfigService` to carry `businessPhone`, merge into persisted config.
4. Rename `businessTypeIds` → `subGiroIds` in `UpdateBusinessGiroRequest` + `BusinessGiroResponse`. Update the single producer in `onboarding.component.ts:510-514`.

**Depends on:** backend BDD-015 deployed (for the rename) and emitting `DeliveryPlatforms` in JWT (for the new key). Either dependency missing → phase blocks.

### Phase 2 — Extract Sucursales

**Deliverables:**
1. Create `AdminBranchesComponent` at `src/app/modules/admin/components/branches/`.
2. Move all branch-related state, templates, handlers, and styles from `AdminSettingsComponent`.
3. Wrap the delivery section in `@if (tenantContext.hasFeature(FeatureKey.DeliveryPlatforms))`.
4. Add a child route `{ path: 'branches', loadComponent: ... }` in `admin.routes.ts` (inherits `/admin` guards; accepts Owner + Manager).
5. Add a sidebar entry for "Sucursales" next to "Dispositivos".
6. Delete the `'branches'` tab, buttons, and `@case` block from Settings.

**Depends on:** Phase 1.

### Phase 3 — Delete Dispositivo tab

**Deliverables:**
1. Remove the `'device'` tab button, `@case` block, and all device-related state from `AdminSettingsComponent`.
2. Delete `availableModes`, `saveAndRedirect`, `updateDeviceConfig`, `deviceConfig`, `isSavingDevice`, `saveDeviceSuccess`.
3. Remove `DEFAULT_DEVICE_CONFIG` and `RadioButtonModule` imports if unused elsewhere.

**Depends on:** none (parallelizable with Phase 2).

### Phase 4 — Merge Periféricos + Impresoras → Hardware

**Deliverables:**
1. Rename `'peripherals'` case to `'hardware'`.
2. Inline `<app-admin-printer-settings>` at the end of the Hardware tab.
3. Gate the Scale card behind `canSeeScale`.
4. Gate Print Destinations inside `AdminPrinterSettingsComponent`'s host via `canSeePrintDestinations` (or move the gate inside the component if it owns it — decision goes to implementer).
5. Delete the `'printers'` tab button and `@case` block.

**Depends on:** Phase 3.

### Phase 5 — Feature shield wiring + polish

**Deliverables:**
1. Inject `TenantContextService` into `AdminSettingsComponent`.
2. Implement `canSeeFiscal`, `canSeeScale`, `canSeePrintDestinations`, `canSeeCustomFolio`, `visibleTabs` computeds.
3. Wrap Fiscal tab button and `@case` block with `@if (canSeeFiscal())`.
4. Wrap Folio-custom-format section with `@if (canSeeCustomFolio())`.
5. Filter `upgradeOptions` by `AVAILABLE_PLANS_BY_MACRO`.
6. Wire `businessPhone` into the Negocio save handler.
7. Guard `setTab()` so it ignores calls targeting a hidden tab and auto-falls back to `'business'` if the current tab disappears mid-session.
8. Remove `roleId === Owner` checks replaced by role-guarded routes.

**Depends on:** Phases 2 + 3 + 4.

### Phase 6 — Tests and cleanup

**Deliverables:**
1. Unit tests per §11.1.
2. E2E tests per §11.2.
3. Delete dead imports (`RadioButtonModule`, `MACRO_CATEGORY_LABELS` references that only fed removed sections, etc.).
4. Smoke-run the app against a fresh incognito login as each tenant flavor (Free FoodBev, Pro FoodBev, Free Retail, Pro Services) to verify the tab matrix.

**Depends on:** Phases 1-5.

### Phase ordering rationale

Phase 1 is purely additive; it can ship without any UI visible change. Phases 2-4 each remove a user-visible surface cleanly; doing them in separate commits lets us isolate regressions. Phase 5 is where the new contracts become visible (tabs reorder, Fiscal may disappear) — it ships last among structural changes so reviewers can trace visible diffs to a single PR. Phase 6 consolidates.

---

## 13. Out of Scope

- Replacing the 3-second `setTimeout`-based save indicators with a global toast system (cosmetic; can ship later).
- A dedicated `/admin/upgrade` page refactor — billing tab keeps its current structure minus the filtered upgrade options.
- Moving PIN management out of Settings (still useful as a device-level quick action).
- Localization beyond Spanish.
- A tab-level permission system richer than macro × feature (future work if the app grows role granularity).
- Sidebar / top-nav restructuring outside Settings (keep the rest of Back Office navigation as-is).

---

## 14. Approval

This document is **DRAFT**. Implementation MUST NOT start until an explicit approval comment references FDD-016 by name on the PR description or branch.
