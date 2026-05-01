# FDD-022 — Rollback FDD-020 / FDD-021 (Restore Human Identity to Cash Register Endpoints)

> Reverts the interceptor URL overrides introduced in FDD-020 and FDD-021.
> Backend audit revealed those endpoints require human-role claims that
> device JWTs intentionally lack — forcing the device JWT guaranteed 403.
> **Status:** Draft — pending implementation approval.
> **Author:** Senior Angular Architect (Claude).
> **Date:** 2026-04-30.

> Supersedes: [FDD-020](FDD-020-identity-recovery-and-pos-ux.md), [FDD-021](FDD-021-hybrid-identity-fix.md)
> Preserves: [FDD-019](FDD-019-auth-interceptor-and-error-ux.md) `/redeem-link-code` override (still correct — that endpoint resolves the device server-side from the device JWT and does not require a human role).

---

## 0. Executive Summary

[FDD-020](FDD-020-identity-recovery-and-pos-ux.md) promoted `/registers/by-device/{uuid}` and `/cashregister/session` to **Device-Auth Priority** routes inside the auth interceptor, on the hypothesis that those endpoints resolve the target device server-side from the device JWT. The fix was meant to break a cold-boot 403 cascade observed when those endpoints carried the user JWT.

[FDD-021](FDD-021-hybrid-identity-fix.md) followed up with a "Device-First, User-Fallback" relaxation when the strict zero-fallback caused 401-loops for admins (who lack a device JWT entirely).

A subsequent backend audit revealed the **opposite policy**: those endpoints are protected by `[Authorize(Roles = "Owner,Manager,Cashier")]`, and **device JWTs intentionally omit role claims** to prevent role-impersonation attacks. The result: forcing the device JWT onto these routes guaranteed a 403 for both POS devices AND admins. FDD-020/021 were chasing the wrong contract.

This document **reverts the interceptor block (1)** to its FDD-019 form — only `/redeem-link-code` keeps the device-JWT override. All other endpoints fall back to the standard mode-based resolution, which sends the **user JWT** for cashier-mode devices and admin sessions. The user JWT carries role claims (`Cashier`, `Owner`, `Manager`), satisfying the backend's authorization policy.

**Why FDD-019 stays:** `/redeem-link-code` does NOT require a human role. The backend resolves the redeeming device strictly from the device JWT (binding caja → device). User JWT does not work there. FDD-019's contract is correct and unaffected by the audit.

---

## 1. Backend Contract Discovered

| Endpoint | Backend authorization | Frontend implication |
|---|---|---|
| `GET /api/cashregister/session` | `[Authorize(Roles = "Owner,Manager,Cashier")]` | Must send a **user JWT** with `role` claim ∈ {Owner, Manager, Cashier}. Device JWT → 403. |
| `GET /api/cashregister/registers/by-device/{uuid}` | `[Authorize(Roles = "Owner,Manager,Cashier")]` | Idem above. Device JWT → 403. |
| `POST /api/cashregister/session/open`, `POST /api/cashregister/session/close` | `[Authorize(Roles = "Owner,Manager,Cashier")]` (inferred — same surface) | Idem. |
| `POST /api/cashregister/registers/redeem-link-code` | Resolves device server-side from device JWT (no role check) | Must send **device JWT**. User JWT does not work. |

### Why device JWTs lack role claims (architectural principle)

Device JWTs are issued at activation time and tied to a `deviceUuid` + `tenantId`. They are intentionally restricted to:

- `typ: 'device'`
- `mode: 'cashier' | 'tables' | 'kitchen' | 'kiosk' | 'reception'`
- `tenantId`, `branchId`, plan and feature claims

They **do not carry** `role`, `userId`, `username`, or any human-identity claim. This is by design — a device should never be able to act as a specific human (e.g., approve a void with manager-level authority just because it's plugged in to the manager's WiFi). Role-bound operations always require a human-authenticated user JWT.

The misread in FDD-020 was assuming "device-scoped" implied "device-JWT-authenticated". Some endpoints ARE that way (`/redeem-link-code`), but `/cashregister/session` queries are role-bound human operations even though they're scoped to a device's branch or register.

---

## 2. Components Reverted

| # | File | Type | Scope of change |
|---|---|---|---|
| 1 | [auth.interceptor.ts](../src/app/core/interceptors/auth.interceptor.ts) | Functional interceptor | Bloque (1) de `resolveBearerToken` revertido a la forma de FDD-019. Sólo `/redeem-link-code` permanece con device-JWT override (zero-fallback). El OR-chain de FDD-020 y el if-form device-first/user-fallback de FDD-021 se eliminan. JSDoc del bloque (1) se restaura a su estado pre-FDD-020. Bloques (2) y (3) intactos. |

### Componentes que NO se revierten

| File | Status | Razón |
|---|---|---|
| [pos-header.component.ts](../src/app/modules/pos/components/pos-header/pos-header.component.ts) — `blockerTitle` / `blockerSubtitle` computed signals | **Preservado** | Mejora UX ortogonal al auth — resuelve la disonancia visual original ("Caja Cerrada" mientras el body pedía código). Sigue siendo correcto independientemente del rollback de auth. |
| [pos-header.component.html](../src/app/modules/pos/components/pos-header/pos-header.component.html) — bindings dinámicos en `<h2>` y `<p>` del session-blocker | **Preservado** | Idem — sólo refleja los signals computed que siguen vigentes. |
| `tap.error` 401 guard (FDD-019, `!isPublicRoute && !isRedeemRoute`) | **Preservado** | Sigue siendo correcto para `/redeem-link-code` que es lo único en el override post-rollback. |
| FDD-018 `secure-alphabet.utils.ts` y todos los consumers | **Preservado** | Independiente — no toca auth. |

---

## 3. Side Effects Considered

### Comportamiento esperado post-rollback

| Contexto | Endpoint | Token enviado | Resultado esperado |
|---|---|---|---|
| Cashier post-PIN en POS | `/cashregister/session` | User JWT (block 3, role: Cashier) | ✅ 200 — cierra el loop "Caja Cerrada" |
| Cashier post-PIN en POS | `/registers/by-device/{uuid}` | User JWT (block 3, role: Cashier) | ✅ 200 — `linkedRegister` se hidrata correctamente |
| Cashier en blocker `needsLinking` | `/redeem-link-code` | Device JWT (FDD-019 override, zero-fallback) | ✅ 200 — flow de redeem intacto |
| Admin en backoffice | `/cashregister/session?registerId=X` | User JWT (block 3, role: Owner/Manager) | ✅ 200 — admin flow restaurado, sin loop a `/pin` |
| Kitchen / Kiosk / Reception | Cualquiera | Device JWT (block 2 DEVICE_TOKEN_MODES, zero-fallback) | Igual que pre-FDD-020 |

### Pendientes que NO resuelve este rollback

| Síntoma observado en screenshots | Estado post-rollback |
|---|---|
| `GET /api/orders/last-number` → 403 | ⚠️ Sigue 403 — endpoint con role policy distinto, fuera de scope. |
| `GET /api/auth/employee-hashes?branchId=36` → 404 | ⚠️ Sigue 404 — recurso no existe, fuera de scope. |
| `POST /api/device/activate` → 400 en `/setup` | ⚠️ Sigue 400 — bug independiente del flow de auth, fuera de scope. |

Estos son problemas separados que requieren su propia investigación (probablemente backend role-policy o data-state).

---

## 4. Implementation Order

| Phase | Step | File | Description |
|---|---|---|---|
| **B — Historical cleanup** | B1 | `docs/FDD-020-...md` | Cambiar `Status:` a "Superseded by FDD-022" con la frase explicativa del backend audit. |
| | B2 | `docs/FDD-021-...md` | Mismo cambio de status. |
| **A — Doc** | A1 | `docs/FDD-022-...md` (NEW) | Crear este documento. |
| **C — Code rollback** | C1 | `auth.interceptor.ts` | Revertir bloque (1) de `resolveBearerToken`: dejar sólo `if (url.includes('/redeem-link-code'))` con ternary `hasValidDeviceToken() ? getDeviceToken() : null`. Limpiar comentarios FDD-020/021. Restaurar JSDoc al estado pre-FDD-020. |
| **D — Verification** | D1 | n/a | `npm run lint`, `npm run build`, grep estático para confirmar que `/registers/by-device/` y `/cashregister/session` NO aparecen en `auth.interceptor.ts`. |

> **Stop conditions:**
> - Lint o build regression en `auth.interceptor.ts`.
> - Grep encuentra `/registers/by-device/` o `/cashregister/session` dentro del interceptor.
> - El bloque (2) DEVICE_TOKEN_MODES o el `tap.error` 401 guard cambian de comportamiento.

---

## 5. Acceptance Criteria

| ID | Criterion | How to verify |
|---|---|---|
| **AC-1** | Cashier post-PIN no entra en loop. `/cashregister/session` carga el user JWT del cashier (role: Cashier) y el backend responde 200. | Manual smoke: PIN login en device cashier → debería navegar a `/pos/quick` con `_activeSession` y `_linkedRegister` poblados. NO loop a `/pin`. DevTools Network: el Authorization en `/cashregister/session` decodifica como user JWT con claim `role: 'Cashier'`. |
| **AC-2** | Admin en backoffice sigue funcionando. User JWT del admin (role: Owner/Manager) viaja a estos endpoints. | Manual smoke: admin → `/admin/registers` → click cambiar device → modal abre, request a `/cashregister/session?registerId=X` retorna 200. |
| **AC-3** | `/redeem-link-code` mantiene zero-fallback strict con device JWT. | Static: `auth.interceptor.ts` post-rollback contiene exactamente `if (url.includes('/redeem-link-code')) { return deviceService.hasValidDeviceToken() ? deviceService.getDeviceToken() : null; }`. |
| **AC-4** | `npm run lint` y `npm run build` pasan sin nuevos issues. | CI / local. |
| **AC-5** | Strings `/registers/by-device/` y `/cashregister/session` NO existen en `auth.interceptor.ts`. | `grep -n "/registers/by-device/\|/cashregister/session" src/app/core/interceptors/auth.interceptor.ts` retorna 0 matches. |

---

**End of document.** Awaiting confirmation to proceed with **Phase C — Interceptor rollback**.
