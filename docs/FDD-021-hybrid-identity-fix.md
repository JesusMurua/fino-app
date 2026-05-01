# FDD-021 — Hybrid Identity Fix (Admin Context Restored)

> Hot-fix para regresión introducida por FDD-020. Relaja la política
> zero-fallback para los 3 URL patterns en el bloque (1) del interceptor,
> permitiendo que el flujo de Admin (sin device JWT) caiga al user JWT
> en lugar de quedarse sin Authorization.
> **Status:** Superseded by [FDD-022](FDD-022-rollback-device-auth.md) — backend audit revealed that the targeted endpoints require human role claims that device JWTs intentionally lack. The interceptor overrides were rolled back.
> **Author:** Senior Angular Architect (Claude).
> **Date:** 2026-04-30.

---

## 0. Executive Summary

[FDD-020](FDD-020-identity-recovery-and-pos-ux.md) introdujo una política **zero-fallback estricta** para 3 endpoints (`/redeem-link-code`, `/registers/by-device/`, `/cashregister/session`): si el device JWT no estaba disponible, el interceptor retornaba `null` para forzar un 401 limpio que indicara "device sin identidad, debe re-provisionarse".

**El supuesto era:** sólo cashiers/POS llaman a esos endpoints, y un cashier sin device JWT está roto.

**El supuesto era incorrecto.** El back-office Admin UI (`admin-registers.component.ts:415`) también llama a `/cashregister/session?registerId=X` para verificar si una caja tiene sesión abierta antes de cambiar su device. El admin **no tiene device JWT** (es un humano en un browser, sin activar el equipo), por lo que el interceptor lo deja sin Authorization → 401 → `tap.error` → `authService.logout()` → redirect a `/pin`. Loop.

Este FDD relaja la política para los 3 patterns: **device JWT cuando está disponible (cashier flow preservado), user JWT como fallback (admin flow restaurado).** El bloque (2) `DEVICE_TOKEN_MODES` (kitchen / kiosk / reception) permanece estrictamente zero-fallback — ningún cambio ahí.

---

## 1. Components to Modify

| # | File | Type | Scope of change | Risk |
|---|---|---|---|---|
| 1 | [auth.interceptor.ts](../src/app/core/interceptors/auth.interceptor.ts) | Functional interceptor | Sólo el bloque (1) de `resolveBearerToken`. Reemplazar el `return null` cuando `hasValidDeviceToken()` es false por un fall-through implícito que deja al request bajar al bloque (2) y luego al (3) (user JWT). Bloque (2) y `tap.error` 401 guard permanecen idénticos. | Medium — auth-critical |

---

## 2. State Management

No hay signals nuevos. La función `resolveBearerToken` es pura (no muta estado). Cambia sólo el branching dentro del bloque (1).

---

## 3. Behavior Change Table

### 3.1 Comportamiento por contexto

| Contexto del usuario | Pre-FDD-021 | Post-FDD-021 |
|---|---|---|
| **Admin en backoffice** consulta `/cashregister/session?registerId=X` | `null` → 401 → `logout()` → `/pin` 🔴 | **User JWT del admin** → backend acepta → 200 ✅ |
| **Cashier en POS** consulta `/cashregister/session` con device JWT vigente | Device JWT → 200 ✅ | Device JWT → 200 ✅ (sin cambio) |
| **Cashier** redime `/redeem-link-code` con device JWT vigente | Device JWT → 200 ✅ | Device JWT → 200 ✅ (sin cambio) |
| **Cashier** consulta `/registers/by-device/{uuid}` con device JWT vigente | Device JWT → 200 ✅ | Device JWT → 200 ✅ (sin cambio) |
| **Cashier en POS sin device JWT (expirado/missing)** ⚠️ | `null` → 401 → `logout()` → `/pin` (force re-provisión) | **User JWT del cashier** → comportamiento depende del backend (ver §3.2) |
| **Kitchen / Kiosk / Reception** sin device JWT vigente | `null` (zero-fallback estricto del bloque 2) | `null` (sin cambio — bloque 2 no se toca) |
| **Setup screen** (no llega a estos endpoints) | n/a | n/a |

### 3.2 Trade-off explícito: cashier con device JWT expirado / missing

**Esto es lo más importante de revisar antes de implementar:**

| Sub-escenario | Resultado |
|---|---|
| Cashier sin device JWT envía user JWT a `/cashregister/session` y el backend resuelve la sesión por user-id | ⚠️ El cashier puede ver una sesión que NO corresponde a su tablet (mismatch tablet-vs-sesión) |
| Cashier sin device JWT envía user JWT y el backend rechaza con 403 | El catch silencioso de `getRegisterByDevice` cae al fallback de Dexie (cache local). UI sigue funcionando con state stale, sin loop, sin redirect. |
| Cashier sin device JWT envía user JWT y el backend devuelve 401 | `tap.error` → `logout()` → `/pin` (igual que pre-FDD-021, no hay regresión adicional) |

**Aceptamos este trade-off** porque:

1. El cashier flow normal **siempre tiene device JWT vigente** — el device JWT se persiste en activación y vive con TTL largo. Un cashier en operación nunca llega a este sub-escenario.
2. Si el device JWT expira realmente, el flow correcto es re-provisionar — pero forzarlo vía `/pin` loop (FDD-020) bloqueaba al admin sin solución. El admin necesita acceso prioritario.
3. El JSDoc original de FDD-020 advertía sobre *"a misleading user JWT that would resolve to the wrong device server-side"*. Reconocemos esa garantía está relajada en este sub-escenario, pero limitada al cashier con device-token-roto (caso de excepción, no operación normal).

### 3.3 Lo que NO cambia

- **Bloque (2) DEVICE_TOKEN_MODES** (kitchen / kiosk / reception): permanece estrictamente zero-fallback. Esos modos nunca tocan user JWT.
- **`tap.error` 401 guard**: idéntico (`!isPublicRoute && !isRedeemRoute`). Un 401 real seguirá disparando `logout()` excepto en `/redeem-link-code` (eximido por FDD-019).
- **Lista de URL patterns**: los 3 patterns existentes (`/redeem-link-code`, `/registers/by-device/`, `/cashregister/session`) permanecen. No se agregan ni remueven.

---

## 4. Implementation Order

| Phase | Step | File | Description |
|---|---|---|---|
| **A — Doc** | A1 | `docs/FDD-021-hybrid-identity-fix.md` (NEW) | Crear este documento. |
| **B — Interceptor** | B1 | `auth.interceptor.ts` | En el bloque (1) de `resolveBearerToken`, reemplazar el ternary `hasValidDeviceToken() ? getDeviceToken() : null` por un `if (hasValidDeviceToken()) return getDeviceToken();` sin else, dejando que la ejecución caiga al bloque (2) y luego al (3) si no hay device JWT. Añadir comentario expandido explicando el cambio. |
| **C — Verificación** | C1 | n/a | `npm run lint`, `npm run build`, grep estático para verificar bloque (2) y `tap.error` 401 intactos. |

> **Stop conditions:**
> - Lint o build regression en `auth.interceptor.ts`.
> - El bloque (2) DEVICE_TOKEN_MODES cambia de comportamiento (debe permanecer estrictamente zero-fallback).
> - El `tap.error` 401 guard cambia (debe permanecer idéntico).

---

## 5. Acceptance Criteria

| ID | Criterion | How to verify |
|---|---|---|
| **AC-1** | Admin desde `/admin/registers` puede abrir el modal de cambio de device sin redirect a `/pin`. | Manual smoke: login email → admin/registers → click cambiar device en una caja → verificar que el modal se abre y NO hay navegación a `/pin`. |
| **AC-2** | Cashier en POS sigue enviando device JWT a `/cashregister/session` cuando tiene device token válido. | Manual: DevTools Network sobre un cashier activo → request a `/cashregister/session` → decodificar Authorization → JWT con claim `type: 'device'`. |
| **AC-3** | El bloque (2) `DEVICE_TOKEN_MODES` permanece estrictamente zero-fallback. | Static: `git diff` muestra cambios SÓLO dentro del bloque (1); el `if (DEVICE_TOKEN_MODES.includes(mode)) { return ... ? ... : null }` no se modifica. |
| **AC-4** | El `tap.error` 401 guard permanece idéntico. | Static: `git diff` no muestra cambios en el bloque `error: (error) => { if (error.status === 401 ...) }`. |
| **AC-5** | `npm run lint` y `npm run build` pasan sin nuevos issues en `auth.interceptor.ts`. | CI / local. |

---

**End of document.** Awaiting confirmation to proceed with **Phase B — Interceptor**.
