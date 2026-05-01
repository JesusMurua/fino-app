# FDD-019 — Auth Interceptor Override & UX Error Parity

> Sibling of FDD-017 / FDD-018. Closes the link-code redemption error loop and aligns error UX between Setup and PosHeader.
> **Status:** Draft — pending implementation approval.
> **Author:** Senior Angular Architect (Claude).
> **Date:** 2026-04-30.

---

## 0. Executive Summary

Three production issues confirmed by read-only audit:

1. **Infinite PIN loop on `/redeem-link-code` 401** — the cashier types a link-code, the backend rejects with 401 because the request carries the **user JWT** instead of the **device JWT** (the endpoint resolves the bound device server-side from the device JWT). The auth interceptor's `tap.error` handler then calls `authService.logout()` and redirects to `/pin`. The cashier re-PINs, sees the same blocker, retries, loops.

2. **Setup banner shows generic copy on backend 400** — `/device/activate` legitimately returns 400 for invalid/expired/already-redeemed codes, but `resolveActivationError` only special-cases 403 (plan quota). 400 falls through to a generic *"Código inválido o expirado."* that mixes activation-code semantics with link-code semantics.

3. **Admin Devices Activation Code generator lacks "Copy to clipboard"** — asymmetric with the link-code modal in `admin-registers`, which already has the copy-with-2s-feedback UX.

This document specifies surgical frontend changes to address all three:

- Make the auth interceptor URL-aware: route the device JWT specifically to `/redeem-link-code`, and exempt that route from the 401 → logout side-effect.
- Add status-specific branches (400, 401) in PosHeader's `handleRedeemError` and setup's `resolveActivationError`.
- Mirror the `admin-registers` copy-button UX in `admin-devices`.

**Out of scope:** backend status-code semantics. The 401 the backend returns when the device JWT is missing is technically correct from the server perspective; the frontend's job is to send the right token in the first place.

---

## 1. Interfaces / Models

No new interfaces. No model changes.

| File | Change |
|---|---|
| n/a | — |

---

## 2. Components & Files to Modify

| # | File | Type | Scope of change | Risk |
|---|---|---|---|---|
| 1 | [auth.interceptor.ts](../src/app/core/interceptors/auth.interceptor.ts) | Functional interceptor | (a) `resolveBearerToken` signature gains `url: string`. (b) Top-of-function priority guard for `/redeem-link-code` → device JWT (zero-fallback). (c) `tap.error` 401 branch gains `isRedeemRoute` exemption that scopes JUST around the `logout()` call (preserves the 402 handler). | Medium — auth-critical |
| 2 | [pos-header.component.ts](../src/app/modules/pos/components/pos-header/pos-header.component.ts) | Standalone component (TS) | `handleRedeemError` adds explicit branches for 400 and 401. | Low |
| 3 | [setup.component.ts](../src/app/modules/setup/setup.component.ts) | Standalone component (TS) | `resolveActivationError` adds explicit branch for 400. Banner UX preserved (no toast conversion). | Low |
| 4 | [admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts) | Standalone component (TS) | Add `lastCodeCopied = signal(false)` + `copyActivationCode(code)` method using `navigator.clipboard.writeText` and a 2000ms timeout. | Low |
| 5 | [admin-devices.component.html](../src/app/modules/admin/components/devices/admin-devices.component.html) | Standalone component (template) | Add the icon-toggle copy button next to `activation-code__value`, mirroring the structure used by `admin-registers.component.html` (BEM names adapted to `activation-code__copy` / `activation-code__copy--ok`). | Low |

---

## 3. State Management

| Component | Symbol | Type | Effect of change |
|---|---|---|---|
| `auth.interceptor.ts` | `resolveBearerToken` | `(configService, deviceService, url) => string \| null` | Pure function — no state. Adds URL inspection at the top. |
| `pos-header.component.ts` | `handleRedeemError` | `private (error: unknown) => void` | No new signals — the existing `messageService.add(...)` toast surface absorbs the new branches. |
| `setup.component.ts` | `resolveActivationError` | `private (error, fallback) => string` | No new signals — existing `error` signal and inline banner absorb the new branch. |
| `admin-devices.component.ts` | `lastCodeCopied` (NEW) | `WritableSignal<boolean>` | Drives the icon toggle on the copy button. Reset to `false` after 2000ms via `setTimeout`. |

---

## 4. Validations & UX

### 4.1 Interceptor — URL-aware token resolution

| Request URL contains | Token attached |
|---|---|
| `/api/auth/pin-login` or `/api/auth/email-login` (PUBLIC_PATHS) | None |
| `/redeem-link-code` (NEW priority) | `pos_device_token` if `hasValidDeviceToken()`, else `null` (zero-fallback — never user JWT) |
| Any other URL with `mode ∈ ['kitchen', 'kiosk', 'reception']` | `pos_device_token` (zero-fallback) |
| Any other URL with `mode ∈ ['cashier', 'tables']` or undefined | `pos_auth_token` (skipping `offline-session-*`) |

### 4.2 Interceptor — 401 logout exemption

| 401 source | Behavior |
|---|---|
| `PUBLIC_PATHS` (login endpoints) | No logout (already exempt) |
| Browser is currently on `PUBLIC_ROUTES` (`/setup`, `/login`, etc.) | No logout (already exempt) |
| Request URL is `/redeem-link-code` (NEW) | **No logout** — error propagates to caller's `catch` for toast |
| Anything else | `authService.logout()` → navigate to `/pin` (regression preserved) |

### 4.3 PosHeader — status-specific copy in `handleRedeemError`

| Status | Toast detail |
|---|---|
| 200 | (success path — out of `handleRedeemError` scope) |
| **400** (NEW) | `"Código mal escrito. Pídele al administrador que lo dicte de nuevo."` |
| **401** (NEW) | `"Autorización de dispositivo denegada. El código no corresponde a esta tablet."` |
| 403 (existing) | `"Este dispositivo no tiene permiso para redimir códigos."` |
| 404 (existing) | `"Código inválido o expirado. Pide un código nuevo al administrador."` |
| 409 (existing) | `"Este código ya fue usado. Pide uno nuevo al administrador."` |
| 0 (existing) | `"Sin conexión. Verifica tu red e intenta de nuevo."` |
| Other | `"No se pudo vincular. Intenta de nuevo."` (existing fallback) |

### 4.4 Setup — status-specific copy in `resolveActivationError`

| Status | Banner text |
|---|---|
| **400** (NEW) | `"Código de activación inválido."` |
| 403 (existing) | Surface backend `message` / `detail`, fallback `"Has alcanzado el límite de dispositivos de tu plan."` |
| Other | Caller-supplied fallback (typically `"Código inválido o expirado."`) |

### 4.5 Admin Devices — copy-to-clipboard parity

Mirrors [admin-registers.component.ts:497-504](../src/app/modules/admin/components/admin-registers/admin-registers.component.ts#L497-L504) and the surrounding HTML. New BEM classes:

- `activation-code__copy` — base class for the button (mirrors `link-code__copy`)
- `activation-code__copy--ok` — modifier when `lastCodeCopied()` is `true`

Icon toggle: `pi pi-copy` (default) ↔ `pi pi-check` (after click, for 2 seconds).

---

## 5. Implementation Order

| Phase | Step | File | Description |
|---|---|---|---|
| **A — Interceptor** (highest risk) | A1 | `auth.interceptor.ts` | Add `url: string` param to `resolveBearerToken`, propagate at callsite. |
| | A2 | `auth.interceptor.ts` | Inside `resolveBearerToken`, add `if (url.includes('/redeem-link-code'))` priority branch with zero-fallback. |
| | A3 | `auth.interceptor.ts` | Inside `tap.error` 401 branch, compute `isRedeemRoute` and combine with existing `isPublicRoute` to scope JUST the `logout()` call. |
| **B — Component error parity** | B1 | `pos-header.component.ts` | Add 400 and 401 branches in `handleRedeemError`. |
| | B2 | `setup.component.ts` | Add 400 branch in `resolveActivationError`. |
| **C — Admin Devices Copy UX** | C1 | `admin-devices.component.ts` | Add `lastCodeCopied` signal + `copyActivationCode` method. |
| | C2 | `admin-devices.component.html` | Add button next to `activation-code__value` with icon toggle. |
| **D — Verification** | D1 | n/a | `npm run lint` + `npm run build` + grep ACs. |

> **Stop conditions:** lint/build regression in any touched file; `/redeem-link-code` no longer carries the device JWT (AC-1); 401 elsewhere stops triggering logout (AC-3 regression).

---

## 6. Acceptance Criteria

| ID | Criterion | How to verify |
|---|---|---|
| **AC-1** | `/redeem-link-code` requests carry `pos_device_token` (zero-fallback if missing). | Static: read `auth.interceptor.ts` after fix; verify the URL guard precedes the `mode` switch. Manual: DevTools → Network → decode the Authorization JWT on a redeem request. |
| **AC-2** | A 401 from `/redeem-link-code` does NOT trigger navigation to `/pin`. | Manual smoke: force a 401 (e.g., expired link-code), confirm browser stays on POS surface and a toast appears. |
| **AC-3** | A 401 on any OTHER protected route still triggers `authService.logout()` (regression check). | Static: confirm the guard is `!isPublicRoute && !isRedeemRoute` — any 401 NOT on those exemptions still calls `logout()`. |
| **AC-4** | Setup banner shows `"Código de activación inválido."` for HTTP 400. | Manual: type a wrong code in `/setup`; banner copy. |
| **AC-5** | PosHeader toast shows specific messages for 400 and 401 (per §4.3). | Manual: trigger each status from the link-code blocker. |
| **AC-6** | Admin Devices generator shows the copy button with ✓ feedback for 2 seconds after click. | Manual: generate a code, click copy, observe icon swap and 2s reset. |
| **AC-7** | `npm run lint` and `npm run build` pass without new issues in touched files. | CI / local. |

---

**End of document.** Awaiting confirmation to proceed with **Phase A — Interceptor**.
