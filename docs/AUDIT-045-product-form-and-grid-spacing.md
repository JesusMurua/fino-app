# AUDIT-045 — Product Form Audit + Grid Spacing in Settings

**Status:** Read-only audit. No files modified. Awaiting confirmation before implementing.
**Date:** 2026-04-26
**Branch:** `refactor/settings-and-product-ux`

---

## Part A — Product form audit

### Estructura del componente

| | Valor |
|---|---|
| Archivos | [`product-form.component.ts`](src/app/modules/admin/components/products/product-form/product-form.component.ts) · [`.html`](src/app/modules/admin/components/products/product-form/product-form.component.html) · [`.scss`](src/app/modules/admin/components/products/product-form/product-form.component.scss) |
| Líneas (TS / HTML / SCSS) | 720 · 490 · 459 |
| Tipo | crear-editar-compartido (mismo componente; modo determinado por `:id` en la ruta) |
| Estado | **Reactive Forms** (FormGroup tipado) + **Signals** para estado UI (`editingProduct`, `savingProduct`, `productImages`, `uploadingImage`, `categories`) + **computed** para hints verticales |
| Standalone | Sí |

### Campos del formulario

Único `productForm: ProductFormGroup` ([product-form.component.ts:81-101](src/app/modules/admin/components/products/product-form/product-form.component.ts#L81-L101)) con 16 controles + 2 FormArrays:

| Campo | Tipo de control | Tab actual | ¿Condicional por giro? | Validación |
|---|---|---|---|---|
| `name` | `<input pInputText>` | 1 — Info básica | No (placeholder verticalizado) | `Validators.required` |
| `barcode` | `<input pInputText>` + scanner | 1 | No | — |
| `description` | `<textarea pInputTextarea>` (max 1000) | 1 | No | — |
| `pricePesos` | `<p-inputNumber currency="MXN">` | 1 | No | `Validators.min(0)` |
| `categoryId` | `<p-dropdown>` (categorías Dexie) | 1 | No | `Validators.required` |
| `isAvailable` | `<p-inputSwitch>` | 1 | No | — |
| `trackStock` | `<p-inputSwitch>` | 1 | No | — |
| `currentStock` | `<p-inputNumber>` | 1 (visible si `trackStock`) | No | `Validators.min(0)` |
| `lowStockThreshold` | `<p-inputNumber>` | 1 (visible si `trackStock`) | No | `Validators.min(0)` |
| `isMembership` | `<p-inputSwitch>` | 1 | **Sí** — sólo si `tenantContext.currentMacro() === Services` (`showsMembership`) | — |
| `membershipDurationDays` | `<p-inputNumber suffix=" días">` | 1 (visible si `isMembership`) | **Sí** — Services + isMembership | `Validators.min(1)` |
| `printingDestinationId` | `<p-dropdown>` | 1 | **Sí** — sólo si `tenantContext.hasKitchen()` | — |
| `satProductCode` | `<input pInputText>` | 1 | No | — |
| `satUnitCode` | `<p-dropdown>` (catálogo SAT) | 1 | No | — |
| `taxRate` | `<p-dropdown>` (IVA_RATE_OPTIONS) | 1 | No | — |
| `sizes` | `FormArray<SizeFormGroup>` (label, priceDeltaPesos) | 3 — Precios y modificadores | No | child `Validators.required` en label |
| `modifierGroups` | `FormArray<ModifierGroupForm>` (name, min/max, isRequired, extras) | 3 (visible si F&B / hasKitchen) | **Sí** — sólo si `hasKitchen()` o macro F&B | `modifierGroupMinMaxValidator` cross-field + child requireds |
| (productImages — no es FormControl) | upload nativo `<input type="file">` | 2 — Imágenes | Disabled hasta que el producto esté guardado | servicio limita 5 imágenes |

### Tabs

- **PrimeNG `<p-tabView>`** (no custom). Modulo `TabViewModule` importado.
- 3 tabs hardcoded:
  1. "Info básica" — todos los campos del FormGroup excepto sizes y modifierGroups
  2. "Imágenes" — gestionado fuera del FormGroup, vía `ProductService.uploadProductImage` directamente
  3. "Precios y modificadores" — sizes + modifierGroups (este último gateado por F&B/hasKitchen)
- Index activo en signal `activeTabIndex = 0`.
- **Indicador visual del tab activo aparece en violeta lara-indigo (#6366F1)**, no en verde brand. Este es un bug de override en `styles.scss` (sólo override de buttons/checkboxes/radios; TabView no incluido).

### Servicios inyectados

| Servicio | Uso |
|---|---|
| `DatabaseService` (Dexie) | Carga categorías y producto a editar (`db.categories`, `db.products.get(id)`) |
| `ProductService` | `createProduct`, `updateProduct`, `uploadProductImage`, `deleteProductImage` |
| `ScannerService` | Escaneo HID global del código de barras |
| `MessageService` (PrimeNG) | Toasts (success / error) |
| `Router` + `ActivatedRoute` | Navegación post-save y resolución de modo (`:id` → edit) |
| `TenantContextService` | Hints verticales (`currentMacro`, `hasKitchen`, `posExperience`) — gating + placeholders |
| `PrinterDestinationService` | Lista de destinos de impresión activos |

### Modelos / utilidades

- `Product`, `ProductImage`, `ProductExtra`, `ProductModifierGroup`, `Category` (de `core/models`)
- `IVA_RATE_OPTIONS`, `SAT_UNIT_OPTIONS` (catálogos fiscales)
- `MacroCategoryType` (enum)
- `SaveProductDto` (shape del payload al backend)
- `getHttpErrorSummary` (utilidad de error)
- Sin pipes / directivas custom.

### HTML actual

- **Layout**: flex column en el host, con header (toolbar sticky), body (scroll), y footer sticky con Cancel/Save.
- **TabView** ocupa todo el body. Cada `<p-tabPanel>` tiene un `<div class="product-form">` adentro.
- `.product-form` es **flex column** con `gap: $space-4; padding: $space-5; max-width: 720px; margin: 0 auto` ([product-form.component.scss:192-202](src/app/modules/admin/components/products/product-form/product-form.component.scss#L192-L202)).
- **No hay grid 2-col**. Todos los campos van apilados verticalmente. Hay UN solo `.form-row` (clase `display: flex; gap` con `>.form-field { flex: 1 }`) usado dos veces: para `currentStock + lowStockThreshold` y para `satUnitCode + taxRate`.
- `.form-field--row` (modificador) pone label + input switch en la misma línea con `space-between`.
- Sin media queries en este SCSS (verificado).
- Inputs tienen `width: 100%` vía `.form-field__input` o `styleClass="w-full"`.
- Secciones lógicas presentes pero implícitas: separadas por `<div class="form-section-divider">` y `<span class="form-section-title">` (líneas 165, 193 del HTML). Hoy hay dos divisores: "Impresión de cocina" e "Datos fiscales (CFDI)".

### SCSS actual

- 459 líneas. Usa tokens de `styles/variables` (`$space-*`, `$color-*`, `$font-size-*`).
- `:host { display: block; height: 100% }` + flex column hace que el sticky header/footer funcione.
- **Cero media queries** en este archivo. No hay responsive design propio. Heredarán cualquier responsive de PrimeFlex si el HTML lo usara — pero el HTML no lo usa.
- Estilos del TabView vía `:host ::ng-deep .product-form-tabs { … }`.
- Botones declarados localmente (`.btn-primary`, `.btn-ghost`, `.btn-icon`) en lugar de `<p-button>` — comentario indica que son "duplicados de la lista" para mantener autonomía y promover a partial compartido en follow-up.
- `max-width: 720px` en `.product-form` → en pantallas anchas la mitad derecha queda vacía.

### Problemas UX detectados

1. **`max-width: 720px` desperdicia ancho en monitores grandes**. En 1850px de viewport, la columna del form ocupa ~39% — el resto es espacio en blanco. Sin preview ni columna lateral que aproveche ese espacio.
2. **Tabs forzadas** — la separación Info / Imágenes / Precios es artificial: muchos workflows requieren saltar entre tabs (e.g., para modificadores hay que ir a la 3ra tab; para imágenes hay que guardar primero y volver a la 2da). Una sola página con secciones colapsables sería más fluida.
3. **Indicador del TabView en violeta `#6366F1`** (lara-indigo default) en vez del verde brand. Inconsistente con el resto de la UI.
4. **Datos fiscales (SAT) viven dentro de "Info básica"** sin colapsar. Para tenants sin facturación (sin `CfdiInvoicing`) sigue mostrándose y ocupa espacio. Aún más: ya hay un tab "Fiscal" en Settings — duplicación conceptual.
5. **Membership / vigencia mezclado con Stock** en la misma tab. Para un Gym, `trackStock` y `currentStock` rara vez aplican; `isMembership` y `membershipDurationDays` son los campos clave y aparecen abajo del switch de stock.
6. **Sin preview** — el usuario no ve cómo se renderiza el producto en POS hasta guardar y abrir el grid. La curva de feedback es lenta.
7. **Imágenes deshabilitadas en modo crear** — el tab 2 muestra un empty-state ("Guarda el producto primero para agregar imágenes") en lugar de permitir adjuntar archivos pendientes y subirlos al guardar. Workflow de dos pasos forzado.
8. **Botones del footer con clases custom** (`.btn-primary`, `.btn-ghost`) en vez de `<p-button>`. Inconsistente con el resto del Back Office tras AUDIT-044 (que limpió el sizing global y habilita PrimeNG nativo).
9. **Cantidad de campos en una sola página (16+)** sin agrupación visual fuerte. La densidad sin separadores claros hace que el ojo se pierda — sólo hay 2 dividers.

---

## Part B — Hallazgos de spacing en los screenshots

Tres bugs reales de layout, cada uno con su raíz identificada:

### B1 — Las cards no llegan al borde derecho de la página

[`admin-shell.component.scss:397-410`](src/app/modules/admin/admin-shell.component.scss#L397-L410) — el contenedor `.content` tiene `max-width: 1200px; margin: 0 auto`. En un monitor de 1850px de viewport con sidebar de ~200px, el área disponible es ~1650px, pero `.content` se restringe a 1200px y se centra → quedan ~225px de blanco a cada lado.

Esto NO es un bug del grid de PrimeFlex — es la regla `max-width: 1200px` en el shell. Funciona como diseño en pantallas medianas; en monitores grandes deja la sensación que el grid "no se toma completo".

**Opciones**:
- a) Subir `max-width` a 1440px o 1600px (más espacio sin perder densidad).
- b) Removerlo (`max-width: none`) y dejar que cada página decida.
- c) Mantenerlo pero condicional por tab/página (Settings full-width, otras restringidas).

### B2 — La tabla de Sucursales está desalineada con las cards superiores

Causa: PrimeFlex `.grid` aplica `margin: -0.5rem -0.5rem 0 -0.5rem` para compensar el `padding: 0.5rem` de cada `.col-*`. La row de Info+Folios queda 0.5rem (8px) más ancha que su parent — extiende fuera por la izquierda y derecha.

La sección de Sucursales (`<section class="settings-card">` directa, sin grid wrapper) no tiene esa compensación → queda 8px más adentro a cada lado.

**Resultado**: el borde derecho de "Configuración de folios" sobresale ~8px del borde derecho de la card de Sucursales. Visualmente desalineado.

**Fix mínimo**: envolver la card de Sucursales en `<div class="grid"><div class="col-12">…</div></div>` para que herede la misma compensación de margen. O alternativamente quitar el `.grid` outer y usar otro mecanismo de columnas.

### B3 — El form de Producto se ve "centrado y angosto"

Causa: [`product-form.component.scss:199`](src/app/modules/admin/components/products/product-form/product-form.component.scss#L199) — `.product-form { max-width: 720px; margin: 0 auto }`. En viewport de 1850px, el área disponible para el form (después del sidebar de admin-shell + max-width 1200px del .content) es ~1200-padding ≈ ~1100px, y el form se restringe a 720px → ~190px de blanco a cada lado dentro del card.

Esto se nota más por el bug B1 (que ya restringe el .content a 1200px) → doble restricción.

### B4 — Tab activo en violeta en lugar de verde

[`styles.scss:69-107`](src/styles.scss#L69-L107) override sólo color de buttons / radio / checkbox / inputtext. **TabView no está overrideado**, entonces el indicador del tab activo (border-bottom de `.p-tabview-nav-link.p-highlight`) hereda del theme lara-light-indigo: `#6366F1`.

**Fix**: agregar override del TabView en `styles.scss`:
```scss
.p-tabview .p-tabview-nav li.p-highlight .p-tabview-nav-link {
  color: #16A34A;
  border-color: #16A34A;
}
```

---

## Part C — Propuesta de rediseño del Product Form (PASO 3)

### Layout nuevo — sin tabs, con secciones agrupadas y preview lateral

| Elemento actual | Problema | Cambio propuesto |
|---|---|---|
| `<p-tabView>` con 3 tabs | Fragmenta el flujo; el usuario salta. Imágenes deshabilitada en crear. | Eliminar tabs. Una sola página scrolleable con **secciones colapsables** (`<details>` o componente accordion de PrimeNG). |
| `.product-form { max-width: 720px }` | Desperdicia 60% del ancho en monitores grandes. | Layout **2-col 60/40**: 60% form + 40% preview lateral del producto en POS (vista previa de tarjeta). En `<768px` el preview se oculta y el form queda single-column full-width. |
| Tab "Info básica" con 16 campos | Densidad sin agrupación. | Dividir en 4 secciones colapsables: **Identidad**, **Precio**, **Inventario**, **Modificadores**. |
| Sección Identidad | — | Nombre (full-width, `max-width: 480px`), Categoría (dropdown), Descripción, Imagen primaria (drag-drop). Toggle "Disponible". |
| Sección Precio | — | Precio base + Unidad de medida en **2-col** (col-12 md:col-6). Switch "Precio incluye IVA" o dropdown de tasa IVA. Sólo si `tenantContext.hasFeature(CfdiInvoicing)` → Clave SAT + Unidad SAT. |
| Sección Inventario | — | Switch "Controlar stock" → si activo, expone Stock inicial + Alerta mínima en 2-col + Código de barras + (futuro) Proveedor. |
| Sección Modificadores | — | Sólo visible si `tenantContext.hasKitchen() \|\| currentMacro() === FoodBeverage`. Sizes + grupos de modificadores con UI igual a la actual (las FormArrays no necesitan cambio). |
| Sección Membership (Services) | Mezclada con Stock | Sección propia "Vigencia y membresía" — sólo visible si `showsMembership()`. Switch + días + hint. |
| Datos fiscales (SAT) en Info básica | Duplicación con tab Fiscal de Settings | Mover a sección colapsable "Datos fiscales (avanzado)". Default: colapsado. Sólo visible si `hasFeature(CfdiInvoicing)`. |
| Imágenes en tab separado, deshabilitado en crear | Workflow de 2 pasos | En sección Identidad, **acumular en memoria** las imágenes elegidas y subirlas al `save()` exitoso. La barra de progreso aparece después del POST `createProduct`. |
| Indicador TabView violeta | Bug de theme | Después de eliminar TabView, irrelevante. Pero override igual al `styles.scss` para futuras tabs (settings sigue usando tabs). |
| `.btn-primary` / `.btn-ghost` custom | Inconsistente con resto del Back Office post-AUDIT-044 | Reemplazar por `<p-button label="Guardar" icon="pi pi-save" [loading]="savingProduct()" />` y `<p-button label="Cancelar" severity="secondary" [outlined]="true" />`. Sticky footer se mantiene. |
| Sin responsive | Form se rompe en viewport <600px | Agregar media query en SCSS: `@media (max-width: 768px) { .product-form-page__body { grid-template-columns: 1fr; } .preview { display: none; } }` |
| Header del page con sólo "Volver" | Sub-óptimo | Mantener el "Volver" pero agregar a la derecha el contador de secciones completas (`3/4 secciones`) o el switch "Disponible" para acceso rápido. |

### Mockup textual

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ← Volver        Nuevo producto                                           │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  ┌──────────────────────┐  │
│  │ ▼ IDENTIDAD                            │  │   PREVIEW EN POS     │  │
│  │   Nombre        [_______________]      │  │                      │  │
│  │   Categoría     [▼ Seleccionar  ]      │  │   ┌──────────────┐   │  │
│  │   Descripción   [_______________]      │  │   │   [imagen]   │   │  │
│  │   Imagen        [drag and drop]        │  │   │              │   │  │
│  │   Disponible    [● switch]             │  │   │  Mensualidad │   │  │
│  │                                        │  │   │   $300.00    │   │  │
│  │ ▼ PRECIO                               │  │   └──────────────┘   │  │
│  │   Precio base   [$0.00]   IVA [16%▼]   │  │                      │  │
│  │   ☑ Precio incluye IVA                 │  │  ─ vista en grid ─   │  │
│  │                                        │  │                      │  │
│  │ ▶ INVENTARIO                           │  └──────────────────────┘  │
│  │ ▶ VIGENCIA Y MEMBRESÍA  (Services)     │                            │
│  │ ▶ MODIFICADORES         (F&B)          │                            │
│  │ ▶ DATOS FISCALES        (CFDI)         │                            │
│  └────────────────────────────────────────┘                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                  [Cancelar]  [Guardar]  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Responsive

- **≥1024px**: 2 columnas (form 60% + preview 40%). Preview sticky en scroll.
- **768–1023px**: form full-width, preview se transforma en una "tarjeta peek" colapsable arriba del form (botón "Ver vista previa").
- **<768px**: form full-width, preview oculto. Secciones colapsables con la primera (Identidad) abierta por default.

### Cambios en el código

**TS**: muy pocos cambios reales:
- Quitar `activeTabIndex` (no más tabs).
- Agregar signals `expandedSections = signal<Set<string>>(new Set(['identity']))` y método `toggleSection(id: string)`.
- Si se implementa preview, exponer `previewProduct = computed<Product>()` que arma el shape para el preview a partir del FormGroup.
- Imágenes en modo crear: agregar `pendingImageFiles = signal<File[]>([])` y subirlas tras `createProduct` exitoso.

**HTML**: reescribir el `<p-tabView>` por un container 2-col con secciones colapsables. Mucho del markup interno (FormArrays de sizes/modifiers) se reusa intacto.

**SCSS**: agregar grid 2-col para body, sticky preview, y media queries. Quitar `max-width: 720px` del `.product-form`.

### Riesgo y blast-radius

- El FormGroup no cambia (cero riesgo en el save path).
- TabView fuera, accordion adentro: `TabViewModule` se puede quitar de imports.
- El indicador violeta (B4) se resuelve solo al eliminar TabView, pero conviene parchear `styles.scss` igual para Settings que SÍ usa tabs.
- Las gates por vertical (`showsMembership`, `hasKitchen`, etc.) se mantienen — sólo cambian de tab a sección colapsable.

---

## Part D — Spacing fixes (Settings + Sucursales)

| # | Bug | Fix propuesto | Riesgo |
|---|---|---|---|
| B1 | `.content { max-width: 1200px }` en admin-shell | Subir a `1440px` (o tab-aware: Settings y catálogos full, dashboards 1200px) | Bajo |
| B2 | Sucursales card desalineada vs grid | Wrap en `<div class="grid"><div class="col-12">…</div></div>` para heredar las negative margins | Muy bajo |
| B3 | Form de producto angosto (720px) | Resuelto por la propuesta C (2-col con preview, sin max-width) | — |
| B4 | TabView en violeta | Override en `styles.scss` para `.p-tabview .p-highlight .p-tabview-nav-link` con color brand verde | Muy bajo |

---

## Próximos pasos — esperando confirmación

Pregunto antes de implementar nada:

1. **¿Implementamos los 4 fixes de spacing (B1-B4)** primero como pase chico independiente del rediseño del form? Son cambios pequeños y aislados.
2. **¿Confirmamos el rediseño del Product Form** según la propuesta C (sin tabs, 2-col con preview, secciones colapsables)?
   - ¿Te interesa el preview lateral (40%) o lo dejamos sólo single-column?
   - ¿Mantenemos el `<details>` HTML nativo para colapsables o usamos `<p-accordion>` de PrimeNG?
3. **¿Hay restricciones que no estoy viendo?** — por ejemplo, si el preview requiere endpoints nuevos, o si las secciones colapsables tienen que persistir su estado abierto entre sesiones.

No voy a implementar nada hasta tu aprobación.
