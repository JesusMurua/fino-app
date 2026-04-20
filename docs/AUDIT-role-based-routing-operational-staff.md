# AUDIT — Ruteo por rol y resolución de vistas para personal operativo (Host / Waiter / Cashier)

**Tipo:** Análisis puro (sin propuestas de fix)
**Branch:** `fix/pos-to-admin-routing-auth`
**Fecha:** 2026-04-19

---

## 1. Inventario de código relevante

| Archivo | Rol |
|---|---|
| [src/app/app.routes.ts](src/app/app.routes.ts) | Declaración top-level de rutas y composición de guards |
| [src/app/modules/pos/pos.routes.ts](src/app/modules/pos/pos.routes.ts) | Sub-rutas del módulo POS (incluye `/pos/waiter`) |
| [src/app/modules/tables/tables.component.ts](src/app/modules/tables/tables.component.ts) | `/tables` se declara inline como `loadComponent` — no existe `tables.routes.ts` |
| [src/app/core/guards/role.guard.ts](src/app/core/guards/role.guard.ts) | Gate de permisos por rol |
| [src/app/core/guards/pos-entry.guard.ts](src/app/core/guards/pos-entry.guard.ts) | Resuelve variante de POS al entrar a `/pos` |
| [src/app/core/guards/terminal.guard.ts](src/app/core/guards/terminal.guard.ts) | Gate de hardware (device provisioning) |
| [src/app/core/guards/feature.guard.ts](src/app/core/guards/feature.guard.ts) | Gate por feature flag del plan |
| [src/app/core/services/device-routing.service.ts](src/app/core/services/device-routing.service.ts) | Decide destino post-login por rol + modo de device |
| [src/app/modules/pin/pin.component.ts](src/app/modules/pin/pin.component.ts) | Invoca el redirect post-login |
| [src/app/core/enums/config.enum.ts](src/app/core/enums/config.enum.ts) | Enum `UserRoleId` y `isBackOfficeRole` |

> **Nota:** No existe `src/app/modules/tables/tables.routes.ts`. La ruta `/tables` se define directamente en `app.routes.ts` como `loadComponent` del `TablesComponent`.

---

## 2. Enum de roles (referencia)

Archivo: [src/app/core/enums/config.enum.ts:2-11](src/app/core/enums/config.enum.ts#L2-L11)

```ts
export enum UserRoleId {
  Owner   = 1,
  Admin   = 2,
  Manager = 3,
  Cashier = 4,
  Waiter  = 5,
  Kitchen = 6,
  Host    = 7,
  Kiosk   = 8,
}
```

Back Office roles ([config.enum.ts:19-22](src/app/core/enums/config.enum.ts#L19-L22)):

```ts
BACK_OFFICE_ROLES = [Owner, Manager]
```

> **Observación:** `Admin` (id=2) NO está en `BACK_OFFICE_ROLES`. Todas las heurísticas que delegan en `isBackOfficeRole()` (bypass de `terminalGuard`, fallback de `roleGuard`) tratan `Admin` como rol operativo, no como Back Office.

---

## 3. Matriz de ruteo por rol

### 3.1 Guards declarados en `app.routes.ts`

| Ruta | canActivate | `data.roles` | Feature |
|---|---|---|---|
| `/admin`  | `authGuard`, `roleGuard`                                  | `[Owner, Manager]`                              | — |
| `/pos`    | `authGuard`, `roleGuard`, `terminalGuard`                 | `[Cashier, Owner, Manager, Waiter]`             | — |
| `/pos/waiter` | hereda las de `/pos` + `featureGuard` propia          | hereda `[Cashier, Owner, Manager, Waiter]`      | `WaiterApp` |
| `/tables` | `authGuard`, `roleGuard`, `terminalGuard`                 | `[Cashier, Owner, Manager, Waiter, Host]`       | — |
| `/orders` | `authGuard`, `roleGuard`, `terminalGuard`                 | `[Cashier, Kitchen, Owner, Manager, Waiter]`    | — |
| `/kitchen`| `deviceAuthGuard`, `featureGuard`                         | (no aplica — sin identidad)                     | `KdsBasic` OR `RealtimeKds` |
| `/kiosk`  | `deviceAuthGuard`, `featureGuard`                         | (no aplica — sin identidad)                     | `KioskMode` |

### 3.2 Matriz rol × ruta (según `data.roles`)

| Rol          | `/admin` | `/pos` | `/pos/waiter` | `/tables` | `/orders` |
|--------------|:---:|:---:|:---:|:---:|:---:|
| Owner        | ✅ | ✅ | ✅ (si feature) | ✅ | ✅ |
| Manager      | ✅ | ✅ | ✅ (si feature) | ✅ | ✅ |
| Admin        | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cashier      | ❌ | ✅ | ✅ (si feature) | ✅ | ✅ |
| Waiter       | ❌ | ✅ | ✅ (si feature) | ✅ | ✅ |
| Kitchen      | ❌ | ❌ | ❌ | ❌ | ✅ |
| Host         | ❌ | ❌ | ❌ | ✅ | ❌ |
| Kiosk        | ❌ | ❌ | ❌ | ❌ | ❌ |

### 3.3 Observaciones importantes sobre la matriz

1. **`/pos/waiter` no tiene allow-list propia.** En [pos.routes.ts:39-46](src/app/modules/pos/pos.routes.ts#L39-L46) solo declara `featureGuard` con `requiredFeature: WaiterApp`. Hereda los guards del padre `/pos` de [app.routes.ts:80-86](src/app/app.routes.ts#L80-L86), que permiten `[Cashier, Owner, Manager, Waiter]`. No hay filtro que restrinja la pantalla de mesero exclusivamente al rol Waiter — Cashier/Owner/Manager pueden entrar si la feature está habilitada.

2. **`/tables` incluye a `Host`** pero NO a `Kitchen`. Es la única ruta operativa donde Host aparece en la allow-list.

3. **Role `Admin`** no está permitido en ninguna ruta. El fallback de `roleGuard` lo mandaría a `/pin` (no es back-office según `isBackOfficeRole`).

4. **`roleGuard` fallback** ([role.guard.ts:29-30](src/app/core/guards/role.guard.ts#L29-L30)): si el rol no pertenece al allow-list, Back Office roles → `/admin`, resto → `/pin`. Esto significa que un Host que intente entrar a `/pos` es devuelto a `/pin` (re-auth), no a `/tables`.

5. **`terminalGuard`** ([terminal.guard.ts:25-31](src/app/core/guards/terminal.guard.ts#L25-L31)): Owner/Manager lo bypasean. Host/Waiter/Cashier lo deben pasar — si el device no tiene `businessId`/`branchId`, son reenviados a `/setup`.

---

## 4. Lógica post-PIN: qué servicio decide el destino

### 4.1 Trigger: `PinComponent.submit()`

Archivo: [src/app/modules/pin/pin.component.ts:152-209](src/app/modules/pin/pin.component.ts#L152-L209)

Tras un PIN válido (`result.user != null`), el componente realiza preloads (config, catálogo, inventario, mesas) y luego en [pin.component.ts:188-195](src/app/modules/pin/pin.component.ts#L188-L195):

```ts
const returnUrl = this.authService.consumeReturnUrl();
if (returnUrl) {
  this.router.navigateByUrl(returnUrl);
  return;
}
const dest = this.deviceRoutingService.getPostLoginRoute(result.user.roleId);
this.router.navigate([dest]);
```

Hay **dos caminos** de redirect:

1. **Return URL almacenado:** si `authGuard` previamente guardó una URL en `localStorage[RETURN_URL_KEY]` (por ejemplo, el usuario intentó `/admin` sin sesión), el PIN restaura ese destino ignorando el rol.
2. **Cálculo por rol + modo:** delegado a `DeviceRoutingService.getPostLoginRoute(roleId)`.

### 4.2 `DeviceRoutingService.getPostLoginRoute` — la tabla de decisión

Archivo: [src/app/core/services/device-routing.service.ts:34-54](src/app/core/services/device-routing.service.ts#L34-L54)

```ts
getPostLoginRoute(roleId: UserRoleId, deviceMode?: string): string {
  const mode = deviceMode ?? this.configService.deviceConfig$.getValue().mode;

  switch (roleId) {
    case Owner:
    case Manager:  return '/admin';
    case Kitchen:  return '/kitchen';
    case Host:     return '/tables';
    case Waiter:   return mode === 'tables' ? '/tables' : this.resolvePosRoute();
    case Cashier:
      if (mode === 'tables') return '/tables';
      if (mode === 'kitchen') return '/kitchen';
      return this.resolvePosRoute();
    default:       return '/pin';
  }
}
```

Matriz efectiva de **destino post-login** por rol y `deviceMode`:

| Rol      | mode = `tables` | mode = `kitchen` | mode = `kiosk` / otro / undefined |
|----------|---|---|---|
| Owner    | `/admin`  | `/admin`   | `/admin` |
| Manager  | `/admin`  | `/admin`   | `/admin` |
| Admin    | `/pin` (default) | `/pin` | `/pin` |
| Cashier  | `/tables` | `/kitchen` | `resolvePosRoute()` |
| Waiter   | `/tables` | `resolvePosRoute()` | `resolvePosRoute()` |
| Host     | `/tables` | `/tables`  | `/tables` |
| Kitchen  | `/kitchen`| `/kitchen` | `/kitchen` |
| Kiosk    | `/pin` (default) | `/pin` | `/pin` |

### 4.3 `resolvePosRoute()` — resolución de variante de POS

Archivo: [device-routing.service.ts:70-88](src/app/core/services/device-routing.service.ts#L70-L88)

Prioridad:
1. `ConfigService.posExperience()` (cargado desde Dexie/API al pre-load).
2. Fallback por `MacroCategoryType` del JWT (`MACRO_POS_EXPERIENCE` en [device-routing.service.ts:7-13](src/app/core/services/device-routing.service.ts#L7-L13)).
3. Último recurso: `/pos`.

Mapeo:

| `posExperience` | destino |
|---|---|
| `Restaurant` | `/pos` |
| `Retail`     | `/pos/retail` |
| `Counter`    | `/pos/quick-service` |
| `Quick`      | `/pos/quick` |
| (default)    | `/pos` |

### 4.4 Hallazgos del flujo de decisión

1. **`/pos/waiter` no es un destino alcanzable desde el login.** `resolvePosRoute()` nunca retorna `/pos/waiter`. No hay rama en `getPostLoginRoute` que envíe al Waiter a su pantalla dedicada; si la experiencia es `Restaurant` y modo ≠ `'tables'`, el mesero aterriza en `/pos` (RestaurantHubComponent), igual que Cashier u Owner/Manager. La única forma de llegar a `/pos/waiter` es navegación explícita (sidebar, URL, botón in-app).

2. **`posEntryGuard` reusa `resolvePosRoute()`** ([pos-entry.guard.ts:21-28](src/app/core/guards/pos-entry.guard.ts#L21-L28)). Cuando el usuario aterriza en `/pos`, el guard vuelve a resolver la variante y redirige — pero tampoco considera el rol, así que nunca deriva al Waiter a `/pos/waiter`.

3. **Host va a `/tables` incondicionalmente**, pero `Waiter` solo va a `/tables` si `deviceMode === 'tables'`. Si el modo es `'counter'`, `'retail'`, `'kitchen'`, `'kiosk'` o está vacío, el mesero termina en la variante de POS resuelta, nunca en mesas.

4. **`Cashier` puede aterrizar en tres lugares distintos** según el modo configurado en el device (`tables` / `kitchen` / POS por experiencia). El Cashier es el único rol operativo cuyo destino depende fuertemente de la config del dispositivo.

5. **Compatibilidad de destino con allow-list:**
   - Host → `/tables`: permitido por la matriz (✅).
   - Waiter → `/tables` (cuando mode=tables): permitido (✅).
   - Waiter → `resolvePosRoute()`: `/pos`, `/pos/retail`, `/pos/quick-service`, `/pos/quick` — todos bajo `/pos` → permitido (✅).
   - Cashier → `/kitchen`: NO permitido. La ruta `/kitchen` usa `deviceAuthGuard` (no `authGuard`), requiere device token. Si el Cashier aterriza aquí sin token de dispositivo, `deviceAuthGuard` lo rebotaría a `/setup?reason=unbound`. Zona de fricción potencial.

---

## 5. Protección de la vista `/tables`

### 5.1 En la ruta

Archivo: [app.routes.ts:94-102](src/app/app.routes.ts#L94-L102)

```ts
{
  path: 'tables',
  canActivate: [authGuard, roleGuard, terminalGuard],
  data: { roles: [Cashier, Owner, Manager, Waiter, Host] },
  loadComponent: () => import('.../tables.component').then(m => m.TablesComponent),
}
```

Orden de evaluación:

1. **`authGuard`**: sesión activa + onboarding completo. Si no hay sesión → `/pin` + `RETURN_URL_KEY` guardado. Si onboarding pendiente → `/onboarding`.
2. **`roleGuard`**: verifica que `currentUser().roleId ∈ {Cashier, Owner, Manager, Waiter, Host}`. Fallback: Owner/Manager → `/admin`, otros → `/pin`.
3. **`terminalGuard`**: si es Back Office (Owner/Manager) pasa directo; si no, exige `isDeviceConfigured()` (businessId>0 y branchId>0). De lo contrario → `/setup`.

### 5.2 En el componente

[tables.component.ts](src/app/modules/tables/tables.component.ts) **no tiene lógica adicional de autorización por rol**. No hay checks del tipo "si es Host mostrar X, si es Waiter mostrar Y". Toda la UI está disponible para cualquier rol que pase los guards.

Un matiz menor: `showKpis()` en [tables.component.ts:1170-1174](src/app/modules/tables/tables.component.ts#L1170-L1174) condiciona la tira de KPIs al macro-category del negocio (`FoodBeverage` o `QuickService`), no al rol del usuario.

### 5.3 Roles con acceso efectivo a `/tables`

Después de componer los tres guards y considerando el bypass de Back Office en `terminalGuard`:

| Rol | Pasa `roleGuard`? | Pasa `terminalGuard`? | Acceso efectivo |
|---|---|---|---|
| Owner   | ✅ | ✅ bypass | Sí — incluso sin device configurado |
| Manager | ✅ | ✅ bypass | Sí — incluso sin device configurado |
| Cashier | ✅ | requiere `isDeviceConfigured()` | Sí si device provisionado; si no → `/setup` |
| Waiter  | ✅ | requiere `isDeviceConfigured()` | Sí si device provisionado; si no → `/setup` |
| Host    | ✅ | requiere `isDeviceConfigured()` | Sí si device provisionado; si no → `/setup` |
| Admin   | ❌ → `/pin` | (no se evalúa) | No |
| Kitchen | ❌ → `/pin` | (no se evalúa) | No |
| Kiosk   | ❌ → `/pin` | (no se evalúa) | No |

---

## 6. Hallazgos clave (resumen para diagnóstico)

1. **`/admin` es Owner/Manager only.** Ningún otro rol (incluido el `Admin` id=2) puede entrar. Si se espera que Admin tenga Back Office, la matriz actual no lo refleja.

2. **`/pos/waiter` es una ruta huérfana del login.** Ni `DeviceRoutingService` ni `posEntryGuard` la devuelven como destino. Un Waiter aterriza en `/pos` (RestaurantHubComponent) por defecto. La pantalla dedicada existe pero solo se alcanza por navegación manual.

3. **`/tables` es la única ruta operativa con Host.** Host no puede entrar a `/pos`, `/pos/waiter`, `/orders` ni `/admin`. Es un rol con una única pantalla viable.

4. **El destino de Cashier y Waiter depende del `deviceMode`.** `'tables'` → `/tables`. `'kitchen'` (solo Cashier) → `/kitchen`. Otro → `resolvePosRoute()`. No hay consistencia entre rol y hardware: el mismo Cashier ve UI distinta según dónde abra sesión.

5. **`returnUrl` en `PinComponent` puede sobrescribir el ruteo por rol.** Si `authGuard` guardó una URL de una sesión previa (ej. `/admin` del intento anterior), al loguearse con PIN se respeta ese returnUrl aunque el nuevo rol no tenga permiso — `roleGuard` lo rebotará inmediatamente después. Esto puede producir saltos visibles `PIN → /admin → /pin` o `PIN → /pos → /pin`.

6. **`isBackOfficeRole` excluye `Admin`.** `terminalGuard` y `roleGuard` tratan `Admin` como rol operativo; combinado con que ninguna ruta lo permite, el rol queda sin destino.

7. **Sin ruteo específico por `Admin` ni `Kiosk`** en `DeviceRoutingService` → `default` → `/pin`. Un usuario con cualquiera de esos roles entraría en loop: PIN valida, lo manda a `/pin`, PIN renderiza de nuevo.
