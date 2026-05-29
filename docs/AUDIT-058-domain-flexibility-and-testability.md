# AUDIT-058 — Domain Flexibility, Multi-tenant Extensibility & Testability

**Fecha:** 2026-05-21
**Branch:** `feat/gym-reception-v2`
**Alcance:** Frontend (Angular 18 + PrimeNG 17). Inferencias sobre `pos-api` y `pos-local-bridge` marcadas como `[NO VERIFICADO]` — auditarse en repos separados.
**Objetivo:** Evaluar readiness para flexibilidad total de dominio (nuevos macros / giros / subgiros), escalabilidad a largo plazo, y testing automatizado (E2E / Integration). Identificar hardcoded assumptions, architectural leakage y gaps de test infrastructure.

---

## TL;DR

| Vector | Severidad | Hallazgo principal |
|---|---|---|
| **A — Domain Gating** | 🟢 **RESOLVED** | 7+ components now use TenantContext computed capabilities. HasFeaturePipe and POS_EXPERIENCE_PLACEHOLDERS added as supporting infrastructure. |
| **A — ID-range mapping** | 🟢 **RESOLVED** | Helper deleted via FDD-028 F4 (commit 807e28c); `catalogService.resolveMacro()` joins `BusinessTypeDto.primaryMacroCategoryId` against the cached `/catalog/macro-categories` response (BDD-021). |
| **A — SubGiro** | 🟠 Alto | `Yoga` y `Crossfit` declarados en enum pero **nunca usados**; solo `Gym` está cableado. Adding subgiros requiere modificar ≥4 archivos |
| **B — Frontend forms** | 🟠 Alto | 153 referencias a `FormBuilder/FormGroup/FormControl` en 10 components — ningún form metadata-driven |
| **B — Backend Global Filters** | 🟢 **RESOLVED** | `ApplyTenantFilters` en `POS.Repository/ApplicationDbContext.cs` + `IBranchScoped` / `IBusinessScoped` markers + `BranchInjectionInterceptor`. Suspicion falsified by cross-repo evidence; URL-level `branchId` params are independent of DbContext-level filters. |
| **B — Bridge supervisors** | 🟢 **RESOLVED** | Bridge parses JWT and gates 5 of 7 supervisors via `FeatureGating.IsEnabled` with fail-open pre-pairing semantics. |
| **C — WebApplicationFactory** | 🟢 **RESOLVED** | `POS.IntegrationTests/Infrastructure/CustomWebApplicationFactory.cs` + `JwtTestFactory.cs` + `FakeTenantContext.cs` + `TenantIsolationTests.cs` + `CatalogApiTests.cs` (35/35 facts). Real-JWT-signed, no auth bypass. |
| **C — SignalR loopback** | 🔴 **CONFIRMED MISSING** | Backend audit: `grep` on `POS.IntegrationTests` for `HubConnection`/`HubConnectionBuilder`/`Microsoft.AspNetCore.SignalR.Client` returns zero matches. Production hubs `/hubs/kds` + `/hubs/bridge` have no loopback tests. |
| **C — Unit tests** | 🔴 Crítico | **1 archivo `.spec.ts`** en `src/` (`cash-register.service.spec.ts`) vs ~150+ archivos productivos |
| **C — Mock JWT** | 🟢 **RESOLVED** | `seedJwtClaims()` fixture + 5 pre-canned scenarios (`TEST_TENANT_SCENARIOS`) + smoke spec validating all scenarios. See §3.2. |
| **C — Virtual hardware** | 🔴 Crítico | Sin `MockPrinterTransport` / `VirtualScanner` — flujos print/scan no testeables en CI headless |

Conclusión rápida: la **abstracción está bien diseñada** (`TenantContextService`, `*appFeature`, `featureGuard`, `FeatureKey` enum), pero **la disciplina se diluye** en 7+ componentes que saltan la capa con `currentMacro() === X`. La test infra es prácticamente inexistente — sin mock JWT + virtual hardware no se puede validar el contrato multi-tenant en CI.

---

## Sección 1 — Vector A: Domain Flexibility & Gating

### 1.1 Hardcoded macro switches con catch-all silencioso [RESOLVED]

> **Resolución (refactor AUDIT-058 / Vector A)**: los tres switches gemelos de placeholders en `product-form` fueron reemplazados por el diccionario declarativo `POS_EXPERIENCE_PLACEHOLDERS` con TypeScript exhaustivity sobre `PosExperience`. El `default → FoodBeverage` silencioso ya no existe.

#### `posExperienceForMacro` — exhaustivo (✅)
[src/app/core/services/config.service.ts:18-25](../src/app/core/services/config.service.ts#L18-L25):
```ts
function posExperienceForMacro(macro: MacroCategoryType): PosExperience {
  switch (macro) {
    case MacroCategoryType.FoodBeverage: return 'Restaurant';
    case MacroCategoryType.QuickService: return 'Counter';
    case MacroCategoryType.Retail:       return 'Retail';
    case MacroCategoryType.Services:     return 'Quick';
  }
}
```
Sin `default` — TypeScript narrowing fuerza exhaustividad. Agregar un macro nuevo rompe build aquí. **OK por diseño.**

#### `product-form` placeholders — 3 switches gemelos con `default` peligroso
[src/app/modules/admin/components/products/product-form/product-form.component.ts:182-217](../src/app/modules/admin/components/products/product-form/product-form.component.ts#L182-L217):
```ts
switch (this.tenantContext.currentMacro()) {
  case MacroCategoryType.Retail:       return 'Ej. Coca-Cola 600ml';
  case MacroCategoryType.Services:     return 'Ej. Mensualidad';
  case MacroCategoryType.QuickService: return 'Ej. Café americano';
  default:                             return 'Ej. Torta de Milanesa';   // ← FoodBeverage assumption
}
```
**Tres switches idénticos** (`namePlaceholder`, `modifierGroupPlaceholder`, `modifierExtraPlaceholder`). Si agregas `Hospitality`, **se renderiza con placeholders de Restaurante silenciosamente**. Open-Closed violado.

### 1.2 ID-range hardcoded para inferir macro [RESOLVED — FDD-028 F4 commit 807e28c]

> **Resolution (FDD-028 / Vector A complement)**: el helper `macroOfBusinessType()` fue eliminado en la fase F4 de [FDD-028](FDD-028-catalog-api-integration.md). Reemplazo: `catalogService.resolveMacro(businessTypeId)` joinea `BusinessTypeDto` cached + `MacroCategoryDto` cached por `primaryMacroCategoryId`. Backend ahora ship `BusinessTypeDto.primaryMacroCategoryId` como FK explícita (BDD-021), eliminando la necesidad de inferir macro por rangos de ID en el frontend. La función `macroOfBusinessType()` fue eliminada de `config.enum.ts` en el commit 807e28c (FDD-028 F4).

[src/app/core/enums/config.enum.ts:106-111](../src/app/core/enums/config.enum.ts#L106-L111):
```ts
export function macroOfBusinessType(id: BusinessTypeId): MacroCategoryType {
  if (id <= 3)  return MacroCategoryType.FoodBeverage;
  if (id <= 9)  return MacroCategoryType.QuickService;
  if (id <= 16) return MacroCategoryType.Retail;
  return MacroCategoryType.Services;
}
```
Range conditions sobre IDs autoincrementales = acoplamiento al orden de seeding del backend. **Si backend reordena `BusinessTypeId` values o inserta entre rangos**, el frontend asigna macro incorrecto sin error. Drift garantizado entre dos repos que mantienen la "misma" tabla mentalmente.

### 1.3 SubGiro hardcoded en componentes

[src/app/modules/admin/admin-shell.component.ts:159-161](../src/app/modules/admin/admin-shell.component.ts#L159-L161):
```ts
const isGym = this.tenantContext.currentSubCategory() === SubCategoryType.Gym;
const isServices = this.tenantContext.currentMacro() === MacroCategoryType.Services;
if (isGym || isServices) return 'Pantallas y Accesos';
```

[src/app/core/enums/config.enum.ts:138-141](../src/app/core/enums/config.enum.ts#L138-L141):
```ts
export function subCategoryOfBusinessType(id: BusinessTypeId): SubCategoryType {
  if (id === BusinessTypeId.Gimnasio) return SubCategoryType.Gym;
  return SubCategoryType.Generic;
}
```

`SubCategoryType.Yoga` y `SubCategoryType.Crossfit` están **declarados pero nunca usados**. Adding Yoga/Crossfit/Spa requiere:
- Update `subCategoryOfBusinessType()`.
- Update cada `currentSubCategory() === SubCategoryType.Gym` (admin-shell, admin-customers, dashboard, admin-products → 5 files con refs a `SubCategoryType.*`).
- Update `posExperience` resolution si nueva subcat necesita layout distinto.

### 1.4 `hasKitchen` con fallback codeado al macro [RESOLVED — FDD-028 F3 commit bbefbe1 + F6 commit 6333d14 + F5 B3 commit 38e6bc8]

> **Resolution (FDD-028)**: la race condition en cold-boot desapareció cuando [FDD-028](FDD-028-catalog-api-integration.md) cerró: (a) F3 cambió la fuente de `hasKitchen` de `currentBusinessType()?.hasKitchen` (campo que ya no existe en `BusinessTypeDto`) a `TenantContextService.currentBusinessType()` synthetic shape que joinea con `MacroCategoryDto` cached; (b) F6 commiteó seed JSONs bajo `src/assets/catalog-seed/*.json` garantizando que `MacroCategoryDto` está disponible en cualquier boot (incluyendo first-install offline); (c) F5 migró el fallback macro-based en `tenant-context.service.ts:99-100` a comparación contra `MacroCategoryCode` (string) alongside la migración del enum. `tenant-context.service.ts:99` ahora compara contra `MacroCategoryCode.FoodBeverage` (string code), y el macro fallback path solo se activa durante la breve ventana de cold-boot antes de que Dexie / seed JSON hidraten — que ahora es sub-20ms.

[src/app/core/services/tenant-context.service.ts:97-100](../src/app/core/services/tenant-context.service.ts#L97-L100):
```ts
readonly hasKitchen = computed(
  () => this.currentBusinessType()?.hasKitchen
    ?? (this.currentMacro() === MacroCategoryType.FoodBeverage),
);
```
Si llega un nuevo macro con cocina (ej. `Hospitality` con room service), el fallback asume "no kitchen" hasta que el catálogo backend hidrate `hasKitchen` en `BusinessTypeCatalog`. Race condition en cold-boot — la UI puede arrancar sin cocina antes de hidratar.

### 1.5 `isFoodAndBeverage` propagado en bounded contexts [RESOLVED]

> **Resolución (refactor AUDIT-058 / Vector A)**: `isFoodAndBeverage` fue eliminado y reemplazado por el computed signal `supportsKitchenOrders` en `TenantContextService`, mapeado a `hasAnyFeature([PrintedTickets, MaxKdsScreens, TableMap])`. `cart-panel` y su template consumen ahora este signal — el bounded context ya no tiene macro-awareness, solo capability awareness.

[src/app/modules/pos/components/cart-panel/cart-panel.component.ts:106-108](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L106-L108):
```ts
readonly isFoodAndBeverage = computed(() =>
  this.tenantContext.currentMacro() === MacroCategoryType.FoodBeverage,
);
```
Combinado con [cart-panel.component.html](../src/app/modules/pos/components/cart-panel/cart-panel.component.html) que tiene `@if` contra esto, mete macro-awareness en un componente que debería ser polimórfico (`RestaurantCartPanel` vs `RetailCartPanel` por factory).

### 1.6 Direct comparison `currentMacro() === X` en 7 files

| Archivo | Comparación | Status |
| --- | --- | --- |
| [cart-panel.component.ts:107](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L107) | `=== FoodBeverage` | `[RESOLVED]` |
| [admin-shell.component.ts:160](../src/app/modules/admin/admin-shell.component.ts#L160) | `=== Services` | `[RESOLVED]` |
| [admin-devices.component.ts:307](../src/app/modules/admin/components/devices/admin-devices.component.ts#L307) | `=== Services` | `[RESOLVED]` |
| [dashboard.component.ts:125](../src/app/modules/admin/components/dashboard/dashboard.component.ts#L125) | `=== null` (guard) | `[RESOLVED]` |
| [product-form.component.ts:166](../src/app/modules/admin/components/products/product-form/product-form.component.ts#L166) | `=== Services` | `[RESOLVED]` |
| [tenant-context.service.ts:99](../src/app/core/services/tenant-context.service.ts#L99) | `=== FoodBeverage` (autodepend) | `OPEN / DEFERRED` |
| [product-form.component.ts:182,197,212](../src/app/modules/admin/components/products/product-form/product-form.component.ts#L182) | 3 switches | `[RESOLVED]` |

> **Nota arquitectónica sobre la fila `tenant-context.service.ts:99`**: este fallback es un *defensive race-condition handler* (el flag `hasKitchen` del catálogo puede no estar hidratado en cold-boot), **NO** un business gate. Se conserva conscientemente como la única referencia sancionada a `MacroCategoryType` dentro de `TenantContextService` — ver §1.4 para el detalle de race-condition.

### 1.7 Costo de agregar un nuevo macro (ej. `Hospitality`)

> **Update post-refactor**: el costo arquitectónico ha bajado **más del 50%** tras cerrar Vector A. Los puntos marcados a continuación reflejan el nuevo estado.

Touchpoints obligatorios:
1. `MacroCategoryType` enum en [config.enum.ts](../src/app/core/enums/config.enum.ts).
2. `macroOfBusinessType()` range table.
3. `parseMacroCategoryClaim()` switch en [jwt.utils.ts:55-66](../src/app/core/utils/jwt.utils.ts#L55-L66).
4. `posExperienceForMacro()` switch (TS lo fuerza ✅).
5. `MACRO_CATEGORY_LABELS` Record (TS lo fuerza ✅).
6. `GIRO_FEATURE_MAP` Record (TS lo fuerza ✅).
7. Nuevo `HOSPITALITY_FEATURES: readonly FeatureKey[]` array.
8. ~~Cada `currentMacro() === X` comparison (7+ files).~~ **Reduced to 2 deferred instances** (`hasKitchen` fallback en `tenant-context.service.ts`, `hasModifiersSection` en `product-form`).
9. ~~Cada switch en `product-form.component.ts` (3 placeholders).~~ **Streamlined into 1 entry** inside `POS_EXPERIENCE_PLACEHOLDERS`.
10. **Backend** debe agregar el valor al claim emitter del JWT, al EF enum, y al `DeviceModeCatalog` si el macro habilita modos nuevos.

TypeScript fuerza ~30% del trabajo (puntos 4-6); el resto es grep-manual — pero el grep-surface se redujo de 7+ files + 3 switches a 2 instances + 1 catalog entry.

### 1.8 Refactor Design Decisions & Proxies

Esta sub-sección documenta los proxies semánticos introducidos durante el refactor que cerró Vector A. Cada uno mapea un check macro/subgiro original a una capability o feature ya existente — sin agregar verticales al enum `FeatureKey`.

- **`hasFeature(FeatureKey.RealtimeAccessControl)`** se usa como proxy pragmático para `isAccessControlTenant`, reemplazando el legacy `currentSubCategory() === Gym`. Reusado en `dashboard.component.ts` y `admin-customers.component.ts` para mantener consistencia cross-screen. Funcional 1-to-1 hoy porque `RealtimeAccessControl` solo se emite a tenants Services-macro; si producto requiere granularidad fina (ej. Spa sin realtime), promover a `FeatureKey.MembershipExpirationDashboard` dedicado.
- **`supportsMemberships`** mapeado a `posExperience in {'Quick', 'Services'}` porque el backend emite ambos como sinónimos durante la migración cross-repo (per los docs del tipo `PosExperience`). Cuando la migración consolide a un solo valor, simplificar el predicado.
- **`supportsKitchenOrders`** como capability broad mapeada a `hasAnyFeature([PrintedTickets, MaxKdsScreens, TableMap])` — semántica "tenant has any F&B-style flow", **no 1-to-1** con el macro `FoodBeverage`. Si producto pide split fino (ej. `supportsTableOrders` vs `supportsKitchenPrint`), el split queda diferido.
- **`admin-shell`** "Pantallas y Accesos" device label gateado vía `hasAnyFeature([MaxReceptionsPerBranch, RealtimeAccessControl])` — mismo patrón de proxy que el access-control dashboard, para coherencia de copy entre sidebar y screens.
- **`isHydrated`** derivado de `currentMacro !== null` — semántica "tenant context ready" más que "macro present"; reemplaza el legacy `currentMacro() === null` loading-guard pattern en 2 componentes (`admin-shell.component.ts:187`, `dashboard.component.ts:125`).

---

## Sección 2 — Vector B: Architectural Extensibility

### 2.1 Frontend — Templates con `@if (currentMacro/isFoodAndBeverage)` [PARTIALLY RESOLVED]

> **Resolución parcial (refactor AUDIT-058 / Vector A)**: las 3 templates fueron migradas a capability signals (`supportsKitchenOrders` en `cart-panel.html`, `isAccessControlTenant` en `dashboard.html` y `admin-customers.html`). El constructo `@if` permanece como gating mechanism — pero su condición referencia capability signals en lugar de valores macro directos. El refactor polimórfico (factory keyed on `posExperience`) sigue diferido.

3 archivos HTML usan condicionales contra macros directos:
- [cart-panel.component.html](../src/app/modules/pos/components/cart-panel/cart-panel.component.html)
- [admin-customers.component.html](../src/app/modules/admin/components/customers/admin-customers.component.html)
- [dashboard.component.html](../src/app/modules/admin/components/dashboard/dashboard.component.html)

En lugar de componentes polimórficos cargados por factory keyed on `posExperience`, hay templates monolíticos con bloques condicionales. **Crecimiento lineal mal contenido**: cada nuevo vertical agrega `@if` blocks al mismo file en lugar de crear un nuevo componente.

### 2.2 Forms estáticos, no metadata-driven [PARTIALLY RESOLVED — product-form POC only]

> **Resolución parcial (Vector B POC)**: se implementó la arquitectura de 3 capas (`schemas/*` → `ProductFormBuilderService` → renderers `<app-form-field>` / `<app-form-section>` / `<app-product-preview>`) **acotada al `product-form`**. El `@switch (currentMacro())` del preview pane fue reemplazado por `<app-product-preview [variant]="schemaFor(posExperience()).previewVariant">`. Los otros 9 archivos con FormBuilder permanecen hand-rolled — extensión gradual via **"Rule of 3"** (cuando un segundo form requiera el patrón, el `ProductFormBuilderService` se generaliza a `shared/`).

**153 referencias** a `FormBuilder/FormGroup/FormControl` en 10 component files. Cada form es hand-rolled. No hay:
- Definición declarativa de forms por giro (ej. `FormSchema[giro]`).
- Generación dinámica desde catalog backend.
- Validators driven by tenant claims.

Si Hospitality necesita campo "Room number" en checkout, hay que tocar `checkout.component.ts` + `.html` + validators + reactivity manualmente.

### 2.3 `TenantContextService` con buena API, mal aprovechada [PARTIALLY RESOLVED]

> **Resolución parcial (refactor AUDIT-058 / Vector A)**: se agregaron 3 nuevos computed signals (`isHydrated`, `supportsKitchenOrders`, `supportsMemberships`) a `TenantContextService`; 6 componentes los consumen (`cart-panel`, `admin-shell`, `admin-devices`, `dashboard`, `product-form`, `admin-customers`). El refactor más profundo hacia keys verticales (`FeatureKey.VerticalRestaurant`, etc.) **NO** se persiguió — capability signals fueron juzgados mejor fit que vertical FeatureKey leakage en el enum.

La service tiene **excelente método declarativo** [`isApplicableToGiro(feature)`](../src/app/core/services/tenant-context.service.ts#L182-L191) que delega a `GIRO_FEATURE_MAP`. Sin embargo:
- **`isApplicableToGiro` se usa solo en `admin-shell.component.ts`** (grep: 14 refs total, mayoría en la propia service + directive).
- Los componentes prefieren la ruta dura `currentMacro() === X` (7+ files).

**Refactor sugerido**: extender `FeatureKey` con keys verticales (`VerticalRestaurant`, `VerticalGym`, `VerticalHospitality`) y migrar todos los checks `currentMacro() === ...` a `hasFeature(FeatureKey.VerticalGym)`. Centraliza el sistema en un solo grafo declarativo.

### 2.4 `*appFeature` directive — buen patrón infrautilizado

[src/app/shared/directives/app-feature.directive.ts](../src/app/shared/directives/app-feature.directive.ts) es excelente:
- Reacciona via `effect()` a signals de TenantContextService.
- Dos modos: `hide` (saca del DOM) vs `lock` (renderiza con clase `feature-locked`).
- 14 referencias totales en el codebase. **Subutilizada** — muchos componentes prefieren `@if` template-level en lugar de la directiva.

### 2.5 JWT claim parsing tolerante a backend drift (señal de fragilidad)

[src/app/core/utils/jwt.utils.ts:32-34](../src/app/core/utils/jwt.utils.ts#L32-L34):
```ts
let feats = payload.features;
if (typeof feats === 'string') {
  try { feats = JSON.parse(feats); } catch { return undefined; }
}
```
[jwt.utils.ts:54](../src/app/core/utils/jwt.utils.ts#L54):
```ts
const normalised = value.toLowerCase().replace(/[^a-z]/g, '');
```
Estos branches existen porque el backend ha emitido el mismo claim en formatos distintos en distintos momentos. **Contrato JWT no congelado** → riesgo de regresión silenciosa cada vez que backend ajusta `JsonSerializerOptions`. Sugerir contract test en CI compartido entre repos.

### 2.6 Backend EF Core Global Query Filters [RESOLVED — cross-repo evidence delivered]

> **Resolution (cross-repo audit 2026-05-23)**: la sospecha está **falseada**. EF Core Global Query Filters **están presentes** en `pos-api`. Evidence:
> - `POS.Repository/ApplicationDbContext.cs::ApplyTenantFilters(ModelBuilder)` invocado desde `OnModelCreating`.
> - Marker interfaces: `POS.Domain/Interfaces/IBranchScoped.cs` (`int BranchId`) + `POS.Domain/Interfaces/IBusinessScoped.cs` (`int BusinessId`).
> - `ITenantContext` (Scoped) inyectado al DbContext; resuelto per-request desde JWT claims por `POS.Repository/Tenancy/HttpTenantContext.cs`.
> - `ApplyTenantFilters` itera `modelBuilder.Model.GetEntityTypes()` y construye expression-tree filters `e => !ctx.{Scope}.HasValue || e.{Scope} == ctx.{Scope}.Value` vía `IMutableEntityType.SetQueryFilter`. Para entidades que implementan ambas markers, los predicados se componen con `Expression.AndAlso`.
> - Write-side guard: `POS.Repository/Interceptors/BranchInjectionInterceptor.cs` overwrites `BranchId` on inserts para `IBranchScoped`.
> - Filters degrade to no-op cuando `ITenantContext` regresa `null` (background jobs, EF design-time tooling, migrations, seeding) — by design.
>
> **Frontend explicit `branchId` URL params son independientes del DbContext-level filter** (likely para cross-branch admin flows explícitos). Routine endpoints **sí** están protegidos.

Sin acceso al repo `pos-api` al momento del audit original. Inferencias desde el frontend (legacy — superseded by cross-repo evidence above):
- JWT carga `businessId` y `branchId` claims.
- Endpoints como `/api/branch/{id}/config`, `/api/Devices/limits?branchId={id}` — el `branchId` se pasa **explícitamente** en URL/query.
- Si EF Core tuviera `HasQueryFilter` transparente sobre `BranchId`, el frontend no necesitaría pasarlo (el filtro se aplicaría desde el JWT claim server-side).
- ~~**Sospecha fuerte**: el backend NO aplica filtros globales transparentes a nivel de DbContext.~~ **FALSEADA** — ver resolución arriba.

~~**Recomendación urgente**: auditar `pos-api` para confirmar si existen `modelBuilder.Entity<T>().HasQueryFilter(e => e.BranchId == _tenantContext.BranchId)` para entidades scopeables.~~ **HECHO** — confirmado presente.

### 2.7 Bridge supervisors [RESOLVED — cross-repo evidence delivered]

> **Resolution (cross-repo audit 2026-05-25)**: la sospecha está **cerrada**. El `pos-local-bridge` (Windows Worker Service, .NET 8) es SMART y multi-tenant ready. Evidence:
> - **JWT parsing**: `PosLocalBridge.Security/JwtDeviceClaimsReader.cs` (registered singleton vía `IDeviceClaimsReader`) extrae `branchId`, `businessId`, `mode`, `features` del device JWT. Signature validation NO se realiza localmente — el cloud es single source of truth post-pairing (consume vía `JwtSecurityTokenHandler.ReadJwtToken`, no `ValidateToken`). Claims **NO extraídos** (known one-line extension point en `ParseClaims`): `macroCategory`, `planType`, `type`, `deviceId`. El claim `features` ship como nested JSON string (`"features": "[\"RealtimeAccessControl\",\"CoreHardware\"]"`) y se parsea en 2 pasos vía `ReadFeaturesClaim`. Cache thread-safe (SemaphoreSlim-gated), lifetime-of-process; null results NOT cached.
> - **Feature gating**: single source of truth `PosLocalBridge.Security/FeatureGating.cs::IsEnabled(claims, requiredFeature)` con **fail-open semantics** (returns `true` si `claims is null` o `requiredFeature` está vacío). Fail-open es **deliberate by design** para preservar pre-pairing compatibility — first-boot antes de que se emita cualquier token debe permitir que los supervisors arranquen.
> - **Gateable supervisors (5/7)** evalúan claims en su `StartAsync` y skip subscription/port-open/timer-start si el feature requerido está ausente: `TurnstileSupervisor`, `PrinterSupervisor`, `BiometricSupervisor`, `SerialInputSupervisor` (per-device gating en el event handler — Scale role fail-open, Access role gated), `AccessSyncSupervisor`. Required features son config-driven (`Hardware:*:RequiredFeature` en appsettings.json) — backend renames no fuerzan code changes.
> - **Unconditional services (3/7) by design**: `ResetBootstrapService` (consume `%ProgramData%\Fino\reset.txt` pre-token), `HealthMonitor` (telemetry must report regardless of feature set), `Worker` (orchestrator drives pairing + SignalR connect loop). DI registration order en `BridgeHostBuilder.cs:67-77` es intencional — bootstrap first, supervisors next, Worker last.
> - **Architectural debt remaining**: AD-3 (OCP-mini en `PrinterConnectionFactory` y `SerialInputSupervisor` role dispatch) y AD-5 (`PairingResponse` non-token fields logged but not propagated to runtime). Ambos classified Low severity en bridge repo audit.
>
> **Implication**: el bridge **no** es un passive consumer que inicializa hardware blindly. Honora el contrato multi-tenant end-to-end. Si se requiere gating por macro/plan en el futuro, agregar extracción en `JwtDeviceClaimsReader.ParseClaims` + nuevo field en `DeviceClaims` record + consumer en el supervisor afectado (one-line change documentado).

Sin acceso a `pos-local-bridge` al momento del audit original. Inferencias desde frontend + audit anterior del backend (legacy — superseded by cross-repo evidence above):

- El device JWT del bridge incluye `features` claim. ✅ Confirmed.
- `BridgeHub.OnConnectedAsync` agrupa por `mode === 'bridge'` vs otros.
- ~~**No puedo verificar** si los supervisors del Bridge (impresora, scanner, scale, biometric) consultan `features` antes de inicializarse o si arrancan todos ciegamente.~~ **FALSEADA** — los 5 supervisors gateables consultan `features` vía `FeatureGating.IsEnabled` (ver resolución arriba).

~~**Recomendación**: pedir audit explícito del bridge enfocado en supervisor lifecycle vs feature claims.~~ **HECHO** — Bridge Architectural Audit completed 2026-05-25.

---

## Sección 3 — Vector C: Testability & Infrastructure Resiliency

### 3.1 Cobertura unit testing despreciable

- **1 archivo `.spec.ts` en `src/`** ([cash-register.service.spec.ts](../src/app/core/services/cash-register.service.spec.ts)).
- Ratio: **1 test : ~150+ archivos productivos** (~0.6%).

Servicios críticos sin test:
- `TenantContextService` — ¿qué pasa con cada combinación macro × plan × features?
- `AuthService` — flujo JWT, refresh, logout
- `CartService` — cents/totals/promos
- `SyncService` — offline-first sync
- `PrinterService` — ESC/POS bytes
- `PrintService` — orchestration
- `BridgeHttpTransport`, `PrintBridgeService` — recién agregados, sin test

Componentes sin `.spec.ts`: 100%.

### 3.2 E2E con cobertura mínima + sin mock JWT [RESOLVED]

> **Resolución (Vector C §3.2)**: implementado `seedJwtClaims(page, claims)` + `mockAuthMeEndpoint(page, claims)` en [e2e/fixtures/jwt-mock.ts](../e2e/fixtures/jwt-mock.ts). Sintetiza un JWT firmado-formato + AuthUser completo (con `primaryMacroCategoryId` numérico, `onboardingStatusId: 3`, `features[]`, `currentBranchId`) e inyecta en `localStorage` antes de cualquier script de página. Adicional: [e2e/fixtures/scenarios.ts](../e2e/fixtures/scenarios.ts) con 5 escenarios pre-canned (`RESTAURANT_PRO`, `QUICK_SERVICE_PRO`, `RETAIL_BASIC`, `GYM_PRO`, `FREE_TIER`). Validado vía [e2e/tests/jwt-mock-smoke.spec.ts](../e2e/tests/jwt-mock-smoke.spec.ts) — 5/5 tests verde, smoke spec valida el contrato del fixture (token shape, AuthUser shape, JWT claims). Nota: full vertical-aware UI rendering end-to-end espera resolución de §3.3 (CapturingPrinterTransport) y mocks de `/business/settings` + `/tax/catalog`.

**3 archivos E2E**: [login.spec.ts](../e2e/tests/login.spec.ts), [pin.spec.ts](../e2e/tests/pin.spec.ts), [stock-receipts.spec.ts](../e2e/tests/stock-receipts.spec.ts).

Único fixture: [`seedDeviceConfig()`](../e2e/fixtures/device-config.ts) — inyecta DeviceConfig en localStorage. **NO existe equivalente para JWT con claims variables**. Para testear "Gym tenant ve banner X" o "FoodBeverage tenant tiene cocina visible", necesitas:

```ts
// FALTANTE:
export async function seedJwtClaims(page: Page, claims: {
  macroCategory: 'FoodBeverage' | 'QuickService' | 'Retail' | 'Services';
  features: FeatureKey[];
  planType: PlanTypeId;
  subCategory?: SubCategoryType;
}): Promise<void> { /* construye JWT mock, lo mete en localStorage */ }
```

Sin esto, **es imposible** testear el matrix Vertical × Plan × Features end-to-end.

### 3.3 No virtual hardware abstractions

- `SerialTransport`, `BluetoothTransport`, `BridgeHttpTransport` implementan [`PrinterTransport`](../src/app/core/services/printer-transport.interface.ts) — buen abstracto.
- **No existe `VirtualPrinterTransport` / `CapturingPrinterTransport`** para tests E2E o integration.
- Sin esto: tests que ejerzan flujo "checkout → print" no pueden correr en CI headless. El frontend escupe "Impresora no conectada" en cada test.

Recomendación:
```ts
// public mock que captura bytes en memoria
export class CapturingPrinterTransport implements PrinterTransport {
  bytesWritten: Uint8Array[] = [];
  get isConnected() { return true; }
  async write(data: Uint8Array) { this.bytesWritten.push(data); }
  // ...
}
```
Inyectable en tests via `providers: [{ provide: PrinterService, useFactory: () => mock }]`.

### 3.4 WebApplicationFactory audit (backend) [RESOLVED — cross-repo evidence delivered]

> **Resolution (cross-repo audit 2026-05-23)**: `POS.IntegrationTests` project **existe** en `pos-api` (xUnit 2.9.3 + `Microsoft.AspNetCore.Mvc.Testing` 10.0.3 + EF Core InMemory 10.0.4 + FluentAssertions 6.12.2). Evidence:
> - `POS.IntegrationTests/Infrastructure/CustomWebApplicationFactory.cs` — extends `WebApplicationFactory<Program>`. Static ctor sets JWT/Stripe/HMAC test secrets antes de `Program.Main`. `ConfigureWebHost` swaps `DbContextOptions<ApplicationDbContext>` a `UseInMemoryDatabase($"PosTests_{Guid.NewGuid():N}")`, remueve hosted services en namespace `POS.API.Workers`.
> - `POS.IntegrationTests/Infrastructure/JwtTestFactory.cs` — forja real HS256 tokens con la misma key que el test host valida. Métodos: `CreateUserToken(businessId, branchId, userId, role)`, `CreateDeviceToken(businessId, branchId, mode, features[])`.
> - `POS.IntegrationTests/Infrastructure/FakeTenantContext.cs` — mutable `ITenantContext` para DbContext-level tests.
> - `POS.IntegrationTests/Infrastructure/InMemoryModelCustomizer.cs` — pre-registra `JsonDocument? ↔ string` value converter.
> - `POS.IntegrationTests/Tenancy/TenantIsolationTests.cs` — `IClassFixture<CustomWebApplicationFactory>`, seeds Business B + 2 orders, runs both HTTP test y DbContext-level test.
> - Adicional: `POS.IntegrationTests/Catalogs/CatalogApiTests.cs` ships 13 integration tests para BDD-021 (35/35 facts passing incluyendo theory expansions). Ver [BDD-021 §9.2](BDD-021-Dynamic-Catalogs-API.md).
> - **Authentication mocking**: NO bypass handler. Tests firman JWTs reales con la symmetric key del validator. Tenant seeding per test class.

Cannot inspect `pos-api` al momento del audit original. Standard pattern .NET integration tests (legacy — superseded by cross-repo evidence above):
```csharp
public class CustomWebApplicationFactory : WebApplicationFactory<Program> {
  protected override void ConfigureWebHost(IWebHostBuilder builder) {
    builder.ConfigureServices(services => {
      services.AddSingleton<ITenantContext>(MockTenantContext.Gym());
    });
  }
}
```

Si no existe en pos-api → cada integration test arranca host real con DB real → tests slow + flaky + sin variabilidad de claims.

### 3.5 Sin loopback de SignalR hubs [CONFIRMED MISSING — cross-repo evidence]

> **Cross-repo audit confirmation (2026-05-23)**: backend audit verificó explícitamente:
> - `grep` on `POS.IntegrationTests` for `HubConnection`, `HubConnectionBuilder`, `Microsoft.AspNetCore.SignalR.Client`, `TestServer.*Hub`, `SignalRTest` → **zero matches**.
> - `Microsoft.AspNetCore.SignalR.Client` NuGet **NOT referenced** from the test project.
> - Production hubs registrados en `POS.API/Program.cs:395-396`: `/hubs/kds` (KdsHub) + `/hubs/bridge` (BridgeHub).
> - **Ningún** hub tiene loopback / end-to-end integration test que asserte event emission.
> - Las únicas referencias a "SignalR" en el repo son design docs (`docs/AUDIT-026`, `docs/BDD-010`) — no test code.
>
> **Status remains OPEN as a backend testing gap.** FDD-028 no toca esta surface; tracking aparte.
>
> **Bridge audit note (2026-05-25)**: production SignalR usage in `pos-local-bridge` verified cross-repo. `FinoCloudClient` (`PosLocalBridge.Transport/Cloud/FinoCloudClient.cs`) subscribes to **3 inbound hub methods** post-feature-gating (`OpenTurnstile` → `TurnstileSupervisor`, `SendEscPosCommand` → `PrinterSupervisor`, `SyncAccessData` → `AccessSyncSupervisor`) and emits **3 outbound methods** (`ProcessScan` from `AccessGate.TryGrantAccessAsync`, `ProcessWeightRead` from `SerialInputSupervisor` Scale role, `ReportHealth` from `HealthMonitor`) plus 2 declared-but-currently-unused (`ProcessFingerprint`, `ProcessSerialInput`). Hub URL: `{ApiBaseUrl}/hubs/bridge`; JWT vía lazy `AccessTokenProvider` reading `ITokenStore` on every (re)negotiation. Method dispatch goes through `ICloudClient.On<T>` indirection (not direct `HubConnection.On<T>`) which enabled the `InMemoryCloudClient` testing harness. Caveat: only HTTP 401 during SignalR negotiate is detected as auth-rejection — established-WebSocket auth failures surface as different exception types and are not currently caught. **The remaining gap in §3.5 is strictly backend loopback test infrastructure** (`POS.IntegrationTests` SignalR client coverage on `/hubs/kds` + `/hubs/bridge`) — not the production contract on either side.

El frontend tiene 3 clientes SignalR ([ScaleSignalrService](../src/app/core/services/scale.signalr.service.ts), [KitchenService](../src/app/core/services/kitchen.service.ts), [AccessDashboardSignalrService](../src/app/core/services/access-dashboard.signalr.service.ts)). Para testear "el bridge recibe `OpenTurnstile` y abre el torniquete":
- Necesitas **virtual SignalR server** en tests del bridge (.NET) que emita eventos al hub local del bridge.
- No verificable sin acceso al repo del bridge.

### 3.6 `playwright.config.ts` solo Chromium, sin matriz de claims

[playwright.config.ts:23-27](../playwright.config.ts#L23-L27):
```ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
],
```

Sólo un browser, sin proyectos para distintas verticales. Idealmente:
```ts
projects: [
  { name: 'restaurant', use: { storageState: 'states/restaurant.json' } },
  { name: 'gym',         use: { storageState: 'states/gym.json' } },
  { name: 'retail',      use: { storageState: 'states/retail.json' } },
],
```

### 3.7 `TestDeviceConfig` desfasado del modelo real

[e2e/fixtures/device-config.ts:21](../e2e/fixtures/device-config.ts#L21):
```ts
export interface TestDeviceConfig {
  mode: 'cashier' | 'kiosk' | 'tables' | 'kitchen';   // ← falta mobile, reception, bridge
  ...
}
```
El comentario del file dice "duplicated intentionally" — pero la duplicación se quedó atrás. Tests E2E con `mode: 'bridge'` no compilan.

### 3.8 Protractor leftovers en `e2e/`

[e2e/protractor.conf.js](../e2e/protractor.conf.js), [e2e/src/app.e2e-spec.ts](../e2e/src/app.e2e-spec.ts), [e2e/src/app.po.ts](../e2e/src/app.po.ts), [e2e/tsconfig.json](../e2e/tsconfig.json) — restos del scaffold legacy de Angular CLI con Protractor. Conviven con Playwright moderno. Confunde a developers nuevos.

---

## Sección 4 — Mapa de acción priorizado

| Prioridad | Item | Esfuerzo | Pago |
|---|---|---|---|
| **P0** | Auditar `pos-api` Global Query Filters (2.6) | 2-4 hrs | Previene data leak multi-tenant |
| **P0** | Crear `seedJwtClaims()` fixture E2E (3.2) | 1-2 hrs | Desbloquea testing por vertical |
| **P0** | Crear `CapturingPrinterTransport` mock (3.3) | 2-3 hrs | Desbloquea CI headless con flujos de print |
| **P1** | Consolidar macro checks via `FeatureKey` verticales (2.3) `[ALTERNATIVE APPROACH TAKEN]` | 1-2 días | Open-Closed real, escala N verticales — capability signals (`supportsKitchenOrders`, `supportsMemberships`, `isAccessControlTenant`, `isHydrated`) preferidos sobre vertical FeatureKey leakage en el enum. |
| **P1** | ~~Refactor `product-form` placeholders a metadata catalog (1.1)~~ ✅ **DONE** | 4 hrs | Elimina 3 switches gemelos |
| **P1** | Actualizar `TestDeviceConfig` y eliminar Protractor leftovers (3.7, 3.8) | 30 min | Higiene |
| **P2** | Crear specs para `TenantContextService`, `CartService`, `PrinterService` (3.1) | 2-3 días | Cobertura crítica |
| **P2** | Polimorfizar `CartPanel` y `Dashboard` por `posExperience` (2.1) | 2-3 días | Escala UI sin templates monolíticos |
| **P3** | Forms metadata-driven (2.2) | 1-2 semanas | Largo plazo |

---

## Sección 5 — Resumen ejecutivo

**Frontend está mejor arquitecturado de lo aparente**:
- `TenantContextService` declarativa con API completa.
- `*appFeature` structural directive limpia.
- `featureGuard` route guard data-driven via `route.data['requiredFeature']`.
- JWT parsing defensivo contra backend drift.
- `GIRO_FEATURE_MAP` central record con TypeScript exhaustividad parcial.

**La disciplina se diluye en 2 dimensiones**:

1. **Macro/Giro checks duros — RESOLVED for Vector A.** 6 of 7 hardcoded `currentMacro() === X` checks were migrated to capability signals (`supportsKitchenOrders`, `supportsMemberships`, `isAccessControlTenant`, `isHydrated`). One disciplined fallback remains in `tenant-context.service.ts:99` as a documented race-condition handler. The remaining macro-derivation surface (ID-range mapping en `config.enum.ts`, SubGiro enum derivation) requires backend catalog changes y queda tracked bajo §1.2 / §1.3 como OPEN.
2. **Test infrastructure prácticamente inexistente** — 1 unit test, 3 E2E sin mock de JWT, 0 virtual hardware. CI no puede validar que el contrato multi-tenant se respete.

**Si se planea agregar nuevas verticales** (`Hospitality`, `Healthcare`, `Entertainment`) en los próximos meses, los 3 P0 son **no-negociables** ANTES de meter el primer macro nuevo. Sin Global Query Filters confirmados (pos-api) + JWT-mock fixture + virtual printer, las regresiones serán manuales en cada release. Vector A's macro fan-out is no longer a barrier to adding new verticals — but the 3 P0 testing/infra items (Global Query Filters audit, `seedJwtClaims()` fixture, `CapturingPrinterTransport` mock) remain non-negotiable before any new vertical can be validated end-to-end in CI.

**Repos pendientes de auditar** (no incluidos en este audit):
- `pos-api` — EF Core multi-tenant isolation, WebApplicationFactory test infrastructure.
- `pos-local-bridge` — supervisor lifecycle vs feature claims, virtual hardware abstractions, SignalR loopback testing.

---

## Apéndice — Archivos analizados

### TenantContext + claim parsing
- [src/app/core/services/tenant-context.service.ts](../src/app/core/services/tenant-context.service.ts)
- [src/app/core/utils/jwt.utils.ts](../src/app/core/utils/jwt.utils.ts)
- [src/app/core/enums/config.enum.ts](../src/app/core/enums/config.enum.ts)
- [src/app/core/enums/feature-key.enum.ts](../src/app/core/enums/feature-key.enum.ts)

### Feature gating infra
- [src/app/shared/directives/app-feature.directive.ts](../src/app/shared/directives/app-feature.directive.ts)
- [src/app/core/guards/feature.guard.ts](../src/app/core/guards/feature.guard.ts)

### Componentes con macro checks directos
- [src/app/modules/pos/components/cart-panel/cart-panel.component.ts](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts)
- [src/app/modules/admin/admin-shell.component.ts](../src/app/modules/admin/admin-shell.component.ts)
- [src/app/modules/admin/components/devices/admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts)
- [src/app/modules/admin/components/dashboard/dashboard.component.ts](../src/app/modules/admin/components/dashboard/dashboard.component.ts)
- [src/app/modules/admin/components/products/product-form/product-form.component.ts](../src/app/modules/admin/components/products/product-form/product-form.component.ts)

### Test infrastructure
- [src/app/core/services/cash-register.service.spec.ts](../src/app/core/services/cash-register.service.spec.ts) (único)
- [e2e/tests/login.spec.ts](../e2e/tests/login.spec.ts), [pin.spec.ts](../e2e/tests/pin.spec.ts), [stock-receipts.spec.ts](../e2e/tests/stock-receipts.spec.ts)
- [e2e/fixtures/device-config.ts](../e2e/fixtures/device-config.ts)
- [playwright.config.ts](../playwright.config.ts)

### Legacy / drift
- [e2e/protractor.conf.js](../e2e/protractor.conf.js), [e2e/src/app.e2e-spec.ts](../e2e/src/app.e2e-spec.ts) (Protractor leftovers)

---

## Changelog

### 2026-05-21 — Vector A Domain Gating closure

- §1.1 RESOLVED (POS_EXPERIENCE_PLACEHOLDERS catalog).
- §1.5 RESOLVED (supportsKitchenOrders).
- §1.6 RESOLVED 6/7 rows; tenant-context.service.ts:99 stays OPEN / DEFERRED.
- §1.7 cost narrative updated.
- §1.8 added (Refactor Design Decisions & Proxies).
- AD-1 PARTIALLY RESOLVED. AD-3 PARTIALLY RESOLVED.
- Sección 4 action plan: P1 placeholders DONE; P1 vertical keys ALTERNATIVE APPROACH.
- Sección 5 executive summary updated to reflect post-refactor state.
- Vector A — Domain Gating closed in the TL;DR.

### 2026-05-21 — Vector B POC + Vector C §3.2 closure

- §2.2 PARTIALLY RESOLVED (product-form POC: 3-layer schema architecture — `schemas/product-form.{schema,registry,validators}.ts`, `ProductFormBuilderService`, renderers `<app-form-field>` / `<app-form-section>` / `<app-product-preview>`). Preview pane `@switch (currentMacro())` replaced by `<app-product-preview [variant]>`. Other 9 forms remain hand-rolled — Rule of 3 trigger documented.
- §3.2 RESOLVED (`seedJwtClaims()` fixture + `mockAuthMeEndpoint()` + 5 pre-canned `TEST_TENANT_SCENARIOS` + 5/5 green smoke spec).
- TL;DR "C — Mock JWT" row → RESOLVED. "B — Frontend forms" row remains 🟠 Alto (only 1 of 10 forms migrated; POC scope).
- §1.2, §1.3, §1.4 remain strictly OPEN. §2.1 / §2.3 stay at prior PARTIALLY RESOLVED. §2.4-§2.7, §3.1, §3.3-§3.8 untouched.

### 2026-05-23 — Cross-repo evidence absorbed + FDD-028 closures proposed

Applied via [FDD-028 Appendix A](FDD-028-catalog-api-integration.md).

- §2.6 (Global Query Filters): 🔴 `[NO VERIFICADO]` → 🟢 **RESOLVED**. Evidence: `POS.Repository/ApplicationDbContext.cs::ApplyTenantFilters` + `IBranchScoped`/`IBusinessScoped` markers + `BranchInjectionInterceptor`. Sospecha original (frontend pasa `branchId` explícito ⇒ no global filters) está **falseada** — los URL-level params son independientes del DbContext-level filter.
- §3.4 (WebApplicationFactory): 🔴 `[NO VERIFICADO]` → 🟢 **RESOLVED**. Evidence: `POS.IntegrationTests/Infrastructure/{CustomWebApplicationFactory, JwtTestFactory, FakeTenantContext, InMemoryModelCustomizer}.cs` + `Tenancy/TenantIsolationTests.cs` + `Catalogs/CatalogApiTests.cs` (35/35 facts).
- §1.2 (ID-range mapping `macroOfBusinessType`): 🔴 Crítico → 🟡 **RESOLVABLE** (gated on FDD-028 F4). Backend ahora ship `BusinessTypeDto.primaryMacroCategoryId` como FK explícita; F4 elimina el helper y reemplaza con `catalogService.resolveMacro(businessTypeId)` join.
- §1.4 (hasKitchen race condition): OPEN → 🟡 **RESOLVABLE** (gated on FDD-028 F3 + F6 + F5). Race eliminada por Dexie persistence + seed JSON fallback + `TenantContextService.currentBusinessType()` synthetic shape with join.
- §2.7 (Bridge supervisors): still 🔴 `[NO VERIFICADO]` — `pos-local-bridge` audit pending.
- §3.5 (SignalR loopback): 🔴 Crítico → 🔴 **CONFIRMED MISSING**. Backend audit verified zero matches for `HubConnection*` in `POS.IntegrationTests`; `Microsoft.AspNetCore.SignalR.Client` NuGet not referenced.
- TL;DR table updated: `B — Backend Global Filters` row → 🟢 RESOLVED; new `C — WebApplicationFactory` row added → 🟢 RESOLVED; new `C — SignalR loopback` row added → 🔴 CONFIRMED MISSING.

### 2026-05-24 — FDD-028 fully shipped, §1.2 + §1.4 closed

- §1.2 (ID-range mapping for `macroOfBusinessType()`): 🟡 RESOLVABLE → 🟢 **RESOLVED**. Commit 807e28c (FDD-028 F4). Helper deleted from `config.enum.ts`; replaced by `catalogService.resolveMacro(businessTypeId)` join.
- §1.4 (hasKitchen race condition): 🟡 RESOLVABLE → 🟢 **RESOLVED**. Commits bbefbe1 (F3) + 6333d14 (F6) + 38e6bc8 (F5 B3). Race window eliminated by sub-20ms Dexie hydration + macro fallback comparison now against canonical string code.
- F5 enum migration (5 buckets B0-B4): `MacroCategoryType` deleted; `MacroCategoryCode` canonical. Production-validation gate waived per user (single-dev startup context).
- TL;DR table updated: `A — ID-range mapping` row → 🟢 RESOLVED.
- §2.7 (Bridge supervisors) and §3.5 (SignalR loopback) remain STILL OPEN — cross-repo, not actionable from this repo.

### 2026-05-25 — Cross-repo audit: pos-local-bridge

Applied via Bridge Architectural Audit (AUDIT-058 §2.7 scope).

- §2.7 (Bridge supervisors): 🔴 `[NO VERIFICADO]` → 🟢 **RESOLVED**. Bridge audited and confirmed SMART. `JwtDeviceClaimsReader` extracts `branchId`, `businessId`, `mode`, `features` (NOT `macroCategory` / `planType` / `type` / `deviceId` — known extension point: one-line addition in `ParseClaims` + `DeviceClaims` record field). 5 of 7 hosted services (`TurnstileSupervisor`, `PrinterSupervisor`, `BiometricSupervisor`, `SerialInputSupervisor`, `AccessSyncSupervisor`) gated via `FeatureGating.IsEnabled` with fail-open semantics for pre-pairing compatibility. 3 unconditional services by design (`ResetBootstrapService`, `HealthMonitor`, `Worker`). DI registration order intentional in `BridgeHostBuilder.cs:67-77`. Architectural debt AD-3 / AD-5 remain Low severity in bridge repo.
- §3.5 (SignalR loopback): no status change — remains 🔴 **CONFIRMED MISSING**. Added 2026-05-25 cross-repo note clarifying that bridge production SignalR usage is verified (3 inbound + 3 outbound methods on `/hubs/bridge`, JWT vía lazy `AccessTokenProvider`, `ICloudClient.On<T>` indirection that enabled `InMemoryCloudClient` test harness). Remaining gap is strictly backend `POS.IntegrationTests` SignalR client coverage — not production contract on either side.
- TL;DR `B — Bridge supervisors` row → 🟢 RESOLVED with cell rewritten to "Bridge parses JWT and gates 5 of 7 supervisors via `FeatureGating.IsEnabled` with fail-open pre-pairing semantics."
