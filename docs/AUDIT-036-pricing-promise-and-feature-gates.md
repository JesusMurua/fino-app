# AUDIT-036 — Pricing Promise · Onboarding Handshake · Frontend Feature Gates

**Fecha:** 2026-04-21
**Rama:** `audit/cajas-y-hardware`
**Modo:** Análisis (sin cambios de código)

Este documento mapea **qué promete el sistema al usuario**, **cómo se traduce al registrar**, y **cómo se enforza en la UI**. Nota importante del scope:

> La **landing page pública** (`https://kaja.mx` per [environment.prod.ts:4](src/environments/environment.prod.ts#L4)) vive en un repo separado — no existe módulo `landing` ni `pricing` dentro de `restaurant-app`. La única "promesa de plan" que renderiza **esta app** es la grid de precios del **paso 2 del onboarding**, que actúa como la promesa visible al usuario autenticado.

---

## 1. La Promesa (Pricing mostrado dentro de la app)

### 1.1 Paso 2 del Onboarding — pricing grid

Fuente: [onboarding.component.ts:94-139](src/app/modules/onboarding/onboarding.component.ts#L94-L139)

El precio se decide por **dos ejes**: `plan` × `pricingGroup` (derivado del macro). Tres grupos:

| Macro | PricingGroup |
|-------|--------------|
| Services / Retail | `general` |
| QuickService | `standard` |
| FoodBeverage | `restaurant` |

#### Precios mostrados (MXN, desplegados como `$XX/mes` o `$XX/mes · anual`)

| Plan | Grupo | Mensual | Anual (por mes) |
|------|-------|--------:|----------------:|
| Basic | general | $99 | $79 |
| Basic | standard | $149 | $119 |
| Basic | restaurant | $199 | $159 |
| Pro | general | $249 | $199 |
| Pro | standard | $349 | $279 |
| Pro | restaurant | $499 | $399 |
| Enterprise | general | $599 | $479 |
| Enterprise | standard | $799 | $639 |
| Enterprise | restaurant | $999 | $799 |

Free siempre cuesta `$0` ("Gratis").

#### Features anunciadas por plan ([onboarding.component.ts:134-139](src/app/modules/onboarding/onboarding.component.ts#L134-L139))

| Plan | Bullets mostrados |
|------|-------------------|
| **Free** | `1 sucursal` · `Hasta 100 ventas/mes` · `Inventario básico` · `App iOS / Android` |
| **Basic** | `1 sucursal` · `Ventas ilimitadas` · `Reportes mensuales` · `Soporte prioritario` |
| **Pro** | `3 sucursales` · `Multi-dispositivo` · `Reportes avanzados` · `Facturación CFDI` · `Soporte 24/7` |
| **Enterprise** | `Sucursales ilimitadas` · `API personalizada` · `Dashboard central` · `Gerente dedicado` |

Badges: Free → `Gratis`, Basic → `Básico`, **Pro → `Más popular` (featured)**, Enterprise → `Franquicia`.

#### Disponibilidad por macro ([onboarding.component.ts:68-73](src/app/modules/onboarding/onboarding.component.ts#L68-L73))

| Macro | Planes elegibles |
|-------|-----------------|
| FoodBeverage | Free · Basic · Pro · Enterprise |
| QuickService | Free · Basic · Pro |
| Retail | Free · Basic · Pro |
| Services | Free · Pro (Basic bloqueado) |

Los planes no elegibles aparecen con `isLocked: true` y no responden al click.

### 1.2 Pricing alterno en Settings → Facturación

⚠️ **Inconsistencia detectada.** [admin-settings.component.ts:238-270](src/app/modules/admin/components/settings/admin-settings.component.ts#L238-L270) renderiza "opciones de upgrade" con **precios y features distintos** a los del onboarding:

| Plan | Precio en Settings | Features en Settings |
|------|-------------------|----------------------|
| Básico | `$199/mes` (fijo, sin ciclo) | Impresora térmica · Escáner de códigos · Promociones |
| Pro | `$399/mes` (fijo) | Reportes avanzados · Facturación CFDI · Multi-sucursal |
| Enterprise | `Contacto` | Báscula industrial · API de acceso · Soporte prioritario |

Estos bullets **no coinciden** con los del onboarding (ej. "Impresora térmica" como feature de Basic — pero según `.claude/business-rules-matrix.md` el `CoreHardware` es Free). Son listas hardcoded probablemente de un sprint anterior, nunca reconciliadas con la matriz.

### 1.3 Stripe Price IDs

Hay una tercera capa: el precio real cobrado por Stripe vive en [onboarding.component.ts:76-92](src/app/modules/onboarding/onboarding.component.ts#L76-L92). Los `price_1TGj…` son IDs exactos de productos Stripe por `[plan][group][cycle]`. Si hay drift con los `DISPLAY_PRICES`, el usuario verá un precio diferente al llegar al checkout.

---

## 2. El Handshake de Registro (Landing → Register → Onboarding)

### 2.1 Query params aceptados por `/register`

Parser: [registration.utils.ts:163-185](src/app/core/utils/registration.utils.ts#L163-L185) → `parseRegistrationIntent(params)`.

Acepta tres claves en `?giro=…&plan=…&country=…`:

| Param | Comportamiento |
|-------|----------------|
| `giro` | Opcional. Si viene y el slug es desconocido → `resolveMacroSlug` **lanza excepción** y el form muestra error 'invalid_giro'. Si no viene → el form muestra un dropdown para elegir macro. |
| `plan` | Opcional. Fallback silencioso a `Free` con warning en consola si el slug es desconocido ([registration.utils.ts:145-154](src/app/core/utils/registration.utils.ts#L145-L154)). |
| `country` | Opcional. Se normaliza a mayúsculas, default `'MX'`. |

### 2.2 Mapping de `plan` slug → `PlanTypeId`

[registration.utils.ts:76-81](src/app/core/utils/registration.utils.ts#L76-L81):

```ts
{
  free:       PlanTypeId.Free,       // 0
  basic:      PlanTypeId.Basic,      // 1
  pro:        PlanTypeId.Pro,        // 2
  enterprise: PlanTypeId.Enterprise, // 3
}
```

Slugs acumulados son `toLowerCase().trim()` antes del lookup. Cualquier otra cadena → Free (log warning).

### 2.3 Mapping de `giro` slug → `MacroCategoryType`

[registration.utils.ts:25-70](src/app/core/utils/registration.utils.ts#L25-L70). Diccionario exhaustivo con macros canónicas + aliases comunes:

#### FoodBeverage (macro id 1)
`food-beverage` · `restaurant` · `restaurante` · `bar` · `bar-cantina` · `cantina` · `sports-bar`

#### QuickService (macro id 2)
`quick-service` · `cafe` · `cafeteria` · `taqueria` · `dogos` · `hamburguesas` · `pizzeria` · `paleteria` · `panaderia`

#### Retail (macro id 3)
`retail` · `retail-commerce` · `abarrotes` · `abarrotes-retail` · `expendio` · `refaccionaria` · `ferreteria` · `papeleria` · `farmacia` · `boutique`

#### Services (macro id 4)
`services` · `servicios` · `servicios-especializados` · `specialized-services` · `estetica` · `barberia` · `taller` · `taller-mecanico` · `consultorio` · `clinica` · `gimnasio`

> Los sub-giros (Taquería, Ferretería, etc.) **no se comprometen en el registro** — cae al macro correspondiente. El detalle fino se captura después en `Onboarding Step 1` vía `PUT /business/giro`.

### 2.4 Flujo completo

```
Landing (kaja.mx) con ?plan=pro&giro=taqueria
  ↓
/register → parseRegistrationIntent:
   { primaryMacroCategoryId: 2 (QuickService),
     planTypeId: 2 (Pro),
     countryCode: 'MX',
     planSlug: 'pro',  ← se guarda en localStorage "pending-plan-{branchId}"
     giroSlug: 'taqueria' }
  ↓
POST /auth/register → backend emite JWT
  ↓
/onboarding Step 1 → macro pre-seleccionado, sub-giros + "Otra" libre
  → PUT /business/giro con { primaryMacroCategoryId, subGiroIds[], customGiroDescription? }
  ↓
/onboarding Step 2 → grid de planes. Effect reactivo ([onboarding.component.ts:370-384](src/app/modules/onboarding/onboarding.component.ts#L370-L384)) resuelve:
   1. si `selectedPlan` es válido → respeta
   2. si hay `pending-plan-{branchId}` en localStorage → lo usa
   3. caso contrario → usa `defaultPlan` = Pro si aplica al macro, sino el primer permitido
  ↓
activatePlan():
   - plan paid → POST /subscription/checkout (Stripe) con priceId resuelto
     priceId = STRIPE_PRICE_IDS[plan][group][cycle]
   - plan free → continueWithTrial → finalizeOnboarding
```

### 2.5 Observaciones de integridad

- **Bug potencial documentado en auditorías previas**: si el usuario llega con `?plan=basic` pero manualmente cambia a Pro en Step 2, el effect de `planCards` corre cada vez que cambia el macro o ciclo, y al re-seleccionar podría "revertir" al `pending-plan` escrito por register. Lógica actual prioriza el plan ya válido primero (`isValid: true ? return`), después el pending, después el default. **No hay bug si `selectedPlan` siempre está sincronizado al click** — verificar en QA.
- **`countryCode` ≠ `'MX'`** entra al payload del backend, pero no hay lógica frontend que varíe por país (solo se almacena).
- **Timezone** se resuelve con `Intl.DateTimeFormat().resolvedOptions().timeZone` ([register.component.ts:195](src/app/modules/register/register.component.ts#L195)) y se envía al backend.

---

## 3. Feature Gates reales en la UI

El Frontend tiene **cuatro mecanismos** de enforcement, todos leyendo de `TenantContextService.activeFeatures` (poblado desde el claim `features` del JWT):

### 3.1 Guardián de ruta (`featureGuard`)

[feature.guard.ts](src/app/core/guards/feature.guard.ts) lee `route.data['requiredFeature']`. Acepta un `FeatureKey` único o un array (OR). Si falla → toast "Función bloqueada" + redirect a `/admin/upgrade`.

**Rutas protegidas hoy:**

| Ruta | FeatureKey requerida | Fuente |
|------|----------------------|--------|
| `/admin/reports` | `AdvancedReports` | [admin.routes.ts:37-38](src/app/modules/admin/admin.routes.ts#L37-L38) |
| `/admin/inventory` | `RecipeInventory` **OR** `MultiWarehouseInventory` | [admin.routes.ts:57-58](src/app/modules/admin/admin.routes.ts#L57-L58) |
| `/admin/recipes` | `RecipeInventory` | [admin.routes.ts:65-66](src/app/modules/admin/admin.routes.ts#L65-L66) |
| `/admin/invoicing` | `CfdiInvoicing` | [admin.routes.ts:125-126](src/app/modules/admin/admin.routes.ts#L125-L126) |
| `/kiosk` | `KioskMode` | [app.routes.ts:57-58](src/app/app.routes.ts#L57-L58) |
| `/kitchen` | `KdsBasic` **OR** `RealtimeKds` | [app.routes.ts:64-66](src/app/app.routes.ts#L64-L66) |
| `/pos/waiter` | `WaiterApp` | [pos.routes.ts:41-42](src/app/modules/pos/pos.routes.ts#L41-L42) |

### 3.2 Directiva estructural (`*appFeature`)

[app-feature.directive.ts](src/app/shared/directives/app-feature.directive.ts) con dos modos:

- `mode: 'hide'` (default) — remueve el DOM si falta la feature.
- `mode: 'lock'` — renderiza con clase CSS `feature-locked` para overlay de candado.

Uso principal: [admin-shell.component.html:54](src/app/modules/admin/admin-shell.component.html#L54) renderiza los items del menú lateral según su `feature` declarada en [admin-shell.component.ts:103-114](src/app/modules/admin/admin-shell.component.ts#L103-L114):

| Item del menú | Feature requerida |
|---------------|-------------------|
| Reportes | `AdvancedReports` |
| Mesas | `TableMap` |
| Inventario (badge) | `RecipeInventory` |
| Recetas | `RecipeInventory` |
| Promociones | `LoyaltyCrm` |
| Clientes | `CustomerBase` |
| Facturación | `CfdiInvoicing` |
| Reservaciones | `TableMap` |

### 3.3 Computeds en componentes (hasFeature / hasAnyFeature)

**Settings** ([admin-settings.component.ts:108-134](src/app/modules/admin/components/settings/admin-settings.component.ts#L108-L134)):

| Surface | Regla |
|---------|-------|
| Tab **Fiscal** completa | `CfdiInvoicing` |
| Tarjeta **Báscula** | `CoreHardware` **AND** macro === Retail |
| **Destinos de impresión** (cocina/barra) | `KdsBasic` **OR** `RealtimeKds` **OR** `PrintedTickets` |
| Bloque de **Folios personalizados** | `CustomFolios` **OR** `CfdiInvoicing` |

**Admin Devices** — modos de terminal disponibles según features ([admin-devices.component.ts:119-133](src/app/modules/admin/components/devices/admin-devices.component.ts#L119-L133)):

| Modo | Requiere |
|------|----------|
| Cajero | Siempre disponible |
| Mesas | `TableMap` **OR** `WaiterApp` |
| Cocina (KDS) | `KdsBasic` **OR** `RealtimeKds` |
| Kiosko | `KioskMode` |

**Admin Branches** — sección Delivery editable solo con `DeliveryPlatforms` ([admin-branches.component.ts:114,126](src/app/modules/admin/components/branches/admin-branches.component.ts#L114)).

**Dashboard** — "Ver más reportes" visible con `AdvancedReports` ([dashboard.component.ts:53](src/app/modules/admin/components/dashboard/dashboard.component.ts#L53)).

**POS Header** — botón "Inventario" visible con `RecipeInventory` **OR** `MultiWarehouseInventory`, o si algún producto tiene `trackStock` ([pos-header.component.ts:147](src/app/modules/pos/components/pos-header/pos-header.component.ts#L147)).

**Cajas / Admin Registers** — botón "Nueva caja" visible con `MultiTill` o si no hay cajas aún (primera caja siempre permitida) ([admin-registers.component.ts:71](src/app/modules/admin/components/admin-registers/admin-registers.component.ts#L71)).

**Admin Tables** — carga del mapa de mesas gateada por `TableMap` ([admin-tables.component.ts:118](src/app/modules/admin/components/tables/admin-tables.component.ts#L118)).

### 3.4 Applicabilidad por giro (`isApplicableToGiro`)

[tenant-context.service.ts:75-84](src/app/core/services/tenant-context.service.ts#L75-L84) + `GIRO_FEATURE_MAP` ([feature-key.enum.ts:88-113](src/app/core/enums/feature-key.enum.ts#L88-L113)) distinguen **"no aplica al giro"** vs **"necesita plan superior"**. La tabla cruzada:

| Feature | F&B | QS | Retail | Services |
|---------|:---:|:--:|:------:|:--------:|
| CoreHardware | ✅ | ✅ | ✅ | ✅ |
| CfdiInvoicing | ✅ | ✅ | ✅ | ✅ |
| UnlimitedProducts | ✅ | ✅ | ✅ | — |
| PrintedTickets | ✅ | — | — | — |
| KdsBasic / RealtimeKds | ✅ | ✅ | — | — |
| TableMap / WaiterApp | ✅ | — | — | — |
| KioskMode | ✅ | ✅ | — | — |
| MultiTill | ✅ | ✅ | — | — |
| MultiBranch | ✅ | — | — | — |
| PublicApi | ✅ | — | — | — |
| RecipeInventory | ✅ | — | — | — |
| DeliveryPlatforms | ✅ | ✅ | — | — |
| LoyaltyCrm | — | ✅ | — | — |
| CustomerCredit | — | — | ✅ | — |
| MultiWarehouseInventory | — | — | ✅ | — |
| ComparativeReports | — | — | ✅ | — |
| StockAlerts | — | — | ✅ | — |
| SimpleFolios | — | — | — | ✅ |
| CustomFolios | — | — | — | ✅ |
| CustomerBase | — | — | — | ✅ |
| CustomerHistory | — | — | — | ✅ |
| Reminders | — | — | — | ✅ |
| AdvancedReports | ✅ | ✅ | ✅ | — |

Esta matriz la usa `*appFeature` (y potencialmente la sidebar) para decidir si un item queda **oculto** (no aplica) vs **bloqueado con candado** (aplica pero plan inferior).

---

## Resumen ejecutivo — lo que necesita Phase 2/3

| Capa | Fuente de verdad actual | Riesgo |
|------|-------------------------|--------|
| **Pricing al usuario anónimo** | Landing page externa (kaja.mx) — NO en este repo | ⚠️ No auditable desde este workspace |
| **Pricing al usuario autenticado (Onboarding)** | [onboarding.component.ts:95-139](src/app/modules/onboarding/onboarding.component.ts#L95-L139) — `DISPLAY_PRICES` + `PLAN_FEATURES` hardcoded | ⚠️ Bullets **divergen** de lo que gateas realmente (ej. Basic dice "Ventas ilimitadas" pero el guard que enforza `UnlimitedProducts` no está en ninguna ruta) |
| **Pricing en Settings → Facturación** | [admin-settings.component.ts:238-270](src/app/modules/admin/components/settings/admin-settings.component.ts#L238-L270) — lista aparte con **precios y features distintos** | ⚠️ Tres fuentes de verdad (Landing · Onboarding · Settings). Recomiendo unificar en `plan.model.ts` |
| **Stripe price IDs** | [onboarding.component.ts:76-92](src/app/modules/onboarding/onboarding.component.ts#L76-L92) — hardcoded | Si cambian en Stripe y no aquí, el checkout cobrará mal |
| **Slug → enum** (Landing handshake) | [registration.utils.ts](src/app/core/utils/registration.utils.ts) | Bien aislado. OK |
| **Feature gating runtime** | `TenantContextService` + 4 mecanismos (guard · directiva · computed · GIRO_FEATURE_MAP) | Bien estructurado. Todo depende del claim `features` del JWT |
| **Giro applicability** | [feature-key.enum.ts](src/app/core/enums/feature-key.enum.ts) — `GIRO_FEATURE_MAP` | Matriz duplica a `.claude/business-rules-matrix.md`; drift posible |

**Recomendación para Phase 2/3:**

1. **Crear `plan-catalog.model.ts`** con la fuente única: `{ plan, macro, cycle, priceCents, stripePriceId, featureBullets, featureKeys, badge, description }`. Onboarding y Settings derivan de ahí.
2. **Sincronizar `PLAN_FEATURES` (bullets) con `GIRO_FEATURE_MAP` (enforcement)** — los bullets que muestras al cliente deben mapear 1:1 a las `FeatureKey` que el backend enciende en el JWT.
3. **Extraer `.claude/business-rules-matrix.md` → generador**: si la matriz es la fuente, un script que genere `feature-key.enum.ts`, `plan-catalog.model.ts` y el matrix del backend evita drift.
4. **Documentar la landing externa**: las URLs que emite (`kaja.mx/...?plan=X&giro=Y`) deben tener su propia auditoría — este repo solo las recibe.
