# FDD-015 — Back Office Device Management UI

**Status:** Draft — awaiting approval
**Branch:** `fix/pos-to-admin-routing-auth`
**Author:** Architecture team
**Date:** 2026-04-20
**Related audits:**
- [AUDIT-032 — Back Office Device List UI](./AUDIT-032-admin-devices-list.md)

---

## 1. Executive Summary

**Problem statement.** The Back Office "Dispositivos vinculados" section is a static placeholder (`.devices-empty`). Admins cannot see which terminals are online, cannot rename a mislabelled cashier, cannot revoke a stolen tablet, and have no "last seen" signal to debug drop-offs. Backend has shipped three new endpoints (`GET /api/devices`, `PATCH /api/devices/{id}/toggle-active`, `PATCH /api/devices/{id}`) that are unused.

**Proposed solution.** Replace the placeholder with a PrimeNG `p-table` fed by a new `DeviceService.getAll()`. Add a three-state status badge (Revoked / Online / Offline) derived from `isActive` and a 10-minute freshness window over `lastSeenAt`. Add two row actions: a **Revoke/Restore** toggle with a `ConfirmationService` confirmation dialog, and an **Edit** dialog to change `name` and `branchId`. All three new service methods stay congruent with the existing `DeviceService` surface.

**User impact and UX goals.**
- Owners/Managers see their whole fleet on one screen — name, branch, mode, live status, last heartbeat, actions.
- One click + confirm to revoke a terminal that left the business (returns 401 on next request, device is effectively killed server-side).
- One click + two fields to fix a naming typo or move a device to a different branch without reprovisioning.
- Green/orange/red semantics are reinforced with text, not color alone, so colorblind users still parse the status correctly.

---

## 2. Current State Analysis

### 2.1 Existing artifacts involved

| Artifact | Current responsibility | Change |
|---|---|---|
| [admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts) | Activation-code generator + placeholder list | Extend with list state, row actions, edit dialog |
| [admin-devices.component.html](../src/app/modules/admin/components/devices/admin-devices.component.html) | Activation UI + `.devices-empty` block | Replace `.devices-empty` with `<p-table>` + add `<p-dialog>` + `<p-confirmDialog>` |
| [admin-devices.component.scss](../src/app/modules/admin/components/devices/admin-devices.component.scss) | Styles for activation card and empty state | Add styles for status badge, action buttons, edit dialog layout |
| [device.service.ts](../src/app/core/services/device.service.ts) | Own-device registration, validation, heartbeat | Add `getAll`, `toggleActive`, `update` |
| [device.model.ts](../src/app/core/models/device.model.ts) *(new)* | — | Public `DeviceListItem`, `UpdateDevicePayload`, `ToggleActiveResponse` |
| [branch.service.ts](../src/app/core/services/branch.service.ts) | Branch list (already consumed here) | No change |

### 2.2 Current UX pain points (from AUDIT-032)

1. **Zero fleet visibility.** Admins cannot answer "¿cuántas cajas están prendidas hoy?" from the UI.
2. **No recovery path for lost devices.** If a tablet is stolen, there is no "revoke" button; the only option is to rotate business credentials.
3. **Naming mistakes are permanent until reprovision.** A typo in "Caja 1" forces the admin to run setup again from the terminal.
4. **Branch mis-assignment is permanent.** Moving a device between branches requires a full re-bind cycle.
5. **`TableModule` is imported but dead code** in the standalone component (dangling dependency from earlier prototype).

### 2.3 Performance baseline

- Expected fleet size per tenant: **p50 = 2 devices, p95 = 15, p99 = 50**. No realistic scenario crosses 100.
- The Back Office grid loads branches already on `ngOnInit` (~50-200 ms). Adding a second parallel HTTP call for devices should not push total first-paint past **500 ms p95**.
- Table rendering for ≤100 rows does not need virtual scrolling; plain PrimeNG table with `[value]` binding is sufficient.

---

## 3. Requirements

### 3.1 Functional Requirements

**FR-001 — List all devices for the tenant**
*As an Owner or Manager, I want to see every device linked to my business so that I can audit my fleet at a glance.*
The UI SHALL render a table of `DeviceListItem` rows loaded from `GET /api/devices` (optionally scoped by `?branchId=X` per FR-008), refreshed on navigation into the screen and on demand via a "Refrescar" button.

**FR-002 — Status column with 3 states**
*As an admin, I want a visual cue for each device's reachability so that I can spot terminals that are down.*
The Status column SHALL display exactly one of three badges per the decision table:

| Condition | Badge | Color | Text |
|---|---|---|---|
| `isActive === false` | Revoked | Red (`#DC2626`) | "Revocado" |
| `isActive === true` AND `lastSeenAt != null` AND `(now − lastSeenAt) < 10 min` | Online | Green (`#16A34A`) | "En línea" |
| `isActive === true` AND (`lastSeenAt == null` OR `(now − lastSeenAt) ≥ 10 min`) | Offline | Gray (`#6B7280`) | "Desconectado" |

**FR-003 — Relative "Last Seen"**
*As an admin, I want to know how long ago a device checked in so that I can judge its freshness without doing arithmetic.*
The Last-Seen column SHALL render `lastSeenAt` as a localized relative string (e.g. "hace 3 min", "hace 2 h", "ayer"). Revoked devices still show their last seen timestamp. Never-seen devices show `—`.

**FR-004 — Revoke / Restore toggle**
*As an Owner, I want to revoke a device that is no longer trusted so that its device token becomes unusable.*
Each row SHALL expose a button whose label depends on state:
- `isActive === true` → label "Revocar", icon `pi-ban`, severity danger.
- `isActive === false` → label "Reactivar", icon `pi-refresh`, severity success.
The click SHALL open a `ConfirmationService` dialog; on accept, `PATCH /api/devices/{id}/toggle-active` is fired and the row is updated in place.

**FR-005 — Edit name and branch**
*As a Manager, I want to rename or re-assign a device without reprovisioning it so that small corrections don't require a field trip.*
A per-row "Editar" button SHALL open a `p-dialog` with two fields: `name` (text, required, max 60 chars) and `branchId` (dropdown, required, populated from the existing branches signal). Saving fires `PATCH /api/devices/{id}` and replaces the row in place.

**FR-006 — Counters header**
*As an admin, I want a quick summary of fleet health above the table.*
A header strip above the table SHALL show three counts derived from the data: **Total · En línea · Desconectados**. Revoked devices are excluded from "Desconectados".

**FR-007 — Empty state**
*As a first-time admin, I want a clear empty state when no devices exist yet.*
When `GET /api/devices` returns `[]`, the UI SHALL render the existing `.devices-empty` block (minus the "Próximamente" badge — replaced with instructions to use the generator above). The same block renders when a branch filter is active and that branch has no devices, with copy adapted to mention the filter.

**FR-008 — Server-side branch filter**
*As a multi-branch Owner, I want to narrow the fleet view to a single branch so that I can audit one location at a time without wading through every tablet.*
A dropdown placed next to the "Refrescar" button in the fleet header SHALL let the user scope the list to a branch. Behavior:
- Default selection is the sentinel "Todas las sucursales" (value `null`).
- When the selection changes, the UI SHALL call `getAll({ branchId })` which maps to `GET /api/devices?branchId=X` server-side (filter is enforced by the backend, not client-side).
- Switching back to "Todas las sucursales" SHALL call `getAll()` without the query parameter.
- Options derive from the same `branches` signal that already feeds the activation-code generator — no extra HTTP call. When `branches()` has fewer than 2 entries the filter control is hidden (nothing to filter by).
- The selected branch persists only within the component lifecycle (no URL param, no localStorage) — leaving and returning to the screen resets the filter to "Todas las sucursales".

### 3.2 Non-Functional Requirements

- **Performance:** First paint of the table ≤ 500 ms p95 on LTE, assuming ≤ 50 devices.
- **Auto-refresh:** "Last seen" relative strings SHALL update at least once per minute without a network call (local `setInterval` on the component that increments a `nowTick` signal).
- **Accessibility:** WCAG 2.1 AA. Status badges MUST include text (not color-only). Dialogs trap focus. All interactive elements keyboard reachable.
- **Browser/device support:** Identical to app baseline (Chromium ≥ 110, iPad Safari ≥ 16).
- **Data volume:** Fleet size bounded at 100 devices. No pagination required at this tier.
- **Offline:** Graceful. Network failure shows a toast; existing rows stay visible; actions are disabled while the request is pending.
- **I18n:** Spanish copy only (matches the rest of Back Office today).

---

## 4. Component Architecture

### 4.1 Component / Service hierarchy

```
AdminDevicesComponent (standalone, existing, extended)
├── (existing) ActivationCodeSection   — no change
│
├── (new) DeviceFleetHeader             — counters strip (Total / En línea / Desconectados)
│
├── (new) DeviceListTable               — p-table with 6 columns
│   ├── StatusBadge (inline template)   — renders the 3-state badge
│   ├── RelativeTime (pipe)             — transforms ISO date → "hace 3 min"
│   └── RowActions (inline template)    — Edit + Revoke/Restore buttons
│
├── (new) DeviceEditDialog              — <p-dialog> with edit form
│   └── ReactiveForm { name, branchId }
│
└── (existing) ConfirmationService + <p-confirmDialog>  — Revoke/Restore confirmation

core/services/device.service.ts (extended)
├── registerDevice()    (existing)
├── validateDevice()    (existing)
├── sendHeartbeat()     (existing, private)
├── getAll()            (new)   → GET    /api/devices
├── toggleActive(id)    (new)   → PATCH  /api/devices/{id}/toggle-active
└── update(id, payload) (new)   → PATCH  /api/devices/{id}

core/models/device.model.ts (new file)
├── DeviceListItem         (public)
├── UpdateDevicePayload    (public)
└── ToggleActiveResponse   (public, internal-ish)
```

> The "sub-components" listed above are **template regions** inside the single `AdminDevicesComponent`, not separate Angular components. Splitting into children is explicitly not recommended for this scope — the fleet screen is cohesive and keeping state co-located mirrors the existing `admin-users.component.ts` pattern.

### 4.2 Component / Service Specifications

#### 4.2.1 `AdminDevicesComponent` (modified)

- **Type:** Standalone, existing, extended.
- **New responsibilities:**
  - Load the device list on `ngOnInit` in parallel with branches.
  - Compute and render counters + table rows + row action states.
  - Own the edit dialog form and confirmation handlers.
  - Tick a `nowTick` signal every 60 s so relative time labels refresh without HTTP.
- **New imports added to `imports[]`:** `TableModule` (already imported — now used), `TagModule` for the status badge, `DialogModule`, `ConfirmDialogModule`, `InputTextModule` (already in for code form), `ReactiveFormsModule` (for the edit form).
- **New service dependency:** `ConfirmationService` via `providers: [ConfirmationService]` at component level so the `<p-confirmDialog>` renders in this component's scope.
- **Out of scope:** no WebSocket and no server-sent events in this iteration. Freshness comes from Angular's lifecycle (`ngOnInit` re-fires on re-entry), from the Refrescar button, and from branch-filter changes — see §7.3.

#### 4.2.2 `DeviceListItem` model (new, public)

- **Location:** `src/app/core/models/device.model.ts`.
- **Shape (contract, no code):**
  - `id: number` — backend PK.
  - `deviceUuid: string` — stable browser UUID.
  - `name: string` — admin-facing name.
  - `mode: DeviceConfig['mode']` — reuse existing union.
  - `isActive: boolean` — false after revoke.
  - `branchId: number`.
  - `branchName: string` — denormalized by backend for display.
  - `lastSeenAt: string | null` — ISO date; null when the device has never sent a heartbeat.
  - `createdAt: string` — ISO date of first registration.
- **Exported through** `core/models/index.ts` barrel.

#### 4.2.3 `UpdateDevicePayload` model (new, public)

- **Shape:**
  - `name: string`
  - `branchId: number`

#### 4.2.4 `ToggleActiveResponse` model (new, internal)

- **Shape:**
  - `id: number`
  - `isActive: boolean`

#### 4.2.5 `DeviceService.getAll(params?)` (new)

- **Signature contract:** `getAll(params?: { branchId?: number }): Observable<DeviceListItem[]>`.
- **Endpoint:**
  - No params or `params.branchId == null` → `GET /api/devices`.
  - `params.branchId` is a positive integer → `GET /api/devices?branchId={id}`.
- **URL building:** the service constructs the query string internally (no leaked `HttpParams` in the component). Invalid or zero `branchId` values are treated as "no filter".
- **Error handling:** propagate via the existing `ApiService` pipeline (which logs and re-throws). The caller (component) maps errors to a toast.

#### 4.2.6 `DeviceService.toggleActive(id)` (new)

- **Signature contract:** `toggleActive(id: number): Observable<ToggleActiveResponse>`.
- **Endpoint:** `PATCH /api/devices/{id}/toggle-active` with empty body.
- **Side effect:** none inside the service. The component is responsible for merging the response back into its local signal.

#### 4.2.7 `DeviceService.update(id, payload)` (new)

- **Signature contract:** `update(id: number, payload: UpdateDevicePayload): Observable<DeviceListItem>`.
- **Endpoint:** `PATCH /api/devices/{id}` with `{ name, branchId }` body.
- **Validation:** service is transport-only. UI enforces `name.trim().length > 0` and `branchId > 0`.

### 4.3 Component communication

- **Parent → Child:** N/A (single-component design).
- **Child → Parent:** N/A.
- **Service-level:** `ConfirmationService` carries the accept/reject signal from `<p-confirmDialog>` back to the handler; `MessageService` surfaces toasts (already injected in the existing component).

---

## 5. State Management

### 5.1 Component state (new / modified)

| Property | Type | Initial | Purpose |
|---|---|---|---|
| `devices` | `Signal<DeviceListItem[]>` | `[]` | Rows feeding the table |
| `loadingDevices` | `Signal<boolean>` | `false` | Shown as `p-table` loading attribute |
| `refreshingDevices` | `Signal<boolean>` | `false` | Spinner on the "Refrescar" button (distinct from initial load) |
| `editingDevice` | `Signal<DeviceListItem \| null>` | `null` | Row under edit; drives `editDialogVisible` |
| `editDialogVisible` | `Signal<boolean>` | `false` | Controls `<p-dialog>` visibility |
| `savingEdit` | `Signal<boolean>` | `false` | Disables the edit dialog footer while saving |
| `togglingDeviceId` | `Signal<number \| null>` | `null` | Used to spinner-lock a single row's action button |
| `nowTick` | `Signal<number>` | `Date.now()` | Tick source for relative-time labels; ++ every 60 s |
| `branchFilterId` | `Signal<number \| null>` | `null` | Current branch filter; `null` means "Todas las sucursales" |

### 5.2 Derived / computed state

| Computed | Body |
|---|---|
| `totalCount` | `devices().length` |
| `onlineCount` | `devices().filter(d => statusOf(d) === 'online').length` |
| `offlineCount` | `devices().filter(d => statusOf(d) === 'offline').length` |
| `revokedCount` | `devices().filter(d => !d.isActive).length` |
| `hasDevices` | `devices().length > 0` |
| `showBranchFilter` | `branches().length >= 2` — hides the filter on single-branch tenants |
| `branchFilterOptions` | `[{ label: 'Todas las sucursales', value: null }, ...branches().map(b => ({ label: b.name, value: b.id }))]` |

A private helper `statusOf(device: DeviceListItem): 'online' \| 'offline' \| 'revoked'` encapsulates the FR-002 decision table. It reads `nowTick()` so relative evaluation stays reactive.

### 5.3 Reactive patterns

- **Source observables:** three new HTTP observables from `DeviceService`. Each is converted to a promise at the component boundary via `firstValueFrom`, matching the style of the existing `loadBranches()`.
- **Subscription management:** HTTP observables auto-complete — no `takeUntilDestroyed` needed.
- **Timer:** the 60-second tick is a single `setInterval` set in `ngOnInit`, cleared in `ngOnDestroy`. Guard against multiple ticks by storing the handle on the component.

### 5.4 Form state

#### Edit dialog form

- **Framework:** `ReactiveFormsModule`, `FormGroup` initialized in a private `buildEditForm()` helper.
- **Controls:**
  - `name: FormControl<string>` with `Validators.required` + `Validators.maxLength(60)` + a custom trim validator that rejects whitespace-only.
  - `branchId: FormControl<number>` with `Validators.required` + `Validators.min(1)`.
- **Population:** when `openEditDialog(device)` runs, the form is `patchValue`'d with the row's current `name` and `branchId`.
- **Disabled state:** form disabled while `savingEdit()` is true.
- **Submit:** calls `DeviceService.update(...)` with `{ name: value.trim(), branchId }`.

---

## 6. UI/UX Specifications

### 6.1 Layout structure

```
┌─ admin-devices grid ────────────────────────────────────┐
│                                                         │
│  Section 1 — Activation code generator  (unchanged)     │
│                                                         │
│  Section 2 — Dispositivos vinculados                    │
│  ┌─ Fleet header ──────────────────────────────────┐    │
│  │ Total: 12 · En línea: 8 · Desconectados: 3      │    │
│  │  [ Sucursal: Todas ▾ ]       [ Refrescar ⟳ ]    │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─ p-table ───────────────────────────────────────┐    │
│  │ Nombre │ Sucursal │ Modo │ Estado │ Últ. visto │ │   │
│  │ ...                                              │   │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  (If no devices → retain .devices-empty block)          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- Section 2 keeps its existing `<section class="settings-card">` wrapper.
- Fleet header lives inside the card header extras slot. The branch filter sits to the left of the Refrescar button on desktop; on viewport widths below 768 px the two controls stack vertically (filter on top, refresh below) — PrimeFlex `flex-wrap` handles the fallback.
- Table + dialogs live in the card body.
- The branch-filter dropdown is hidden when `showBranchFilter()` is false (single-branch tenants).

### 6.2 PrimeNG components used

| Component | Configuration | Events | Templates |
|---|---|---|---|
| `p-table` | `[value]="devices()"`, `[loading]="loadingDevices()"`, `dataKey="id"`, `styleClass="p-datatable-sm"`, `[rowTrackBy]="trackByDeviceId"`, `responsiveLayout="scroll"` | N/A | `pTemplate="header"` (6 `<th>`), `pTemplate="body"` (typed `let-device`), `pTemplate="loadingbody"` (skeleton rows), `pTemplate="emptymessage"` (optional — but when `devices().length === 0` we render the external `.devices-empty` block instead) |
| `p-tag` | One per status state: `severity="success" value="En línea" icon="pi pi-circle-fill"` · `severity="secondary" value="Desconectado"` · `severity="danger" value="Revocado"` | — | — |
| `p-button` | Row actions: "Editar" (`severity="secondary" text` `icon="pi pi-pencil"`), "Revocar" (`severity="danger" text icon="pi pi-ban"`), "Reactivar" (`severity="success" text icon="pi pi-refresh"`) | `(onClick)` handlers | — |
| `p-dialog` (edit) | `[(visible)]="editDialogVisible"`, `modal=true`, `header="Editar dispositivo"`, `[style]="{ width: '32rem' }"`, `closeOnEscape=true`, `closable=true` | `(onHide)` resets `editingDevice` and form | Default content template with `ReactiveForm` + footer buttons |
| `p-confirmDialog` | `key="device-toggle"`, `acceptButtonStyleClass` varies by action | `accept` / `reject` callbacks passed at call site | — |
| `p-dropdown` (in edit) | `[options]="branches()"`, `optionLabel="name"`, `optionValue="id"`, `styleClass="w-full"` | — | — |
| `p-dropdown` (branch filter) | `[options]="branchFilterOptions()"`, `optionLabel="label"`, `optionValue="value"`, `[(ngModel)]="branchFilterId"`, `placeholder="Todas las sucursales"`, `[showClear]="false"`, `styleClass="w-14rem"` | `(onChange)` → `onBranchFilterChange(value)` calls `loadDevices({ branchId: value ?? undefined })` | — |

### 6.3 Visual states

- **Loading (first mount):** `loadingDevices=true` → `p-table` renders skeleton rows (via its `loadingbody` template). Header and refresh button remain enabled.
- **Refreshing (manual):** `refreshingDevices=true` → button shows inline spinner; table keeps showing stale rows (no skeleton replacement) to avoid flicker.
- **Filtering (branch change):** same visual treatment as a manual refresh — `refreshingDevices=true` while the filtered `getAll({ branchId })` is in flight; old rows stay visible until the response arrives.
- **Empty:** `devices().length === 0 && !loadingDevices()` → table is hidden and the existing `.devices-empty` block renders. Copy revised: title "Aún no tienes dispositivos vinculados", body "Genera un código con el formulario de arriba para agregar tu primer equipo.", the "Próximamente" badge is removed.
- **Row action in flight:** `togglingDeviceId === device.id` → that row's action button shows an inline spinner and is disabled; other rows unaffected.
- **Edit dialog saving:** `savingEdit=true` → "Guardar" button shows spinner; "Cancelar" disabled.
- **Error:** toast via `MessageService` (severity `error`, summary "Error", detail specific to the operation). Table state is not wiped on error — the last known good rows stay visible.

### 6.4 Status badge visual spec

Per FR-002 but with concrete visual details:

| State | `p-tag` severity | Background | Text color | Icon | Copy |
|---|---|---|---|---|---|
| Online | `success` | `#DCFCE7` | `#166534` | `pi pi-circle-fill` (animated subtle pulse 1.5 s ease-in-out) | "En línea" |
| Offline | `secondary` | `#F3F4F6` | `#374151` | `pi pi-circle` (no fill) | "Desconectado" |
| Revoked | `danger` | `#FEE2E2` | `#991B1B` | `pi pi-ban` | "Revocado" |

> Pulse animation is purely decorative and must respect `prefers-reduced-motion: reduce` (CSS media query disables the keyframe).

### 6.5 User interactions

- **Click row "Editar":** opens `<p-dialog>` prefilled with the row's name and branch. User changes values, clicks "Guardar" → `update()` fires, row replaces in place on success, toast "Dispositivo actualizado" shows.
- **Click row "Revocar":** `ConfirmationService.confirm` with header "¿Revocar este dispositivo?", message includes the device name ("«Caja 1» quedará desconectado y su sesión será inválida al siguiente request."), acceptLabel "Revocar" red, rejectLabel "Cancelar". On accept → `toggleActive()`. Row badge flips to Revoked; button flips to "Reactivar". Toast "Dispositivo revocado".
- **Click row "Reactivar":** symmetric confirmation with different copy ("El dispositivo volverá a aceptar comandos del backend."), acceptLabel "Reactivar" green. Toast "Dispositivo reactivado".
- **Click "Refrescar":** fires `getAll(...)` again using the current `branchFilterId` so a manual refresh respects the active filter; table updates in place without skeleton flicker.
- **Change branch filter:** picking a branch in the dropdown fires `getAll({ branchId })`; selecting "Todas las sucursales" fires `getAll()` with no param. The empty-state copy swaps to mention the current filter ("No hay dispositivos en la sucursal seleccionada.").
- **Keyboard:** tabs cycle through: Branch filter → Refresh button → first row's Edit → first row's Revoke → second row's Edit → ... Enter triggers the focused button. Edit dialog traps focus; ESC closes the dialog without saving.

---

## 7. Data Flow

### 7.1 API integration

| Call | Trigger | Request | Response | Success handling | Error handling |
|---|---|---|---|---|---|
| `getAll({ branchId? })` | `ngOnInit`, "Refrescar" button, branch-filter change | `GET /api/devices` · `GET /api/devices?branchId=X` when a branch is selected | `DeviceListItem[]` | `devices.set(rows)` | Toast severity `error`; keep prior rows; set `loadingDevices=false` |
| `toggleActive(id)` | Confirm on revoke/restore | `PATCH /api/devices/{id}/toggle-active` empty body | `{ id, isActive }` | Merge new `isActive` into the target row via `devices.update(arr => arr.map(...))` | Toast "No se pudo cambiar el estado"; row stays unchanged |
| `update(id, body)` | Save in edit dialog | `PATCH /api/devices/{id}` body `{ name, branchId }` | `DeviceListItem` | Replace the target row with the returned object; close dialog; toast | Toast; keep dialog open so the user can retry |

All three calls inherit the 10-second timeout from `ApiService`.

### 7.2 Data transformation

- **Backend → component:** 1:1. No aggregation. `DeviceListItem.branchName` comes denormalized from the backend so the UI does not join client-side against `branches()`.
- **Component → backend:** the edit form trims `name` before sending. `branchId` is validated as positive integer.

### 7.3 Data refresh strategy

- **Initial load:** triggered by `ngOnInit` in parallel with `loadBranches()` via `Promise.all`.
- **Re-entry to the view:** whenever the route re-activates `AdminDevicesComponent` (e.g. Back Office tab-switch away and back), `ngOnInit` fires again — Angular destroys and re-creates the component on each activation of this lazy-loaded child. That guarantees a fresh `getAll()` when the admin returns to the screen without requiring a dedicated poll. The branch filter resets to "Todas las sucursales" on re-entry because it lives in component state only.
- **Manual:** "Refrescar" button; respects the current `branchFilterId`.
- **Filter change:** every `branchFilterId` transition fires a fresh `getAll({ branchId })`.
- **Post-mutation:** no full refresh; local patch of the affected row only.
- **Relative-time freshness:** the 60-second `nowTick` recomputes Online/Offline locally against `lastSeenAt` without any HTTP call. A stale `lastSeenAt` (e.g. device heartbeated at t=0 but backend has not persisted yet) self-corrects on the next manual refresh or re-entry. Real-time push (WebSocket / SignalR) is explicitly deferred.

---

## 8. Performance Optimization

### 8.1 Rendering optimization

- **`OnPush` is NOT adopted** because the existing `AdminDevicesComponent` uses default change detection and signals already short-circuit re-renders effectively. Adding OnPush across the file is out of scope.
- **`trackBy`:** `trackByDeviceId = (_, d) => d.id` to avoid DOM churn when a single row is patched.
- **Virtual scrolling:** not used. Fleet size is bounded < 100.
- **Status badge:** a cheap pure function reading `nowTick()` + `device.lastSeenAt`. Recomputes ≤ 100 times per tick.

### 8.2 Data optimization

- **Caching:** none. Every landing on the screen fires one `GET /api/devices`. Acceptable for bounded fleet.
- **Pagination:** not implemented.
- **Payload size:** one row ≈ 250 bytes → 50 devices ≈ 12 KB. Negligible.

### 8.3 Bundle optimization

- `DialogModule`, `TableModule`, `TagModule`, `ConfirmDialogModule`, `ReactiveFormsModule` are tree-shakeable standalone imports. No extra vendor cost beyond what PrimeNG already bundles.
- No new third-party dependency.

---

## 9. Error Handling

### 9.1 Error types

| Error | Source | UX surface |
|---|---|---|
| 401 / 403 | Interceptor | Automatic logout (existing behavior) |
| 404 on PATCH | Backend: device deleted or not in tenant | Toast "Dispositivo no encontrado"; refresh list |
| 409 on PATCH | Backend: name collision or optimistic-concurrency issue | Toast with backend `error.message` if present; keep dialog open |
| Network / 5xx on `getAll` | Transient | Toast "No se pudieron cargar los dispositivos"; keep prior rows |
| Network / 5xx on `toggleActive` / `update` | Transient | Toast; no state mutation |
| Validation (client-side) | Form invalid | Inline highlight + `<small class="form-error">` under the failing control |

### 9.2 User feedback channels

- **Toast** (`MessageService`) — default for all success / transient errors.
- **Inline form errors** — only for edit dialog validation.
- **Confirmation dialog** — for destructive toggle actions only.
- **No full-page error screens.**

---

## 10. Accessibility

### 10.1 Keyboard navigation

- **Tab order:** `Refrescar` → (per row) `Editar`, then `Revocar/Reactivar`.
- **Edit dialog:** focus moves to the `name` input on open; tab cycles `name` → `branchId` → `Cancelar` → `Guardar` → `name`. ESC triggers `(onHide)`.
- **Confirm dialog:** focus on the primary action button by default. ESC rejects.

### 10.2 Screen reader support

- `<p-table>` with `aria-label="Lista de dispositivos"`.
- Status column cell includes `aria-label` describing the state in words (e.g. `aria-label="Estado: En línea, visto hace 3 minutos"`) so screen readers do not read only the badge icon.
- Badges MUST render text alongside their icon (already in spec §6.4) — no icon-only states.
- The pulse animation on Online badge respects `prefers-reduced-motion`.
- Action buttons include `aria-label` variants for their dynamic copy: "Revocar dispositivo «Caja 1»", "Editar dispositivo «Caja 1»".

### 10.3 Color contrast

All three badge color pairs pass WCAG AA ≥ 4.5 :1 per the hex values in §6.4:
- #166534 on #DCFCE7 → ≥ 7.2 :1
- #374151 on #F3F4F6 → ≥ 8.9 :1
- #991B1B on #FEE2E2 → ≥ 6.1 :1

---

## 11. Testing Requirements

### 11.1 Unit tests

**`DeviceService`**
- `getAll()` with no args hits `/api/devices`.
- `getAll({ branchId: 5 })` hits `/api/devices?branchId=5`.
- `getAll({ branchId: 0 })` and `getAll({ branchId: undefined })` both hit `/api/devices` with no query string.
- `toggleActive(id)` hits `/devices/{id}/toggle-active` with empty body.
- `update(id, payload)` hits `/devices/{id}` with the trimmed body.

**`AdminDevicesComponent.statusOf`**
- Returns `'revoked'` when `isActive` is false (regardless of `lastSeenAt`).
- Returns `'online'` when `isActive=true` and `now − lastSeenAt < 10 min`.
- Returns `'offline'` when `isActive=true` and `now − lastSeenAt ≥ 10 min`.
- Returns `'offline'` when `isActive=true` and `lastSeenAt` is null.
- Re-evaluates when `nowTick` changes (simulate by advancing the tick signal).

**Counters**
- `onlineCount`, `offlineCount`, `revokedCount` match hand-computed values across mixed fixtures.

**Edit form**
- Valid `name` (trimmed non-empty, ≤ 60) + `branchId > 0` → form valid.
- Whitespace-only `name` → invalid.
- `name.length > 60` → invalid.
- `branchId` unset → invalid.

**Confirmation flow**
- Confirm on revoke → `toggleActive` fires; cancel → no HTTP call.

**Branch filter**
- Changing `branchFilterId` to a positive id fires `getAll({ branchId: id })`.
- Switching back to `null` fires `getAll()` with no query string.
- "Refrescar" while a filter is active re-fires `getAll({ branchId: current })`, not the unfiltered variant.
- `showBranchFilter` is `false` when `branches().length < 2` and `true` otherwise.
- Re-initialization of the component resets `branchFilterId` to `null`.

### 11.2 E2E tests

1. **Happy path — view list:** seed 3 devices (2 online, 1 offline, 1 revoked), navigate to `/admin/devices`, assert 4 rows with correct status badges + counter strip reads "Total 4 · En línea 2 · Desconectados 1".
2. **Revoke flow:** click Revocar on row A, confirm, assert row badge flips to Revoked; counter "Desconectados" does not increment (revoked is excluded); backend received PATCH.
3. **Restore flow:** symmetric, row flips back to Online/Offline depending on last seen.
4. **Edit rename:** open Edit on row B, change name to "Caja Refaccionaria 3", save, assert toast + row shows new name; backend PATCH body correct.
5. **Edit move branch:** same row, change dropdown to a different branch, save, assert `branchName` cell updated.
6. **Empty state:** navigate to a tenant with zero devices, assert `.devices-empty` block renders with the updated copy.
7. **Network failure on load:** stub `getAll` to reject, assert toast and that the table shows no rows (graceful degradation).
8. **Branch filter server-side call:** seed a tenant with 2 branches (3 devices in Centro, 1 in Norte). Open `/admin/devices`, assert 4 rows. Pick "Norte" in the filter; assert exactly one `GET /api/devices?branchId=<id-norte>` was sent and only that row remains. Pick "Todas las sucursales"; assert `GET /api/devices` (no query) fires and all 4 rows return.
9. **Filter hidden on single-branch tenant:** seed a tenant with one branch, assert the filter dropdown is not rendered while the Refrescar button is.

---

## 12. Implementation Phases

> All phases share the `fix/pos-to-admin-routing-auth` branch. Each phase is a separately reviewable diff.

### Phase 1 — Service + model foundation

**Deliverables:**
1. Create `src/app/core/models/device.model.ts` with `DeviceListItem`, `UpdateDevicePayload`, `ToggleActiveResponse`.
2. Export the new types through `core/models/index.ts`.
3. Add `DeviceService.getAll`, `DeviceService.toggleActive`, `DeviceService.update`.

**Depends on:** backend endpoints live in the dev environment.

### Phase 2 — Read-only list + branch filter

**Deliverables:**
1. Extend `AdminDevicesComponent` state: `devices`, `loadingDevices`, `refreshingDevices`, `nowTick`, `branchFilterId`, `statusOf`, counters, `branchFilterOptions`, `showBranchFilter`.
2. Replace `.devices-empty` placeholder with conditional `<p-table>` + counters header + filter+refresh controls + empty state copy (with filter-aware variant).
3. Implement relative-time rendering (component method or inline helper — no new pipe unless it becomes reused elsewhere).
4. Wire "Refrescar" button and the branch-filter dropdown, both routed through a single `loadDevices()` helper that reads `branchFilterId` and calls `getAll({ branchId })`.

**Depends on:** Phase 1.

### Phase 3 — Revoke / Restore with confirmation

**Deliverables:**
1. Add Revocar/Reactivar button per row.
2. Wire `ConfirmationService` + `<p-confirmDialog key="device-toggle">`.
3. Handler calls `toggleActive`, merges response, toasts.

**Depends on:** Phase 2.

### Phase 4 — Edit dialog

**Deliverables:**
1. Add edit button per row.
2. Introduce `editingDevice` + `editDialogVisible` + `ReactiveForm`.
3. `<p-dialog>` with name + branch dropdown.
4. Wire `update` call, merge response, toast.

**Depends on:** Phase 2 (not 3 — Phase 3 and 4 are independent).

### Phase 5 — Tests and polish

**Deliverables:**
1. Unit tests per §11.1.
2. E2E tests per §11.2 (Playwright).
3. Reduce-motion CSS variant for the Online badge pulse.
4. Remove the now-obsolete "Próximamente" badge from `.devices-empty` copy.

**Depends on:** Phases 1-4.

### Phase ordering rationale

Phase 1 is foundation with zero user-visible impact. Phase 2 is a read-only list — safe to ship alone if the backend endpoints surprise us with shape drift. Phases 3 and 4 are mutually independent, so if one is blocked by a backend question (e.g. unclear error payload on `PATCH /devices/{id}`) the other can still merge. Phase 5 consolidates.

---

## 13. Out of Scope

- Real-time push via WebSocket / SignalR. Data freshness comes from component re-entry, manual refresh, and filter changes (see §7.3).
- Bulk operations (multi-select revoke).
- Column sorting and free-text search (can be added later; the branch filter covers the highest-value slice first per FR-008).
- Pagination (fleet bounded at 100).
- Device-level activity log or audit trail view.
- Changing a device's `mode` after provisioning — would require backend invariants we don't own here.
- Re-emitting a fresh device token from the Back Office.
- Localization beyond Spanish.

---

## 14. Approval

This document is **DRAFT**. Implementation MUST NOT start until an explicit approval comment references FDD-015 by name on the PR description or branch.
