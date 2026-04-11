# AUDIT-025: Device Binding & Shift-Session Gating (Role-Aware UX)

**Date:** 2026-04-11
**Scope:** Post-login redirect, device-config interception, cash-register session gating, cash-register component tech debt
**Goal:** Validar que el flujo intercepta al *usuario operativo* (Cajero) en el POS y NUNCA al Owner/Manager cuando se dirige al Back Office.

---

## 1. Respuestas a las cuatro preguntas

### 1.1 Post-Login Redirect — ¿A dónde va cada rol?

**Source of truth:** [device-routing.service.ts:29-49](src/app/core/services/device-routing.service.ts#L29-L49)

```
Owner   → /admin                    (ignora deviceMode — correcto)
Manager → /admin                    (ignora deviceMode — correcto)
Kitchen → /kitchen                  (ignora deviceMode)
Host    → /tables                   (ignora deviceMode)
Waiter  → deviceMode === 'tables' ? /tables : /pos[-variant]
Cashier → deviceMode === 'tables' ? /tables
         : deviceMode === 'kitchen' ? /kitchen
         : /pos[-variant] (Restaurant/Retail/Counter/Quick según posExperience)
```

**Callers del servicio:**

| Archivo | Línea | Contexto |
|---|---|---|
| [pin.component.ts:188](src/app/modules/pin/pin.component.ts#L188) | `deviceRoutingService.getPostLoginRoute(result.user.roleId)` | Post-PIN login — si `returnUrl` no está seteado |
| [login.component.ts:51](src/app/modules/login/login.component.ts#L51) | `deviceRoutingService.getPostLoginRoute(user.roleId)` | Post-email login — mismo patrón |
| [onboarding.component.ts:661](src/app/modules/onboarding/onboarding.component.ts#L661) | `this.router.navigate([this.isOwnerOrManager() ? '/admin' : '/pin'])` | Post-onboarding — **no usa el service**, navega literal |

**Hallazgo clave:** la lógica de "Owner → /admin" existe y es correcta en `DeviceRoutingService`, pero el onboarding component **no delega al service** — replica la decisión con un ternario inline. Dos fuentes de verdad para la misma regla. Si mañana cambias la regla en `DeviceRoutingService`, onboarding no se entera.

### 1.2 Device Gating — ¿El Admin llega directo al dashboard?

**Respuesta corta:** **No.** El `authGuard` intercepta a TODO rol (incluyendo Owner/Manager) si el `localStorage` del dispositivo no tiene `businessId` / `branchId`.

**Source of truth:** [auth.guard.ts:29-45](src/app/core/guards/auth.guard.ts#L29-L45)

```typescript
// 1. Authentication check
if (!authService.isAuthenticated()) → redirect /pin
// 2. Onboarding check
if (!authService.isOnboardingComplete()) → redirect /onboarding
// 3. Device configuration check  ⚠️  AQUÍ SE ROMPE LA UX
if (!configService.isDeviceConfigured()) → redirect /setup
// 4. Role check
if (role not in allowedRoles) → redirect /pin
```

El step 3 **NO discrimina por rol**. Para cualquier ruta protegida (incluyendo `/admin`), si `localStorage['pos-device-config']` no tiene `businessId > 0 && branchId > 0`, el guard redirige a `/setup` — sin importar si el user es un Owner que solo quiere abrir el back office.

**¿Cuándo se dispara esto en la práctica?**

| Escenario | `isDeviceConfigured()` | ¿Owner intercepted? |
|---|---|---|
| Owner recién terminó onboarding (3 pasos) | ✓ (onboarding guarda `mode: 'admin'` al final) | **No** — flujo OK |
| Owner loguea en **nueva tab / nuevo browser / nuevo device** | ✗ (localStorage vacío) | **Sí — bug de UX** |
| Owner limpió caché del navegador | ✗ | **Sí — bug de UX** |
| Owner en modo incógnito | ✗ | **Sí — bug de UX** |
| Cashier en device recién sacado de la caja | ✗ | ✓ — comportamiento deseable |

**El onboarding SÍ intenta resolver esto** al final: [onboarding.component.ts:627-642](src/app/modules/onboarding/onboarding.component.ts#L627-L642) guarda silenciosamente un `DeviceConfig` con `mode: 'admin'` para Owners/Managers, de modo que la próxima navegación el guard no intercepte. Pero solo funciona **una vez** — en el device donde se completó el onboarding. Cualquier otro device del mismo Owner vuelve a caer en step 3.

**Otra observación:** `DeviceConfig.mode` incluye `'admin'` como valor válido ([device-config.model.ts:15](src/app/core/models/device-config.model.ts#L15)), pero `DeviceRoutingService` nunca lo revisa — solo lo usa el flag del onboarding. El `'admin'` mode no está cumpliendo el rol de "marcar este device como dashboard-only", solo existe como etiqueta cosmética.

**Conclusión:** la lógica para *omitir* el device gating para Owner/Manager no existe en ningún guard. El bug de UX es real en los escenarios enumerados arriba.

### 1.3 Shift Gating — ¿Cómo bloqueamos al Cajero sin turno abierto?

**Respuesta corta:** con una combinación de tres capas, todas efectivas pero ninguna a nivel de ruta. El blocker real es un **full-screen overlay** en el header del POS.

#### Capa A — Full-screen overlay en el `pos-header`

[pos-header.component.ts:545-570](src/app/modules/pos/components/pos-header/pos-header.component.ts#L545-L570)

```typescript
readonly showSessionBlocker = computed(() => !this.cashRegisterService.hasOpenSession());

readonly setupState = computed<'loading' | 'needsLinking' | 'needsOpening' | 'isOpen'>(() => {
  if (this.isLinkingDevice() || this.isOpeningSession()) return 'loading';
  if (this.cashRegisterService.hasOpenSession()) return 'isOpen';
  if (!this.linkedRegister()) return 'needsLinking';
  return 'needsOpening';
});
```

[pos-header.component.html:552-630](src/app/modules/pos/components/pos-header/pos-header.component.html#L552-L630) renderiza un `<div class="session-blocker">` con `@switch(setupState())`:

- `'needsLinking'` → botón "Vincular caja" (solo visible a Owner/Manager via `canSelfLink()`)
- `'needsOpening'` → formulario "Abrir turno" con inputNumber
- `'isOpen'` → overlay se oculta (no renderiza)
- `'loading'` → spinner

**Limitación:** este overlay vive dentro del `pos-header` component. Si el usuario navega a una sub-ruta del POS que **no incluye el header** (ej. una ruta directa que renderice solo el checkout), el overlay no se monta. No verifiqué exhaustivamente que todas las rutas `/pos/**` renderizen el header — ese es un punto que debe validarse.

#### Capa B — Toast + return early en los botones de acción

[cart-panel.component.ts:138, 147, 250](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L250)

```typescript
onSendToKitchen() {
  if (!this.requireOpenSession()) return;   // línea 138
  ...
}

onCheckout() {
  if (!this.requireOpenSession()) return;   // línea 147
  ...
}

private requireOpenSession(): boolean {
  return this.cashRegisterService.requireOpenSession();  // línea 251
}
```

[checkout.component.ts:283, 600, 733](src/app/modules/pos/components/checkout/checkout.component.ts#L600)

```typescript
readonly sessionBlocked = computed(() => !this.cashRegisterService.hasOpenSession());
// ...
onConfirmPayment() {
  if (!this.requireOpenSession()) return;  // línea 600
  ...
}
private requireOpenSession(): boolean {
  return this.cashRegisterService.requireOpenSession();  // línea 734
}
```

El helper centralizado vive en el service:

[cash-register.service.ts:137-147](src/app/core/services/cash-register.service.ts#L137-L147)

```typescript
requireOpenSession(): boolean {
  if (this.hasOpenSession()) return true;
  this.messageService.add({
    severity: 'warn',
    summary: 'Apertura de caja requerida',
    detail: 'Debes abrir un turno de caja para procesar órdenes.',
    life: 5000,
  });
  return false;
}
```

**Esto es bueno** — FDD-002 ya está implementado: existe un único helper reutilizable, llamado desde cart-panel, checkout, y el signal `sessionBlocked` deshabilita botones en el template. Inyección de `cashRegisterSessionId` en el payload de `Order` también está hecha (según el FDD, no re-verifiqué en este audit).

#### Capa C — Banner informativo permanente

[pos-header.component.html:138-144](src/app/modules/pos/components/pos-header/pos-header.component.html#L138-L144)

```html
@if (!cashRegisterService.hasOpenSession()) {
  <div class="pos-header__no-session" role="alert">
    <i class="pi pi-exclamation-triangle"></i>
    <span>Sin turno de caja — ve al Back Office para abrir uno</span>
  </div>
}
```

**Redundante con el overlay**: si el `showSessionBlocker` overlay ya cubre toda la pantalla, este banner nunca debería ser visible porque el overlay está encima. Probablemente sea deuda previa a FDD-002 que no se limpió.

#### ¿Hay guard de ruta?

**No.** No existe un `cashSessionGuard` que bloquee `/pos/**` cuando no hay sesión abierta. El bloqueo vive en el view layer del componente, no en el router. Un cajero puede *navegar* libremente a `/pos`, `/pos/checkout`, etc. — solo que ve el overlay encima de cualquier contenido.

**Implicación arquitectónica:** si mañana queremos permitir que el cajero **vea los productos** (para consultar precios) pero **no pueda enviar a cocina** sin turno, el modelo actual es incorrecto — el overlay cubre todo. Si queremos permitir vista sin acciones, hay que mover el bloqueo a nivel de botón (capa B ya existe) y quitar el overlay (capa A).

### 1.4 Cash Register Errors — Deuda técnica en `cash-register.component.ts`

**TypeScript strict check:** `tsc --noEmit -p tsconfig.app.json` pasa limpio (exit 0) sobre este archivo. No hay errores de tipado.

**Lint errors y warnings (ng lint):**

[cash-register.component.ts](src/app/modules/admin/components/cash-register/cash-register.component.ts)

| Línea | Regla | Severidad | Detalle |
|---|---|---|---|
| 20 | `@typescript-eslint/no-unused-vars` | **error** | `CASH_MOVEMENT_TYPE_CLASSES` importado pero nunca usado |
| 89 | `max-len` | warning | Línea de 165 chars (límite 140) — primer item de `movementTypes` array |
| 90 | `max-len` | warning | Línea de 151 chars — segundo item |
| 91 | `max-len` | warning | Línea de 158 chars — tercer item |

[cash-register.component.html](src/app/modules/admin/components/cash-register/cash-register.component.html)

| Línea | Regla | Severidad | Detalle |
|---|---|---|---|
| 388 | `@angular-eslint/template/eqeqeq` | **error** | `s.countedAmountCents != null` — debería ser `!==` |
| 390 | `@angular-eslint/template/eqeqeq` | **error** | `s.countedAmountCents != null && ...` — debería ser `!==` |

**Otros olores detectados (no lintables pero sí deuda):**

1. **Source of truth duplicado.** El componente mantiene su PROPIO signal `currentSession` ([línea 60](src/app/modules/admin/components/cash-register/cash-register.component.ts#L60)) que duplica `CashRegisterService.activeSession()`. Los dos se sincronizan manualmente en `loadSession()`, `openSession()`, `closeSession()`. Si otro componente (el overlay del pos-header) abre la sesión, este component no se entera hasta el próximo `loadSession()`.

2. **`openAmount`, `closeAmount`, `closeNotes`, `movementAmount`, `movementDescription`** son propiedades mutables sin type annotation explícito ni `signal()`. Rompen el patrón de signals del resto del proyecto. No causan error de tipado pero van contra el coding standard.

3. **`loadCashSales()` lee órdenes desde Dexie filtrando por `createdAt >= todayStart`** ([línea 320-333](src/app/modules/admin/components/cash-register/cash-register.component.ts#L320-L333)). No considera timezone — si el usuario cambia de día mientras la sesión está abierta, los cálculos se parten por la mitad. Edge case menor pero real.

4. **`onCloseSession()` valida órdenes no pagadas** ([línea 188-207](src/app/modules/admin/components/cash-register/cash-register.component.ts#L188-L207)) con un `filter` + `toArray()` que carga toda la tabla `orders` de Dexie. En un branch con 10k+ órdenes/día esto se vuelve lento. Debería usar un índice compuesto.

5. **No hay subscription/effect que reaccione a cambios remotos**. El polling de 3 minutos de `CashRegisterService.startPolling` actualiza el signal del service, pero este componente no escucha ese signal — mantiene su propia copia stale.

6. **`openSession()` pasa el `branchId` como primer argumento** ([línea 166](src/app/modules/admin/components/cash-register/cash-register.component.ts#L166)) pero el service [cash-register.service.ts:183](src/app/core/services/cash-register.service.ts#L183) internamente **ignora ese parámetro** y usa `this._linkedRegister()?.id`. El parámetro `branchId` de la firma del service es vestigial — confuso para quien lee el código.

---

## 2. Matriz de interceptación por rol (estado actual)

| Escenario | Owner login | Cashier login |
|---|---|---|
| Device ya configurado, onboarding completo | ✓ va a /admin | ✓ va a /pos (overlay se activa si no hay sesión) |
| Device sin configurar, onboarding completo | ⚠️ **intercepted → /setup** | ⚠️ intercepted → /setup (deseable) |
| Onboarding pendiente | /onboarding (correcto) | /onboarding |
| Device configurado, sesión abierta | /admin | /pos sin overlay |
| Device configurado, sin sesión | /admin (correcto) | /pos con overlay bloqueador |
| Tab nueva / incógnito / cache limpia (Owner) | ⚠️ **intercepted → /setup** | N/A (cashier usa PIN, no email) |
| Navegación directa a `/pos/checkout` sin sesión | — | overlay del header bloquea; si header no monta, cae al toast de capa B |

**Celdas marcadas con ⚠️**: los dos casos donde el Owner es interceptado por `authGuard` step 3 aunque la nueva regla de UX dice que no debe serlo.

---

## 3. Gap summary

| ID | Severidad | Título | Ubicación |
|---|---|---|---|
| G1 | **Alta** | `authGuard` step 3 intercepta Owner/Manager en `/admin` cuando el device no está configurado | [auth.guard.ts:35-37](src/app/core/guards/auth.guard.ts#L35-L37) |
| G2 | Media | Duplicación de decisión "Owner → /admin" entre `DeviceRoutingService` y `onboarding.component.ts:661` | [onboarding.component.ts:661](src/app/modules/onboarding/onboarding.component.ts#L661) |
| G3 | Media | `DeviceConfig.mode === 'admin'` existe pero no se consume en ningún guard — semántica huérfana | [device-config.model.ts:15](src/app/core/models/device-config.model.ts#L15) |
| G4 | Media | Shift gating vive en `pos-header.component` (view layer), no en un guard de ruta — acoplamiento frágil si el header no monta | [pos-header.component.html:552](src/app/modules/pos/components/pos-header/pos-header.component.html#L552) |
| G5 | Baja | Banner "Sin turno de caja" coexiste con el overlay full-screen — nunca se ve | [pos-header.component.html:138-144](src/app/modules/pos/components/pos-header/pos-header.component.html#L138-L144) |
| G6 | Baja | `cash-register.component.ts` duplica el signal de la sesión con el service → stale reads | [cash-register.component.ts:60](src/app/modules/admin/components/cash-register/cash-register.component.ts#L60) |
| G7 | Baja | Import no usado `CASH_MOVEMENT_TYPE_CLASSES` | [cash-register.component.ts:20](src/app/modules/admin/components/cash-register/cash-register.component.ts#L20) |
| G8 | Baja | 2 errores `eqeqeq` (`!=` → `!==`) en el template de history | [cash-register.component.html:388, 390](src/app/modules/admin/components/cash-register/cash-register.component.html#L388) |
| G9 | Baja | 3 warnings `max-len` en el array `movementTypes` (165/151/158 chars) | [cash-register.component.ts:89-91](src/app/modules/admin/components/cash-register/cash-register.component.ts#L89-L91) |
| G10 | Baja | `branchId` parameter vestigial en `openSession/closeSession/getOpenSession/getHistory` — el service usa `linkedRegister.id` internamente | [cash-register.service.ts:183](src/app/core/services/cash-register.service.ts#L183) |

---

## 4. Observaciones arquitectónicas

### 4.1 El auto-recovery silencioso ya resuelve la mitad del problema del Cashier

[cash-register.service.ts:87-104](src/app/core/services/cash-register.service.ts#L87-L104) — el service tiene un `effect()` que, en cuanto el user queda autenticado, busca el register linkeado a `deviceUuid` y refresca la sesión. Esto evita que el overlay de `needsLinking` se muestre incorrectamente cuando el backend ya tiene el register asignado.

Este patrón funciona bien para el Cashier. Pero para el Owner, el service corre aunque el owner ni siquiera vaya al POS — es trabajo desperdiciado. Ideal: `hasAttemptedRecovery` se active solo si el role actual es operativo (Cashier/Waiter/Kitchen), no para Owner/Manager.

### 4.2 El state machine `setupState` está bien diseñado

`'loading' | 'needsLinking' | 'needsOpening' | 'isOpen'` es un state machine limpio, mutually exclusive, y el template usa `@switch` sobre él. Esta parte NO necesita refactor — es el "corazón" del flow del Cashier y funciona.

### 4.3 El bug clave no es en el POS — es en `authGuard`

Todo el análisis apunta al mismo lugar: el único cambio crítico que resuelve la UX del Owner es hacer que el `authGuard` **no corra el device check para Owner/Manager cuando la ruta es `/admin` (o cualquier sub-ruta de admin)**. Las otras capas (pos overlay, cart-panel guards, service recovery) ya están bien.

### 4.4 `'admin'` como device mode — una convención que no se enforza

El onboarding guarda `mode: 'admin'` para Owners ([onboarding.component.ts:628-630](src/app/modules/onboarding/onboarding.component.ts#L628-L630)) pero ningún guard lo verifica, y `DeviceRoutingService` no lo usa. Es una etiqueta muerta. Tiene potencial: un `'admin'` mode podría significar "este device es solo back office, no debe mostrar overlay de sesión", pero hoy no lo significa.

---

## 5. Preguntas abiertas antes de proponer solución

1. **¿El Owner necesita siquiera un `DeviceConfig` en localStorage?** Si el back office no depende de device mode / branch linkage, podríamos omitir el check para roles Owner/Manager por completo.
2. **¿Qué pasa cuando un Owner abre el POS (`/pos`) sin turno?** ¿Debe ver el overlay "Vincular caja" con el botón `canSelfLink`, o debe ver un mensaje distinto tipo "solo los cajeros pueden abrir turnos"?
3. **¿El Cashier debe poder ver el catálogo sin turno abierto?** Si la respuesta es sí, el overlay full-screen debe convertirse en un disabled state por-botón. Si es no, podemos añadir un `cashSessionGuard` al router para bloqueo puro.
4. **¿El onboarding debe dejar de duplicar la decisión de routing post-completion?** Migrar [onboarding.component.ts:661](src/app/modules/onboarding/onboarding.component.ts#L661) para usar `DeviceRoutingService.getPostLoginRoute()` es una simplificación obvia.
5. **¿El `'admin'` mode debe quedarse como etiqueta o debe tener semántica real?** Si le damos semántica, `authGuard` puede saltarse el device check cuando el mode ya sea `'admin'`. Si no, deberíamos eliminarlo del enum.
6. **¿Los 2 errores de lint en `cash-register.component.html` (`!=` → `!==`)** son bloqueantes para un refactor en este ciclo o los dejamos para un commit de limpieza separado?
7. **¿Refactorizamos `cash-register.component.ts` para consumir `CashRegisterService.activeSession()` directamente** (eliminando el `currentSession` local)? Es un refactor de ~15 líneas pero toca el flow de dialogs — hay que validar no introducir regresiones.

---

## 6. Próximo paso

**Esperando confirmación.** Mi recomendación inicial, en cuanto tenga respuestas a §5:

1. **Fix P0 (G1):** Introducir un helper `isBackOfficeRole(roleId): boolean` + condición en `authGuard` step 3. Cuando el rol es Owner/Manager y la ruta empieza con `/admin`, saltar el device check. 1 archivo, ~8 líneas.
2. **Fix P1 (G2):** Migrar la navegación post-onboarding a `DeviceRoutingService.getPostLoginRoute`. 1 archivo, ~3 líneas.
3. **Fix P1 (G3 + G5):** Aprovechar la semántica de `mode: 'admin'` — si el device está en admin mode, el POS header no monta el overlay ni el banner. 2 archivos, ~10 líneas.
4. **Fix P2 (G7, G8, G9):** Limpiar deuda de lint en `cash-register.component.*` — import muerto, `!==`, line-length. 2 archivos, ~5 cambios mecánicos.
5. **Fix P2 (G6):** Refactorizar `cash-register.component.ts` para consumir el signal del service. 1 archivo, ~20 líneas de delta.

Los items 4-5 son opcionales en este sprint — se pueden sacar en un commit de housekeeping aparte.

---

*Generated by Claude Code — AUDIT-025*
