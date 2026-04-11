# AUDIT-023: Feature Gating Frontend — Plan × Giro × Vista

**Date:** 2026-04-10
**Scope:** Frontend feature flags, plan guards, business-type gating, subscription sync
**Goal:** Evaluar el estado actual del gating por Plan y BusinessType, y proponer una arquitectura unificada basada en Signals.

---

## 1. Inventario del sistema actual

### 1.1 Piezas detectadas

| Archivo | Rol | Estado |
|---------|-----|--------|
| [plan.model.ts](src/app/core/models/plan.model.ts) | `FeatureKey` enum, `PLAN_FEATURE_MAP`, `BUSINESS_FEATURE_MAP`, `FEATURE_MIN_PLAN`, `PLAN_HIERARCHY` | Completo, bien modelado |
| [plan.guard.ts](src/app/core/guards/plan.guard.ts) | `planGuard` canActivate por `requiredPlan` en `route.data` | Activo, 3 rutas lo usan |
| [feature-flag.service.ts](src/app/core/services/feature-flag.service.ts) | `canUse`, `meetsPlan`, `isRelevantForGiro`, `lockedMessage` | Activo, 3 componentes lo consumen |
| [feature-gate.directive.ts](src/app/shared/directives/feature-gate.directive.ts) | Directiva estructural `*featureGate` | **Código muerto — no lo importa nadie** |
| [auth.service.ts](src/app/core/services/auth.service.ts) | `planTypeId`, `businessTypeId`, `trialEndsAt`, `planInfo` (signals) | SSOT parcial (ver §3) |
| [config.service.ts](src/app/core/services/config.service.ts) | `hasKitchen`, `hasTables`, `hasInvoicing`, `posExperience` signals | Fuente paralela — branch-level |
| [business.service.ts](src/app/core/services/business.service.ts) | `updateBusinessTypes` PUT /business/type | No re-sincroniza el signal local |

### 1.2 Rutas que realmente usan `planGuard`

| Ruta | requiredPlan | Archivo |
|------|--------------|---------|
| `/admin/reports` | `Pro` | [admin.routes.ts:38](src/app/modules/admin/admin.routes.ts#L38) |
| `/admin/invoicing` | `Pro` | [admin.routes.ts:105](src/app/modules/admin/admin.routes.ts#L105) |
| `/pos/waiter` | `Pro` | [pos.routes.ts:40](src/app/modules/pos/pos.routes.ts#L40) |

**Total: 3 rutas.** Todas las demás (`/kitchen`, `/kiosk`, `/admin/inventory`, `/admin/recipes`, `/admin/promotions`, `/admin/customers`, `/admin/reservations`, `/admin/registers`) son accesibles escribiendo la URL — el gating vive exclusivamente en el menú del shell.

### 1.3 Consumidores de `FeatureFlagService` (`canUse` / `isRelevantForGiro`)

- [admin-shell.component.ts:70-90](src/app/modules/admin/admin-shell.component.ts#L70-L90) — menú lateral.
- `cajas-container.component.ts` — validación inline.
- `admin-tables.component.ts` — validación inline.

Nadie más. El resto del UI asume que las features están habilitadas.

---

## 2. Respuestas a las tres preguntas del brief

### 2.1 ¿Cómo ocultamos botones/rutas si el plan no corresponde?

**Respuesta corta:** con tres mecanismos descoordinados que no se cubren mutuamente.

**Mecanismo A — `planGuard` (declarativo, route-level)**
- Compara `PLAN_HIERARCHY[currentPlan]` contra `requiredPlan` de `route.data`.
- Redirige a `/admin/upgrade` con toast informativo.
- **Cobertura: 3 rutas de ~25 rutas gateables.**
- **Bug latente:** no aplica la lógica de trial. `FeatureFlagService.getEffectivePlan` promueve a `Basic` durante el trial, pero el guard lee `planTypeId()` crudo. Resultado: un usuario Free-en-trial ve el menú "Reportes" habilitado y al hacer click es bloqueado por el guard.

**Mecanismo B — `FeatureFlagService.canUse()` (imperativo, en componente)**
- Usado exclusivamente en el `admin-shell` para calcular `show` y `locked` por item. Un item puede estar:
  - oculto totalmente (`show: false`, combina `isRelevantForGiro` + `hasTables`);
  - visible pero con candado (`locked: true`), y al click dispara un toast.
- La lógica está cableada item por item en una función `computed`. Agregar una nueva sección implica editar `allItems[]` a mano.

**Mecanismo C — `*featureGate` (estructural, declarativo)**
- [feature-gate.directive.ts](src/app/shared/directives/feature-gate.directive.ts) existe y está bien escrita, pero **ningún template del proyecto la importa ni la usa.** Código muerto — el gating declarativo en templates nunca se adoptó.

**Mecanismo D (paralelo) — `ConfigService.hasKitchen/hasTables`**
- Flags boolean por sucursal, cargados desde `/branch/{id}/config`. Se mezclan con el gating por plan en el menú: `show: hasTables` (plano) o `show: isRelevantForGiro(Inventory)` (feature map). La semántica varía por item.

**Síntesis:** no hay una capa única. El gating que ves en la UI depende de *qué componente estás tocando* y cuál de los 4 mecanismos usó el autor original.

---

### 2.2 ¿La UI reacciona al BusinessType para ocultar KDS en "Servicios"?

**Respuesta corta:** no hay gating explícito del KDS por giro.

**Lo que existe:**
- `BUSINESS_FEATURE_MAP` en [plan.model.ts:127-184](src/app/core/models/plan.model.ts#L127-L184) declara qué features son relevantes por giro. `BusinessTypeId.Servicios` solo incluye `HardwarePrinter`, `ClientsAndCredit`, `CashRegister` — no incluye nada de cocina.
- `FeatureFlagService.isRelevantForGiro()` expone la consulta.
- `admin-shell` filtra el menú *Inventario* y *Promociones* con `isRelevantForGiro`.

**Lo que NO existe:**

1. **No hay `FeatureKey.Kds`.** El KDS no aparece como feature key en ningún mapa. Está implícito en `HardwarePrinter` + `ConfigService.hasKitchen`.
2. **La ruta `/kitchen` no tiene `planGuard` ni validación de giro.** [app.routes.ts:71-76](src/app/app.routes.ts#L71-L76) solo valida roles `Kitchen/Owner/Manager`. Un negocio `Servicios` con rol Kitchen puede entrar a `/kitchen/:destinationId` escribiendo la URL.
3. **La ruta `/kiosk` no tiene guards en absoluto.** [app.routes.ts:49-53](src/app/app.routes.ts#L49-L53) es totalmente pública. Cualquier giro, cualquier plan — `BUSINESS_FEATURE_MAP[Servicios]` no incluye `KioskMode` pero la ruta igual responde.
4. **No hay link al KDS en el menú del admin-shell** — se accede únicamente vía modo de dispositivo en `/setup`. Esto enmascara el problema: no se "oculta" el botón porque no hay botón, pero la ruta sigue abierta.
5. **Triple fuente de verdad para "¿este giro tiene cocina?":**
   - `BUSINESS_FEATURE_MAP[Restaurant].includes(HardwarePrinter)` — implícito.
   - `admin-settings.component.ts:264-268` — array hardcoded `[Restaurant, Cafe, Bar, FoodTruck, Taqueria]`.
   - `onboarding.component.ts:85-94` — otro array para activar toggles de cocina.
   - `ConfigService.hasKitchen()` — flag branch-level, editable por el usuario desde admin-settings.
   - `catalog.constants.ts:45-47` — `BusinessTypeCatalog.hasKitchen` — vista catálogo del backend.

Cada una de esas 5 fuentes puede divergir. No hay contrato que las obligue a mantenerse sincronizadas.

**Conclusión:** la UI reacciona al giro en puntos puntuales del menú admin, pero el KDS como flujo crítico queda sin gating por giro. Un negocio `Servicios` teóricamente no debería ver KDS en ningún lado, pero puede aterrizar ahí por URL directa o por haber activado `hasKitchen: true` en branch config sin ninguna validación.

---

### 2.3 ¿Dónde está el cuello de botella en la sincronización JWT / State / Vista?

**Respuesta corta:** `planTypeId` vive en 3 lugares y nadie garantiza que los 3 estén sincronizados en tiempo real.

**Las 3 fuentes:**

1. **JWT claim** — embedded en el token, sólo se lee al decodificarlo manualmente en `isOnboardingComplete`. El signal `planTypeId` **no** se hidrata desde el JWT.
2. **`localStorage[AUTH_USER_KEY]`** — persistido por `handleLoginSuccess` como JSON serializado del `AuthUser`. Es de donde se inicializa el signal en el constructor (`loadUserFromStorage()?.planTypeId ?? Free`).
3. **`SubscriptionStatus`** — cacheado desde `/subscription/status` por `refreshSubscriptionStatus()`.

**Los 4 disparadores de refresh:**

- App init — [app.component.ts:76,90](src/app/app.component.ts#L76)
- Post-login PIN — [pin.component.ts:180](src/app/modules/pin/pin.component.ts#L180)
- Al abrir Settings > Billing — [admin-settings.component.ts:346](src/app/modules/admin/components/settings/admin-settings.component.ts#L346)
- Al cerrar el overlay de expiración — [expired-overlay.component.ts:60](src/app/shared/components/expired-overlay/expired-overlay.component.ts#L60)

**No hay:** polling, listener de visibilidad (`visibilitychange`), SignalR push, ni invalidación al volver online después de un período offline. El dispositivo puede estar hasta horas con un plan stale.

**Los 5 puntos donde se produce desync:**

1. **`planGuard` ignora el trial** mientras `FeatureFlagService` sí lo respeta. El guard usa `planTypeId()` crudo; el service usa `getEffectivePlan(info)` que promueve Free → Basic si `isOnTrial`. Un Free-en-trial ve el menú como Basic pero el guard lo trata como Free. ([plan.guard.ts:27-31](src/app/core/guards/plan.guard.ts#L27-L31) vs [feature-flag.service.ts:113-118](src/app/core/services/feature-flag.service.ts#L113-L118))

2. **`handleLoginSuccess` no decodifica el JWT.** Toma los campos del `LoginResponse.planTypeId` y los pone en el signal, asumiendo que el backend envía valores coherentes con el claim del token. Si el backend emite un JWT con un claim diferente al body, el frontend usa el body.

3. **`BusinessService.updateBusinessTypes()` NO llama `authService.businessTypeId.set(...)`** ([business.service.ts:48-50](src/app/core/services/business.service.ts#L48-L50)). Al cambiar el giro desde admin, el signal local sigue con el valor viejo hasta el próximo login/refresh manual. El menú del shell queda congelado.

4. **`offlinePinLogin` inventa `planTypeId`** a partir de los signals actuales ([auth.service.ts:264-266](src/app/core/services/auth.service.ts#L264-L266)). Si el dispositivo estaba offline con datos de hace 3 días, el login offline "recupera" plan stale.

5. **`switchBranch` no re-sincroniza config.** [auth.service.ts:163-173](src/app/core/services/auth.service.ts#L163-L173) pide un nuevo token scoped al branch pero `ConfigService.load()` no se dispara automáticamente. `admin-shell` escucha `activeBranchId` con un `effect` pero sólo para recargar catalog, no config. El resultado: el nuevo branch trae `hasKitchen: true` del API, pero el signal `hasKitchen` sigue con el valor del branch anterior hasta que alguien llame `configService.load()` explícitamente.

**El cuello de botella específico:** la capa `FeatureFlagService.canUse()` se evalúa cada vez que Angular corre CD sobre el `computed navItems`, pero los datos que lee (`planTypeId`, `businessTypeId`, `trialEndsAt`, `hasKitchen`, `hasTables`) vienen de **dos services distintos** (`AuthService` + `ConfigService`) que nadie fusiona. No hay un "tenant context" que garantice que los 5 valores sean consistentes con la misma sucursal / mismo token / mismo refresh. El `computed` emite con partial updates cada vez que cualquiera de las 5 fuentes cambia independientemente, causando flash de estado incorrecto en el menú durante el switch de branch y después del refresh de subscription.

---

## 3. Matriz de cobertura actual

| Feature | Plan Guard | Menu show/locked | URL bypass | Giro check | Estado |
|---------|------------|------------------|------------|------------|--------|
| `/admin/reports` | ✅ Pro | ✅ locked | ❌ (guard cubre) | ❌ | OK |
| `/admin/invoicing` | ✅ Pro | ✅ `hasInvoicing` | ❌ (guard cubre) | ❌ | OK |
| `/pos/waiter` | ✅ Pro | — | ❌ (guard cubre) | ❌ | OK |
| `/admin/registers` | ❌ | ✅ locked | ⚠️ **Sí — URL directa entra** | ❌ | Parcial |
| `/admin/inventory` | ❌ | ✅ show + locked | ⚠️ **Sí** | ✅ `isRelevantForGiro` | Parcial |
| `/admin/recipes` | ❌ | ✅ show + locked | ⚠️ **Sí** | ✅ | Parcial |
| `/admin/promotions` | ❌ | ✅ show + locked | ⚠️ **Sí** | ✅ | Parcial |
| `/admin/customers` | ❌ | ✅ locked | ⚠️ **Sí** | ❌ | Débil |
| `/admin/reservations` | ❌ | ✅ locked + `hasTables` | ⚠️ **Sí** | ⚠️ indirecto | Débil |
| `/admin/tables` | ❌ | ✅ locked + `hasTables` | ⚠️ **Sí** | ⚠️ indirecto | Débil |
| `/kitchen` (KDS) | ❌ | — (sin link) | ⚠️ **Sí, grave** | ❌ | **Crítico** |
| `/kiosk` | ❌ | — (sin link) | ⚠️ **Sí, grave** | ❌ | **Crítico** |
| `/admin/settings > Printers` | ❌ | ❌ | ⚠️ **Sí** | ❌ | Sin gating |
| `/admin/settings > Peripherals` | ❌ | ❌ | ⚠️ **Sí** | ❌ | Sin gating |

Leyenda: ✅ cubierto · ❌ ausente · ⚠️ bypass posible.

---

## 4. Propuesta de arquitectura

### 4.1 Principios

1. **Single source of truth** para el contexto del tenant. Plan, Giro, Trial, Branch flags, todo en un solo lugar.
2. **Lectura reactiva pura** — un solo `Signal<TenantContext>` que se recalcula cuando cambia cualquier pieza.
3. **Un solo enforcement point** por canal: un guard para rutas, una directiva para templates, un servicio para lógica imperativa. Los tres leen del mismo signal.
4. **Separación Plan-gate vs Giro-gate vs Flag-gate** — tres ejes ortogonales, evaluados en un solo `canUse(feature)`.
5. **Fallback al JWT como última autoridad** — el JWT es lo que el backend firmó; localStorage es un caché, y ambos se reconcilian al boot y en cada refresh.

### 4.2 Componentes nuevos / refactorizados

#### `TenantContextService` (nuevo — SSOT)

Responsabilidad: fusionar los 5 valores en un `computed<TenantContext>` único.

```
TenantContext {
  planTypeId: PlanTypeId
  effectivePlan: PlanTypeId   // promovido por trial
  businessTypeId: BusinessTypeId
  branchId: number
  hasKitchen: boolean
  hasTables: boolean
  hasInvoicing: boolean
  isOnTrial: boolean
  trialDaysLeft: number
  tokenIssuedAt: number       // del JWT — para detectar stale
}
```

Estrategia interna:
- Lee `authService.planTypeId`, `businessTypeId`, `trialEndsAt`, `activeBranchId` como signals fuente.
- Lee `configService.hasKitchen`, `hasTables`, `hasInvoicing` como signals fuente.
- Expone un único `context: Signal<TenantContext>` vía `computed()`.
- Expone además un `availableFeatures: Signal<ReadonlySet<FeatureKey>>` calculado por intersección de `PLAN_FEATURE_MAP[effectivePlan]` ∩ `BUSINESS_FEATURE_MAP[businessTypeId]`, filtrado por flags branch-level (`hasKitchen` descuenta `Kds`, `hasTables` descuenta `Tables`/`Reservations`, etc.).
- Un `refresh()` público que:
  1. Decodifica el JWT y valida que el claim `planTypeId` coincida con el signal.
  2. Llama `authService.refreshSubscriptionStatus()`.
  3. Llama `configService.load()` si cambió el branch.
- Un `effect()` interno que escucha `document.visibilityState === 'visible'` y dispara `refresh()` con debounce.

#### `FeatureFlagService` (refactor)

Queda como una fachada delgada sobre `TenantContextService.availableFeatures`.

- `canUse(f)` → `ctx.availableFeatures().has(f)` — O(1).
- `meetsPlan(p)` → `PLAN_HIERARCHY[ctx.context().effectivePlan] >= PLAN_HIERARCHY[p]`.
- `isRelevantForGiro(f)` → consulta `BUSINESS_FEATURE_MAP` directo.
- `lockedMessage(f)` → igual que hoy.

Beneficio: todos los consumidores existentes (admin-shell, cajas, tables) siguen funcionando sin cambios.

#### `featureGuard` (reemplaza `planGuard`)

Un solo guard declarativo con tres modos:

```
{ canActivate: [featureGuard], data: { feature: FeatureKey.Kds } }
{ canActivate: [featureGuard], data: { plan: PlanTypeId.Pro } }
{ canActivate: [featureGuard], data: { feature: FeatureKey.Kds, plan: PlanTypeId.Basic } }
```

Lógica:
- Si hay `feature`: `featureFlagService.canUse(feature)`.
- Si hay `plan`: `featureFlagService.meetsPlan(plan)`.
- Si hay ambos: ambos deben pasar.
- Si falla por giro → toast "No disponible para tu tipo de negocio" + redirect `/admin` (no tiene sentido mostrar `/upgrade`).
- Si falla por plan → toast + redirect `/admin/upgrade`.

**Ventaja clave:** ahora `planGuard` respetará el trial automáticamente porque llama al mismo `meetsPlan` que el resto del UI.

#### `*appFeature` directive (reusar código muerto)

Refactor de `FeatureGateDirective`:
- Usar `effect()` en vez de `OnInit/setter` — la directiva se re-renderiza automáticamente cuando cambia `availableFeatures`.
- Renombrar el selector a `*appFeature` (estándar interno).
- Dos modos: `*appFeature="FeatureKey.Kds"` y `*appFeature="FeatureKey.Kds; else lockedTpl"` con `<ng-template #lockedTpl>...`.
- Eliminar el DOM injection manual (`document.createElement`); usar templates propios de Angular.

Ejemplo de uso:
```
<button *appFeature="FeatureKey.AdvancedReports">Ver reportes</button>
<div *appFeature="FeatureKey.Kds; else kdsLocked">...</div>
<ng-template #kdsLocked><app-feature-locked [feature]="FeatureKey.Kds" /></ng-template>
```

#### `FeatureKey.Kds` (nuevo feature key)

Agregar a `plan.model.ts`:
- `KDS = 'Kds'` en el enum.
- `FEATURE_MIN_PLAN[Kds] = Basic`.
- Incluirlo en `BUSINESS_FEATURE_MAP` solo para `Restaurant`, `Cafe`, `Bar`, `FoodTruck`, `Taqueria`. **Excluirlo explícitamente de `Servicios`, `Abarrotes`, `Ferreteria`, etc.**
- Aplicar `featureGuard` con `{ feature: FeatureKey.Kds }` a `/kitchen/**`.

#### `FeatureKey.Kiosk` (ya existe como `KioskMode`)

Aplicar `featureGuard` con `{ feature: FeatureKey.KioskMode }` a `/kiosk/**` (actualmente público).

### 4.3 Diagrama de flujo propuesto

```
JWT (backend)
  │
  ├─ decodificado una vez al boot ─┐
  │                                ↓
  AuthService.planTypeId (signal)  │
  AuthService.businessTypeId       │
  AuthService.trialEndsAt          │
  AuthService.activeBranchId       │
                                   │
  ConfigService.hasKitchen ────────┤
  ConfigService.hasTables          │
  ConfigService.hasInvoicing       │
                                   ↓
                      TenantContextService.context
                      TenantContextService.availableFeatures
                                   │
           ┌───────────────────────┼───────────────────────┐
           ↓                       ↓                       ↓
      featureGuard           FeatureFlagService      *appFeature
      (rutas)                (componentes TS)        (templates)
```

### 4.4 Sync JWT / State / Vista — cómo se resuelve el bottleneck

1. **Un solo decode del JWT al boot**, en `AuthService.loadUserFromStorage` — ya hay una función `isTokenExpired` que parsea el JWT; extender para leer `planTypeId`, `businessTypeId` y compararlos contra `AuthUser`. Si divergen, el JWT gana y se persiste en localStorage.

2. **Refresh automático al volver visible:** `TenantContextService` registra un listener `document.visibilitychange` con debounce de 2s → `refreshSubscriptionStatus()`.

3. **Push por SignalR (fase 2):** reusar la conexión SignalR del KDS para recibir eventos `SubscriptionChanged` → el servicio llama `refresh()`.

4. **`switchBranch` re-sincroniza `ConfigService.load()`:** hoy `auth.service.switchBranch` pide el token nuevo pero no recarga config. Agregar un `effect()` en `TenantContextService` que escuche `activeBranchId` y dispare `configService.load()` automáticamente.

5. **`BusinessService.updateBusinessTypes` propaga al signal:** devolver un `LoginResponse` con JWT fresco y llamar `authService.handleLoginSuccess(response)` desde el componente onboarding.

6. **`offlinePinLogin` marca el contexto como stale:** agregar un flag `isOfflineSession` al TenantContext y que `featureGuard` muestre toast "Conexión necesaria para verificar tu plan" si intenta acceder a una ruta Pro sin plan conocido.

### 4.5 Migración por fases

| Fase | Alcance | Riesgo |
|------|---------|--------|
| **1** | Crear `TenantContextService` + refactor `FeatureFlagService` como fachada. Sin tocar guards ni rutas. | Bajo |
| **2** | Introducir `featureGuard` (coexiste con `planGuard`). Migrar las 3 rutas existentes. | Bajo |
| **3** | Reactivar `*appFeature` (refactor de la directiva muerta). Documentar en `html-standards.md`. | Bajo |
| **4** | Agregar `FeatureKey.Kds`. Aplicar `featureGuard` a `/kitchen` y `/kiosk`. **Enterprise blocker.** | Medio — puede romper accesos existentes si algún usuario tenía el bypass |
| **5** | Gatear `/admin/inventory`, `/admin/recipes`, `/admin/promotions`, `/admin/customers`, `/admin/reservations`, `/admin/registers` con `featureGuard`. | Medio |
| **6** | Visibilitychange listener + sync automático branch switch. | Bajo |
| **7** | Eliminar fuentes duplicadas (`showKitchenToggle`, `ENABLE_KITCHEN_FOR_GIRO`) y reemplazar con `isRelevantForGiro(Kds)`. | Bajo |
| **8** (futuro) | SignalR push de cambios de plan. | Alto — requiere backend |

---

## 5. Deuda técnica secundaria detectada

- **Enum duplicado.** `plan.model.ts` exporta `PlanType` y `BusinessType` marcados `@deprecated` en paralelo con `PlanTypeId` / `BusinessTypeId` en `enums/`. Limpiar tras fase 1.
- **`FeatureGateDirective` usa DOM injection manual** (`document.createElement`, `anchor.parentNode.insertBefore`) en vez de `ViewContainerRef.createEmbeddedView` con template — es anti-idiomático y no es reactivo a cambios de plan.
- **`cajas-container` y `admin-tables`** consumen `FeatureFlagService` pero no reaccionan reactivamente al cambio de plan (una sola llamada). Si el trial expira mientras el usuario está en la pantalla, el UI no se re-evalúa.
- **`PLAN_LIMITS`** está declarado pero ningún código lo consume. Es el próximo eje de gating (máx usuarios, máx productos) y no está wired.

---

## 6. Preguntas abiertas para confirmación

1. **¿`/kiosk` debe requerir autenticación?** Hoy es público y cualquiera puede entrar. La propuesta agrega `featureGuard` pero eso implica que el dispositivo debe estar logueado. Alternativa: dejar público pero validar el device-config signed token del backend.
2. **¿`FeatureKey.Kds` debe incluirse en el plan Free?** Hoy `BUSINESS_FEATURE_MAP[Restaurant]` no lo menciona explícitamente. Si lo excluimos de Free, un restaurante Free pierde acceso al KDS — ¿es deseado?
3. **¿El toast "No disponible para tu tipo de negocio" debe ofrecer upgrade de giro?** El giro lo cambia el Owner desde `admin/settings > business`; hoy no hay flujo de "upgrade de giro" como sí lo hay para plan.
4. **¿La propuesta de `*appFeature` reemplaza permanentemente la directiva actual o coexisten?** Recomendación: reemplazar — la directiva actual nunca tuvo consumidores.
5. **¿Quieres que agregue `PLAN_LIMITS` enforcement (maxUsers, maxProducts) en esta misma arquitectura o lo dejamos fuera de alcance?**

---

## 7. Siguiente paso

**Esperando confirmación** antes de implementar. Al aprobar, el orden sugerido es:

1. Generar un FDD (Frontend Design Doc) con el detalle de `TenantContextService` y el contrato del `featureGuard`.
2. Implementar fase 1 (`TenantContextService` + fachada) de forma no destructiva.
3. Revisar el resultado antes de avanzar a fase 4 (que es la que introduce breaking changes en `/kitchen` y `/kiosk`).

---

*Generated by Claude Code — AUDIT-023*
