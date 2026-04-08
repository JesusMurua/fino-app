# AUDIT-012: Gap Analysis — Roles vs. Device Modes (Routing & UI Architecture)

**Date:** 2026-04-07
**Scope:** Frontend routing, authentication flows, guards, and device provisioning
**Goal:** Identify gaps between the current architecture and the target Enterprise model

---

## Target Enterprise Architecture

| Layer | Access Method | Users | Description |
|-------|--------------|-------|-------------|
| **Cloud Backoffice** (`/admin`) | Email + Password | Owner, Manager | Full business management — no PIN, no device mode |
| **Physical Endpoints** (POS, KDS) | Device provisioned once by Owner | — | Device mode is locked after setup; employees don't choose it |
| **Floor Sessions** (`/pin`) | 4-digit PIN | Cashier, Waiter, Kitchen, Host | Employee logs into a pre-provisioned device; never sees setup or mode selection |

---

## 1. Current State — Routing Flow

### 1.1 Application Boot Sequence

```
App Init (app.component.ts)
  │
  ├─ configService.loadDeviceConfig()     → reads localStorage 'pos-device-config'
  ├─ authService (constructor)            → restores token + user from localStorage
  └─ Default route: '/' → redirects to /pin
```

### 1.2 Route Map & Guards

| Route | Guard(s) | Allowed Roles | Purpose |
|-------|----------|---------------|---------|
| `/register` | — | Public | New business registration |
| `/setup` | — | Public | Device provisioning (mode selection) |
| `/onboarding` | — | Public | First-time business setup wizard |
| `/login` | `setupGuard` | Public (post-setup) | Email/Password login |
| `/pin` | `setupGuard` | Public (post-setup) | 4-digit PIN login |
| `/kiosk` | — | Public | Self-service kiosk mode |
| `/pos` | `authGuard` | Cashier, Owner, Manager, Waiter | Point-of-sale |
| `/admin` | `authGuard` + `onboardingGuard` | Owner, Manager, Host | Backoffice |
| `/kitchen` | `authGuard` | Kitchen, Owner, Manager | Kitchen display |
| `/orders` | `authGuard` | Cashier, Kitchen, Owner, Manager, Waiter | Order history |
| `/tables` | `authGuard` | Cashier, Owner, Manager, Waiter, Host | Floor/table map |
| `**` | `setupGuard` | — | Catch-all → `/pin` |

### 1.3 Guard Logic Summary

**`setupGuard`** — Checks if device is configured (businessId > 0 && branchId > 0). If not → `/setup`. If device is in kiosk mode → `/kiosk`.

**`authGuard`** — Priority chain:
1. Not authenticated → `/pin`
2. Onboarding incomplete → `/onboarding`
3. Device not configured → `/setup`
4. Role mismatch (vs `route.data.roles`) → `/pin`

**`onboardingGuard`** — Checks localStorage flag `onboarding-completed-{branchId}` OR JWT claim `onboardingCompleted`. Applied only to `/admin`.

### 1.4 Post-Login Routing (PIN Component)

After successful PIN authentication, `pin.component.ts` routes based on **Role + Device Mode**:

```
Owner / Manager  → /admin
Kitchen          → /kitchen
Host             → /tables
Waiter           → device mode decides: /tables OR /pos
Cashier          → device mode decides: /pos (variant) OR /kitchen OR /tables
```

### 1.5 Post-Login Routing (Email Login)

After successful email/password login, `login.component.ts` routes to:
- Saved `returnUrl` (if redirected by a guard), OR
- `/admin` (hardcoded default)

### 1.6 Device Mode Selection

**During Setup (email flow):** User enters email + password → selects branch → **manually selects mode** from 4 options (cashier, kiosk, tables, kitchen) → saved to localStorage.

**During Setup (activation code flow):** 6-digit code entered → backend returns a **pre-assigned mode** → user cannot override → saved to localStorage.

**During Onboarding (Step 4):** Mode selection available, filtered by business type.

**Storage:** `localStorage['pos-device-config']` — includes `mode`, `deviceName`, `businessId`, `branchId`, `linkedRegisterId`.

---

## 2. Identified Gaps

### GAP-01: Owners/Managers Are Forced Through the PIN Screen

| Severity | **HIGH — UX & Security** |
|----------|--------------------------|
| Current | After email/password login, the Owner lands on `/admin`. But on a fresh device, the default route is `/pin`. There is **no direct path** from the landing page to `/login` without knowing the URL. |
| Problem | Owners provisioning a new device must first navigate to `/setup`, then the system drops them on `/pin` — a screen designed for floor staff. They must find the `/login` link (if it exists in the UI) or type it manually. |
| Target | After `/setup`, an Owner should be routed to `/login` (email/password), **never** to `/pin`. The PIN screen is exclusively for floor employees on already-provisioned devices. |

### GAP-02: Any Authenticated User Can Select Device Mode During Setup

| Severity | **HIGH — Security** |
|----------|---------------------|
| Current | The `/setup` route has **no guards** — it is fully public. Anyone who navigates to `/setup` can change the device mode, business ID, and branch ID stored in localStorage. |
| Problem | A floor employee (Cashier/Waiter) could navigate to `/setup` and change the device from `cashier` mode to `kitchen` mode, or switch branches entirely. |
| Target | `/setup` should only be accessible to Owners/Managers (or via activation codes). Once provisioned, the setup screen should be **locked** behind Owner/Manager re-authentication. |

### GAP-03: Device Mode Stored in Unsigned localStorage

| Severity | **MEDIUM — Security** |
|----------|----------------------|
| Current | Device mode is a plain string in `localStorage['pos-device-config']`. No signature, no server validation. |
| Problem | A technically savvy user can open DevTools → Application → localStorage and change `mode: "cashier"` to `mode: "kitchen"`, gaining access to kitchen routes. The `authGuard` checks **role** but the PIN component's post-login routing uses **device mode** — so the user ends up on a different screen than intended. |
| Target | Device mode should be either: (a) signed by the backend during provisioning, or (b) validated on each navigation by comparing against a server-stored device record. |

### GAP-04: PIN Component Mixes Role Logic and Device Mode Logic

| Severity | **MEDIUM — Architecture** |
|----------|--------------------------|
| Current | `pin.component.ts` lines 224-246 contain a tangled `if/else` tree that combines `user.role` checks with `deviceConfig.mode` checks to determine the post-login route. |
| Problem | Adding new roles or device modes requires editing this monolithic routing block. The logic is not unit-testable in isolation. Role-based access (who can do what) is conflated with device-mode routing (where this device should go). |
| Target | Separate concerns: (1) Guards enforce role-based access. (2) A dedicated `DeviceRoutingService` resolves the landing route based on device mode. The PIN component calls the service and navigates — no inline routing logic. |

### GAP-05: Onboarding State Has Dual Source of Truth

| Severity | **LOW — Reliability** |
|----------|----------------------|
| Current | Onboarding completion is tracked in both `localStorage['onboarding-completed-{branchId}']` AND the JWT claim `onboardingCompleted`. Both `authGuard` and `onboardingGuard` check both sources independently. |
| Problem | If the JWT is refreshed without the claim (backend bug) but localStorage has the flag, the user passes. If localStorage is cleared but JWT has the claim, the guard re-sets localStorage. These fallbacks mask potential desync issues. |
| Target | Single source of truth: JWT claim is authoritative. localStorage is a cache that is always overwritten from JWT on login. |

### GAP-06: Offline Token (`offline-session-*`) Sent to Backend

| Severity | **MEDIUM — Security** |
|----------|----------------------|
| Current | When a user authenticates offline via hashed PINs in IndexedDB, the system generates a marker token `'offline-session-{timestamp}'`. The HTTP interceptor attaches **any** token in localStorage to the `Authorization` header. |
| Problem | If the device comes back online, API requests will carry the `offline-session-*` token. The backend should reject it, but the client doesn't proactively strip it or re-authenticate. |
| Target | The interceptor should detect `offline-session-*` tokens and either (a) suppress the header and queue the request for post-re-auth, or (b) trigger a silent re-authentication flow before sending. |

### GAP-07: No Cross-Device Session Revocation

| Severity | **LOW — Security** |
|----------|---------------------|
| Current | If a user (especially Owner/Manager) logs in on Device A and later on Device B, the token on Device A remains valid until expiration. |
| Problem | A terminated employee's session on a provisioned device could persist until the JWT expires. |
| Target | Backend should track active sessions per `deviceId` (from `DeviceService`) and support revocation. Client should poll or listen for revocation signals. |

### GAP-08: `Host` Role Has Access to `/admin`

| Severity | **LOW — Review Needed** |
|----------|------------------------|
| Current | Route definition for `/admin` allows roles: `Owner, Manager, Host`. |
| Problem | In the Enterprise model, `/admin` is strictly for Owners/Managers. The `Host` role (floor staff managing table seating) should not have backoffice access. |
| Target | Remove `Host` from `/admin` allowed roles. If Hosts need limited admin features, create a separate `/host-dashboard` route. |

### GAP-09: Catch-All Route Uses `setupGuard` Instead of `authGuard`

| Severity | **LOW — Consistency** |
|----------|----------------------|
| Current | The `**` wildcard route (line 94 in `app.routes.ts`) applies only `setupGuard`, redirecting unknown paths to `/pin`. |
| Problem | An unauthenticated user hitting a typo URL (e.g., `/admni`) sees the PIN screen instead of being properly handled. Minor, but inconsistent with the guard strategy on other routes. |
| Target | Apply `authGuard` to the catch-all, or redirect to a dedicated 404 page. |

---

## 3. Gap Summary Matrix

| ID | Gap | Severity | Effort | Enterprise Blocker? |
|----|-----|----------|--------|---------------------|
| GAP-01 | Owners forced to PIN screen | HIGH | Low | **Yes** |
| GAP-02 | Setup screen is unprotected | HIGH | Medium | **Yes** |
| GAP-03 | Device mode in unsigned localStorage | MEDIUM | Medium | No (hardening) |
| GAP-04 | PIN component has tangled routing | MEDIUM | Medium | No (tech debt) |
| GAP-05 | Onboarding dual source of truth | LOW | Low | No |
| GAP-06 | Offline token sent to backend | MEDIUM | Low | No (hardening) |
| GAP-07 | No cross-device session revocation | LOW | High | No (phase 2) |
| GAP-08 | Host role in /admin | LOW | Low | **Yes** |
| GAP-09 | Catch-all guard inconsistency | LOW | Low | No |

---

## 4. Step-by-Step Implementation Plan

### Phase 1: Decouple Cloud Auth from Physical Device PIN Auth (Enterprise Blockers)

#### Step 1.1 — Split the Entry Point After Setup

**Files:** `app.routes.ts`, `setup.component.ts`

- After device provisioning completes in `/setup`:
  - If the user authenticated via **email/password** (Owner/Manager flow) → navigate to `/admin`.
  - If provisioned via **activation code** → navigate to `/pin` (device is ready for floor staff).
- Update the default route (`/`) to check `authService.isAuthenticated()`:
  - Authenticated Owner/Manager → `/admin`
  - Authenticated floor staff → role+mode-based route
  - Not authenticated, device configured → `/pin`
  - Not authenticated, no device config → `/setup`

#### Step 1.2 — Protect the Setup Screen

**Files:** `app.routes.ts`, new `provisioning.guard.ts`

- Create a `provisioningGuard`:
  - If device is **already provisioned** (valid config in localStorage) → require Owner/Manager role to access `/setup` (re-provisioning).
  - If device is **not provisioned** → allow access (first-time setup).
- Apply `provisioningGuard` to the `/setup` route.
- Add a "Re-provision Device" button in `/admin` settings that navigates to `/setup` (only visible to Owner/Manager).

#### Step 1.3 — Remove Host from /admin Route

**Files:** `app.routes.ts`

- Change `/admin` allowed roles from `[Owner, Manager, Host]` to `[Owner, Manager]`.
- Verify `Host` role has appropriate access to `/tables` (already allowed).

#### Step 1.4 — Extract Post-Login Routing into a Service

**Files:** new `device-routing.service.ts`, `pin.component.ts`, `login.component.ts`

- Create `DeviceRoutingService` with method `getPostLoginRoute(user: AuthUser, deviceConfig: DeviceConfig): string`.
- Logic:
  ```
  if role is Owner or Manager → '/admin'
  if role is Kitchen → '/kitchen'
  if role is Host → '/tables'
  if role is Waiter → mode === 'tables' ? '/tables' : '/pos'
  if role is Cashier → resolve by device mode (cashier→/pos, kitchen→/kitchen, tables→/tables)
  fallback → '/pin'
  ```
- Refactor `pin.component.ts` to call `deviceRoutingService.getPostLoginRoute()` instead of inline if/else.
- Refactor `login.component.ts` to use the same service (with `/admin` as the Owner default).

### Phase 2: Security Hardening

#### Step 2.1 — Intercept Offline Tokens

**Files:** `auth.interceptor.ts`

- Before attaching the `Authorization` header, check if the token starts with `offline-session-`.
- If offline token detected AND device is online (`navigator.onLine`):
  - Strip the header.
  - Emit a `tokenExpired` event to trigger re-authentication.
- If offline and offline token → skip the header entirely (requests will be queued by sync service).

#### Step 2.2 — Sign Device Config from Backend

**Files:** `config.service.ts`, `setup.component.ts`, backend `DeviceController`

- Backend: When a device is provisioned (setup or activation code), return a signed `deviceConfigToken` (JWT with `mode`, `businessId`, `branchId`, `deviceId`).
- Frontend: Store the `deviceConfigToken` alongside the plain config.
- Guards: Optionally validate the token signature on sensitive route transitions (or at minimum, on app init).

#### Step 2.3 — Unify Onboarding Source of Truth

**Files:** `auth.guard.ts`, `onboarding.guard.ts`, `auth.service.ts`

- Make JWT claim `onboardingCompleted` the single source of truth.
- On login success, always write the claim value to localStorage (cache).
- Guards read localStorage for speed, but on any mismatch or missing value, fall back to JWT.
- Remove the dual-check pattern; make it a single `isOnboardingComplete()` method in `AuthService`.

### Phase 3: Future Enhancements

#### Step 3.1 — Per-Device Session Tracking

- Backend: Store `deviceId` + `userId` + `tokenId` on login.
- Backend: Expose `DELETE /api/auth/sessions/{deviceId}` for Owners to revoke.
- Frontend: On app init, call `GET /api/auth/session/validate` to check if session is still valid.

#### Step 3.2 — Activation Code as Primary Provisioning

- Deprecate the email/password flow in `/setup` for device provisioning.
- Owners generate activation codes from `/admin/devices` → codes are pre-assigned a mode, branch, and device name.
- `/setup` only accepts activation codes → eliminates the need for mode selection UI on the device.

---

## 5. Key Files Reference

| File | Role in Architecture |
|------|---------------------|
| [app.routes.ts](src/app/app.routes.ts) | Master route definitions & guard assignments |
| [auth.service.ts](src/app/core/services/auth.service.ts) | Token storage, login flows, user state |
| [auth.guard.ts](src/app/core/guards/auth.guard.ts) | Role + auth + onboarding checks |
| [setup.guard.ts](src/app/core/guards/setup.guard.ts) | Device config presence check |
| [onboarding.guard.ts](src/app/core/guards/onboarding.guard.ts) | Onboarding completion check |
| [pin.component.ts](src/app/modules/pin/pin.component.ts) | PIN login + post-auth routing logic |
| [login.component.ts](src/app/modules/login/login.component.ts) | Email/password login + redirect |
| [setup.component.ts](src/app/modules/setup/setup.component.ts) | Device provisioning (mode selection) |
| [onboarding.component.ts](src/app/modules/onboarding/onboarding.component.ts) | First-time business wizard |
| [config.service.ts](src/app/core/services/config.service.ts) | Device config read/write (localStorage) |
| [device.service.ts](src/app/core/services/device.service.ts) | Stable device UUID generation |
| [device-config.model.ts](src/app/core/models/device-config.model.ts) | DeviceConfig interface & defaults |
| [auth.model.ts](src/app/core/models/auth.model.ts) | UserRole type, AuthUser, LoginResponse |
| [auth.interceptor.ts](src/app/core/interceptors/auth.interceptor.ts) | Bearer token injection |

---

*Generated by Claude Code — AUDIT-012*
