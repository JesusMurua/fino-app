# AUDIT — Loops de ruteo POS → Back Office (`/setup` y `/pin`)

**Tipo:** Análisis puro (sin propuestas de fix)
**Branch:** `fix/pos-to-admin-routing-auth`
**Fecha:** 2026-04-19

---

## 1. Inventario de código relevante

| Archivo | Rol |
|---|---|
| [src/app/app.routes.ts](src/app/app.routes.ts) | Declara rutas y composición de guards |
| [src/app/core/guards/setup.guard.ts](src/app/core/guards/setup.guard.ts) | Gate de provisioning del dispositivo |
| [src/app/core/guards/auth.guard.ts](src/app/core/guards/auth.guard.ts) | Gate de identidad (sesión + onboarding) |
| [src/app/core/guards/role.guard.ts](src/app/core/guards/role.guard.ts) | Gate de permisos por rol |
| [src/app/core/guards/device-auth.guard.ts](src/app/core/guards/device-auth.guard.ts) | Gate de token de dispositivo (kiosk/kitchen) |
| [src/app/modules/pos/components/pos-header/pos-header.component.ts](src/app/modules/pos/components/pos-header/pos-header.component.ts) | Header del POS — contiene el botón "Back Office" |

Archivos de soporte inspeccionados para contextualizar predicados:

- [src/app/core/services/config.service.ts](src/app/core/services/config.service.ts) — `isDeviceConfigured()`
- [src/app/core/services/auth.service.ts](src/app/core/services/auth.service.ts) — `isAuthenticated`, `isOnboardingComplete`

---

## 2. Configuración de rutas (app.routes.ts)

### 2.1 Rutas involucradas en el loop

```ts
{ path: '',        redirectTo: 'pin', pathMatch: 'full' }                              // línea 13-17
{ path: 'setup',   canActivate: [provisioningGuard], ... }                             // línea 28-32
{ path: 'pin',     canActivate: [setupGuard],        ... }                             // línea 46-50
{ path: 'admin',   canActivate: [authGuard, roleGuard],
                   data: { roles: [Owner, Manager] }, ... }                            // línea 71-77
{ path: '**',      redirectTo: 'pin' }                                                 // línea 105-108
```

### 2.2 Observaciones clave sobre la configuración

- **`/pin` tiene `setupGuard`** como único canActivate.
- **`/admin` tiene `authGuard` + `roleGuard`**, no tiene `setupGuard`.
- **`/setup` tiene `provisioningGuard`** (no auditado aquí pero relevante en el ping-pong).
- El catch-all `**` también apunta a `/pin` (cualquier URL desconocida pasa por `setupGuard`).

---

## 3. El botón "Back Office" en el POS

Archivo: [src/app/modules/pos/components/pos-header/pos-header.component.ts:287-289](src/app/modules/pos/components/pos-header/pos-header.component.ts#L287-L289)

```ts
openAdmin(): void {
  this.router.navigate(['/pin']);   // ⚠️ navega a /pin, NO a /admin
}
```

**Hallazgo crítico:** el método que el template vincula al botón **"Back Office"** no navega a `/admin`. Navega directamente a `/pin`. El nombre del método (`openAdmin`) sugiere la intención (abrir el Back Office), pero la implementación envía al usuario a la pantalla de PIN.

Consecuencia: al pulsar el botón, la única ruta que se evalúa es `/pin`, cuyo único guard es `setupGuard`. `authGuard` y `roleGuard` **no se ejecutan nunca** en este flujo.

---

## 4. Secuencia exacta de guards al pulsar "Back Office"

Dado el código actual:

```
Click "Back Office"
      │
      ▼
openAdmin() → router.navigate(['/pin'])
      │
      ▼
ROUTE /pin  → canActivate: [setupGuard]
      │
      ├── setupGuard consulta ConfigService.isDeviceConfigured()
      │         (true ⟺ businessId > 0 AND branchId > 0)
      │
      ├── if !isDeviceConfigured()      → UrlTree('/setup')     ← Loop A
      ├── else if deviceConfig.mode === 'kiosk' → UrlTree('/kiosk')
      └── else                          → return true → renderiza PinComponent   ← Loop B
```

`authGuard`, `roleGuard`, `terminalGuard` **no intervienen** en este flujo porque el botón no apunta a una ruta que los declare.

---

## 5. Condición exacta que fuerza el redirect a `/setup`

### 5.1 setup.guard.ts — el predicado crítico

Archivo: [src/app/core/guards/setup.guard.ts:11-24](src/app/core/guards/setup.guard.ts#L11-L24)

```ts
export const setupGuard: CanActivateFn = () => {
  const configService = inject(ConfigService);
  const router = inject(Router);

  if (!configService.isDeviceConfigured()) {           // ← línea 15
    return router.createUrlTree(['/setup']);           // ← línea 16  ⟵ causa del loop A
  }

  if (configService.deviceConfig$.getValue().mode === 'kiosk') {
    return router.createUrlTree(['/kiosk']);
  }

  return true;
};
```

### 5.2 Definición de `isDeviceConfigured()`

Archivo: [src/app/core/services/config.service.ts:218-221](src/app/core/services/config.service.ts#L218-L221)

```ts
isDeviceConfigured(): boolean {
  const config = this.deviceConfig$.getValue();
  return config.businessId > 0 && config.branchId > 0;
}
```

**El guard NO consulta `onboardingCompleted` en absoluto.** El predicado depende únicamente del estado de `deviceConfig$` (BehaviorSubject poblado desde `localStorage` vía Base64-encoded JSON según se describe en el comentario de `loadDeviceConfig` en config.service.ts:223-236).

### 5.3 Condiciones que disparan el redirect a `/setup`

Cualquiera de estos estados hace que `isDeviceConfigured()` retorne `false` y gatille `UrlTree('/setup')`:

1. **No existe la clave `DEVICE_CONFIG_KEY` en localStorage.** `loadDeviceConfig` emite `DEFAULT_DEVICE_CONFIG` (que presumiblemente tiene `businessId=0, branchId=0`).
2. **La clave existe pero está corrupta / no decodifica.** El fallback emite el default.
3. **La clave existe con payload válido pero `businessId` o `branchId` siguen en `0`** (p. ej. setup parcialmente completado, o el backend nunca devolvió el binding, o el usuario tenía una sesión autenticada sin dispositivo aún registrado).
4. **`deviceConfig$` fue reseteado en memoria** (por un logout que limpia device config, o una inicialización reactiva que sobrescribe con defaults antes de que `load()` complete).

> **Nota importante sobre `onboardingCompleted`:** el usuario pregunta explícitamente por este flag. `setup.guard.ts` **no lo lee**. `onboardingCompleted` se consulta en `AuthService.isOnboardingComplete` y se usa dentro de `authGuard` para redirigir a `/onboarding` — pero ese guard no participa del flujo actual del botón "Back Office". Si hay confusión entre onboarding de negocio vs. provisioning de dispositivo, vale la pena consignarlo: son conceptos distintos y el loop a `/setup` está causado por el **segundo** (device config), no por onboarding de cuenta.

---

## 6. Condición exacta que fuerza el redirect a `/pin`

### 6.1 Explicación del loop B (el caso "a veces termina en /pin")

Con el código actual, el redirect a `/pin` no ocurre por denegación de un guard de admin — ocurre porque `openAdmin()` **ya navega directamente a `/pin`**. Cuando el dispositivo SÍ está configurado (`isDeviceConfigured()` == true) y NO es kiosk, `setupGuard` retorna `true` y el usuario aterriza en `PinComponent`. Eso es lo que el usuario percibe como "a veces me manda a /pin".

Es decir: los dos "loops" reportados no son dos bugs independientes sino **dos ramas del mismo flujo**, seleccionadas por el estado de `deviceConfig`:

| Estado de deviceConfig | Rama tomada | Resultado visible |
|---|---|---|
| `businessId=0` o `branchId=0` | `setup.guard` → UrlTree('/setup') | Loop A → `/setup` |
| válido, mode ≠ 'kiosk'        | `setup.guard` → `true`             | Loop B → `/pin` |
| válido, mode === 'kiosk'      | `setup.guard` → UrlTree('/kiosk')  | (caso no reportado) |

### 6.2 Qué haría el redirect a `/pin` si el botón apuntara a `/admin`

Para completitud, aquí está el desglose de cómo `authGuard` + `roleGuard` tratarían una navegación hacia `/admin` (no es el flujo actual, pero es la intención del botón):

#### auth.guard.ts — [src/app/core/guards/auth.guard.ts:18-32](src/app/core/guards/auth.guard.ts#L18-L32)

```ts
export const authGuard: CanActivateFn = (route) => {
  if (!authService.isAuthenticated()) {                          // ← línea 22
    localStorage.setItem(RETURN_URL_KEY, route.routeConfig?.path ?? '/');
    return router.createUrlTree(['/pin']);                       // ← línea 25  ⟵ redirect a /pin si no hay sesión
  }

  if (!authService.isOnboardingComplete()) {                     // ← línea 27
    return router.createUrlTree(['/onboarding']);                // ← línea 28
  }

  return true;
};
```

`authService.isAuthenticated` es un `computed` definido en [auth.service.ts:42](src/app/core/services/auth.service.ts#L42):

```ts
readonly isAuthenticated = computed(() => this.currentUser() !== null);
```

Por lo tanto, si al pulsar Back Office `currentUser()` retorna `null` (token expirado, logout implícito, falla al restaurar desde localStorage durante el bootstrap), `authGuard` redirige a `/pin`.

`isOnboardingComplete` (auth.service.ts:103-116) es un computed con prioridad:
`user.onboardingStatusId === 3` → `localStorage['onboarding-completed-{branchId}'] === 'true'` → claim `onboardingCompleted` en el JWT. Si ninguna de las tres fuentes afirma, redirige a `/onboarding`.

#### role.guard.ts — [src/app/core/guards/role.guard.ts:19-31](src/app/core/guards/role.guard.ts#L19-L31)

```ts
export const roleGuard: CanActivateFn = (route) => {
  const allowedRoles = route.data['roles'] ?? [];                 // [Owner, Manager] para /admin
  if (allowedRoles.length === 0) return true;

  const roleId = authService.currentUser()?.roleId;
  if (roleId && allowedRoles.includes(roleId)) return true;

  const fallback = isBackOfficeRole(roleId) ? '/admin' : '/pin';  // ← línea 29
  return router.createUrlTree([fallback]);
};
```

Si el usuario está autenticado pero su `roleId` no está en `[Owner, Manager]` (p. ej. es `Cashier` o `Waiter` trabajando en el POS), `roleGuard` lo manda a `/pin`. Solo un Owner/Manager autenticado podría entrar limpiamente a `/admin`.

---

## 7. Resumen de hallazgos

1. **El botón "Back Office" no apunta a `/admin`.** `openAdmin()` en [pos-header.component.ts:287-289](src/app/modules/pos/components/pos-header/pos-header.component.ts#L287-L289) navega a `/pin`. Esto hace que `authGuard` y `roleGuard` nunca se evalúen en este flujo.

2. **El único guard que se ejecuta es `setupGuard`**, porque `/pin` lo declara como único canActivate.

3. **El redirect a `/setup` lo produce `setupGuard`** cuando `ConfigService.isDeviceConfigured()` retorna `false`. La condición es estrictamente `deviceConfig.businessId > 0 && deviceConfig.branchId > 0`; **no se consulta `onboardingCompleted`** en este guard. El flag de onboarding vive en `authGuard` y no participa aquí.

4. **El redirect a `/pin` no es un redirect de guard** — es el destino literal de `openAdmin()`. Cuando el dispositivo SÍ está configurado, `setupGuard` retorna `true` y el usuario simplemente aterriza en la pantalla de PIN. No hay rebote de un guard de admin.

5. **Los dos "loops" reportados son el mismo flujo** ramificado por el estado de `deviceConfig` en localStorage:
   - `businessId`/`branchId` inválidos → `/setup`
   - `businessId`/`branchId` válidos y no-kiosk → `/pin`

6. **Implicación secundaria (si se corrigiera el botón a `/admin`):**
   - `authGuard` rebotaría a `/pin` si `currentUser()` es `null`.
   - Si onboarding no está completo → a `/onboarding`.
   - Si el rol no es Owner/Manager → `roleGuard` rebotaría a `/pin` (para roles no-BackOffice como Cashier/Waiter).
