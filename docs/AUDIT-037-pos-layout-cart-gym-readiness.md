# AUDIT-037 — POS Layout & Cart: Readiness para vertical Gym

**Fecha:** 2026-04-25
**Branch:** `feat/retail-gym`
**Tipo:** Auditoría arquitectónica (read-only, sin modificaciones)
**Objetivo:** Evaluar la modularidad y la responsividad móvil del POS para soportar verticales (Gym) gobernadas por contexto de tenant.

---

## 0. Aclaración previa: `currentSubCategory()` no existe

El task pedía evaluar la modularidad basada en `TenantContextService.currentSubCategory()`, **pero ese método no existe** en el código actual.

`src/app/core/services/tenant-context.service.ts` expone únicamente:

- `currentMacro: Signal<MacroCategoryType | null>` (líneas 29, 40)
- `hasFeature(feature)`, `hasAnyFeature(features)`, `isApplicableToGiro(feature)` (~líneas 77–91)

> **Implicación:** Antes de poder "switchear UI por sub-categoría", hay que extender el modelo de tenant para incluir `subCategory` (p. ej. `Gym`, `Yoga`, `Crossfit` dentro del macro `Retail`/`Services`) y exponerlo como signal. Sin esa primera pieza, ningún componente puede reaccionar.

---

## 1. POS Layout — estado actual

**No existe un `pos-layout.component`** unificado. Existen 5 shells independientes, cada uno con su propio grid y sus propios breakpoints:

| Shell | Path | Estrategia | List vs Grid | Mobile (≤480px) |
|---|---|---|---|---|
| **quick-pos** | [quick-pos.component.ts](src/app/modules/pos/components/quick-pos/quick-pos.component.ts) | Grid 1 col → 2 col @768 → 3 col @1024 | Solo grid (sin toggle) | Stacked, input-row pasa a column |
| **retail-pos** | [retail-pos.component.ts](src/app/modules/pos/components/retail-pos/retail-pos.component.ts) | 90px / 1fr / 380px | **Solo lista densa** (HTML table) | Sidebar oculto, cart bottom-sheet 50vh |
| **waiter-pos** | [waiter-pos.component.ts](src/app/modules/pos/components/waiter-pos/waiter-pos.component.ts) | Manejado por signal `isCartOpen` | Solo grid | Cart como bottom-sheet drawer |
| **product-grid** | [product-grid.component.ts](src/app/modules/pos/components/product-grid/product-grid.component.ts) | 90px / center / 340px | **Solo grid visual** (`auto-fill, minmax(200px, 1fr)`) | Sidebar oculto, cart bottom-sheet 50vh |
| **restaurant-hub** | [restaurant-hub.component.ts](src/app/modules/pos/pages/restaurant-hub/restaurant-hub.component.ts) | SelectButton orquestador | Delega al hijo activo | Hereda del hijo |

### Hallazgos clave de layout

- ❌ **No existe toggle "List View / Grid View"** dentro de un mismo shell. Cada shell se compromete a una vista. Para "switchear" hay que cambiar de ruta (`/pos/retail` vs `/pos/quick-service`).
- ❌ **`product-card` no tiene modo compacto**: siempre renderiza imagen 3:4, nombre, descripción, precio y badge ([product-card.component.html:1-54](src/app/modules/pos/components/product-card/product-card.component.html)). No acepta `[mode]="'list' | 'grid'"`.
- ✅ **Responsividad básica funciona** en `product-grid` y `retail-pos`: a ≤768px el sidebar de categorías se oculta y el cart pasa a bottom-sheet con `max-height: 50vh` ([product-grid.component.scss:81](src/app/modules/pos/components/product-grid/product-grid.component.scss#L81), [retail-pos.component.scss:81](src/app/modules/pos/components/retail-pos/retail-pos.component.scss#L81)).
- ⚠️ **Touch targets a 480px**: cuando el cart ocupa 50vh y el grid el otro 50vh, los product cards quedan apretados verticalmente. Hay que validar manualmente que sigan respetando los **120×120px mínimos** del design system.
- ❌ **Ningún shell lee `tenantContext.currentMacro()`** para adaptar su layout. Son completamente vertical-agnósticos hoy.

---

## 2. Cart / Checkout — modularidad para inyectar bloques por vertical

### `cart-panel.component`

**Estado:** Modular *por composición ad-hoc*, no por slots formales.

Bloques actualmente condicionales (verificados en [cart-panel.component.html](src/app/modules/pos/components/cart-panel/cart-panel.component.html)):

- ✅ `<app-customer-selector>` ya está presente (líneas ~22–26) con `[(selectedCustomer)]` bindeado a `customerService.selectedCustomer()`
- ✅ Botón "Asignar mesa" condicional vía `canAssignTable()` (líneas ~202–211) → abre `app-table-selector-dialog`
- ✅ Bloque de cupón colapsable con input + botón Aplicar (líneas ~109–141)
- ✅ Botón "Enviar a cocina" vs "Cobrar directo" condicional vía `showSendToKitchen()` (líneas ~213–248)

**Limitaciones para Gym:**

- ❌ **Sin `<ng-content>`** ni outlet para inyectar contenido externo. Toda condicionalidad está hard-coded en el template.
- ❌ **No hay concepto de "miembro/socio/alumno"**. Existe `Customer` genérico pero no campos de membresía, nivel, clase asignada o sesiones restantes.
- ❌ **El selector de cliente es opcional** en el flujo. Para Gym debe ser obligatorio (no se puede vender una clase sin saber a quién).

### `checkout.component`

Estado: [checkout.component.html](src/app/modules/pos/components/checkout/checkout.component.html) es una **página completa centrada** (`max-width: 640px`) con state machine de dos pasos (`payment | confirmed`).

- ✅ Customer selector embebido (líneas ~21–25)
- ✅ Pills de saldo de cliente: store credit + loyalty points (líneas ~29–43)
- ✅ Métodos de pago dinámicos vía `paymentOptions` computed signal ([checkout.component.ts:78](src/app/modules/pos/components/checkout/checkout.component.ts#L78))
- ✅ Sección de descuento colapsable con presets + input custom (líneas ~91–180)
- ❌ Sin tracking de "tipo de venta" (clase única vs membresía mensual vs recarga de sesiones)

### Renderizado móvil del cart

- **Desktop:** panel derecho fijo (`$cart-panel-width = 340px` en `product-grid`, `380px` en `retail-pos`)
- **Tablet/móvil ≤768px:** bottom-sheet con `max-height: 50vh`, sin animación de drawer (sin `slide-up`/`slide-down`)
- ❌ **No existe estado "colapsado/expandido"** del bottom-sheet. Es un bloque CSS estático, no un drawer interactivo. En un teléfono real, dedicar 50vh fijos al cart cuando está vacío desperdicia pantalla.

---

## 3. Promociones — aplicación manual desde el cart

### Modelo y servicio

- **Modelo:** [promotion.model.ts](src/app/core/models/promotion.model.ts)
  - `PromotionScope`: `All | Category | Product` (línea ~70 `couponCode?: string`, líneas ~90+ `daysOfWeek`, `dateRange`)
  - ❌ **No hay `PromotionScope.TenantVertical`** ni filtrado por sub-categoría
- **Service:** [promotion.service.ts](src/app/core/services/promotion.service.ts)
  - Carga vía `/promotion/public/active?branchId=${branchId}` (línea ~80)
  - Cache en Dexie, evaluación offline
  - ❌ **No filtra por `currentMacro()`**

### UI manual existente

- ✅ **En cart-panel:** input de cupón + botón "Aplicar" → `applyCoupon()` que llama a `promotionService.validateCoupon(code)` ([cart-panel.component.ts:293-307](src/app/modules/pos/components/cart-panel/cart-panel.component.ts))
- ✅ **En checkout:** chips de descuentos preset + toggle de descuento custom (% o monto fijo) — controlado por cajero
- ❌ **No existe un toggle directo "Aplicar Descuento Estudiante"**. El cajero tendría que:
  1. Conocer el código del cupón ("STUDENT15") y tipearlo manualmente, o
  2. Usar el descuento manual genérico introduciendo el % a mano

### Veredicto

El cajero **sí puede** aplicar promociones manualmente hoy, pero la UX es **codificada por cupón** o **descuento libre**, no por **selección de promoción preconfigurada filtrable por vertical**.

---

## 4. Awareness de tenant en el POS

| Componente POS | ¿Lee `tenantContext.currentMacro()`? |
|---|---|
| quick-pos | ❌ No |
| retail-pos | ❌ No |
| waiter-pos | ❌ No |
| product-grid | ❌ No |
| restaurant-hub | ❌ No |
| cart-panel | ❌ No |
| checkout | ❌ No |
| pos-header | ✅ Sí — solo para `RecipeInventory` feature flag ([pos-header.component.ts:104,147](src/app/modules/pos/components/pos-header/pos-header.component.ts)) |

**Conclusión:** El POS es 100% vertical-agnóstico hoy. Toda la lógica de tenant vive en feature flags binarios, no en *vertical-aware UI*.

---

## 5. Cambios estructurales requeridos para Gym

### A. Modelo de tenant (prerrequisito)

1. Extender `MacroCategoryType` o agregar `SubCategoryType` con valores como `Gym`, `Yoga`, `Crossfit`, `Spa`.
2. Exponer `currentSubCategory: Signal<SubCategoryType | null>` en `TenantContextService`.
3. Agregar helper `isVertical(macro, sub)` para condicionales en templates.

### B. Layout del POS

1. **Crear `pos-layout.component`** (shell unificado) que reciba `[viewMode]="'list' | 'grid'"` como input — o, alternativamente, agregar un toggle dentro de `product-grid` que alterne CSS class entre `.layout-grid` y `.layout-list`.
2. **Agregar variante "list" a `product-card`** con `[mode]="'list'"` que renderice una fila densa (ícono pequeño + nombre + precio + acción), útil para Gym donde los "productos" son clases/membresías sin imagen rica.
3. **Convertir el bottom-sheet del cart en drawer real** con estados `collapsed (peek 80px) | expanded (50vh) | full (90vh)` y handle de drag. Hoy es un bloque CSS fijo.
4. **Validar touch targets a 480px**: en split 50/50, los cards deben mantener ≥120×120px o el grid debe colapsar a 1 columna.

### C. Cart / Checkout modular

1. **Convertir `cart-panel` en composable** con `<ng-content select="[cartHeader]">`, `<ng-content select="[cartCustomer]">`, `<ng-content select="[cartFooter]">`. Permite al `gym-pos` shell inyectar un `<gym-member-selector>` con campos específicos (membresía activa, sesiones restantes, vencimiento) sin tocar el cart base.
2. **Hacer obligatorio el selector de cliente** mediante input `[customerRequired]="true"` que bloquee el botón "Cobrar" hasta que haya `selectedCustomer`.
3. **Crear `<gym-member-selector>`** como wrapper de `customer-selector` que muestre además: tipo de membresía, sesiones restantes, vencimiento, alertas de cobro pendiente.
4. **Ocultar bloques no aplicables** vía `@if (!tenant.isGym())`:
   - Botón "Asignar mesa"
   - Botón "Enviar a cocina"
   - Sección de delivery en `restaurant-hub`

### D. Promociones por vertical

1. Agregar `PromotionScope.TenantVertical` al enum.
2. Pasar `subCategory` en query: `/promotion/public/active?branchId=X&subCategory=Gym`.
3. **Renderizar promociones como chips clickeables** en cart-panel y checkout (no solo input de cupón). Filtradas server-side o client-side por `currentSubCategory()`.
4. Seedear "Descuento Estudiante" como promoción preconfigurada del macro Gym, con toggle directo en cart.

---

## 6. Resumen de readiness

| Área | Readiness | Bloqueador principal |
|---|---|---|
| Layout switching List/Grid | 🔴 0% | No existe modo "list" en cards ni toggle en shells |
| Mobile responsivo del catálogo | 🟡 60% | Funciona pero touch targets a validar a 480px |
| Mobile responsivo del cart | 🟡 50% | Es bloque CSS, no drawer real con estados |
| Cart modular (slots) | 🔴 20% | Sin `ng-content`; toda condicionalidad hard-coded |
| Selector de cliente para Gym | 🟡 40% | Existe genérico, falta modelo de miembro y obligatoriedad |
| Promociones manuales | 🟢 70% | Funciona vía cupón + descuento libre; falta UX por chips |
| Promociones filtradas por vertical | 🔴 0% | Modelo y servicio sin awareness de sub-categoría |
| Tenant vertical awareness en POS | 🔴 5% | Solo `pos-header` lee tenant, y solo para 1 feature flag |
| Modelo `currentSubCategory()` | 🔴 0% | No existe — prerrequisito para todo lo demás |

**Veredicto global:** El POS está en estado **"sólido para Restaurant, vertical-agnóstico para todo lo demás"**. Para soportar Gym necesitamos primero el modelo de sub-categoría en `TenantContextService`, y sobre eso construir las 4 piezas estructurales (layout-shell unificado con view toggle, cart-panel componible con `ng-content`, member-selector específico, promociones filtrables). Ninguna de las piezas requiere reescribir lo existente — son extensiones por composición.
