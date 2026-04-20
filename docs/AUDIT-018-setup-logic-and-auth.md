# AUDIT-018 — Setup flow, 401 en fresh incognito y enforcement de matrix

**Tipo:** Análisis puro (sin propuestas de código)
**Branch:** `fix/pos-to-admin-routing-auth`
**Fecha:** 2026-04-19
**Scope:** `/setup`, `provisioningGuard`, `ConfigService.load()`, `DeviceService`, matrix de giros × planes × modos.

---

## 1. Archivos inspeccionados

| Artefacto | Rol |
|---|---|
| [setup.component.ts](../src/app/modules/setup/setup.component.ts) | UI de alta del dispositivo (email, código) + auto-recovery |
| [setup.guard.ts](../src/app/core/guards/setup.guard.ts) | Guard del numpad `/pin` (revisado en FDD-013) |
| [provisioning.guard.ts](../src/app/core/guards/provisioning.guard.ts) | Guard de `/setup` — bloquea re-provisioning no autorizado |
| [device-auth.guard.ts](../src/app/core/guards/device-auth.guard.ts) | Guard de `/kitchen` y `/kiosk` — solo device token |
| [device.service.ts](../src/app/core/services/device.service.ts) | `registerDevice`, `validateDevice`, token del dispositivo |
| [config.service.ts](../src/app/core/services/config.service.ts) | `load()` → `GET /branch/{id}/config`, `deviceConfig$` en localStorage |
| [auth.interceptor.ts](../src/app/core/interceptors/auth.interceptor.ts) | Resuelve bearer (user vs device) y silencia logout en rutas públicas |
| [onboarding.component.ts](../src/app/modules/onboarding/onboarding.component.ts) | Única fuente JS de `AVAILABLE_PLANS_BY_MACRO` |
| [device-routing.service.ts](../src/app/core/services/device-routing.service.ts) | `MACRO_POS_EXPERIENCE` (macro → POS variant) |
| [.claude/business-rules-matrix.md](../.claude/business-rules-matrix.md) | Matrix canónica (docs, no código) |

---

## 2. El 401 — causa raíz

### 2.1 Secuencia en una pestaña de incógnito fresca

1. URL inicial resuelve a `/pin` → `setupGuard` detecta que `deviceConfig.businessId === 0` → redirect a `/setup`.
2. `APP_INITIALIZER` en [app.config.ts:36-42](../src/app/app.config.ts#L36-L42) evalúa `authService.isAuthenticated()` → `false` → NO llama `configService.load()`. ✅
3. `provisioningGuard` permite pasar porque `isDeviceConfigured() === false`. ✅
4. `SetupComponent.ngOnInit` ([setup.component.ts:149-165](../src/app/modules/setup/setup.component.ts#L149-L165)) dispara:
   ```
   await this.deviceService.validateDevice();
   ```
5. `DeviceService.validateDevice` ([device.service.ts:140-168](../src/app/core/services/device.service.ts#L140-L168)) hace:
   ```
   GET /api/devices/validate/{uuid}
   ```
6. El interceptor ([auth.interceptor.ts:104-120](../src/app/core/interceptors/auth.interceptor.ts#L104-L120)) busca un bearer:
   - Modo del device es `'cashier'` (default), no está en `DEVICE_TOKEN_MODES` → intenta el user token → no existe → retorna `null`.
   - La request sale **sin header `Authorization`**.
7. Backend exige `[Authorize]` en `/devices/validate` → **401 Unauthorized**.
8. `validateDevice` atrapa el error y retorna `false` → la UI muestra la pantalla de elección (email / código). El usuario ve el flujo normal, pero DevTools registra el 401.

### 2.2 Por qué el 401 no cascada a logout

El interceptor en [auth.interceptor.ts:60-70](../src/app/core/interceptors/auth.interceptor.ts#L60-L70) chequea:

```ts
const isPublicRoute = PUBLIC_ROUTES.some(route => currentPath.startsWith(route));
if (!isPublicRoute) { authService.logout(); }
```

`PUBLIC_ROUTES = ['/register', '/setup', '/onboarding', '/login']` — `/setup` está listado, así que **el 401 se silencia a nivel de sesión**. Pero la request ya voló, el navegador la mostró en la consola, y el `pendingRequestsInterceptor$` (ng-http-loader) probablemente pintó un spinner fantasma.

### 2.3 Conclusión

**El 401 no rompe el flujo funcionalmente** — `validateDevice` está envuelto en try/catch y la UI se recupera. **El problema es conceptual y operativo:**

- El endpoint `GET /devices/validate/{uuid}` es semánticamente una **consulta por identidad de dispositivo** (el UUID ES la identidad). No debería requerir autenticación humana.
- El dispositivo **no tiene con qué autenticarse todavía**: el device token se emite recién cuando `registerDevice` o `activateDevice` retornan.
- El 401 ensucia logs / observabilidad, engaña a alertas de auth failures y viola el principio "no hagas ruido innecesario".
- Si el backend decidiera activar logout global en 401 (por ej. quitando `/setup` de `PUBLIC_ROUTES`), la app entraría en loop.

**Raíz:** no existe una fase de "**Pre-Setup Auth / Device Bootstrap**". El dispositivo salta de "cero identidad" directamente a "credenciales humanas o código de activación" sin un paso intermedio que pregunte "¿me conoces ya?" de forma anónima.

---

## 3. Matrix Mapping — estado actual

### 3.1 Fuentes de verdad dispersas

| Dimensión | Ubicación | Consumido por |
|---|---|---|
| Planes por macro | [onboarding.component.ts:68](../src/app/modules/onboarding/onboarding.component.ts#L68) (`AVAILABLE_PLANS_BY_MACRO`) | Solo la wizard de onboarding |
| POS experience por macro | [device-routing.service.ts:8](../src/app/core/services/device-routing.service.ts#L8) (`MACRO_POS_EXPERIENCE`) | Post-login routing |
| Sub-giros por macro | [config.enum.ts:61-89](../src/app/core/enums/config.enum.ts#L61-L89) (`BusinessTypeId` + `macroOfBusinessType`) | Onboarding + display |
| Features por plan/macro | [.claude/business-rules-matrix.md](../.claude/business-rules-matrix.md) (solo docs) | **Ninguno — no hay enforcement código** |
| **Modos permitidos por macro/plan** | **(no existe)** | **SetupComponent ofrece los 4 modos a todos** |

### 3.2 Lo que dicta la matrix vs. lo que el código hace

Leyendo [business-rules-matrix.md](../.claude/business-rules-matrix.md) §1.1-§1.4:

| Macro | Modos viables según matrix | `SetupComponent.modes` hoy | Gap |
|---|---|---|---|
| FoodBeverage | `cashier`, `tables` (Pro+), `kitchen` (Basic+ con KDS), `kiosk` (Pro+) | `cashier`, `tables`, `kitchen`, `kiosk` | Sin gating por plan (un Free de FoodBeverage ve `kiosk` y `tables` aunque no los tenga) |
| QuickService | `cashier`, `kitchen` (Basic+ barra), `kiosk` (Pro+) — **NO tables** | `cashier`, `tables`, `kitchen`, `kiosk` | Muestra `tables` que no aplica; no bloquea `kiosk` en Free |
| Retail | `cashier` solamente (sin tables, sin kitchen, sin kiosk según matrix) | `cashier`, `tables`, `kitchen`, `kiosk` | Muestra 3 modos inválidos |
| Services | `cashier` solamente | `cashier`, `tables`, `kitchen`, `kiosk` | Idem |

La lista de modos en [setup.component.ts:108-113](../src/app/modules/setup/setup.component.ts#L108-L113) es un array estático. No hay lectura de macro, plan ni feature-set para filtrarla.

### 3.3 Flujos del setup — granularidad del gap

- **Email flow** (`POST /device/setup`): el backend retorna `businessId`, `businessName`, `branches`. **No retorna macro ni plan**. El frontend no tiene forma de filtrar los modos sin otra llamada.
- **Code flow** (`POST /device/activate`): el backend pre-asigna `mode` y lo devuelve. Aquí el gating vive en backend — el usuario solo ve un badge del modo pre-asignado. Este flujo respeta la matrix implícitamente (si el backend la respeta al generar el código).

Resumen: **el gating de la matrix existe en onboarding y en routing post-login, pero no en setup/alta del dispositivo**. El único freno real es si el backend valida el payload `{ branchId, mode }` contra la matrix al recibir `/devices/register`. Si lo valida, el usuario obtiene un 4xx opaco después de pulsar "Guardar"; si no lo valida, el dispositivo queda provisionado con un modo incoherente con su plan.

---

## 4. The Good, the Bad, the Ugly

### 4.1 Good 👍

- **Separación user-token vs device-token** bien implementada en [auth.interceptor.ts:104-120](../src/app/core/interceptors/auth.interceptor.ts#L104-L120). Los modos `kitchen`/`kiosk` usan device token exclusivamente; los operativos usan user token; los offline markers nunca se envían.
- **Auto-recovery silencioso** en `ngOnInit` — si el UUID sigue vinculado server-side, el dispositivo se re-hidrata sin pedir credenciales. Con guardas para no redirigir a `/kitchen`/`/kiosk` si el device token falta ([setup.component.ts:173-180](../src/app/modules/setup/setup.component.ts#L173-L180)).
- **`provisioningGuard`** restringe el re-provisioning a Owner/Manager una vez el device está configurado — Cashier no puede re-bindear.
- **Dos flujos independientes** (email con branch picker vs código con mode pre-asignado) cubren tanto el caso "dueño configurando su local" como "técnico instalando un kiosko".
- **Setup atomic fix ya documentado** en [setup.component.ts:345-354](../src/app/modules/setup/setup.component.ts#L345-L354) — el flujo espera el `registerDevice` antes de navegar, evitando half-provisioning bajo red lenta.

### 4.2 Bad ⚠️

- **401 silencioso en fresh incognito** (sección 2). Aun si no rompe, contamina dashboards de error y es un olor que crece cuando el equipo activa Sentry/Application Insights.
- **Lista estática de modos** — `SetupComponent.modes` no respeta macro ni plan. Un Retail puede seleccionar "Pantalla de cocina" y descubrir solo después de guardar que el backend rechaza (o peor, acepta silenciosamente).
- **Duplicación casi total** entre `saveEmailSetup` ([setup.component.ts:297-317](../src/app/modules/setup/setup.component.ts#L297-L317)) y `saveCodeSetup` ([setup.component.ts:355-376](../src/app/modules/setup/setup.component.ts#L355-L376)) — mismo cuerpo con distinto origen del `branchId`/`mode`.
- **El setup no pregunta por el giro ni el plan**. Asume que el backend los tiene correctamente de un registro previo. Si el dueño se registró con el macro equivocado, el setup no lo sabe y no lo corrige.
- **ConfigService.load()** ([config.service.ts:112-175](../src/app/core/services/config.service.ts#L112-L175)) siempre intenta `GET /branch/{id}/config`. Si la sesión es válida pero `authService.branchId === 0` (recién loggeado sin branch activa), la URL se forma como `/branch/0/config` → 404/400 silenciado → el POS arranca con hasTables=false y posExperience=undefined, y el header deriva datos incorrectos.

### 4.3 Ugly 🔥

- **`PUBLIC_ROUTES = ['/register', '/setup', '/onboarding', '/login']`** ([auth.interceptor.ts:15](../src/app/core/interceptors/auth.interceptor.ts#L15)) es una lista negra por prefijo de URL del window location, no de la API. Suprime el logout en 401 solo mientras la URL del navegador sea una de esas. Un 401 legítimo que ocurra justo después de un `router.navigate` fuera de estas rutas disparará logout aunque la request haya sido lanzada desde setup.
- **No existe un endpoint "anónimo de identidad"**. `validateDevice`, `registerDevice` y `activateDevice` mezclan "quién soy" con "qué puedo hacer". Un `GET /bootstrap/device/{uuid}` anónimo que retorne `{ isRegistered: boolean, mode?, businessId? }` no existe — y es exactamente lo que el incognito necesita.
- **La matrix vive en un `.md`** y se duplica parcialmente en tres archivos JS. Si Producto cambia "Services ya no tiene Basic" en la matrix, hay que tocar manualmente `AVAILABLE_PLANS_BY_MACRO`, `MACRO_POS_EXPERIENCE`, `SetupComponent.modes` (cuando exista), y el feature gate del backend. Alta probabilidad de drift.
- **Mode `'mobile'`** existe en el modelo ([device-config.model.ts:18](../src/app/core/models/device-config.model.ts#L18)) pero NO aparece en la UI de setup. Legacy o futuro no documentado.
- **Migraciones de modos legacy** (`'counter' → 'cashier'`, `'waiter' → 'tables'`) viven embebidas en `ConfigService.loadDeviceConfig()` ([config.service.ts:249-253](../src/app/core/services/config.service.ts#L249-L253)). Útil, pero habla de un refactor incompleto.
- **`isDeviceConfigured()`** ([config.service.ts:218-221](../src/app/core/services/config.service.ts#L218-L221)) se basa solo en `businessId > 0 && branchId > 0`. No verifica que el device token esté presente. Un device en modo `kitchen` puede parecer "configurado" pero fallar `deviceAuthGuard` si el token expiró — produce el loop a `/setup?reason=unbound` conocido.

---

## 5. Action Plan

### Fase 1 — Silenciar el 401 (no-breaking, backend+frontend)

1. **Backend:** marcar `GET /api/devices/validate/{uuid}` como anónimo (o introducir `GET /api/devices/bootstrap/{uuid}` con la misma semántica). El UUID del dispositivo funciona como identificador público — el riesgo es un enumeration attack, mitigable con rate limiting.
2. **Frontend:** si el backend no puede cambiarse a corto plazo, envolver `deviceService.validateDevice()` para que detecte "sin user token y sin device token" y **no dispare la request**. Retornar `false` sin hacer HTTP. Esto elimina el 401 ruidoso sin cambiar el backend.
3. Añadir `/api/devices/bootstrap` (o `/validate`) a los `PUBLIC_PATHS` del interceptor para que no intente attach de headers ni logout automático.

### Fase 2 — Pre-Setup Auth (Device Bootstrap)

1. Introducir un paso 0 en `SetupComponent.ngOnInit`:
   - `GET /api/devices/bootstrap/{uuid}` anónimo → `{ isRegistered: boolean, publicBusinessName?: string, publicBranchName?: string, mode?: string }` (los campos opcionales solo se exponen si el device YA está bindado, para mostrar contexto tipo "Este dispositivo pertenece a 'Café del Centro'").
2. Si `isRegistered === true` → disparar `validateDevice()` (ahora sí con un token derivable o con UUID+HMAC como auth ligero) y auto-redirect como hoy.
3. Si `isRegistered === false` → mostrar la pantalla de elección email/código.
4. **Sin token de sesión humana involucrado** en este paso. El device bootstrap es propiedad del dispositivo, no del humano.

### Fase 3 — Matrix enforcement en setup

1. Crear un único módulo de políticas en `core/policies/business-matrix.policy.ts` que exponga:
   - `plansForMacro(macro): PlanTypeId[]`
   - `modesForMacroPlan(macro, plan): DeviceConfig['mode'][]`
   - `posExperienceForMacro(macro): PosExperience`
2. Migrar `AVAILABLE_PLANS_BY_MACRO` y `MACRO_POS_EXPERIENCE` a ese módulo — fuente única espejo 1-a-1 del `.claude/business-rules-matrix.md`.
3. Extender el endpoint `POST /device/setup` (email flow) para devolver también `{ macro, planTypeId }` del negocio, o crear `GET /business/{id}/matrix-scope` que devuelva `{ macro, plan, allowedModes }`.
4. En `SetupComponent`, después de step `branch`, filtrar `modes` con `modesForMacroPlan(macro, plan)` antes de renderizar el selector. Los modos vedados por plan pueden mostrarse **disabled con tooltip "Requiere plan Pro"** (upsell), los vedados por macro se **ocultan totalmente** (DOM removal, como manda la matrix §2.1).
5. En el code flow, validar que `activateData.mode` pertenezca a los modos válidos para el negocio. Si no, surfacear error antes de `saveCodeSetup`.

### Fase 4 — Limpieza y hardening

1. Consolidar `saveEmailSetup` y `saveCodeSetup` en un único `commitDeviceRegistration(branchId, mode, name)`.
2. Reforzar `isDeviceConfigured()` con un segundo predicado `hasTokenForMode()`: modos hardware requieren device token presente.
3. Resolver el caso `ConfigService.load()` con `branchId === 0`: abortar si el branch no está resuelto aún, con warning.
4. Decidir qué hacer con `mode: 'mobile'`: documentarlo en la UI o eliminarlo del tipo.
5. Agregar test de integración: un fresh incognito navega a `/setup` sin generar 4xx en network panel.

### Fase 5 — Observabilidad

1. Log estructurado en cada transición del setup state machine (`choose → email → branch → mode → done` / `choose → code → code-name → done`).
2. Métrica: `setup.completion_time_seconds` p50/p95 por flow (email/code).
3. Alerta si `setup.mode_matrix_violation_attempts > 0` — caso en que el frontend deja pasar un mode fuera de la matrix y el backend lo rechaza.

---

## 6. Resumen

| Aspecto | Estado actual | Gap |
|---|---|---|
| 401 en fresh incognito | Silenciado por try/catch, pero visible en DevTools | Sin endpoint anónimo de bootstrap |
| Auth del device pre-registro | Inexistente | Necesario un "pre-setup auth" para evitar el 401 y habilitar lookups anónimos |
| Matrix giro × plan × modo | Solo en `.md` y duplicada parcialmente en 3 TS | Sin policy central; setup no filtra modos |
| Enforcement en setup | Frontend estático | Depende 100% del backend rechazar modes inválidos post-hoc |
| Enforcement en onboarding | `AVAILABLE_PLANS_BY_MACRO` — parcial | Sirve solo para planes, no para modos ni features |
| Routing post-login | `MACRO_POS_EXPERIENCE` cubre macro → experience | OK para Phase 2 de FDD-013 |

**Prioridad sugerida:** Fase 1 (rápida, limpia el 401) → Fase 3 (visible al usuario, cierra agujero de configuración inválida) → Fase 2 (requiere backend) → Fase 4-5 (hardening).

Sin implementación de código. Documento cerrado.
