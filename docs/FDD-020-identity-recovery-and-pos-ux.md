# FDD-020 — Identity Recovery & POS UI Coherence

> Closes the cold-boot 403 cascade on POS startup and resolves the
> contradictory "Caja Cerrada" header that was rendered even during the
> linking flow.
> **Status:** Superseded by [FDD-022](FDD-022-rollback-device-auth.md) — backend audit revealed that the targeted endpoints require human role claims that device JWTs intentionally lack. The interceptor overrides were rolled back. The UI improvements (`blockerTitle`/`blockerSubtitle` computed signals) remain in effect — those changes are orthogonal to the auth fix.
> **Author:** Senior Angular Architect (Claude).
> **Date:** 2026-04-30.

---

## 0. Executive Summary

Two production issues confirmed by read-only audit:

1. **Cold-boot 403 cascade** — `runPostAuthRecovery()` fires two device-scoped GETs in sequence (`/registers/by-device/{uuid}` then `/cashregister/session`). On a `cashier`-mode device, `auth.interceptor` attaches the **user JWT** to both requests because the URL-aware override in FDD-019 was scoped to `/redeem-link-code` only. The backend rejects with 403, the frontend silently falls back to an empty Dexie cache, `_linkedRegister` and `_activeSession` stay `null`, and the session blocker shows `'needsLinking'` even when the device IS linked server-side.

2. **Header dissonance** — the `<h2>` "Caja Cerrada" + `<p>` "Abre un turno de caja para comenzar a cobrar" live **outside** the `@switch (setupState())` in [pos-header.component.html:660-661](../src/app/modules/pos/components/pos-header/pos-header.component.html#L660-L661). When `setupState()` resolves to `'needsLinking'`, the body asks for a linking code while the header still says "Caja Cerrada" — visual contradiction that confuses cashiers.

This document specifies surgical frontend changes to:

- Promote `/registers/by-device/` and `/cashregister/session` to **Device-Auth Priority** routes inside `auth.interceptor`'s `resolveBearerToken`, mirroring the FDD-019 `/redeem-link-code` pattern (zero-fallback).
- Replace the static `<h2>` and `<p>` content with computed signals (`blockerTitle`, `blockerSubtitle`) driven by `setupState()`.

**Out of scope:** other 403s observed in the screenshots (`/orders/last-number`, `/auth/employee-hashes`). Those endpoints are user-scoped by design — their 403s mean the cashier role lacks permission, not that the wrong JWT was sent. They require backend role-policy work, not interceptor changes.

---

## 1. Components to Modify

| # | File | Type | Scope of change | Risk |
|---|---|---|---|---|
| 1 | [auth.interceptor.ts](../src/app/core/interceptors/auth.interceptor.ts) | Functional interceptor | Inside `resolveBearerToken(url)`, add two priority guards (before the `mode` switch) — one for `/registers/by-device/` and one for `/cashregister/session`. Both follow the FDD-019 zero-fallback pattern: device JWT or `null`. | Medium — auth-critical |
| 2 | [pos-header.component.ts](../src/app/modules/pos/components/pos-header/pos-header.component.ts) | Standalone component (TS) | Add `blockerTitle` and `blockerSubtitle` `computed<string>` signals in the Session Blocker region. Each switches on `setupState()` and returns the per-state copy. | Low |
| 3 | [pos-header.component.html](../src/app/modules/pos/components/pos-header/pos-header.component.html) | Standalone component (template) | Lines 660-661: replace literal `"Caja Cerrada"` and `"Abre un turno de caja…"` with `{{ blockerTitle() }}` and `{{ blockerSubtitle() }}`. Keep the elements OUTSIDE the switch (so they appear consistently across all `@case` blocks). | Low |

---

## 2. State Management

| Signal | Kind | Type | Behavior |
|---|---|---|---|
| `blockerTitle` (NEW) | `computed<string>` | `string` | Returns `"Vincular Dispositivo"` when `setupState()` is `'needsLinking'` or `'loading'`; `"Caja Cerrada"` when `'needsOpening'`; empty string otherwise (unreachable — when `'isOpen'`, the parent `@if (showSessionBlocker())` hides the modal entirely). |
| `blockerSubtitle` (NEW) | `computed<string>` | `string` | Returns `"Este equipo aún no está asignado a una caja física."` for `'needsLinking'` / `'loading'`; `"Abre un turno de caja para comenzar a cobrar."` for `'needsOpening'`. |
| `setupState`, `linkedRegister`, `_activeSession`, `hasOpenSession` | unchanged | unchanged | Behavioral change is implicit: with the new interceptor overrides, `_linkedRegister` and `_activeSession` will populate correctly on cold-boot, so `setupState()` can correctly transition to `'needsOpening'` instead of being stuck at `'needsLinking'`. |

The two new signals are pure derivations — no side effects, no service calls.

---

## 3. State → Header Copy Mapping

| `setupState()` | `blockerTitle` | `blockerSubtitle` | Body shown by `@switch` |
|---|---|---|---|
| `'needsLinking'` | `Vincular Dispositivo` | `Este equipo aún no está asignado a una caja física.` | Self-link CTA + redeem code input |
| `'loading'` | `Vincular Dispositivo` | `Este equipo aún no está asignado a una caja física.` | Disabled "Vinculando..." button (loading transitively comes from the linking flow — `isLinkingDevice()` is set only there) |
| `'needsOpening'` | `Caja Cerrada` | `Abre un turno de caja para comenzar a cobrar.` | Linked-register badge + "Abrir Turno" button |
| `'isOpen'` | n/a | n/a | Blocker is hidden by `@if (showSessionBlocker())` — header signals never read |

---

## 4. Validations & UX

### 4.1 Interceptor — URL-aware token resolution (extended)

| Request URL contains | Token attached |
|---|---|
| `/api/auth/pin-login` or `/api/auth/email-login` (PUBLIC_PATHS) | None |
| `/redeem-link-code` (FDD-019) | `pos_device_token` if valid, else `null` |
| **`/registers/by-device/`** (NEW) | `pos_device_token` if valid, else `null` |
| **`/cashregister/session`** (NEW) | `pos_device_token` if valid, else `null` |
| Any other URL with `mode ∈ ['kitchen', 'kiosk', 'reception']` | `pos_device_token` (zero-fallback) |
| Any other URL with `mode ∈ ['cashier', 'tables']` or undefined | `pos_auth_token` (skipping `offline-session-*`) |

### 4.2 Logout exemption — unchanged from FDD-019

The 401 → `authService.logout()` guard inside `tap.error` continues to use `!isPublicRoute && !isRedeemRoute`. We do **NOT** add `/by-device/` or `/cashregister/session` to the logout exemption list — a real 401 on those endpoints (for example, the device JWT actually expired) is a legitimate auth-failure that should bounce the user to re-auth. This is different from `/redeem-link-code`, where the 401 is a domain-rejection of the typed code rather than a session failure.

### 4.3 Header copy — silent transitions

Both `blockerTitle` and `blockerSubtitle` are computed signals, so the header text updates **synchronously** when `setupState()` transitions. No flicker, no state mismatch, no manual change-detection.

---

## 5. Implementation Order

| Phase | Step | File | Description |
|---|---|---|---|
| **A — Doc** | A1 | `docs/FDD-020-...md` (NEW) | Create this document. |
| **B — Interceptor** | B1 | `auth.interceptor.ts` | **Pre-flight check:** grep `/cashregister/session` across `src/` to confirm no colliding endpoints (e.g., `/cashregister/sessions/all`). If collision found, refine pattern to a more anchored form. |
| | B2 | `auth.interceptor.ts` | Add two `if (url.includes(...))` guards inside `resolveBearerToken` BEFORE the existing mode switch, mirroring the FDD-019 `/redeem-link-code` block. |
| **C — Component TS** | C1 | `pos-header.component.ts` | Add `blockerTitle` and `blockerSubtitle` `computed()` signals next to `setupState` in the Session Blocker region. |
| **D — Template** | D1 | `pos-header.component.html` | Replace literal `"Caja Cerrada"` and `"Abre un turno..."` (lines 660-661) with `{{ blockerTitle() }}` and `{{ blockerSubtitle() }}`. Keep the `<h2>` and `<p>` elements in their current location (outside the switch). |
| **E — Verification** | E1 | n/a | `npm run lint`, `npm run build`, grep AC checks. |

> **Stop conditions:**
> - Lint or build regression in any touched file.
> - `'Caja Cerrada'` literal still present anywhere outside the `blockerTitle` signal definition.
> - User-JWT logic for `/by-device/` or `/cashregister/session` not removed.

---

## 6. Acceptance Criteria

| ID | Criterion | How to verify |
|---|---|---|
| **AC-1** | `/registers/by-device/{uuid}` requests carry the device JWT (or no Authorization when device JWT is missing — zero-fallback). | Static: read `auth.interceptor.ts` post-fix; verify the URL guard precedes the mode switch and uses the ternary `hasValidDeviceToken() ? getDeviceToken() : null`. Manual: DevTools → Network → decode the Authorization header on a `/by-device/` request. |
| **AC-2** | `/cashregister/session` requests carry the device JWT (zero-fallback). | Same as AC-1, applied to the second URL guard. |
| **AC-3** | UI header copy switches dynamically by `setupState()` per §3. | Static: read `pos-header.component.html` — no literal `"Caja Cerrada"` or `"Abre un turno..."` outside the new `computed` signals. Manual: open the blocker on a needs-linking flow, confirm header reads "Vincular Dispositivo". Force-link, confirm header transitions to "Caja Cerrada" before the user clicks "Abrir Turno". |
| **AC-4** | Zero-fallback integrity preserved — neither new override silently falls back to the user JWT when the device token is missing. | Static: both new branches use `hasValidDeviceToken() ? getDeviceToken() : null` exactly. |
| **AC-5** | Cold-boot completes without 403 errors on `/by-device/` and `/cashregister/session` when the device has a valid JWT. | Manual: DevTools → Network at first POS load with a freshly-activated device → both requests return 2xx. |
| **AC-6** | `npm run lint` and `npm run build` pass without new issues in touched files. | CI / local. |

---

**End of document.** Awaiting confirmation to proceed with **Phase B — Interceptor**.
