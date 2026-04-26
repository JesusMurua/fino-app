# AUDIT-039 — Product Form & Sidebar: Tenant Verticalization & Plan Gating

**Fecha:** 2026-04-26
**Branch:** `feat/gym-reception`
**Tipo:** Auditoría read-only (no se modificaron archivos)
**Alcance:** Componente de creación/edición de producto + Sidebar de navegación admin

---

## TL;DR

| Problema reportado | Causa raíz | Severidad |
|--------------------|-----------|-----------|
| Form de producto muestra placeholders restauranteros ("Torta", "Salsa") y secciones "Comandera"/"Modificadores" para Gym | **Frontend** — placeholders hardcodeados y dos secciones del template carecen de gating por `subCategory` o por `BusinessType.hasKitchen` | Media (UX) |
| Sidebar muestra "Clientes" bloqueado pidiendo plan **Enterprise**, aunque `CustomerDatabase` debería estar disponible | **Backend (probable)** — el JWT `features` claim o el endpoint `/catalog/plans` no está exponiendo `CustomerDatabase` en los planes inferiores. El frontend está implementado correctamente. | Alta (bloquea funcionalidad) |

---

## 1) Product Creation Form

### 1.1 Localización

| Archivo | Ruta |
|--------|------|
| Template | [src/app/modules/admin/components/products/product-form/product-form.component.html](src/app/modules/admin/components/products/product-form/product-form.component.html) |
| Component | [src/app/modules/admin/components/products/product-form/product-form.component.ts](src/app/modules/admin/components/products/product-form/product-form.component.ts) |

### 1.2 Acceso al contexto del tenant

El componente **ya inyecta** `TenantContextService` y tiene un computed para detectar Gym:

- [product-form.component.ts:146](src/app/modules/admin/components/products/product-form/product-form.component.ts#L146) → `inject(TenantContextService)`
- [product-form.component.ts:155-157](src/app/modules/admin/components/products/product-form/product-form.component.ts#L155-L157) → `isGymTenant = computed(() => this.tenantContext.currentSubCategory() === SubCategoryType.Gym)`

Pero `isGymTenant()` **solo se usa en una sección** (membresías, líneas 141-161 del HTML). El resto del form ignora el contexto.

### 1.3 Hallazgo A — Placeholders hardcodeados restauranteros

| Línea | Ubicación | Placeholder actual |
|-------|-----------|-------------------|
| [37](src/app/modules/admin/components/products/product-form/product-form.component.html#L37) | Input "Nombre" | `"Ej. Torta de Milanesa"` |
| [365](src/app/modules/admin/components/products/product-form/product-form.component.html#L365) | Input "Nombre del grupo" (modificadores) | `"Nombre del grupo (ej. Proteína, Salsas)"` |
| [418](src/app/modules/admin/components/products/product-form/product-form.component.html#L418) | Input "Extra/Modificador" | `"Ej. Queso extra, Sin cebolla"` |

**Impacto:** Para un Gym/Estética/Refaccionaria los ejemplos son irrelevantes y comunican una identidad de producto equivocada.

### 1.4 Hallazgo B — Sección "Impresión de cocina" sin gating

[product-form.component.html:163-188](src/app/modules/admin/components/products/product-form/product-form.component.html#L163-L188)

```html
<!-- Printing destination -->
<div class="form-section-divider"></div>
<span class="form-section-title">Impresión de cocina</span>

@if (hasPrinters()) { ... } @else { ... }
```

El bloque solo verifica `hasPrinters()` (¿hay impresoras configuradas?) pero **nunca pregunta si el negocio tiene cocina**. Esta sección se renderiza para **todos los giros**: Gimnasio, Boutique, Refaccionaria, Estética, etc.

El catálogo `BUSINESS_TYPES` en [catalog.constants.ts:49-77](src/app/core/models/catalog.constants.ts#L49-L77) ya define la propiedad `hasKitchen: boolean` por sub-giro:
- `hasKitchen: true` → IDs 1, 2, 3, 4, 5, 6, 7, 9 (giros gastronómicos con cocina)
- `hasKitchen: false` → IDs 8, 10–20 (Paletería, todo Retail, todo Services incluyendo Gimnasio)

**Pero `TenantContextService` no expone helper para esto** — solo tiene `currentMacro()`, `currentSubCategory()` y `hasFeature()`. No hay un `currentBusinessType()` ni un `hasKitchen()` derivado.

### 1.5 Hallazgo C — Sección "Modificadores" sin gating

[product-form.component.html:350-458](src/app/modules/admin/components/products/product-form/product-form.component.html#L350-L458)

Toda la sección de **Grupos de modificadores** (extras, salsas, proteínas) se renderiza sin condicional. Para un gimnasio que vende membresías o pases diarios, "Grupos de modificadores con reglas Min/Máx" no tiene sentido conceptual.

A diferencia de "Comandera" (que es claramente Food & Beverage), modificadores podría aplicar a algunos verticales no-food (ej. Estética: "modificadores de servicio"). Por eso aquí la decisión arquitectónica es más matizada.

### 1.6 Modelos disponibles para el fix

| Símbolo | Archivo |
|--------|---------|
| `SubCategoryType` enum (Gym, Yoga, Crossfit, Generic) | [src/app/core/enums/config.enum.ts:113-118](src/app/core/enums/config.enum.ts#L113-L118) |
| `MacroCategoryType` enum | [src/app/core/enums/config.enum.ts:44-49](src/app/core/enums/config.enum.ts#L44-L49) |
| `BUSINESS_TYPES` con `hasKitchen`/`hasTables` | [src/app/core/models/catalog.constants.ts:49-77](src/app/core/models/catalog.constants.ts#L49-L77) |
| `TenantContextService` (signals: plan, macro, subCategory, features) | [src/app/core/services/tenant-context.service.ts](src/app/core/services/tenant-context.service.ts) |

---

## 2) Sidebar — "Clientes" bloqueado pidiendo Enterprise

### 2.1 Localización

| Archivo | Ruta |
|--------|------|
| Component | [src/app/modules/admin/admin-shell.component.ts](src/app/modules/admin/admin-shell.component.ts) |
| Template | [src/app/modules/admin/admin-shell.component.html](src/app/modules/admin/admin-shell.component.html) |
| Directiva | [src/app/shared/directives/app-feature.directive.ts](src/app/shared/directives/app-feature.directive.ts) |

### 2.2 Definición del item "Clientes"

[admin-shell.component.ts:130](src/app/modules/admin/admin-shell.component.ts#L130)

```ts
{ path: 'customers', icon: 'pi-id-card', label: 'Clientes', feature: FeatureKey.CustomerDatabase },
```

El item está correctamente declarativamente atado a `FeatureKey.CustomerDatabase` (no a un plan).

### 2.3 Lógica de bloqueo (CORRECTA)

[admin-shell.component.ts:169-174](src/app/modules/admin/admin-shell.component.ts#L169-L174)

```ts
isLocked(item: NavItem): boolean {
  if (!item.feature) return false;
  if (this.tenantContext.hasFeature(item.feature)) return false; // ← lectura SSOT
  if (this.tenantContext.currentMacro() === null) return false;
  return this.tenantContext.isApplicableToGiro(item.feature);
}
```

**Esto NO está hardcodeado contra `plan === 'Enterprise'`.** Lee el set `activeFeatures` directamente.

### 2.4 Lógica del badge "Enterprise" (CORRECTA pero reveladora)

[admin-shell.component.ts:219-229](src/app/modules/admin/admin-shell.component.ts#L219-L229)

```ts
private upsellInfo(item: NavItem): { plan: string; price: number } | null {
  if (!item.feature) return null;
  const currentLevel = PLAN_HIERARCHY[this.tenantContext.currentPlan()] ?? 0;
  const tier = this.catalogService.planCatalog().find(t =>
    t.features.includes(item.feature!)
    && (PLAN_HIERARCHY[t.planTypeId] ?? 0) > currentLevel,
  );
  if (!tier) return null;
  const group = pricingGroupForMacro(this.tenantContext.currentMacro());
  return { plan: tier.name, price: tier.monthlyPrice[group] };
}
```

El tooltip dice "Enterprise" porque busca **el primer tier estrictamente superior al actual cuyo `features[]` incluya `CustomerDatabase`**. Si el resultado es Enterprise, significa que ni Free, ni Basic, ni Pro lo incluyen **en el catálogo activo en runtime** (`catalogService.planCatalog()`).

### 2.5 Verificación contra el SSOT del cliente

`CustomerDatabase` debería estar disponible **desde el plan Free** según los dos catálogos del cliente:

**Fallback estático** ([catalog.fallback.ts:21-28](src/app/core/models/catalog.fallback.ts#L21-L28)):
```ts
const FREE_FEATURES = [
  FeatureKey.CoreHardware,
  FeatureKey.CustomerCredit,
  FeatureKey.SimpleFolios,
  FeatureKey.CustomerDatabase,   // ← presente en Free
  FeatureKey.PrintedTickets,
  FeatureKey.TableMap,
];
```

**Mapa de aplicabilidad por giro** ([feature-key.enum.ts:93-103](src/app/core/enums/feature-key.enum.ts#L93-L103)):
```ts
const UNIVERSAL_FEATURES = [
  FeatureKey.CoreHardware,
  FeatureKey.CfdiInvoicing,
  FeatureKey.CustomerCredit,
  FeatureKey.CustomerDatabase,   // ← aplicable a TODOS los macros
  ...
];
```

**Conclusión:** `CustomerDatabase` está marcada como universal y como Free en el código del cliente. **Si el sidebar lo muestra bloqueado pidiendo Enterprise, es porque el catálogo dinámico del backend está sobrescribiendo el fallback con datos incorrectos** (o el JWT no incluye el feature claim).

### 2.6 Cómo se hidrata `activeFeatures`

[tenant-context.service.ts:121-138](src/app/core/services/tenant-context.service.ts#L121-L138) → `setContext()` recibe `features: readonly string[]` desde `AuthService` (que las extrae del JWT claim).

[catalog.service.ts:108-115](src/app/core/services/catalog.service.ts#L108-L115) → `fetchPlanCatalog()` llama a `GET /api/catalog/plans` y reemplaza el feature manifest del fallback. Si el backend devuelve un manifest donde `CustomerDatabase` solo aparece en Enterprise, **eso explica exactamente el badge "Enterprise"** que ve el usuario.

### 2.7 Diagnóstico recomendado (no en código)

Antes de tocar código, verificar en runtime con un tenant afectado:

1. **DevTools → Application → localStorage → `pos_auth_token`** — decodificar el JWT en jwt.io y revisar el claim `features`. ¿Incluye `"CustomerDatabase"`?
2. **DevTools → Network → `GET /api/catalog/plans`** — revisar el response body. ¿`CustomerDatabase` aparece solo en Enterprise?
3. **DevTools → Network → `POST /api/auth/...` (login)** — ¿el body de respuesta incluye `features`?

Si (1) y (2) confirman que el backend no expone `CustomerDatabase` en los planes inferiores, el fix es **backend-only** — no hay nada estructural que arreglar en el frontend del sidebar.

---

## 3) Propuesta de fix estructural

### 3.1 Frontend — Product Form (acción requerida)

**Objetivo:** que el form se adapte al `subCategory` / `BusinessType` actual.

**Paso 1 — Extender `TenantContextService`:**

Agregar un computed signal que exponga el `BusinessTypeCatalog` actual y derivados:

```ts
// tenant-context.service.ts
private readonly _currentBusinessTypeId = signal<number | null>(null);
readonly currentBusinessType = computed<BusinessTypeCatalog | null>(() => {
  const id = this._currentBusinessTypeId();
  if (id === null) return null;
  return this.catalogService.businessTypes().find(b => b.id === id) ?? null;
});
readonly hasKitchen = computed(() => this.currentBusinessType()?.hasKitchen ?? false);
```

Y mutarlo desde `setContext()` (o un nuevo `setBusinessType()`).

**Paso 2 — Envolver "Impresión de cocina"** con `@if (hasKitchen()) { ... }` en `product-form.component.html:163-188`.

**Paso 3 — Decidir política para "Modificadores":**
   - Opción A (más conservadora): mostrar siempre, dado que también aplica a giros tipo Estética.
   - Opción B (más estricta): envolver en `@if (currentBusinessType()?.hasModifiers ?? true)`, agregando ese flag al `BusinessTypeCatalog`.

**Paso 4 — Parametrizar placeholders:**

Crear un mapa simple en `catalog.constants.ts` o en el propio componente:

```ts
const PRODUCT_NAME_PLACEHOLDERS: Record<string, string> = {
  Restaurant: 'Ej. Torta de Milanesa',
  Counter:    'Ej. Café americano',
  Retail:     'Ej. Coca-Cola 600ml',
  Quick:      'Ej. Membresía mensual',
};
```

E indexar por `currentBusinessType()?.posExperience`.

### 3.2 Backend — Sidebar / Plan Catalog (acción requerida)

**No tocar el frontend del sidebar.** El fix es del lado del backend:

1. **Verificar `/api/catalog/plans`:** asegurar que `CustomerDatabase` aparezca en `Free`, `Basic`, `Pro`, `Enterprise` (manifest acumulativo, no exclusivo).
2. **Verificar emisión del JWT:** asegurar que el claim `features` incluye `CustomerDatabase` cuando el plan del tenant es Free o superior.

### 3.3 Frontend — Mejora defensiva opcional (no bloqueante)

En [admin-shell.component.ts:219-229](src/app/modules/admin/admin-shell.component.ts#L219-L229), `upsellInfo()` podría loggear un warning cuando el "tier mínimo que desbloquea X" es Enterprise pero la feature también figura en el fallback como Free — eso facilitaría detectar discrepancias backend/fallback en dev sin esperar a un report manual del usuario.

---

## 4) Resumen ejecutivo (1 línea por hallazgo)

1. **Product Form, placeholders:** hardcoded en líneas 37, 365, 418 → parametrizar por `posExperience` del business type.
2. **Product Form, "Impresión de cocina":** sin gating en líneas 163-188 → envolver en `@if (hasKitchen())`.
3. **Product Form, "Modificadores":** sin gating en líneas 350-458 → decisión de producto pendiente (¿se muestra para Estética? ¿Solo Food?).
4. **Sidebar "Clientes":** la lógica del frontend es correcta y SSOT-driven; el bug está en el backend (manifest de planes o JWT features claim). Verificar primero con DevTools antes de cualquier cambio de código.

---

## 5) Archivos clave (referencia rápida)

```
src/app/modules/admin/components/products/product-form/
  ├── product-form.component.ts      (TS — inyecta TenantContextService)
  └── product-form.component.html    (HTML — ubicación de los hallazgos)

src/app/modules/admin/
  ├── admin-shell.component.ts       (sidebar TS — lógica navItems / isLocked / upsellInfo)
  └── admin-shell.component.html     (sidebar HTML — *appFeature usage)

src/app/shared/directives/app-feature.directive.ts   (renderizado lock/hide)

src/app/core/services/
  ├── tenant-context.service.ts      (SSOT runtime: plan, macro, subCategory, features)
  └── catalog.service.ts             (mezcla fallback + /api/catalog/plans)

src/app/core/models/
  ├── catalog.constants.ts           (BUSINESS_TYPES con hasKitchen/hasTables)
  └── catalog.fallback.ts            (PLAN_CATALOG fallback con FREE_FEATURES)

src/app/core/enums/
  ├── feature-key.enum.ts            (FeatureKey + GIRO_FEATURE_MAP)
  └── config.enum.ts                 (PlanTypeId, MacroCategoryType, SubCategoryType)
```
