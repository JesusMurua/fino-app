# FDD-013 — Frontend Routing & Session Rehydration

**Status:** Draft — awaiting approval
**Branch:** `fix/pos-to-admin-routing-auth`
**Author:** Architecture team
**Date:** 2026-04-19
**Related audits:**
- [AUDIT — POS → Admin routing loops](./AUDIT-pos-to-admin-routing-loops.md)
- [AUDIT — Role-based routing for operational staff](./AUDIT-role-based-routing-operational-staff.md)

---

## 1. Executive Summary

**Problem statement.** The current routing layer conflates human sessions, device provisioning, and role-based navigation. Three concrete defects ship in production: (1) the POS "Back Office" button sends users to `/pin` instead of `/admin`, trapping Owners/Managers in a PIN loop; (2) `setup.guard` blocks Owners/Managers without a configured device even when they legitimately want to reach `/admin` from a laptop; (3) `DeviceRoutingService` never routes Waiters to `/pos/waiter` and can route Cashiers to a hardware-only `/kitchen` screen.

**Proposed solution.** Introduce a *session rehydration* flow backed by `GET /api/auth/me` that refreshes `onboardingCompleted`, `roleId`, `planTypeId`, and the new `sessionType` claim on app bootstrap and on major shell transitions. Tighten `setup.guard` so it only applies to terminal-bound routes and lets Back Office `sessionType === 'email'` users through. Fix the three concrete routing defects (Back Office button, Waiter/Cashier post-login mapping, `returnUrl` role filtering) so that the human vs. hardware separation is strict end to end.

**User impact and UX goals.**
- Owners/Managers can cross from POS to Back Office in one tap — no PIN, no `/setup` bounce.
- Owners/Managers returning after completing onboarding on another device instantly see the full Back Office UI without logging out and back in.
- Waiters on a standard POS device always land on `/pos/waiter`; Hosts always land on `/tables`; Cashiers never accidentally land on `/kitchen`.
- Humans who touch a KDS/kiosk screen get a clear "this screen is for devices, not people" UI instead of being silently authenticated into the wrong shell.

---

## 2. Current State Analysis

### 2.1 Existing components and services involved

| Artifact | Current responsibility | Defect |
|---|---|---|
| [app.routes.ts](../src/app/app.routes.ts) | Declares routes and composes guards | `/pin` has `setupGuard` (correct), but `/admin` sits behind `authGuard` + `roleGuard` with no sessionType awareness |
| [setup.guard.ts](../src/app/core/guards/setup.guard.ts) | Redirects to `/setup` when device is not configured | Blocks email-session admins who don't need a terminal |
| [auth.guard.ts](../src/app/core/guards/auth.guard.ts) | Identity gate (session + onboarding) | Reads `isOnboardingComplete` from stale local JWT; never refreshes |
| [role.guard.ts](../src/app/core/guards/role.guard.ts) | Role allow-list gate | OK, but its `/pin` fallback amplifies the stale-token problem |
| [auth.service.ts](../src/app/core/services/auth.service.ts) | JWT and user state | No `GET /api/auth/me`; `isOnboardingComplete` computed from frozen JWT claim |
| [device-routing.service.ts](../src/app/core/services/device-routing.service.ts) | Post-login route resolution | Waiter never routed to `/pos/waiter`; Cashier can land on `/kitchen` |
| [pin.component.ts](../src/app/modules/pin/pin.component.ts) | PIN auth + redirect | Respects `returnUrl` even when the new role cannot reach it |
| [pos-header.component.ts](../src/app/modules/pos/components/pos-header/pos-header.component.ts) | POS top bar | `openAdmin()` navigates to `/pin` instead of `/admin` |

### 2.2 Current UX pain points

1. **Pain point A — "Back Office" is a PIN trap.** [pos-header.component.ts:287-289](../src/app/modules/pos/components/pos-header/pos-header.component.ts#L287-L289) hardcodes `router.navigate(['/pin'])`. Owners/Managers are forced to re-enter their PIN to reach their own Back Office.

2. **Pain point B — Stale onboarding flag.** `AuthService.isOnboardingComplete` ([auth.service.ts:103-116](../src/app/core/services/auth.service.ts#L103-L116)) is a pure computed over local state: `user.onboardingStatusId` / `localStorage['onboarding-completed-{branchId}']` / JWT `onboardingCompleted` claim. When onboarding is completed on another device, this flag never flips until the user manually logs out and back in. `authGuard` loops them through `/onboarding` indefinitely.

3. **Pain point C — `/setup` forced on email admins.** `setupGuard` ([setup.guard.ts:15-17](../src/app/core/guards/setup.guard.ts#L15-L17)) redirects on `!isDeviceConfigured()` without distinguishing between a kiosk user and an email-logged admin on a laptop.

4. **Pain point D — Waiter loses the dedicated shell.** `resolvePosRoute()` never returns `/pos/waiter`; Waiters default to `/pos` (RestaurantHub), even when `WaiterApp` feature is unlocked.

5. **Pain point E — Cashier on KDS mode.** `DeviceRoutingService.getPostLoginRoute` ([device-routing.service.ts:34-54](../src/app/core/services/device-routing.service.ts#L34-L54)) routes Cashier to `/kitchen` when `deviceMode==='kitchen'`. `/kitchen` is protected by `deviceAuthGuard`, which only accepts device tokens, producing an immediate rebound to `/setup?reason=unbound`.

6. **Pain point F — `returnUrl` hijack.** `PinComponent` ([pin.component.ts:188-192](../src/app/modules/pin/pin.component.ts#L188-L192)) navigates to the saved `returnUrl` unconditionally. A Cashier logging in after an Owner left a `/admin` returnUrl behind is bounced to `/admin` → `roleGuard` bounces back to `/pin` (since Cashier ∉ BackOffice) → visible flicker loop.

### 2.3 Performance baseline

- Current guard stack evaluates synchronously off local signals; no additional network I/O. Introducing rehydration adds a single `GET /api/auth/me` HTTP call per bootstrap / transition — must target < 300 ms p95 on LTE and must not block initial UI paint (non-blocking, background).
- `APP_INITIALIZER` changes must keep cold-start under 2 s on a mid-tier Android tablet.

### 2.4 Role model — Back Office membership

The backend role catalog is contiguous and has no gaps. This FDD operates on the following canonical mapping, which is the single source of truth for every routing / guard decision in the spec:

```
UserRoleId.Owner   = 1
UserRoleId.Manager = 2
UserRoleId.Cashier = 3
UserRoleId.Waiter  = 4
UserRoleId.Kitchen = 5
UserRoleId.Host    = 6
UserRoleId.Kiosk   = 7
```

**Back Office set (authoritative for this FDD):**

```ts
BACK_OFFICE_ROLES = [UserRoleId.Owner /* 1 */, UserRoleId.Manager /* 2 */]
```

- `isBackOfficeRole(roleId)` returns `true` iff `roleId ∈ BACK_OFFICE_ROLES`.
- Manager (id = 2) is a standard Back Office role on equal footing with Owner. Any spec in this FDD that mentions "Owner/Manager", "Back Office user", or `BACK_OFFICE_ROLES` applies uniformly to both ids 1 and 2.
- There is no placeholder, deprecated, or ghost role in the catalog — id=2 is Manager, not a gap.

Audit trail: see [AUDIT — Role ID hardcoding](./AUDIT-role-id-hardcoding.md) for the frontend consumption map and the confirmation that no component compares `roleId` against a numeric literal.

---

## 3. Requirements

### 3.1 Functional Requirements

**FR-001 — Session rehydration endpoint**
*As an Owner, I want my onboarding / role / plan state to stay in sync across devices so that I don't have to log out after completing onboarding on another terminal.*
The frontend SHALL call `GET /api/auth/me` on app bootstrap and on every major shell transition (POS → Back Office, Back Office → POS) and merge the response into `AuthService` state.

**FR-002 — `sessionType` awareness**
*As an Owner logging in by email from a laptop, I want the Back Office to load without forcing me through `/setup` so that I can manage my business without hardware ceremony.*
The frontend SHALL read the `sessionType` claim from the JWT (`'email' | 'pin' | 'device'`) and expose it as a reactive selector.

**FR-003 — Back Office button fix**
*As an Owner on the POS, I want the "Back Office" button to land me on `/admin` so that I can switch contexts in one tap.*
`PosHeaderComponent.openAdmin()` SHALL navigate to `/admin`.

**FR-004 — Strict `setupGuard` scope**
*As a Back Office user, I want `/admin` to never require device provisioning so that I can reach it from any browser.*
`setupGuard` SHALL allow traversal when the authenticated user's `sessionType === 'email'` OR their `roleId ∈ BACK_OFFICE_ROLES`, regardless of device configuration.

**FR-005 — Waiter → `/pos/waiter`**
*As a Waiter, I want my PIN login to drop me on the dedicated Waiter screen so that I can start taking orders immediately.*
`DeviceRoutingService.getPostLoginRoute(Waiter)` SHALL return `/pos/waiter` on standard POS devices. It SHALL return `/tables` only when `deviceMode === 'tables'`.

**FR-006 — Host → `/tables`**
*As a Host, I always want to land on the table map.*
`DeviceRoutingService.getPostLoginRoute(Host)` SHALL return `/tables` unconditionally (already the case — re-validate).

**FR-007 — Cashier kept off hardware shells**
*As a Cashier, I want never to land on a KDS or kiosk screen via PIN login, because those are device-authenticated shells.*
`DeviceRoutingService.getPostLoginRoute(Cashier)` SHALL NOT return `/kitchen` or `/kiosk` when the device mode is `'kitchen'` or `'kiosk'`. Instead, the PIN flow SHALL surface a "hardware-only screen" error UI that offers (a) re-authenticate as device, (b) re-provision the device, (c) cancel.

**FR-008 — `returnUrl` role filtering**
*As a Cashier inheriting a stale `returnUrl` left by an Owner, I want the PIN login to ignore that URL and route me to my role-appropriate shell.*
`PinComponent` SHALL, before honoring a `returnUrl`, verify that the current user's role is allowed on that URL (per route `data.roles`). If not, the URL SHALL be discarded and the rehydration-driven post-login destination used instead.

**FR-009 — Rehydration on shell transitions**
*As an Owner crossing from POS to Back Office (or vice versa), I want the target shell to see the freshest server state.*
A guard (or resolver) on `/admin` and `/pos` SHALL trigger `GET /api/auth/me` **once per transition** before the target renders. The call SHALL be non-blocking only when rehydrated fields cannot materially change the routing decision; otherwise it is awaited.

### 3.2 Non-Functional Requirements

- **Performance — bootstrap:** The `APP_INITIALIZER` rehydration call MUST NOT delay the first contentful paint of public routes (`/pin`, `/login`, `/register`). Rehydration runs in parallel with router bootstrap.
- **Performance — shell transition:** `GET /api/auth/me` MUST return < 300 ms p95. If it exceeds 2 s, the guard proceeds with the stale local state (fail-open) and logs a warning.
- **Offline:** Rehydration MUST degrade gracefully. When `navigator.onLine === false` or the request fails, the app MUST use the last cached JWT state and show no error.
- **Accessibility:** The new "hardware-only screen" error UI MUST meet WCAG 2.1 AA (focus trap on the dialog, `role="alertdialog"`, `aria-live="assertive"` for the error message, keyboard-dismissable).
- **Browser/device support:** Identical to app baseline (Chromium ≥ 110, iPad Safari ≥ 16, Android WebView ≥ 110). No new APIs beyond `fetch`/`HttpClient`.
- **Security:** The rehydration endpoint response MUST be treated with the same trust level as login — token in the response replaces the stored token atomically.
- **Data volume:** Rehydration payload is constant-size (single user record). No pagination considerations.

---

## 4. Component Architecture

### 4.1 Component / Service hierarchy

```
APP_INITIALIZER
└── SessionRehydrationService.hydrateOnBoot()
        ├── AuthService.rehydrate()           ← new public method
        │     └── ApiService.get('/auth/me')  ← existing helper
        └── (no blocking of router bootstrap)

Router (root)
├── /pin        → [setupGuard*]                       * revised: sessionType-aware
│     └── PinComponent
│           └── (on successful PIN) →
│                 PostLoginRouter
│                     ├── AuthService.rehydrate()     ← awaited
│                     ├── DeviceRoutingService.resolve(...)   ← revised
│                     └── (role filter) consumeReturnUrl
├── /admin      → [authGuard, roleGuard, adminShellGuard*]    * new
│     └── adminShellGuard → AuthService.rehydrate()
├── /pos        → [authGuard, roleGuard, terminalGuard, posEntryGuard, posShellGuard*]  * new
│     └── posShellGuard → AuthService.rehydrate() (non-blocking if recent)
├── /tables     → [authGuard, roleGuard, terminalGuard]
└── /pos/waiter → [authGuard, roleGuard, terminalGuard, featureGuard, waiterShellGuard*] * new (optional)

POS Shell (RestaurantHubComponent, ProductGridComponent, etc.)
└── PosHeaderComponent
      └── openAdmin() → router.navigate(['/admin'])   ← fixed target
```

> **Legend:** `*` marks new or modified artifacts introduced by this FDD. Existing pieces keep their current responsibilities unless explicitly noted.

### 4.2 Component / Service Specifications

#### 4.2.1 `SessionRehydrationService` (new, singleton)

- **Type:** Injectable service (`providedIn: 'root'`).
- **Responsibility:** Single source of truth for "is the stored session still valid per the server?". Coordinates calls to `/auth/me` and decides when a call is redundant (throttling).
- **Public surface (contract only, no code):**
  - `hydrateOnBoot(): Promise<void>` — invoked by `APP_INITIALIZER`; fires a `/auth/me` request when a token exists, otherwise resolves immediately.
  - `hydrateForShell(shell: 'admin' | 'pos' | 'waiter'): Promise<'ok' | 'stale-ok' | 'unauthorized'>` — invoked by shell guards; enforces a TTL (default 60 s) to skip redundant calls.
  - `lastHydratedAt: Signal<number | null>` — read-only signal exposing the last successful hydration timestamp (for debugging / observability).
- **Dependencies:** `AuthService`, `ApiService`.
- **Error semantics:**
  - 200 → update `AuthService` state, resolve.
  - 401 → forward to `AuthService.logout()` and redirect to `/pin`.
  - Network / 5xx → log warning, resolve with `'stale-ok'`, do not mutate state.

#### 4.2.2 `AuthService` (modified)

- **New public method — `rehydrate(): Observable<AuthUser>`:** fetches `/auth/me`, merges `roleId`, `onboardingStatusId`, `planTypeId`, `primaryMacroCategoryId`, `trialEndsAt`, `features`, and the new `sessionType` into the existing stored user; rewrites the JWT in localStorage atomically; invokes `syncTenantContext()`.
- **New readonly signal — `sessionType: Signal<'email' | 'pin' | 'device' | null>`:** derived from the JWT `sessionType` claim. `null` when unauthenticated or the claim is absent (legacy offline sessions).
- **Behavior contracts:**
  - If the response payload lacks `primaryMacroCategoryId`, the service SHALL log an error and keep the previous value — it MUST NOT wipe state mid-session.
  - The new token replaces the stored one only when `response.token` is a real JWT (three segments). Offline marker tokens (`offline-session-*`) SHALL be left untouched.

#### 4.2.3 `SetupGuard` (modified)

- **Revised predicate:**
  1. If `authService.sessionType() === 'email'` OR `isBackOfficeRole(authService.currentUser()?.roleId)` → allow.
  2. Else if `!configService.isDeviceConfigured()` → redirect to `/setup`.
  3. Else if `deviceConfig.mode === 'kiosk'` → redirect to `/kiosk`.
  4. Else → allow.
- **Rationale:** `setupGuard` is declared only on `/pin`. Its purpose is to prevent the PIN numpad from rendering on an unprovisioned device. An email-authenticated admin who happens to navigate through `/pin` (e.g. after clearing cookies) should not be trapped.

#### 4.2.4 `AdminShellGuard` (new, `canActivate` on `/admin`)

- **Responsibility:** Kick off rehydration before the Back Office tree renders, so that stale `onboardingCompleted` cannot redirect the user to `/onboarding`.
- **Contract:** Returns `Observable<boolean | UrlTree>`. Awaits `SessionRehydrationService.hydrateForShell('admin')`; on `'unauthorized'` returns `UrlTree('/pin')`; on any other result returns `true`.
- **Ordering:** Placed AFTER `authGuard` + `roleGuard` in `app.routes.ts` so that unauthenticated users never trigger a needless `/auth/me` call.

#### 4.2.5 `PosShellGuard` (new, `canActivate` on `/pos`)

- **Responsibility:** Opportunistically refresh server state when returning to POS from Back Office. Non-blocking if TTL is satisfied.
- **Contract:** Returns `true` synchronously when `lastHydratedAt` is within TTL; otherwise awaits hydration but never redirects on network failure (fail-open).

#### 4.2.6 `DeviceRoutingService` (modified)

- **Revised `getPostLoginRoute(roleId, deviceMode?)` decision table:**

| Role | Device mode | Returned route |
|---|---|---|
| Owner (id=1) / Manager (id=2) | any | `/admin` |
| Kitchen | any | `/kitchen` |
| Host | any | `/tables` |
| Waiter | `tables` | `/tables` |
| Waiter | any other | `/pos/waiter` **(NEW)** |
| Cashier | `tables` | `/tables` |
| Cashier | `kitchen` or `kiosk` | **`null` + error signal** — caller (PIN component) shows the hardware-only error UI |
| Cashier | any other | `resolvePosRoute()` |
| Kiosk (role) | any | `null` + error signal (same as Cashier on hardware mode) |

> The `/admin` branch applies uniformly to every member of `BACK_OFFICE_ROLES` (Owner and Manager per §2.4). No per-id special-casing is required inside `DeviceRoutingService`; the switch matches the enum constants, not numeric literals.

- **Signature evolution:** the method's return type expands from `string` to a discriminated union `{ route: string } | { error: 'hardware-shell' }`. The caller (`PinComponent`) branches on the discriminator.
- **Waiter branch guard:** when routing to `/pos/waiter`, the service MUST NOT check the `WaiterApp` feature — `featureGuard` on the route handles that. Failing the feature gate surfaces as a toast on navigation, not a silent re-route.

#### 4.2.7 `PinComponent` (modified)

- **Revised post-success flow:**
  1. Call `AuthService.rehydrate()` to refresh the freshly-minted session with the latest server state (harmless redundancy; ensures consistency when PIN login hits a cached JWT path).
  2. Resolve the *role-appropriate destination* via `DeviceRoutingService.getPostLoginRoute(...)`:
     - On `{ error: 'hardware-shell' }` → render the new **Hardware-Only Screen** dialog; do NOT navigate.
  3. Pull `returnUrl` via `consumeReturnUrl()`.
     - If `returnUrl` exists AND the URL's base path is covered by an allow-list for the new user's `roleId`, navigate there.
     - Otherwise discard `returnUrl` and navigate to the role-appropriate destination.
- **Allow-list source:** a new helper `RouteAccessPolicy.isAllowed(roleId, url)` in `core/services/` reads the same role arrays declared in `app.routes.ts`. This avoids drift with the route config.

#### 4.2.8 `PosHeaderComponent` (modified)

- **Change:** `openAdmin()` navigates to `/admin` (not `/pin`).
- **Secondary change:** method is renamed from `openAdmin` to `openBackOffice` only if the template selector is also updated; otherwise name stays to minimize diff.
- **Template contract:** the button's `click` handler binding stays on `openAdmin()`; only the navigation target inside the method changes.

#### 4.2.9 `HardwareOnlyScreenDialog` (new, dumb component)

- **Type:** Standalone presentational component, embedded inside `PinComponent`.
- **Responsibility:** Tell a human who entered a PIN on a KDS/kiosk terminal that the screen is for devices, and offer recovery paths.
- **Inputs:**
  - `mode: 'kitchen' | 'kiosk'`
- **Outputs:**
  - `reprovision: EventEmitter<void>` — user wants to re-run device setup.
  - `dismiss: EventEmitter<void>` — user acknowledges and returns to PIN entry.
- **No dependencies** beyond PrimeNG `p-dialog`.

### 4.3 Component communication

- **Parent → Child:** `PinComponent` passes `mode` to `HardwareOnlyScreenDialog` as an `@Input`.
- **Child → Parent:** Dialog emits `(reprovision)` (PIN component navigates to `/setup?reason=reprovision`) or `(dismiss)` (dialog closed, PIN cleared).
- **Sibling / cross-cutting:** Rehydration state is a service-level concern — components read `AuthService` signals (`currentUser`, `sessionType`, `isOnboardingComplete`). No direct component-to-component state is shared.

---

## 5. State Management

### 5.1 Component / service state

#### `SessionRehydrationService`

| Property | Type | Initial | Purpose |
|---|---|---|---|
| `lastHydratedAt` | `Signal<number \| null>` | `null` | TTL comparison baseline |
| `inFlight` | `Signal<boolean>` | `false` | Prevents duplicate concurrent calls (mutex) |
| `TTL_MS` | `const` | `60_000` | Cache window to skip redundant calls in `hydrateForShell` |

#### `AuthService` (new / changed properties)

| Property | Type | Initial | Purpose |
|---|---|---|---|
| `sessionType` | `Signal<'email' \| 'pin' \| 'device' \| null>` | JWT-derived | Routing decisions and guard predicates |
| `lastRehydratedAt` | internal timestamp | `0` | Used by `SessionRehydrationService` |

#### `PinComponent` (new state)

| Property | Type | Initial | Purpose |
|---|---|---|---|
| `hardwareShellError` | `Signal<'kitchen' \| 'kiosk' \| null>` | `null` | Triggers `HardwareOnlyScreenDialog` |

### 5.2 Reactive patterns

- **Source observables:**
  - `ApiService.get<MeResponse>('/auth/me')` — single-emit HTTP observable.
  - `AuthService.currentUser` / `sessionType` — signals (not observables), read synchronously inside guards via `.call()`.
- **Subscription management:**
  - Rehydration observables are converted to promises in `SessionRehydrationService` so guards can `await` them cleanly.
  - No long-lived subscriptions — HTTP observables complete on their own; no `takeUntilDestroyed` required.
- **Subjects / BehaviorSubjects:** None added. State lives in signals.

### 5.3 Form state

N/A — this FDD does not introduce or modify forms. Existing PIN numpad state in `PinComponent` is unchanged.

---

## 6. UI/UX Specifications

### 6.1 Layout structure

No new layout containers. The only visual addition is the `HardwareOnlyScreenDialog`, overlaid via `p-dialog` centered on the PIN screen.

### 6.2 PrimeNG components used (new)

| Component | Configuration | Events | Templates |
|---|---|---|---|
| `p-dialog` | `modal="true"`, `closable="false"`, `dismissableMask="false"`, `draggable="false"`, `resizable="false"`, `styleClass="hardware-only-dialog"`, `header="Esta pantalla es para dispositivos"` | `(onHide)` → `dismiss.emit()` | Footer with two `p-button` (severity `secondary` for "Entendido", severity `warning` for "Re-vincular dispositivo") |

### 6.3 Visual states

- **Loading state:** `AdminShellGuard` may briefly block navigation during `/auth/me`. Use a full-screen spinner at the router-outlet level (existing `LoadingOverlayComponent` if present; otherwise a lightweight `p-progressSpinner` centered on a 50 % white overlay).
- **Empty state:** N/A for this feature.
- **Error state — hardware-only dialog:**
  - Background overlay (`rgba(17, 24, 39, 0.6)`).
  - Icon: `pi pi-exclamation-triangle` in `#D97706`, 48 px.
  - Title: "Esta pantalla es para dispositivos" — 20 px, 700 weight, `#111827`.
  - Body (mode=`kitchen`): "Esta pantalla es una pantalla de cocina (KDS). No se puede iniciar sesión con PIN aquí. Si necesitas usar este dispositivo como POS, re-vincúlalo desde Configuración."
  - Body (mode=`kiosk`): symmetric wording for kiosk.
  - Buttons: primary "Entendido" (green #16A34A, dismisses), secondary "Re-vincular dispositivo" (#D97706, navigates to `/setup?reason=reprovision`).
- **Success state:** Not surfaced visually — transparent rehydration.

### 6.4 User interactions

- **Click "Back Office" on POS header:** immediate navigation to `/admin`. Toast on rehydration failure: "Trabajando con datos locales — reintenta si hay cambios recientes." (severity `info`, life 3000).
- **Click "Entendido" on hardware dialog:** dialog closes, PIN numpad is re-enabled with digits cleared.
- **Click "Re-vincular dispositivo":** router navigates to `/setup?reason=reprovision`.
- **Keyboard:** dialog traps focus. ESC is disabled (dismissableMask false + closable false); user must click a button.

---

## 7. Data Flow

### 7.1 API integration

**`GET /api/auth/me`**

| Aspect | Specification |
|---|---|
| Service method | `AuthService.rehydrate(): Observable<AuthUser>` wrapping `ApiService.get<MeResponse>('/auth/me')` |
| Trigger — boot | `APP_INITIALIZER` factory invokes `SessionRehydrationService.hydrateOnBoot()` |
| Trigger — shell | `AdminShellGuard`, `PosShellGuard` invoke `hydrateForShell(shell)` |
| Trigger — PIN success | `PinComponent.submit()` awaits `rehydrate()` after `pinLogin` returns a user |
| Request parameters | None — server identifies the session from the Bearer token |
| Response shape (expected, contract-owned by backend) | `{ token: string; roleId: UserRoleId; name: string; businessId: number; branchId: number; branches: BranchInfo[]; currentBranchId: number; planTypeId: PlanTypeId; primaryMacroCategoryId: MacroCategoryType; trialEndsAt?: string; onboardingStatusId?: number; currentOnboardingStep?: number; features: string[]; sessionType: 'email' \| 'pin' \| 'device'; }` |
| 200 handling | Replace stored token + user atomically; call `syncTenantContext()`; update `lastHydratedAt` |
| 401 handling | Call `AuthService.logout()` (which already navigates to `/pin`) |
| 403 handling | Treat as unauthorized — same as 401 |
| Network / 5xx | Keep existing state; log `console.warn('[Rehydration] /auth/me failed, using cached state')` |

### 7.2 Data transformation

- **Backend → frontend mapping:** 1:1 for existing `AuthUser` fields. The new `sessionType` is stored verbatim on the `AuthUser` record (schema addition).
- **Backwards compatibility:** If `sessionType` is missing in the response (legacy backend), default to `'pin'` when `roleId` ∈ operational roles and `'email'` when ∈ `BACK_OFFICE_ROLES`. Log a warning once per session.

### 7.3 Data refresh strategy

- **Initial load:** APP_INITIALIZER fires `/auth/me` in parallel with Angular bootstrap (fire-and-forget; UI does not wait).
- **Shell transitions:** Guards fire with a 60 s TTL. Repeated transitions within the TTL skip the network call.
- **Manual refresh:** `AuthService.refreshSubscriptionStatus()` is already in place for plan refresh; it remains independent of `/auth/me`. Callers that need the freshest identity state call `SessionRehydrationService.hydrateForShell('admin')` explicitly.
- **Polling:** None — rehydration is event-driven, never timer-based.

---

## 8. Performance Optimization

### 8.1 Rendering optimization

- **OnPush candidates:** `HardwareOnlyScreenDialog` (pure presentational, inputs-driven).
- **Virtual scrolling / TrackBy:** N/A (no lists).
- **Guard cost:** `AdminShellGuard` awaits a single HTTP call. The budget is 300 ms p95; above that, the user sees a spinner. `PosShellGuard` is non-blocking — returns synchronously when within TTL.

### 8.2 Data optimization

- **Lazy loading:** Unchanged. `/admin` and `/pos` remain lazy-loaded module trees.
- **Caching strategy:** `SessionRehydrationService` maintains a 60 s TTL window. On transitions within the window, no HTTP call is made.
- **Bundle impact:** New service + guard + small dialog component add ~2 KB gzipped. No new third-party deps.

### 8.3 Bundle optimization

- `SessionRehydrationService` is tree-shakeable via `providedIn: 'root'`.
- `HardwareOnlyScreenDialog` is a standalone component imported only by `PinComponent` (not in shared barrel).

---

## 9. Error Handling

### 9.1 Error types

| Error | Source | UI |
|---|---|---|
| `/auth/me` returns 401/403 | Session expired | Automatic logout → `/pin`. Toast: "Tu sesión expiró, vuelve a ingresar." (severity `warn`, life 4000) |
| `/auth/me` network failure | Offline or backend down | Silent — use cached state. Debug log only. |
| `/auth/me` 5xx | Backend fault | Silent for shell transitions; toast for explicit user-triggered refresh: "No se pudo refrescar sesión." |
| PIN login on hardware shell | User action | `HardwareOnlyScreenDialog` modal |
| `returnUrl` not allowed for role | Stale state | Silent — discard URL and route to role-default destination |

### 9.2 User feedback

- **Toast:** `MessageService.add(...)`. Severity `warn` for session expiry, `info` for stale data, `error` reserved for destructive failures (none in this FDD).
- **Inline:** None — all feedback is modal or toast.
- **Confirmation dialogs:** `HardwareOnlyScreenDialog` is the only modal introduced.

---

## 10. Accessibility

### 10.1 Keyboard navigation

- `HardwareOnlyScreenDialog` traps focus inside; tabbing cycles between the two buttons. `Shift+Tab` cycles backward.
- ESC key is intentionally non-dismissing (prevents accidental bypass of a screen boundary violation).

### 10.2 Screen reader support

- `role="alertdialog"` on the `p-dialog` container.
- `aria-live="assertive"` on the message body so the warning is announced immediately.
- `aria-labelledby` references the header; `aria-describedby` references the body paragraph.
- Buttons have explicit `aria-label`: "Cerrar alerta y volver al PIN" / "Re-vincular dispositivo al POS".

---

## 11. Testing Requirements

### 11.1 Unit tests

**`AuthService.rehydrate`**
- Merges response fields into stored user.
- Replaces JWT only when response contains a real 3-segment token.
- Preserves offline marker tokens.
- Invokes `syncTenantContext()` on success.
- Forwards `401` to `logout()`.

**`SessionRehydrationService.hydrateForShell`**
- Returns immediately (`stale-ok`) when `lastHydratedAt` is within TTL.
- Returns `ok` after successful call.
- Returns `stale-ok` on network failure.
- Returns `unauthorized` on 401.
- Mutex: concurrent callers share a single in-flight request.

**`DeviceRoutingService.getPostLoginRoute`**
- Waiter + default mode → `/pos/waiter`.
- Waiter + `tables` mode → `/tables`.
- Host + any mode → `/tables`.
- Cashier + `kitchen` mode → `{ error: 'hardware-shell' }`.
- Cashier + `kiosk` mode → `{ error: 'hardware-shell' }`.
- Cashier + `tables` mode → `/tables`.
- Cashier + other → `resolvePosRoute()`.
- Owner (id=1) → `/admin`.
- Manager (id=2) → `/admin`.

**`SetupGuard`**
- Allows when `sessionType === 'email'` and device not configured.
- Allows when `isBackOfficeRole(roleId)` and device not configured.
- Redirects non-backoffice to `/setup` when device not configured.

**`PinComponent.submit`**
- Discards `returnUrl` when the URL is not allowed for the authenticated role.
- Surfaces the hardware dialog when `getPostLoginRoute` returns the error discriminator.
- Awaits `rehydrate()` before navigation.

**`PosHeaderComponent.openAdmin`**
- Navigates to `/admin` (never `/pin`).

### 11.2 E2E tests

1. **Owner crosses POS → Back Office:** login via PIN on a POS, click "Back Office", assert URL becomes `/admin` and Back Office shell renders. No redirect to `/pin`, no redirect to `/setup`.
2. **Stale onboarding auto-refresh:** simulate onboarding completed on device B; on device A, click "Back Office", assert `/auth/me` fires and `/onboarding` is not visited.
3. **Waiter lands on dedicated shell:** PIN-login as Waiter on a device with `mode ≠ 'tables'`, assert final URL is `/pos/waiter`.
4. **Cashier on KDS device:** PIN-login as Cashier on `mode='kitchen'`, assert Hardware-Only dialog is shown and no navigation happens.
5. **Host unconditional tables:** PIN-login as Host across `mode='tables' | 'counter' | 'retail' | ''`, assert final URL is always `/tables`.
6. **Stale `returnUrl` discard:** seed `RETURN_URL_KEY=/admin`, PIN-login as Cashier, assert final URL is the Cashier's resolved POS route (not `/admin` → `/pin` loop).
7. **Email admin without device config:** log in via email on a browser with empty `deviceConfig`, navigate to `/admin`, assert no `/setup` redirect.

---

## 12. Implementation Phases

> All phases are behind the `fix/pos-to-admin-routing-auth` branch. Each phase produces a separately reviewable diff.

### Phase 1 — Shared plumbing (foundation)

**Deliverables:**
1. Extend `AuthUser` model with `sessionType: 'email' | 'pin' | 'device'` (optional during migration).
2. Add `AuthService.rehydrate()` + `AuthService.sessionType` signal.
3. Introduce `SessionRehydrationService` with `hydrateOnBoot` and `hydrateForShell`.
4. Wire `APP_INITIALIZER` to `SessionRehydrationService.hydrateOnBoot`.
5. Add `RouteAccessPolicy` helper (role × URL allow-list mirror of `app.routes.ts`).

**Dependencies:** Backend endpoint `GET /api/auth/me` with `sessionType` claim must be deployed to the dev environment before this phase merges.

### Phase 2 — Guard and routing fixes

**Deliverables:**
1. Revise `setupGuard` to bypass on `sessionType === 'email'` OR `isBackOfficeRole`.
2. Add `AdminShellGuard` and wire it to `/admin` route.
3. Add `PosShellGuard` and wire it to `/pos` route.
4. Modify `DeviceRoutingService.getPostLoginRoute` to return the new discriminated union, with Waiter routed to `/pos/waiter` and Cashier/Kiosk on hardware modes returning the error signal.

**Depends on:** Phase 1.

### Phase 3 — Component fixes

**Deliverables:**
1. `PosHeaderComponent.openAdmin` → navigates to `/admin`.
2. `PinComponent.submit` → awaits `rehydrate`, filters `returnUrl` by role allow-list, handles `hardware-shell` error.
3. Add `HardwareOnlyScreenDialog` standalone component + i18n strings.

**Depends on:** Phases 1 & 2.

### Phase 4 — Tests and rollout

**Deliverables:**
1. Unit tests per section 11.1.
2. E2E tests per section 11.2 (Playwright).
3. Manual QA script on a physical iPad + Android tablet.
4. Feature-flag gate (if the team prefers) for the rehydration call; default on in staging, soft-launch in prod.
5. Observability: log a structured event `rehydration.completed` with latency p95 for the first two weeks post-rollout.

**Depends on:** Phases 1-3.

### Phase ordering rationale

Phase 1 is foundation-only and ships with the rehydration endpoint before any user-visible behavior changes. Phase 2 introduces the guards but keeps the old Back Office button broken — this keeps Phase 2 reviewable in isolation. Phase 3 flips the Back Office button, and Phase 4 formalizes testing. This lets us revert any single phase without rolling back the whole feature.

---

## 13. Out of Scope

- Tablet-to-tablet session propagation over the local network (future work).
- Biometric unlock for Owners on Back Office (future work).
- A dedicated `/unauthorized` screen to replace the "bounce to /pin" fallback in `roleGuard` (noted but out of scope).
- Migration of `onboardingCompleted` from a JWT claim to a server-owned state — the rehydration endpoint already exposes `onboardingStatusId`, so this FDD treats the JWT claim as legacy.
- Changes to `/kitchen` or `/kiosk` routes themselves. Those remain device-token-only (`deviceAuthGuard`).

---

## 14. Approval

This document is DRAFT. Implementation MUST NOT start until an explicit approval comment references FDD-013 by name on the PR description or branch.
