# AUDIT-026: Device Auth vs User Auth — Idle Lock, Guard Access y SignalR

**Date:** 2026-04-11
**Scope:** Auto-lock por inactividad, guards de `/kitchen` y `/kiosk`, autenticación del hub SignalR del KDS
**Goal:** Validar que las pantallas de infraestructura (KDS, Kiosko) operan 24/7 sin exigir PIN de usuario ni auto-bloquearse, mientras que las tablets operadas por humanos (Cajero, Mesero) sí mantienen los controles de seguridad.

---

## 1. Contexto — Dos modelos de auth confundidos en el mismo código

El proyecto hoy tiene **un solo modelo de autenticación**: `AuthService` guarda un JWT de usuario en `localStorage[AUTH_TOKEN_KEY]`. Todo lo demás —SignalR, API, guards, idle lock— depende de ese token.

No existe un concepto distinto de **"token de dispositivo"**: `DeviceService.registerDevice` hace `POST /api/devices/register` pero **no devuelve un JWT firmado**, solo devuelve el `DeviceConfig` que se persiste en localStorage como datos planos. Cuando un KDS o un Kiosko arranca, no hay forma de autenticarse contra el backend sin que alguien humano meta un PIN primero.

Esto filtra en tres lugares críticos: el **idle lock global**, los **guards de ruta**, y el **access-token factory del hub SignalR**. Los tres asumen "siempre hay un user logueado" y eso choca con el requisito de UX "la pantalla de cocina opera sin que nadie meta PIN".

---

## 2. Respuestas a las tres preguntas del brief

### 2.1 Idle Lock — ¿Se bloquea la cocina / kiosko por inactividad?

**Respuesta corta:** El KDS **sí se bloquea** a los 5 minutos (bug real). El Kiosko **no se bloquea** por el timer global, pero tiene otro timer interno propio con lógica diferente.

**Source of truth:** [idle.service.ts](src/app/core/services/idle.service.ts)

```typescript
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const EXEMPT_ROUTES = ['/pin', '/login', '/register', '/setup', '/onboarding', '/kiosk'];
```

[idle.service.ts:102-110](src/app/core/services/idle.service.ts#L102-L110):

```typescript
private checkIdle(): void {
  if (Date.now() - this.lastActivity < IDLE_TIMEOUT_MS) return;
  const url = this.router.url;
  if (EXEMPT_ROUTES.some(r => url.startsWith(r))) return;
  this.ngZone.run(() => this.lock());
}
```

El `lock()` hace `cartService.clearCart()` + `router.navigate(['/pin'])`. **No limpia el JWT** — el mismo usuario puede volver a entrar su PIN y continuar.

**Arranque del timer:** [app.component.ts:48-53](src/app/app.component.ts#L48-L53)

```typescript
effect(() => {
  if (this.authService.isAuthenticated()) {
    this.syncService.initialize();
    this.idleService.start();
  }
});
```

El `IdleService.start()` se dispara en cuanto `authService.isAuthenticated()` pasa a `true` (login o restore desde localStorage). Una vez iniciado, corre forever (no hay `stop()` wired a nada que no sea `ngOnDestroy`).

**Matriz de comportamiento real:**

| Ruta | ¿Exempt? | ¿Se dispara lock? | Consecuencia |
|---|---|---|---|
| `/pin` | ✅ | No | correcto |
| `/login`, `/register`, `/setup`, `/onboarding` | ✅ | No | correcto |
| `/kiosk/**` | ✅ | No (timer global) | correcto en UX, pero el KioskShell tiene su **propio** timer paralelo de 3 min ([kiosk-shell.component.ts:13](src/app/modules/kiosk/kiosk-shell.component.ts#L13)) que limpia el carrito y vuelve a `/kiosk/welcome` — no a `/pin`. Dos timers en paralelo sobre el mismo device, cada uno con su propio threshold |
| `/kitchen/**` | **❌ no exempt** | **Sí** | **BUG** — 5 min sin tocar el KDS → auto-lock → navegación a `/pin` |
| `/pos/**`, `/tables/**` | ❌ | Sí | correcto (tablets humanas) |
| `/admin/**` | ❌ | Sí | aceptable pero debatible (un Owner leyendo reportes no esperaría auto-lock) |

**Escenarios rotos detectados:**

1. **KDS montado en la pared sin actividad física.** El cocinero no toca la pantalla porque los gestos son leer + marcar "listo" con un contador de 3 segundos. Entre órdenes hay largas pausas. A los 5 min → `/pin`. Siempre. El operador debe volver a meter PIN cada ~5 min, lo que acumula ~20 PIN-entries en un turno de 2 horas.

2. **`IdleService.start()` es idempotente pero jamás para.** No hay `idleService.stop()` cuando el user cierra sesión ni cuando se detecta que el dispositivo está en modo kitchen/kiosk. Un vez prendido, corre para siempre mientras la app viva.

3. **Threshold único hardcoded** (5 min). No se adapta al rol del usuario ni al modo del dispositivo. Un cajero en /pos tiene el mismo timeout que un Owner en /admin.

4. **`EXEMPT_ROUTES` es una lista de strings, no una regla semántica.** "/kitchen" se puede agregar a la lista, pero esa sería una decisión a nivel de ruta, no a nivel de *device mode*. Si mañana el KDS fuera accesible vía otra ruta (ej. `/kds` o `/cocina`), la exención se rompería.

5. **El Kiosko tiene doble timer**: el `IdleService` global lo exime, pero `KioskShellComponent` implementa su propio monitor de 3 min con overlay "¿Sigues ahí?" + countdown de 30 segundos. Es la lógica correcta para UX de cliente (reset a welcome), pero vive *completamente desacoplada* del servicio global. Duplica la responsabilidad.

### 2.2 Guard Access — ¿`/kitchen` y `/kiosk` exigen JWT de usuario?

**Respuesta corta:** **`/kitchen` sí** exige JWT + rol Kitchen (o Owner/Manager). **`/kiosk` no** exige auth — entra cualquiera con `KioskMode` feature.

**Source of truth:** [app.routes.ts](src/app/app.routes.ts)

```typescript
{
  path: 'kiosk',
  canActivate: [featureGuard],
  data: { requiredFeature: FeatureKey.KioskMode },
  ...
},
{
  path: 'kitchen',
  canActivate: [authGuard, featureGuard],
  data: {
    roles: [UserRoleId.Kitchen, UserRoleId.Owner, UserRoleId.Manager],
    requiredFeature: [FeatureKey.KdsBasic, FeatureKey.RealtimeKds],
  },
  ...
},
```

**Kitchen (`/kitchen/**`):**

El guard chain del `authGuard` corre:
1. `isAuthenticated()` — debe haber JWT en localStorage
2. `isOnboardingComplete()` — onboarding done
3. `isDeviceConfigured()` — localStorage tiene businessId/branchId (y el skip de back-office **no aplica** porque `/kitchen` no empieza con `/admin`)
4. Role check — el user debe tener `roleId ∈ {Kitchen, Owner, Manager}`

Luego `featureGuard` exige que el tenant tenga `KdsBasic` o `RealtimeKds` activos.

**Implicación:** para que un KDS opere, **algún humano con rol `Kitchen`** (o un Owner/Manager) debe haber metido su PIN al menos una vez en ese dispositivo. El JWT resultante queda en `localStorage` y sobrevive refrescos, pero:

- El JWT tiene `exp` claim (chequeado en `AuthService.isTokenExpired`). Cuando vence, `isAuthenticated()` pasa a `false` → guard step 1 falla → redirect a `/pin`.
- El idle lock, como vimos, tira a `/pin` cada 5 min aunque el JWT siga vigente.
- Si un cocinero mete su PIN, se va a casa, y al día siguiente el KDS sigue prendido → eventualmente el JWT expira → `/pin`.

**Kiosk (`/kiosk/**`):**

**Solo `featureGuard(KioskMode)`** — nada más. No pasa por `authGuard`. No chequea auth, no chequea device config.

Pero el `KioskShellComponent` hace peticiones al API (catalog, orders, checkout) a través de `ApiService` → que a su vez usa `AuthInterceptor` que adjunta `Bearer ${localStorage[AUTH_TOKEN_KEY]}`. Si **nadie loguéo en ese dispositivo jamás**, el token es `null`, el interceptor manda `Authorization: Bearer null`, el backend lo rechaza → el kiosko queda sin catálogo funcional.

**En la práctica** el kiosko funciona porque alguien (Owner/Manager) inicia el device primero vía `/setup` o vía onboarding. Ese login deja un JWT válido en localStorage que el kiosko reutiliza indefinidamente. Pero:

1. **No hay distinción entre "token de device" y "token de user"**. El kiosko está usando un token con `roleId = Owner` (el de quien provisionó). Si ese Owner es despedido y se le revoca la sesión desde el backend, el kiosko deja de funcionar.

2. **Cuando el JWT expire**, el kiosko no tiene forma de refrescarlo — no hay refresh-token flow en el código, y no hay nadie físicamente ahí para re-loguear.

3. **El idle lock está exempted en `/kiosk`**, pero si el JWT expirara y alguien navegara a cualquier ruta no-exempt, se dispara toda la cadena de errores.

**Comparativa conceptual:**

| Aspecto | KDS | Kiosk | Tablet Mesero / Cajero |
|---|---|---|---|
| Rol pretendido | Device infra | Device infra | Usuario humano |
| `authGuard` en la ruta | ✅ (bug) | ❌ | ✅ (correcto) |
| Exento de idle lock | ❌ (bug) | ✅ | ❌ (correcto) |
| Necesita PIN de usuario | Sí (bug) | No | Sí (correcto) |
| Puede refrescar JWT solo | No | No | Sí (vía PIN) |

Los dos devices de infraestructura están atrapados en el mismo modelo: **dependen del JWT de un humano** y los controles de seguridad pensados para humanos los perjudican.

### 2.3 SignalR Auth — ¿Cómo se autentica el KDS al hub?

**Respuesta corta:** el hub usa el **JWT de usuario** vía `accessTokenFactory`. Sin un humano logueado, la conexión falla silenciosamente.

**Source of truth:** [kitchen.service.ts:167-194](src/app/core/services/kitchen.service.ts#L167-L194)

```typescript
const hubUrl = `${environment.apiUrl}/hubs/kds?destination=${destinationId}`;

this.hubConnection = new HubConnectionBuilder()
  .withUrl(hubUrl, {
    accessTokenFactory: () => this.authService.getToken() ?? '',
  })
  .withAutomaticReconnect()
  .configureLogging(LogLevel.Warning)
  .build();
// ...
try {
  await this.hubConnection.start();
} catch (error) {
  console.warn('[KitchenService] SignalR connection failed:', error);
}
```

**`AuthService.getToken()`** devuelve literal `localStorage.getItem(AUTH_TOKEN_KEY)`. Si no hay JWT → devuelve `null` → el `??` lo convierte en `''` → SignalR negocia el handshake con `Authorization: Bearer <empty>` → el backend rechaza con 401 → `hubConnection.start()` lanza → el `catch` silencia el error.

**Resultado:** el KDS cae a "polling-only" silenciosamente. `pendingJobs` se refresca cada vez que `NotificationService` dispara `refresh()` (push notifications), pero no llegan los eventos `PrintJobCreated` en tiempo real. En términos del usuario: **el chef no oye el beep de una nueva orden hasta que algo más refresque la lista**.

**Problemas arquitecturales derivados:**

1. **No hay reintento con autenticación fresca.** Si el JWT expira mid-session, SignalR intentará reconectar vía `withAutomaticReconnect()` pero **re-lee el mismo token stale** del accessTokenFactory (porque `getToken()` sigue devolviendo el mismo valor). Sin refresh flow, el reconnect nunca sale del fallo.

2. **`offline-session-*` token rompe SignalR.** Cuando el login es offline (ver [auth.service.ts:256-257](src/app/core/services/auth.service.ts#L256-L257)), el token es literal `'offline-session-${Date.now()}'`. No es un JWT. El `accessTokenFactory` lo devuelve igual, SignalR lo manda, y el backend responde 401. Esto ya lo detectó AUDIT-012 (GAP-06) pero no se arregló — el hub del KDS lo hereda.

3. **El kiosko ni siquiera intenta conectarse a SignalR** (el `KioskShellComponent` no importa `KitchenService`). Si mañana queremos notificaciones realtime en el kiosko (ej. "pedido listo, recoge en la barra"), hay que resolver el mismo problema.

4. **El backend no tiene endpoint `/hubs/kds/device-auth`** (o similar) que acepte un token de device distinto del user. El único mecanismo de auth hacia SignalR es el `accessTokenFactory`, y ese solo conoce el JWT de usuario. **Es un problema de arquitectura end-to-end**, no solo frontend.

5. **Sin logging proactivo.** El `.catch()` en línea 193 hace `console.warn` pero no notifica al usuario. Un KDS que cae a polling-only no tiene banner, toast, ni indicador visual. El cocinero no sabe que el realtime dejó de funcionar.

---

## 3. Matriz de hallazgos

| ID | Severidad | Título | Ubicación |
|---|---|---|---|
| I1 | **Alta** | `/kitchen` no está en `EXEMPT_ROUTES` → auto-lock a 5 min en el KDS | [idle.service.ts:13](src/app/core/services/idle.service.ts#L13) |
| I2 | **Alta** | `authGuard` en `/kitchen` exige rol humano (`Kitchen/Owner/Manager`) → obliga a un humano a meter PIN en un dispositivo de pared | [app.routes.ts](src/app/app.routes.ts) |
| I3 | **Alta** | SignalR KDS usa `authService.getToken()` como única fuente — sin user JWT no hay realtime | [kitchen.service.ts:169](src/app/core/services/kitchen.service.ts#L169) |
| I4 | Media | No existe concepto de "device JWT" — `/devices/register` no devuelve token firmado | [device.service.ts:87](src/app/core/services/device.service.ts#L87) |
| I5 | Media | `/kiosk` depende del JWT del user que provisionó el device — queda atrapado con ese rol y expiration | [app.routes.ts](src/app/app.routes.ts) |
| I6 | Media | `IdleService` no tiene `stop()` wired a logout ni a cambio de device mode — corre para siempre | [idle.service.ts:64](src/app/core/services/idle.service.ts#L64) |
| I7 | Media | `KioskShellComponent` duplica la lógica de idle timer en paralelo al `IdleService` global | [kiosk-shell.component.ts:51-59](src/app/modules/kiosk/kiosk-shell.component.ts#L51-L59) |
| I8 | Media | SignalR falla silenciosamente en el catch — sin banner ni indicador cuando cae a polling | [kitchen.service.ts:193](src/app/core/services/kitchen.service.ts#L193) |
| I9 | Baja | El `offline-session-*` token se envía al hub SignalR → 401 garantizado | [kitchen.service.ts:169](src/app/core/services/kitchen.service.ts#L169) + [auth.service.ts:264](src/app/core/services/auth.service.ts#L264) |
| I10 | Baja | No hay refresh token flow — cuando el JWT expire, el dispositivo queda muerto hasta que un humano re-logue | [auth.service.ts](src/app/core/services/auth.service.ts) |
| I11 | Baja | Threshold único hardcoded (5 min) — no se adapta por rol ni por device mode | [idle.service.ts:7](src/app/core/services/idle.service.ts#L7) |

---

## 4. Flujos actuales vs flujos deseados

### 4.1 KDS en producción — flujo actual (roto)

```
1. Instalan tablet en pared, prenden /kitchen/1
2. Guard step 1 (auth): null → redirect /pin
3. Alguien (chef del turno mañana) mete PIN Kitchen
4. JWT válido → guard pasa → /kitchen/1 carga → SignalR hub conecta
5. hasAttemptedRecovery dispara → loadPendingPrintJobs + connectHub OK
6. Entre 5 min sin interacción → IdleService.checkIdle() detecta idle
7. /kitchen no está en EXEMPT_ROUTES → lock() corre → navigate /pin
8. El chef ve /pin en la pantalla de la pared → mete PIN otra vez
9. (Repite cada 5 minutos hasta el fin del turno)
10. Al día siguiente (JWT de 24h venció) → /pin al inicio → nueva cadena
```

### 4.2 KDS en producción — flujo deseado

```
1. Instalan tablet en pared, el Owner la provisiona como modo 'kitchen' desde /setup con su PIN/email
2. El backend emite un DEVICE TOKEN (JWT firmado con claim 'type=device', 'mode=kitchen', device_id=uuid)
3. El frontend guarda el device token separado del user token
4. La ruta /kitchen usa un deviceAuthGuard que acepta device tokens
5. IdleService lee configService.deviceConfig().mode y hace short-circuit si mode ∈ {'kitchen', 'kiosk'}
6. SignalR accessTokenFactory prefiere device token cuando existe
7. El device token tiene TTL largo (ej. 1 año) y se rota vía refresh flow automático
8. Ningún humano mete PIN jamás — la pantalla arranca sola después del boot
```

### 4.3 Kiosk en producción — flujo actual (funciona por accidente)

```
1. Provisionado por Owner/Manager vía /setup o /onboarding → JWT de Owner en localStorage
2. Device config: mode='kiosk'
3. /kiosk entra sin authGuard (bien)
4. Requests al API usan el JWT de Owner — funcionan (mal: suplantación de rol)
5. IdleService exempted en /kiosk (bien)
6. KioskShellComponent tiene su propio timer de 3 min con countdown (bien UX)
7. JWT vence en 24h (mal) — kiosko muere hasta que el Owner vuelva a loguear
```

### 4.4 Kiosk en producción — flujo deseado

```
1. Provisionado por Owner → backend emite device token con claim 'mode=kiosk'
2. El Owner SE VA. Nunca más loguea en ese kiosko.
3. /kiosk usa device token — API + realtime funcionan
4. Device token se rota solo vía refresh flow
5. Si el Owner es despedido, su user token se revoca, pero el device token del kiosko sigue válido
6. El timer interno del KioskShellComponent se mantiene (UX del cliente)
7. El IdleService global queda fuera del scope (mode='kiosk' → short-circuit)
```

---

## 5. Preguntas abiertas para diseñar la solución

1. **¿El backend puede emitir device tokens?** Necesitamos `POST /api/devices/register` que devuelva `{ deviceToken, expiresIn, refreshToken }`. Si el backend no lo soporta todavía, frontend se queda atado al user-token workaround.
2. **¿Qué claims debe tener el device token?** Sugerencia: `deviceId`, `businessId`, `branchId`, `mode`, `features[]`, `type: 'device'`, `exp`. Sin `roleId` ni `userId`. El `AuthGuard` deberá aprender a reconocer `type: 'device'` para saltarse role checks.
3. **¿Device token y user token pueden coexistir en el mismo `localStorage`?** ¿Con qué keys? Sugerencia: `pos_device_token` separado de `pos_auth_token`. El interceptor HTTP prefiere device token si existe (para KDS/Kiosk).
4. **¿Qué pasa si alguien mete PIN en un kiosko o KDS?** Caso: el Owner llega a revisar algo en /kitchen. ¿Su login sobrescribe el device token o coexiste? Propuesta: coexisten — el user token se usa para /admin, el device token para /kitchen y /pos dentro del mismo device.
5. **¿Qué threshold de idle aplica al admin?** El Owner leyendo reportes a las 11pm no espera que lo boten a /pin en 5 min. Probablemente queremos un threshold más laxo (30 min?) o ninguno en `/admin`.
6. **¿El backend del hub acepta query-string token?** Hoy SignalR usa `accessTokenFactory` que se agrega al header. Si el backend solo valida `Authorization: Bearer`, tenemos que cambiarlo ahí. Si valida `?access_token=` query, es más portable.
7. **¿Hay refresh-token flow planeado?** Sin refresh, cualquier token con `exp` finito eventualmente muere y requiere intervención humana. Para devices 24/7, esto es un no-starter.
8. **¿`KioskShellComponent` conserva su timer interno o lo migramos al `IdleService`?** Hoy son dos timers desacoplados con distintas semánticas (el del kiosk NO navega a /pin, hace `resetToWelcome`). Probablemente deban seguir desacoplados porque la semántica es distinta.
9. **¿El IdleService debe leer `configService.deviceConfig().mode` directamente para decidir exemption?** O es mejor agregar un signal `shouldRunIdleLock: boolean` en `ConfigService` que el `IdleService` consume, y ese signal se calcula en función del mode.
10. **¿Qué pasa con los usuarios Kitchen actuales?** Si los eliminamos del role enum, romperíamos los usuarios ya existentes. Propuesta: mantenemos el rol Kitchen para casos donde haya un humano identificable (ej. reporte de productividad), pero la ruta `/kitchen` acepta device token sin requerir user + rol.

---

## 6. Recomendación preliminar (no implementar hasta confirmar)

Tres capas a resolver:

### Capa 1 — Device Mode Awareness en `IdleService` (fix rápido, frontend-only)

Agregar un short-circuit al principio de `checkIdle()`:

```
if (configService.deviceConfig().mode in ['kitchen', 'kiosk', 'admin']) return;
```

Esto resuelve **I1** inmediatamente sin necesidad de backend. También permite retirar `/kiosk` de `EXEMPT_ROUTES` (redundante) y eliminar el concepto de "rutas exentas" a favor de "modos exentos".

**Pro:** 1 archivo, ~5 líneas, soluciona el auto-lock del KDS hoy mismo.
**Con:** Sigue dependiendo del user token para que el KDS reciba órdenes.

### Capa 2 — Device Token emitido por el backend (cambio de contrato)

Modificar `DeviceService.registerDevice` para que el backend devuelva `deviceToken` junto con la config. Frontend persiste en `pos_device_token` (key separada). `AuthInterceptor` prefiere device token si existe. `SignalR accessTokenFactory` prefiere device token.

**Pro:** Separa auth de device vs auth de user de forma correcta. Fix definitivo.
**Con:** Requiere backend. No es frontend-only.

### Capa 3 — `deviceAuthGuard` que acepta ambos tipos de token

Nuevo guard que:
1. Si hay device token válido → pasa (omite onboarding, device config, roles)
2. Si no hay device token pero hay user token con rol correcto → pasa (compat con flujo actual)
3. Si no hay ninguno → redirect a `/setup`

Reemplazar `authGuard` en `/kitchen` y `/kiosk` con este nuevo guard. Los demás (/pos, /admin, /tables) siguen con `authGuard`.

**Pro:** Limpia el modelo conceptual. Resuelve I2, I5, I10.
**Con:** Requiere haber resuelto Capa 2 primero.

### Sugerencia de priorización

- **Inmediato (frontend-only):** Capa 1 — fix del idle lock en KDS, exempt por device mode.
- **Siguiente sprint (requiere backend):** Capas 2 + 3 — device token + deviceAuthGuard.

La Capa 1 no es un workaround — resuelve el síntoma más visible (el operador re-entrando PIN cada 5 min) sin comprometer las capas posteriores. Cuando aterrice el device token, el short-circuit en `IdleService` seguirá siendo válido.

---

## 7. Próximo paso

**Esperando confirmación.** Si decides priorizar la Capa 1, el scope es:
- 1 archivo: `idle.service.ts`
- ~10 líneas
- 0 backend changes
- Un commit trivial con mensaje `fix(idle): skip auto-lock on devices in kitchen/kiosk/admin mode`

Si decides diseñar las Capas 2 + 3, necesito saber antes:
- Si el backend puede emitir device tokens (o cuándo)
- Claims que tendrá el token
- Key de localStorage para persistirlo
- Política de expiración y refresh

---

*Generated by Claude Code — AUDIT-026*
