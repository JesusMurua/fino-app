# AUDIT-027: Device Provisioning UI + Zero-Fallback Enforcement

**Date:** 2026-04-11
**Scope:** Setup screen UX, admin device management UI, fallback removal for KDS/Kiosk auth
**Goal:** Validar que el proceso visual de aprovisionamiento de dispositivos está completo y detectar los lugares exactos donde todavía existe un fallback de `userToken` para dispositivos de infraestructura.

---

## 1. Respuestas a las tres preguntas

### 1.1 Setup Screen — ¿Existe UI para ingresar un código numérico?

**Respuesta corta:** Sí, existe y funciona — pero el contrato con el backend está desfasado y hay una race condition que puede dejar al device sin `deviceToken` en su primera carga.

**Archivos:**
- [setup.component.ts](src/app/modules/setup/setup.component.ts)
- [setup.component.html](src/app/modules/setup/setup.component.html)

**UI observada:**

La pantalla `/setup` implementa una state machine `'choose' | 'email' | 'code' | 'branch' | 'mode' | 'code-name'` ([setup.component.ts:64](src/app/modules/setup/setup.component.ts#L64)) con dos flujos alternativos:

1. **Flujo email (admin)** — [submitEmail()](src/app/modules/setup/setup.component.ts#L174) → `POST /device/setup` con `{ email, password }` → devuelve branches → user elige branch → elige mode → [saveEmailSetup()](src/app/modules/setup/setup.component.ts#L207).

2. **Flujo código (tablet nueva)** — [submitCode()](src/app/modules/setup/setup.component.ts#L235) → `POST /device/activate` con `{ code }` → devuelve `ActivateResponse` (businessId, businessName, branchId, branchName, mode) → user confirma nombre → [saveCodeSetup()](src/app/modules/setup/setup.component.ts#L257).

El input de 6 dígitos ([setup.component.html:110-122](src/app/modules/setup/setup.component.html#L110-L122)) está bien diseñado: auto-advance, auto-submit cuando se completan los 6, auto-focus en backspace, `inputmode="numeric"` para teclado numérico. Tiene estados `loading`, `error` y una pantalla de confirmación con el mode badge asignado.

**Problema 1 — Endpoint desfasado.**

El task menciona `/api/devices/activation-codes/validate` pero el componente hoy llama:

```typescript
// setup.component.ts:244
this.api.post<ActivateResponse>('/device/activate', { code })
```

El path real es `/device/activate` (singular, sin `/activation-codes/validate`). Y el admin-settings genera códigos contra `/device/generate-code` ([admin-settings.component.ts:753](src/app/modules/admin/components/settings/admin-settings.component.ts#L753)). Hay dos posibilidades:

- (a) El backend ya tiene endpoints separados (`/device/generate-code` + `/device/activate`) y hay que **renombrarlos** al nuevo esquema (`/devices/activation-codes/generate` + `/devices/activation-codes/validate`).
- (b) El backend expone tanto los viejos como los nuevos; podemos migrar el cliente sin romper nada.

**Necesito confirmación** antes de cambiar endpoints.

**Problema 2 — Race condition en el flujo de código.**

[saveCodeSetup()](src/app/modules/setup/setup.component.ts#L257) hace, en este orden:

```typescript
1. this.configService.saveDeviceConfig(config);               // sync
2. this.deviceService.registerDevice(...).catch(...);         // async, NOT awaited
3. this.router.navigate(['/pin']);                            // immediate
```

El punto 2 es el único lugar donde se captura el `deviceToken` (porque `/device/activate` no lo devuelve — lo devuelve `/devices/register`, que es la segunda llamada). Al ser fire-and-forget:

- Paso 3 corre antes de que termine paso 2.
- El usuario llega a `/pin` con `localStorage['pos-device-config']` escrito pero sin `localStorage['pos_device_token']`.
- Si el router aterriza en una ruta que use `deviceAuthGuard` (hoy `/kitchen` y `/kiosk`) antes de que el POST `/devices/register` resuelva, el guard ve `hasValidDeviceToken() === false` y rebote a `/setup` → loop.

Para cajero (mode: cashier) no es crítico porque va a `/pin` y luego a `/pos`, que usa `authGuard` y no `deviceAuthGuard`. Pero para KDS/Kiosk es un fallo real en el camino feliz.

**Problema 3 — No hay estado distintivo "Dispositivo no vinculado".**

Cuando `deviceAuthGuard` rebote a `/setup`, la pantalla muestra el mismo header `"Configurar dispositivo — Primera vez en este equipo"` ([setup.component.html:12-13](src/app/modules/setup/setup.component.html#L12-L13)). El task pide un mensaje claro tipo "Dispositivo no vinculado, ingresa el código de activación". No existe lógica para diferenciar:

- First-time setup (caja recién sacada)
- Rebote de guard (token expiró / revocado / perdido)
- Re-provisioning explícito desde admin

Ni siquiera hay un query param que pase la razón. El componente no tiene manera de saber *por qué* está siendo mostrado.

**Problema 4 — Sin `validateDevice()` al boot.**

El setup asume que cada entrada es primera-vez. No llama [deviceService.validateDevice()](src/app/core/services/device.service.ts#L121) al inicializarse para ver si el backend ya conoce este UUID. Un device que fue borrado de localStorage pero aún está registrado en el backend tendría que volver a emitir un código desde admin, cuando idealmente una simple re-validación resolvería el caso.

### 1.2 Admin Screen — ¿Existe la pantalla para generar códigos?

**Respuesta corta:** Sí existe el generador, pero **no** hay una pantalla dedicada de administración de dispositivos.

**Ubicación actual:** Embebida dentro del tab `'branches'` de [admin-settings.component.ts](src/app/modules/admin/components/settings/admin-settings.component.ts). El fragmento UI vive en [admin-settings.component.html:389-435](src/app/modules/admin/components/settings/admin-settings.component.html#L389-L435) y el código en el método [generateActivationCode()](src/app/modules/admin/components/settings/admin-settings.component.ts#L747).

**Contrato actual:**

```typescript
// admin-settings.component.ts:753
this.api.post<{ code: string }>('/device/generate-code', {
  branchId: this.codeBranchId,
  mode: this.codeMode,
})
```

La UI permite elegir `branchId` (dropdown) + `mode` (dropdown), generar el código, y muestra el resultado como `<span class="activation-code__value">{{ code }}</span>`. Solo está accesible para Owners (el componente carga `loadBranches()` únicamente cuando `roleId === Owner`).

**Lo que NO existe:**

| Feature | Estado |
|---|---|
| Listado de dispositivos (`GET /api/devices`) | ❌ no implementado |
| Nombre, mode, branch de cada device | ❌ |
| Last heartbeat / online-offline badge | ❌ (el heartbeat existe en [device.service.ts:155](src/app/core/services/device.service.ts#L155) pero no se lee de vuelta) |
| Revocación de un device | ❌ no hay botón ni endpoint cliente |
| Rename de device | ❌ |
| Regeneración de token manual | ❌ |
| Historial de códigos generados | ❌ |
| Expiración del código (countdown) | ❌ solo menciona "válido 24h" en un comentario |

**Recomendación para la ubicación de la nueva screen:**

Dos opciones viables:

| Opción | Pros | Contras |
|---|---|---|
| **A. Nuevo tab "Dispositivos" dentro de admin-settings** | Reusa el layout existente. Rápido de agregar. Consistente con el tab "Sucursales" que tiene el generator hoy. | El admin-settings ya tiene 8 tabs (`business`, `device`, `peripherals`, `security`, `fiscal`, `branches`, `billing`, `printers`). Agregar un noveno empieza a saturar la UI. |
| **B. Nueva ruta `/admin/settings/devices`** | Separa concerns. Permite deep-linking (`/admin/settings/devices?branchId=3`). Menos presión en el componente gordo de admin-settings. | Requiere un componente nuevo + wiring en [admin.routes.ts](src/app/modules/admin/admin.routes.ts). |

Mi recomendación es **B**: un componente dedicado `AdminDevicesComponent` en `/admin/settings/devices` (o incluso `/admin/devices` para consistencia con `/admin/users`, `/admin/reports`). El admin-settings ya es un god-component de 815+ líneas y agregar otro tab empeora la situación. El generator actual puede moverse al nuevo componente sin perder funcionalidad.

**Featuring recomendado para la nueva screen:**

```
┌ /admin/settings/devices ──────────────────────────────────┐
│                                                           │
│  [+ Generar código]            [Filtrar por sucursal ▼]   │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 📱 Caja 1          cashier  Matriz   🟢 hace 2 min  │  │
│  │ 🪑 Mesas iPad      tables   Matriz   🟢 hace 5 s    │  │
│  │ 👨‍🍳 Cocina Principal kitchen Matriz   🔴 offline 2h  │  │
│  │ 📱 Kiosko Entrada  kiosk    Matriz   🟢 hace 30 s   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  [Revocar] [Renombrar] al seleccionar fila                │
└───────────────────────────────────────────────────────────┘
```

### 1.3 Zero Fallbacks — Archivos exactos con lógica de fallback

Tres lugares. Los tres introducidos intencionalmente en la fase 8.2 para mantener backward-compat mientras el device token se desplegaba, y los tres marcados como "fallback" explícitamente en comentarios.

#### F1 — `auth.interceptor.ts:97-110` — `resolveBearerToken` cae al user token

**Archivo:** [src/app/core/interceptors/auth.interceptor.ts](src/app/core/interceptors/auth.interceptor.ts)

```typescript
// Líneas 97-110
function resolveBearerToken(
  configService: ConfigService,
  deviceService: DeviceService,
): string | null {
  const mode = configService.deviceConfig$.getValue().mode;
  if (DEVICE_TOKEN_MODES.includes(mode) && deviceService.hasValidDeviceToken()) {
    return deviceService.getDeviceToken();
  }

  const userToken = localStorage.getItem(AUTH_TOKEN_KEY);      // ← FALLBACK
  if (!userToken) return null;
  if (userToken.startsWith('offline-session-')) return null;
  return userToken;
}
```

**El problema:** el condicional de la línea 102 es `AND`. Si el device está en mode kitchen/kiosk **y** no tiene device token válido, cae al `else` (línea 106+) y usa el user token. Para un KDS eso es exactamente lo que el task prohíbe: "CERO FALLBACKS".

**Lo que debe pasar:** si `mode ∈ {kitchen, kiosk}`, solo dos outcomes posibles:
- Device token válido → retorna el device token
- Device token inválido → retorna `null` (y la petición se dispara sin `Authorization` header → el backend responde 401 → el device sabe que debe re-provisionarse)

#### F2 — `kitchen.service.ts:176-179` — SignalR `accessTokenFactory` cae al user token

**Archivo:** [src/app/core/services/kitchen.service.ts](src/app/core/services/kitchen.service.ts)

```typescript
// Líneas 176-179
accessTokenFactory: () =>
    this.deviceService.getDeviceToken()
    ?? this.authService.getToken()       // ← FALLBACK
    ?? '',
```

**El problema:** el `?? this.authService.getToken()` hace que el hub de KDS envíe el token de usuario cuando no hay device token. Mismo patrón que F1 — viola la regla de zero fallbacks.

**Lo que debe pasar:**

```typescript
accessTokenFactory: () => this.deviceService.getDeviceToken() ?? '',
```

Si no hay device token, el factory devuelve `''`, SignalR intenta la conexión sin auth, el backend responde 401, y el `catch` en la línea 203 captura el fallo (mismo flujo de error que hoy).

#### F3 — `device-auth.guard.ts:35-42` — Path 2 del guard acepta user token

**Archivo:** [src/app/core/guards/device-auth.guard.ts](src/app/core/guards/device-auth.guard.ts)

```typescript
// Líneas 30-46
export const deviceAuthGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const deviceService = inject(DeviceService);
  const authService = inject(AuthService);                    // ← usado solo para fallback
  const router = inject(Router);

  // 1. Device token — preferred path for 24/7 infrastructure
  if (deviceService.hasValidDeviceToken()) {
    return true;
  }

  // 2. Backward-compat: an authenticated human with the right role      ← FALLBACK
  if (authService.isAuthenticated()) {
    const allowedRoles: UserRoleId[] = route.data['roles'] ?? [];
    const userRoleId = authService.currentUser()?.roleId;

    if (allowedRoles.length === 0) return true;
    if (userRoleId && allowedRoles.includes(userRoleId)) return true;
  }

  // 3. Neither — the device needs to be provisioned first
  return router.createUrlTree(['/setup']);
};
```

**El problema:** la lógica de Path 2 acepta un humano con rol Kitchen/Owner/Manager metiendo PIN y entrando a `/kitchen` o `/kiosk`. El task es explícito: *"No hay usuarios logueados en un Kiosco"*. Path 2 debe desaparecer.

**Lo que debe pasar:** guard mínimo de ~6 líneas:

```typescript
export const deviceAuthGuard: CanActivateFn = () => {
  const deviceService = inject(DeviceService);
  const router = inject(Router);
  return deviceService.hasValidDeviceToken()
    ? true
    : router.createUrlTree(['/setup']);
};
```

Se pueden borrar los imports de `AuthService`, `UserRoleId`, y `ActivatedRouteSnapshot`. El parámetro `route` se deja en la signature por tipo pero ya no se usa.

---

## 2. Matriz de hallazgos

| ID | Severidad | Título | Ubicación |
|---|---|---|---|
| S1 | **Alta** | Race condition en `saveCodeSetup` — navigate corre antes de persistir `deviceToken` | [setup.component.ts:257-280](src/app/modules/setup/setup.component.ts#L257-L280) |
| S2 | **Alta** | Endpoint del flujo de código (`/device/activate`) no coincide con el contrato esperado (`/devices/activation-codes/validate`) | [setup.component.ts:244](src/app/modules/setup/setup.component.ts#L244) |
| S3 | Media | No hay estado UI distintivo "Dispositivo no vinculado" cuando `deviceAuthGuard` rebota al device | [setup.component.html:12-13](src/app/modules/setup/setup.component.html#L12-L13) |
| S4 | Baja | No se intenta `validateDevice()` al boot del setup — una re-provisioning transparente no es posible | [setup.component.ts](src/app/modules/setup/setup.component.ts) |
| A1 | **Alta** | No existe pantalla de listado de devices — solo hay generator embebido | [admin-settings.component.html:389-435](src/app/modules/admin/components/settings/admin-settings.component.html#L389-L435) |
| A2 | Media | No hay endpoint cliente `GET /api/devices` ni UI para revocar / renombrar | N/A |
| A3 | Media | El generator vive en el tab "branches" de admin-settings — mal ubicado semánticamente | [admin-settings.component.html:389](src/app/modules/admin/components/settings/admin-settings.component.html#L389) |
| F1 | **Alta** | `auth.interceptor.ts` cae a user token cuando infra device sin deviceToken válido | [auth.interceptor.ts:97-110](src/app/core/interceptors/auth.interceptor.ts#L97-L110) |
| F2 | **Alta** | `kitchen.service.ts` SignalR accessTokenFactory cae a user token | [kitchen.service.ts:176-179](src/app/core/services/kitchen.service.ts#L176-L179) |
| F3 | **Alta** | `device-auth.guard.ts` Path 2 acepta user autenticado con rol como backward-compat | [device-auth.guard.ts:35-42](src/app/core/guards/device-auth.guard.ts#L35-L42) |

---

## 3. Secuencia crítica — No se puede remover los fallbacks sin arreglar el setup primero

Los tres fallbacks F1/F2/F3 son el **safety net** que mantiene operativos los devices en producción mientras el `deviceToken` no está garantizado en localStorage. Si los removemos sin hacer más cambios:

**Escenario de rotura:** un cocinero abre el KDS mañana, el device nunca fue re-provisionado contra el nuevo endpoint, `deviceToken` no existe, `deviceAuthGuard` rebota a `/setup`, el admin tiene que generar un código, el cocinero ingresa el código, *pero* `saveCodeSetup` hace fire-and-forget del `registerDevice` → `deviceToken` tampoco se persiste a tiempo → segunda rebote a `/setup` → loop infinito.

**Por eso S1 (race condition) es blocker para remover F1/F2/F3.** El orden correcto es:

1. **Arreglar `saveCodeSetup` primero** para que:
   - Espere (`await`) a que `registerDevice` termine y persista el token
   - O reemplazar el flujo de dos llamadas (`/device/activate` + `/devices/register`) por una sola (`/devices/activation-codes/validate` que devuelva el token en la misma respuesta) — **esto depende del backend**
2. **Confirmar el contrato del endpoint** con el backend (S2) — ¿hay que renombrar a `/devices/activation-codes/validate` o mantener `/device/activate`?
3. **Mejorar la UI del setup** para mostrar el estado "Dispositivo no vinculado" cuando viene por rebote (S3)
4. **Remover F1, F2, F3** en un commit atómico
5. **Crear la admin devices screen** (A1/A2/A3) — puede ir en paralelo, no bloquea los fixes de fallback

---

## 4. Propuesta de solución (alto nivel, esperando confirmación)

### 4.1 Fase A — Arreglar el setup (blocker para remover fallbacks)

**Cambios:**

- En `saveCodeSetup`, cambiar el `.catch(...)` fire-and-forget por un `await ... catch`. Si `registerDevice` falla, mostrar toast + no navegar.
- Alternativa preferida (si el backend coopera): cambiar `submitCode` para llamar directamente al endpoint unificado que devuelva **tanto** la config **como** el `deviceToken` en una sola respuesta. Eso elimina el segundo round-trip y naturalmente secuencializa la operación.
- Agregar un input opcional `?reason=unbound` al query-param de `/setup` → el componente lee el query-param y muestra un header alternativo `"Dispositivo no vinculado — Ingresa el código de activación"`. El `deviceAuthGuard` usa `createUrlTree(['/setup'], { queryParams: { reason: 'unbound' } })` al rebotar.
- Llamar `deviceService.validateDevice()` al `ngOnInit` del setup component. Si devuelve `true` (el backend ya conoce este UUID y lo re-valida) → `router.navigate` directo al flujo correcto sin pedir código.

**Archivos:** `setup.component.ts`, `setup.component.html`, `device-auth.guard.ts` (para el query-param).

### 4.2 Fase B — Remover los tres fallbacks

**Cambios:**

- [F1] `auth.interceptor.ts` `resolveBearerToken` — reestructurar la lógica: `if (mode in DEVICE_TOKEN_MODES) return deviceService.hasValidDeviceToken() ? deviceService.getDeviceToken() : null`. El else branch (user token) solo corre para `cashier`, `waiter`, `admin`, etc.
- [F2] `kitchen.service.ts` — `accessTokenFactory: () => this.deviceService.getDeviceToken() ?? ''`. Remover import de `AuthService` si ya no se usa en otro lado.
- [F3] `device-auth.guard.ts` — reescribir el guard a su versión mínima de 6 líneas. Remover imports de `AuthService`, `UserRoleId`, `ActivatedRouteSnapshot`.

**Archivos:** 3 modificados, 0 creados.

### 4.3 Fase C — Admin Devices Screen

**Cambios:**

- Nuevo componente `AdminDevicesComponent` en `src/app/modules/admin/components/devices/`.
- Nueva ruta `/admin/settings/devices` (o `/admin/devices`) en `admin.routes.ts`.
- Entry en el sidebar nav.
- Mueve el generator de `admin-settings` al nuevo componente. El tab `'branches'` de settings queda sin el generator.
- Requiere endpoint `GET /api/devices` del backend para listar.
- Requiere endpoint `DELETE /api/devices/{id}` para revocar (o `PATCH .../revoke`).
- Usa `device.service.ts` como fachada.

**Archivos:** 1 nuevo component (3 files: ts, html, scss), 1 mod en admin.routes.ts, 1 mod en admin-shell nav, 1 cleanup en admin-settings.

---

## 5. Preguntas abiertas antes de implementar

1. **¿Cuál es el endpoint canónico del activation code flow?** `/device/activate` (actual) o `/devices/activation-codes/validate` (mencionado en el task)? ¿Coexisten?
2. **¿El endpoint canónico devuelve el `deviceToken` en la misma respuesta?** Si sí, podemos eliminar el fire-and-forget sin traerlo en un segundo round-trip.
3. **¿Existe ya `GET /api/devices` en el backend para el listado?** Si no, la Fase C queda bloqueada hasta que el backend lo exponga.
4. **¿Hay endpoint de revocación?** Si no, el botón "Revocar" queda para fase posterior.
5. **¿Los devices en producción hoy ya tienen `deviceToken` almacenado?** Si no, removerlos es un blast radius enorme — cada Kitchen/Kiosk del mundo se rompe al siguiente deploy. La Fase B debe gated por un rollout gradual o coordinada con una migración de datos.
6. **¿El `admin` mode debe tener su propio flujo de auth?** Hoy usa user token (correcto por §1.3 F1 donde `DEVICE_TOKEN_MODES` no lo incluye), pero si en el futuro queremos que un device `admin` también tenga device token para que sobreviva a logout, habría que agregarlo al set.
7. **¿La pantalla "Dispositivo no vinculado" debe permitir al usuario volver al flujo email** o solo al flujo código? En el modelo estricto de zero-fallbacks, el flujo email (que termina guardando localmente sin device token real) es otra forma de evitar el device token — hay que decidir si lo mantenemos o lo retiramos.

---

## 6. Próximo paso

**Esperando confirmación.** Con respuestas a §5 puedo proponer el diseño detallado + orden de commits. Mi recomendación preliminar es:

- **Commit 1:** Fase A (fix del setup — race condition + query-param + validateDevice al boot). Requiere confirmación del endpoint.
- **Commit 2:** Fase B (remover F1, F2, F3). Depende de Commit 1.
- **Commit 3:** Fase C (admin devices screen). Independiente, puede ir en paralelo.

Cada commit es revisable por separado y reversible si surge una regresión en producción.

---

*Generated by Claude Code — AUDIT-027*
