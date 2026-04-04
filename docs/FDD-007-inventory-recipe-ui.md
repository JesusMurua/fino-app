# FDD-007 — Inventory & Recipe UI (Phase 18)

**Fecha:** 2026-04-03
**Estado:** Borrador — Pendiente aprobación
**Fase Angular:** 18 (Signals-first)
**Rutas objetivo:** `/admin/inventory` (ampliar) · `/admin/recipes` (nueva)

---

## 1. Contexto y Análisis del Estado Actual

### 1.1 Lo que ya existe (no rediseñar)

Antes de describir lo que se construirá, se documenta el estado real del código para evitar duplicar trabajo.

| Artefacto | Archivo | Estado |
|-----------|---------|--------|
| `InventoryService` | `core/services/inventory.service.ts` | ✅ Completo con Signals |
| `InventoryConsumptionService` | `core/services/inventory-consumption.service.ts` | ✅ Completo (CRUD básico) |
| `AdminInventoryComponent` (Tab 0: Insumos) | `admin/components/inventory/` | ✅ Construido — tabla + dialogs |
| `AdminInventoryComponent` (Tab 1: Proveedores) | mismo componente | ✅ Construido |
| `AdminInventoryComponent` (Tab 2: Entradas) | mismo componente | ✅ Construido |
| Ruta `/admin/inventory` | `admin.routes.ts:46` | ✅ Registrada |
| `FeatureKey.Inventory` | `core/models/plan.model.ts` | ✅ Existe |
| Badge `lowStockCount` en sidebar | `admin-shell.component.ts` | ✅ Funcional |
| Modelos `InventoryItem`, `InventoryMovement`, `ProductConsumption` | `core/models/inventory.model.ts` | ✅ Completos |

### 1.2 Lo que NO existe (objetivo de Phase 18)

| Artefacto | Estado |
|-----------|--------|
| `AdminRecipesComponent` | ❌ Por crear |
| Ruta `/admin/recipes` | ❌ Por registrar |
| `FeatureKey.Recipes` | ❌ Por agregar o reusar `Inventory` |
| Item "Recetas" en sidebar | ❌ Por agregar |
| Método `update()` en `InventoryConsumptionService` | ❌ Falta (solo create/delete) |
| Pill badge de low-stock en la tabla de insumos | ⚠️ Lógica existe (`isLowStock()`), diseño visual a confirmar |

---

## 2. Arquitectura de State Management — Signals

### 2.1 `InventoryService` — Estado Actual (sin cambios)

Este servicio ya implementa el patrón correcto. Se documenta como referencia para `AdminRecipesComponent`.

```
InventoryService
├── items            = signal<InventoryItem[]>([])          ← fuente de verdad global
├── isLoading        = signal<boolean>(false)
└── lowStockItems    = computed(() =>
        items().filter(i => i.isActive && i.currentStock <= i.lowStockThreshold)
    )
```

**Flujo de carga:** `loadFromApi()` → HTTP GET → `items.set(data)` → `lowStockItems` se recalcula automáticamente.
**Fallback offline:** Si el API falla, `loadFromLocal()` lee desde Dexie y hace `items.set(local)`.

> El `AdminRecipesComponent` consumirá `inventoryService.items()` directamente para calcular costos, sin ninguna HTTP call adicional para los insumos.

---

### 2.2 `InventoryConsumptionService` — Extensión Requerida

El servicio actual tiene `getByProduct`, `create` y `delete`. **Se necesita agregar `update`** para permitir editar el `quantityPerSale` de una línea existente sin borrarla y recrearla.

```
InventoryConsumptionService  (extensión mínima)
├── getByProduct(productId)          → Promise<ProductConsumption[]>   ← ya existe
├── create(productId, itemId, qty)   → Promise<ProductConsumption>     ← ya existe
├── delete(id)                       → Promise<void>                   ← ya existe
└── update(id, quantityPerSale)      → Promise<ProductConsumption>     ← NUEVA
    └── PUT /inventory/consumption/{id}  · body: { quantityPerSale }
```

---

### 2.3 `AdminRecipesComponent` — Diseño de Signals Locales

Este componente es el núcleo de Phase 18. Utiliza exclusivamente `inject()` y Signals locales (sin `BehaviorSubject`, sin `subscribe()` manual donde sea evitable).

```
AdminRecipesComponent
│
├── //#region Signals — Master (Products List)
│   ├── products             = this.productService.products()   ← Signal<Product[]> del servicio
│   ├── productSearch        = signal<string>('')
│   ├── filteredProducts     = computed(() =>
│   │       products().filter(p =>
│   │           p.name.toLowerCase().includes(productSearch().toLowerCase())
│   │       )
│   │   )
│   └── selectedProduct      = signal<Product | null>(null)
│
├── //#region Signals — Detail (Recipe Lines)
│   ├── consumptions         = signal<ProductConsumption[]>([])  ← cargado on-demand
│   ├── isLoadingDetail      = signal<boolean>(false)
│   ├── isSaving             = signal<boolean>(false)
│   │
│   │   ── Formulario de línea nueva ──
│   ├── newLineItemId        = signal<number | null>(null)
│   ├── newLineQty           = signal<number>(1)
│   │
│   │   ── UI state ──
│   └── editingLineId        = signal<number | null>(null)   ← id de la línea en edición inline
│
└── //#region Computed — Costo Total del Producto
    └── totalCostCents = computed(() => {
            const lines = consumptions();
            const allItems = inventoryService.items();            // Ya cargado en memoria

            return lines.reduce((sum, line) => {
                const item = allItems.find(i => i.id === line.inventoryItemId);
                if (!item) return sum;
                // costCents por unidad × cantidad requerida por venta
                return sum + Math.round(item.costCents * line.quantityPerSale);
            }, 0);
        })
        // Expuesto al template como: totalCostCents() / 100  formateado con CurrencyPipe
```

#### Flujo de interacción del computed

```
Usuario selecciona un Producto
        ↓
selectedProduct.set(product)
        ↓
ngOnInit / effect() detecta cambio
        ↓
loadConsumptions(productId)
  └── InventoryConsumptionService.getByProduct(id)
  └── consumptions.set(data)
        ↓
totalCostCents recalcula automáticamente
  └── Lee consumptions() y inventoryService.items()
  └── Multiplica item.costCents × line.quantityPerSale por cada línea
  └── Resultado se muestra en el panel de detalle sin ninguna llamada extra
```

> **Clave arquitectónica:** `inventoryService.items()` ya está en memoria cuando el usuario llega a `/admin/recipes` porque el `effect()` del shell lo carga al cambiar `activeBranchId`. El `computed` de costo es puramente síncrono.

---

## 3. UI — Sección Almacén (`/admin/inventory`)

### 3.1 Estado actual de la tabla

`AdminInventoryComponent` ya tiene una tabla de insumos funcional. Esta sección documenta los elementos visuales que deben **verificarse o ajustarse** durante Phase 18.

### 3.2 Low-Stock Pill Badge — Diseño Visual

El método `isLowStock(item)` ya existe. Se necesita confirmar que el template HTML usa el siguiente patrón:

```
Columna "Stock Actual" de la p-table:

  [valor numérico]   [BAJO STOCK]
                      ↑ pill badge condicional
```

**Especificación del badge:**

| Condición | Badge | Color |
|-----------|-------|-------|
| `currentStock > lowStockThreshold` | Sin badge | — |
| `currentStock <= lowStockThreshold && currentStock > 0` | `BAJO STOCK` | `#D97706` (warning amber) |
| `currentStock === 0` | `SIN STOCK` | `#DC2626` (error red) |

```html
<!-- Patrón de columna de stock -->
<td>
  <span class="stock-value">{{ item.currentStock }} {{ item.unit }}</span>
  @if (item.currentStock === 0) {
    <span class="stock-badge stock-badge--empty">Sin stock</span>
  } @else if (isLowStock(item)) {
    <span class="stock-badge stock-badge--low">Bajo stock</span>
  }
</td>
```

**SCSS de los badges:**
```scss
.stock-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  margin-left: 8px;

  &--low   { background: #FEF3C7; color: #D97706; }
  &--empty { background: #FEE2E2; color: #DC2626; }
}
```

### 3.3 Dialogo "Registrar Movimiento" — Diseño

Los dialogs de Entrada y Salida ya existen (`openEntryDialog`, `openExitDialog`, `saveMovement`). Se documenta el diseño esperado como referencia visual:

```
┌─ Registrar [Entrada | Salida] ────────────────────┐
│  Insumo:  Pollo (kg)               [solo lectura] │
│                                                    │
│  Tipo:    [•] Entrada  [ ] Salida  [ ] Ajuste     │
│                                                    │
│  Cantidad:  [ 5.0 _____ ]  (p-inputNumber, min=0) │
│                                                    │
│  Motivo:  [ Compra semanal __________________ ]   │
│           (p-inputTextarea, opcional)              │
│                                                    │
│           [Cancelar]          [Guardar Movimiento] │
└────────────────────────────────────────────────────┘
```

**Reglas de validación:**
- `quantity` > 0 (requerido)
- `reason` opcional pero recomendado para tipo `adjustment`
- El botón "Guardar" se deshabilita si `quantity <= 0`

---

## 4. UI — Sección Recetas (`/admin/recipes`)

Esta es la sección completamente nueva de Phase 18.

### 4.1 Layout Master-Detail

La vista divide la pantalla en dos paneles horizontales:

```
┌─ Fichas Técnicas ──────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─ Productos (Master) ──────┐  ┌─ Ficha Técnica (Detail) ──────────────┐ │
│  │                            │  │                                        │ │
│  │  🔍 [Buscar producto...]   │  │  Pizza Margherita                      │ │
│  │                            │  │  ────────────────────────────────────  │ │
│  │  > Pizza Margherita   ←sel│  │  Insumo              Cantidad   Costo  │ │
│  │    Borrego al pastor       │  │  Harina (kg)         0.3        $2.40  │ │
│  │    Tacos de canasta        │  │  Queso mozzarella    0.2        $8.00  │ │
│  │    Agua de Jamaica         │  │  Jitomate (kg)       0.15       $1.20  │ │
│  │    Café americano          │  │  ────────────────────────────────────  │ │
│  │    ...                     │  │  Costo Total:                 $11.60   │ │
│  │                            │  │                                        │ │
│  │                            │  │  [+ Agregar Insumo]                   │ │
│  │                            │  │                                        │ │
│  │                            │  │  ┌─ Agregar insumo ──────────────────┐ │ │
│  │                            │  │  │ Insumo: [dropdown inventario]      │ │ │
│  │                            │  │  │ Cantidad: [0.000 pInputNumber]     │ │ │
│  │                            │  │  │          [Cancelar] [Agregar]      │ │ │
│  │                            │  │  └────────────────────────────────────┘ │ │
│  └────────────────────────────┘  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Responsividad:**
- Desktop (≥1024px): layout lado a lado (col-4 / col-8)
- Mobile (<768px): Master ocupa pantalla completa; al seleccionar, Detail desliza como panel

### 4.2 Panel Master — Lista de Productos

**Componente PrimeNG:** `p-listbox` o `p-table` simple (sin paginación propia, la búsqueda filtra el signal).

```
Master Panel — Signals involucrados
─────────────────────────────────────
productSearch        signal<string>('')
filteredProducts     computed(() => productos filtrados por nombre)
selectedProduct      signal<Product | null>(null)
```

**Comportamiento al seleccionar:**
1. `selectedProduct.set(product)`
2. `effect()` detecta el cambio → llama `loadConsumptions(product.id)`
3. `isLoadingDetail.set(true)` mientras la petición está en vuelo
4. Resultado → `consumptions.set(data)` → `totalCostCents` recalcula

**Indicador visual en la lista:** Si un producto tiene al menos 1 línea de `ProductConsumption`, mostrar pequeño icono `pi-book` junto al nombre.

### 4.3 Panel Detail — Tabla de Ingredientes (Ficha Técnica)

**Estado vacío:** Si `selectedProduct()` es `null`, mostrar placeholder centrado:
```
[pi-book icono grande]
"Selecciona un producto para ver o editar su ficha técnica"
```

**Tabla de consumptions:**

| Columna | Tipo | Ancho |
|---------|------|-------|
| Insumo | Nombre del `inventoryItem.name` | flex |
| Unidad | `inventoryItem.unit` | 80px |
| Cantidad por venta | `p-inputNumber` editable inline | 120px |
| Costo unitario | `item.costCents / 100` formateado | 100px |
| Subtotal | `computed` = `costCents × qty` | 100px |
| Acciones | Botón eliminar | 60px |

**Edición inline de cantidad:**
- Cada fila muestra la `quantityPerSale` en un `p-inputNumber` editable directamente
- Al perder el foco (`blur`) → llama `InventoryConsumptionService.update(line.id, newQty)`
- Muestra spinner en esa fila (`editingLineId.set(line.id)`) mientras guarda
- `isSaving.set(true/false)` bloquea el formulario de "Agregar" durante guardado

### 4.4 Cálculo de Costo — Diseño del `computed`

```
totalCostCents = computed(() => {
    consumptions()          // [ProductConsumption]  — cargadas por HTTP
    inventoryService.items()  // [InventoryItem]     — ya en memoria (global signal)

    → Para cada línea:
        item = items().find(i => i.id === line.inventoryItemId)
        subtotal = item.costCents × line.quantityPerSale

    → Suma de todos los subtotales en cents
    → Retorna número entero (cents)
})
```

**Presentación en el template:**
```
Costo Total:    {{ totalCostCents() / 100 | currency:'MXN':'symbol-narrow':'1.2-2' }}
```

**Nota:** El costo refleja el precio actual de cada insumo en la DB. Si el precio del insumo cambia, el costo calculado cambia automáticamente la próxima vez que se cargue la vista.

### 4.5 Formulario "Agregar Insumo"

Inline bajo la tabla (sin dialog):

```
[🔽 Seleccionar insumo dropdown]   [Cantidad: 0.000 ▲▼]   [Agregar]
     ↑ options = inventoryService.items()
       filtrados para excluir los ya agregados al producto
```

**Signals del formulario:**
```
newLineItemId   = signal<number | null>(null)
newLineQty      = signal<number>(1)
```

**Validación antes de llamar `create()`:**
- `newLineItemId()` no debe ser null
- `newLineQty()` > 0
- El insumo no debe estar ya en `consumptions()` (prevenir duplicados)

**Dropdown de insumos disponibles:**
```typescript
availableItems = computed(() => {
    const usedIds = consumptions().map(c => c.inventoryItemId);
    return inventoryService.items()
        .filter(i => i.isActive && !usedIds.includes(i.id))
        .map(i => ({ label: `${i.name} (${i.unit})`, value: i.id }));
})
```

---

## 5. Integración — Sidebar del Admin

### 5.1 Estado Actual del Sidebar

El `AdminShellComponent` define `navItems` como `computed()`. Los ítems actuales relevantes:

```typescript
{ path: 'inventory', icon: 'pi-box',    label: 'Inventario',
  show: featureFlags.isRelevantForGiro(FeatureKey.Inventory),
  locked: !featureFlags.canUse(FeatureKey.Inventory),
  badge: true  /* muestra lowStockCount */
}
```

### 5.2 Nuevo Ítem "Recetas"

Se agrega el ítem `recipes` al array `navItems` **inmediatamente después** de `inventory`:

```typescript
{
  path: 'recipes',
  icon: 'pi-book',
  label: 'Recetas',
  show: featureFlags.isRelevantForGiro(FeatureKey.Inventory),   // mismo flag que Inventario
  locked: !featureFlags.canUse(FeatureKey.Inventory),            // mismo plan requerido
  badge: false,
}
```

**Decisión de Feature Flag:** Se reutiliza `FeatureKey.Inventory` porque las recetas son parte inseparable del módulo de inventario. Las fichas técnicas sin insumos no tienen sentido. No se crea un `FeatureKey.Recipes` separado.

### 5.3 Nueva Ruta en `admin.routes.ts`

```typescript
{
  path: 'recipes',
  loadComponent: () =>
    import('./components/recipes/admin-recipes.component')
      .then(m => m.AdminRecipesComponent),
},
```

**Ubicación:** Después de la ruta `inventory` (línea 48 del archivo actual).

---

## 6. Estructura de Archivos a Crear

```
src/app/modules/admin/components/
└── recipes/
    ├── admin-recipes.component.ts       ← Standalone component
    ├── admin-recipes.component.html
    └── admin-recipes.component.scss
```

No se crean servicios nuevos. No se crean modelos nuevos. La única adición en servicios existentes es el método `update()` en `InventoryConsumptionService`.

---

## 7. Dependencias y Módulos PrimeNG

`AdminRecipesComponent` importará:

| PrimeNG Module | Uso |
|----------------|-----|
| `TableModule` | Tabla de consumptions |
| `ListboxModule` | Lista de productos (Master) o `TableModule` simple |
| `InputTextModule` | Campo de búsqueda de producto |
| `InputNumberModule` | Edición inline de `quantityPerSale` + formulario de nueva línea |
| `DropdownModule` | Selector de insumo en formulario "Agregar" |
| `ButtonModule` | Botones de acción (Agregar, Eliminar, etc.) |
| `ProgressSpinnerModule` | Spinner en panel de detalle mientras carga |
| `TooltipModule` | Tooltips en botones icon-only |
| `SkeletonModule` | Placeholder mientras `isLoadingDetail()` es true |

---

## 8. Flujo Completo de Usuario — Recetas

```
1. Usuario navega a /admin/recipes
   └── AdminRecipesComponent inicializa
   └── [InventoryService ya cargó items en memoria via efecto del shell]

2. Panel Master muestra lista de productos
   └── filteredProducts computed() = todos los productos
   └── productSearch signal vacío

3. Usuario escribe "Pizza" en el buscador
   └── productSearch.set('Pizza')
   └── filteredProducts recomputa → solo productos que contienen "Pizza"

4. Usuario selecciona "Pizza Margherita"
   └── selectedProduct.set(pizza)
   └── effect() dispara loadConsumptions(pizza.id)
   └── isLoadingDetail.set(true)
   └── API: GET /inventory/consumption/42
   └── consumptions.set([{ harina, queso, jitomate }])
   └── isLoadingDetail.set(false)
   └── totalCostCents recalcula automáticamente

5. Panel Detail muestra la ficha técnica con 3 líneas
   └── Costo Total: $11.60

6. Usuario edita "Cantidad" de Harina de 0.3 → 0.35
   └── editingLineId.set(lineId)
   └── PUT /inventory/consumption/7  { quantityPerSale: 0.35 }
   └── consumptions.set([...actualizadas])
   └── totalCostCents recalcula: $11.80
   └── editingLineId.set(null)

7. Usuario agrega "Aceite de Oliva"
   └── newLineItemId.set(aceiteId)
   └── newLineQty.set(0.02)
   └── [Agregar] → POST /inventory/consumption
   └── consumptions.set([...con nueva línea])
   └── totalCostCents: $12.40
```

---

## 9. Consideraciones de UX

| Regla | Especificación |
|-------|---------------|
| Touch targets | Mínimo 64×64px en todos los botones de acción |
| Edición inline | `p-inputNumber` en tabla debe tener width mínimo 100px para precisión decimal |
| Feedback de guardado | Toast `severity='success'` después de cada `create`, `update` o `delete` |
| Error handling | Toast `severity='error'` con mensaje descriptivo si el API falla |
| Estado vacío de receta | Ilustración + texto guía si `consumptions().length === 0` |
| Costo $0.00 | Aclarar con tooltip: "Insumo sin costo registrado" si algún ítem tiene `costCents = 0` |
| Confirmación al eliminar | `p-confirmDialog` antes de `delete()` para prevenir errores táctiles |

---

## 10. Criterios de Aceptación

| # | Criterio |
|---|----------|
| AC-01 | `/admin/recipes` carga sin errores y muestra todos los productos del catálogo |
| AC-02 | El buscador filtra la lista de productos reactivamente (sin debounce manual, signal directo) |
| AC-03 | Al seleccionar un producto, el panel de detalle carga sus consumptions vía API |
| AC-04 | `totalCostCents` se recalcula correctamente al cambiar cualquier `quantityPerSale` |
| AC-05 | Se puede agregar un insumo nuevo a la ficha sin recargar la página |
| AC-06 | Se puede eliminar una línea de la ficha con confirmación previa |
| AC-07 | La tabla de insumos en `/admin/inventory` muestra badge "Bajo stock" / "Sin stock" según el umbral |
| AC-08 | El ítem "Recetas" aparece en el sidebar solo si el plan permite `FeatureKey.Inventory` |
| AC-09 | Al hacer click en "Recetas" con plan insuficiente, aparece toast de upgrade (mismo comportamiento que `onLockedClick()`) |
| AC-10 | El `computed` de costo usa `inventoryService.items()` en memoria y nunca dispara HTTP adicionales |

---

## 11. Fases de Implementación Sugeridas

| Sub-fase | Tarea |
|----------|-------|
| 18a | Agregar método `update()` a `InventoryConsumptionService` · Verificar/ajustar pill badges en tabla de insumos |
| 18b | Crear `AdminRecipesComponent` — Master List + búsqueda + signal `selectedProduct` |
| 18c | Panel Detail — tabla de consumptions + edición inline + `computed` de costo total |
| 18d | Formulario "Agregar Insumo" inline + validaciones |
| 18e | Ruta `recipes` en `admin.routes.ts` · Ítem en sidebar · Feature flag |

---

*FDD-007 — Generado para revisión. No implementar hasta aprobación explícita.*
