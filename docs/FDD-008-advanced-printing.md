# FDD-008 — Printing Destinations UI & Configuration (Phase 19)

**Fecha:** 2026-04-03
**Estado:** Borrador — Pendiente aprobación
**Fase Angular:** 18 (Signals-first)
**Rutas objetivo:** `/admin/products` (extender formulario) · `/admin/settings` (nuevo tab "Impresoras")

---

## 1. Contexto y Análisis del Estado Actual

### 1.1 Lo que ya existe (no rediseñar)

| Artefacto | Archivo | Estado |
|-----------|---------|--------|
| Interfaz `Product` | `core/models/product.model.ts` | ✅ Completo — base a extender |
| `AdminProductsComponent` | `admin/components/products/admin-products.component.ts` | ✅ Completo con Signals — formulario a extender |
| `ProductForm` (interface interna) | mismo archivo | ✅ 13 campos — agregar `printingDestinationId` |
| `AdminSettingsComponent` (tabs) | `admin/components/settings/` | ✅ Construido con tabs de PrimeNG |
| `DatabaseService` (Dexie) | `core/services/database.service.ts` | ✅ Offline-first — agregar tabla nueva |
| `AuthService.activeBranchId()` | `core/services/auth.service.ts` | ✅ Signal reactivo — consumir en nuevo service |
| Ruta `/admin/settings` | `admin.routes.ts` | ✅ Registrada |

### 1.2 Lo que NO existe (objetivo de Phase 19)

| Artefacto | Estado |
|-----------|--------|
| `PrinterDestination` model | ❌ Por crear |
| `PrinterDestinationService` | ❌ Por crear |
| Tabla Dexie `printerDestinations` | ❌ Por agregar a `DatabaseService` |
| Campo `printingDestinationId` en `Product` | ❌ Por agregar |
| Campo `printingDestinationId` en `ProductForm` | ❌ Por agregar en `admin-products.component.ts` |
| Dropdown "Destino de impresión" en formulario de producto | ❌ Por agregar en `admin-products.component.html` |
| `AdminPrinterSettingsComponent` | ❌ Por crear |
| Tab "Impresoras" en Admin Settings | ❌ Por agregar |
| `PrintService` (multi-destino) | ❌ Por crear |

---

## 2. Modelos de Datos Nuevos

### 2.1 `PrinterConnectionType` — Tipo de conexión

```
type PrinterConnectionType = 'none' | 'usb' | 'network' | 'bluetooth'
```

| Valor | Descripción | Implementación Phase 19 |
|-------|-------------|------------------------|
| `'none'` | Sin impresora física — usa `window.print()` con CSS de impresión | ✅ Implementado |
| `'network'` | Impresora de red (IP:puerto) vía bridge ESC/POS local | ⚠️ Arquitectura diseñada, implementación futura |
| `'usb'` | WebUSB API | ⚠️ Arquitectura diseñada, implementación futura |
| `'bluetooth'` | Web Bluetooth API | ⚠️ Arquitectura diseñada, implementación futura |

> **Regla de Phase 19:** Solo `'none'` es funcional. Los demás tipos se guardan en Dexie y aparecen en la UI, pero el dispatch real es idéntico a `'none'` hasta que se implemente cada driver.

---

### 2.2 `PrinterDestination` — Modelo principal

**Archivo:** `src/app/core/models/printer.model.ts` *(nuevo)*

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `id` | `number` | ✅ | PK local (autoincrement Dexie) |
| `name` | `string` | ✅ | Nombre visible. Ej: `"Cocina"`, `"Barra"`, `"Caja"` |
| `connectionType` | `PrinterConnectionType` | ✅ | Tipo de conexión |
| `address` | `string?` | ❌ | IP:puerto para `'network'`. Ej: `"192.168.1.100:9100"` |
| `isDefault` | `boolean` | ✅ | Si `true`, recibe el ticket del cliente. Solo uno puede ser `true` |
| `isActive` | `boolean` | ✅ | Si `false`, el destino no aparece en el dropdown de productos |
| `sortOrder` | `number` | ✅ | Orden visual en la tabla de configuración |

**Invariante de negocio:** Máximo UN destino puede tener `isDefault = true` en cualquier momento. El servicio garantiza esta invariante al hacer `setDefault(id)`.

---

### 2.3 Extensión de `Product` — Campo `printingDestinationId`

**Archivo:** `src/app/core/models/product.model.ts`

Se agrega UNA sola propiedad opcional al final de la interfaz `Product`:

```
printingDestinationId?: number | null
```

**Semántica:**
- `null` o `undefined` → el producto no genera ticket de cocina al venderse
- `number` → al completarse una orden, los items de este producto se agrupan y envían al destino correspondiente

**Ejemplo:** Agua embotellada (`printingDestinationId: null`) no va a cocina. Tacos de canasta (`printingDestinationId: 1` → "Cocina") sí.

---

## 3. Arquitectura de State Management — Signals

### 3.1 `PrinterDestinationService` — Diseño Completo

**Archivo:** `src/app/core/services/printer-destination.service.ts` *(nuevo)*
**Patrón:** Signal-first, offline-first (idéntico a `InventoryService`)

```
PrinterDestinationService  (providedIn: 'root')
│
├── SIGNALS PÚBLICOS (readonly)
│   ├── destinations      = signal<PrinterDestination[]>([])
│   ├── isLoading        = signal<boolean>(false)
│   ├── activeDestinations = computed(() =>
│   │       destinations().filter(d => d.isActive).sort(by sortOrder)
│   │   )
│   └── defaultDestination = computed(() =>
│           destinations().find(d => d.isDefault) ?? null
│       )
│
└── MÉTODOS ASYNC
    ├── loadFromLocal()        → Promise<void>
    │   └── reads db.printerDestinations.orderBy('sortOrder').toArray()
    │       → destinations.set(data)
    │
    ├── create(payload)        → Promise<void>
    │   ├── assigns next available id and sortOrder
    │   ├── db.printerDestinations.add(newDestination)
    │   └── destinations.update(list => [...list, newDestination])
    │
    ├── update(id, patch)      → Promise<void>
    │   ├── db.printerDestinations.update(id, patch)
    │   └── destinations.update(list => list.map apply patch)
    │
    ├── delete(id)             → Promise<void>
    │   ├── Guard: reject if any product references this id
    │   ├── db.printerDestinations.delete(id)
    │   └── destinations.update(list => list.filter(d => d.id !== id))
    │
    └── setDefault(id)         → Promise<void>
        ├── clears isDefault on all existing destinations in Dexie (bulk update)
        ├── sets isDefault = true on target destination
        └── destinations.update(list => list.map apply new defaults)
```

**Dependency:** Solo inyecta `DatabaseService`. No usa `HttpClient`; las impresoras son configuración local (no se sincronizan al API en Phase 19).

---

### 3.2 `PrintService` — Arquitectura Multi-Destino

**Archivo:** `src/app/core/services/print.service.ts` *(nuevo)*
**Patrón:** Servicio orquestador puro. No tiene signals propios; lee `PrinterDestinationService` y recibe `Order` como parámetro.

```
PrintService  (providedIn: 'root')
│
├── DEPENDENCIAS
│   ├── inject(PrinterDestinationService)
│   └── inject(DatabaseService)  ← para leer Product.printingDestinationId en tiempo real
│
└── MÉTODO PRINCIPAL
    printOrder(order: Order) → Promise<void>
    │
    ├── 1. RESOLUCIÓN DE DESTINOS
    │   ├── Obtiene todos los products de los items de la orden desde Dexie
    │   └── Mapea cada CartItem → printingDestinationId
    │
    ├── 2. AGRUPACIÓN
    │   ├── Separa items en grupos: Map<destinationId | null, CartItem[]>
    │   └── El grupo con key null/undefined se descarta (no imprime en cocina)
    │
    ├── 3. TICKETS DE COCINA (paralelo)
    │   └── For each (destinationId, items) where destinationId !== null:
    │       ├── Resuelve PrinterDestination desde PrinterDestinationService
    │       └── dispatchKitchenTicket(items, destination, orderContext)
    │
    └── 4. TICKET DEL CLIENTE
        ├── Obtiene defaultDestination()
        └── dispatchCustomerReceipt(order, defaultDestination | null)
```

#### Método `dispatchKitchenTicket`

```
dispatchKitchenTicket(
  items: CartItem[],
  destination: PrinterDestination,
  orderContext: { orderNumber: string; tableLabel?: string; createdAt: Date }
) → Promise<void>

Switch destination.connectionType:
  case 'none':      openKitchenPrintWindow(ticketContent)   ← window.open() + window.print()
  case 'network':   stub → log warning "Network printing not yet implemented"
  case 'usb':       stub → log warning "USB printing not yet implemented"
  case 'bluetooth': stub → log warning "Bluetooth printing not yet implemented"
```

#### Método `dispatchCustomerReceipt`

```
dispatchCustomerReceipt(
  order: Order,
  destination: PrinterDestination | null
) → Promise<void>

If destination is null or connectionType === 'none':
  → openReceiptPrintWindow(receiptContent)   ← window.open() + window.print()
Else:
  → stub (same approach as kitchen stubs)
```

#### Formato del ticket de cocina (contenido mínimo)

```
┌─────────────────────────────┐
│  COCINA  •  Mesa 3          │
│  12:34 pm  •  Orden #0042   │
├─────────────────────────────┤
│  2x  Tacos de Canasta       │
│      nota: sin cilantro     │
│  1x  Sopa de Lima           │
└─────────────────────────────┘
```

CSS de impresión: `@media print { body { font-family: monospace; font-size: 12pt; } }`
La ventana emergente se cierra automáticamente después de `window.print()`.

---

### 3.3 Flujo completo de una orden completada

```
Checkout completado
        │
        ▼
CartService.completeOrder(order)
        │
        ▼
PrintService.printOrder(order)
        │
        ├─── Leer printingDestinationId de cada item
        │
        ├─── Agrupar items
        │         Items con destinationId = null  →  [descartados — no van a cocina]
        │         Items con destinationId = 1     →  "Cocina"  → KitchenTicket A
        │         Items con destinationId = 2     →  "Barra"   → KitchenTicket B
        │
        ├─── Promise.all([
        │       dispatchKitchenTicket(itemsCocina, destCocina),
        │       dispatchKitchenTicket(itemsBarra,  destBarra),
        │    ])
        │
        └─── dispatchCustomerReceipt(order, defaultDestination)
```

---

## 4. Cambios a `AdminProductsComponent`

### 4.1 Extensión de `ProductForm` (interface interna)

Se agrega un único campo a la interface `ProductForm` que ya existe en el componente:

```
ProductForm {
  // ... campos existentes (13) ...
  printingDestinationId: number | null   ← NUEVO
}
```

### 4.2 Extensión de `emptyProductForm()`

El método helper `emptyProductForm()` (línea ~770 del componente actual) retornará `printingDestinationId: null` como valor por defecto.

### 4.3 Extensión de `openEdit(product)`

El mapper de producto → formulario (línea ~242) incluirá:

```
printingDestinationId: product.printingDestinationId ?? null
```

### 4.4 Extensión de `saveProduct()`

El objeto `payload` construido en `saveProduct()` incluirá:

```
printingDestinationId: this.form.printingDestinationId
```

### 4.5 Nueva inyección requerida

El componente inyectará `PrinterDestinationService` para exponer `activeDestinations()` al template (para el dropdown).

Opción de "Sin impresión de cocina" en el dropdown:

```
[
  { id: null, name: 'Sin impresión de cocina' },
  ...printerDestinationService.activeDestinations()
]
```

---

## 5. UI — Dropdown en el Formulario de Producto

### 5.1 Ubicación en el template

El dropdown se coloca en el tab **"General"** del diálogo de producto, después del campo `isAvailable` (switch), antes del tab de tallas/extras. Tamaño: `col-12 md:col-6`.

### 5.2 Componente PrimeNG

Se usa `<p-dropdown>` (ya importado en `AdminProductsComponent`):

| Propiedad | Valor |
|-----------|-------|
| `[options]` | `printingDestinationOptions()` (computed del componente) |
| `optionLabel` | `'name'` |
| `optionValue` | `'id'` |
| `[(ngModel)]` | `form.printingDestinationId` |
| `placeholder` | `'Sin impresión de cocina'` |
| `[showClear]` | `true` |

### 5.3 Visibilidad condicional

El dropdown solo se muestra si hay al menos un `PrinterDestination` activo configurado (computed signal `hasPrinters`). Si no hay destinos configurados, se muestra un `p-message` informativo: *"Configura impresoras en Ajustes → Impresoras para activar esta función."*

---

## 6. UI — Admin Settings Tab "Impresoras"

### 6.1 Nuevo componente

**Archivo:** `src/app/modules/admin/components/settings/printer-settings/admin-printer-settings.component.ts` *(nuevo)*
**Selector:** `app-admin-printer-settings`
**Standalone:** ✅

### 6.2 Signals del componente

```
AdminPrinterSettingsComponent
│
├── INYECCIONES
│   └── inject(PrinterDestinationService)  →  printerService
│
├── SIGNALS LOCALES
│   ├── dialogVisible    = signal<boolean>(false)
│   ├── editingDest      = signal<PrinterDestination | null>(null)
│   └── isSaving        = signal<boolean>(false)
│
├── COMPUTED
│   └── destinations()   ← delegado a printerService.destinations()
│
└── FORM (interface interna PrinterDestinationForm)
    ├── name:           string
    ├── connectionType: PrinterConnectionType
    ├── address:        string
    └── isActive:       boolean
```

### 6.3 Layout de la tabla

| Columna | Descripción |
|---------|-------------|
| Nombre | Texto con badge "Default" (si `isDefault = true`) |
| Tipo de conexión | Chip: `none` / `network` / `usb` / `bluetooth` |
| Dirección | IP:puerto (vacío si `connectionType = 'none'`) |
| Activo | Toggle `p-inputSwitch` inline |
| Acciones | Botón Editar · Botón Eliminar · Botón "Usar como ticket cliente" |

### 6.4 Diálogo de creación/edición

Campos del formulario:

| Campo | Componente PrimeNG | Validación |
|-------|--------------------|------------|
| Nombre | `pInputText` | Requerido, max 40 chars |
| Tipo de conexión | `p-dropdown` con las 4 opciones | Requerido |
| Dirección (IP:puerto) | `pInputText` | Solo visible si `connectionType !== 'none'`. Patrón `^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$` |
| Activo | `p-inputSwitch` | — |

### 6.5 Confirmación de borrado

Al hacer clic en "Eliminar":
- Si el destino está referenciado por al menos un producto → `p-toast` de error: *"No se puede eliminar '%name%': está asignado a productos existentes."*
- Si no está referenciado → `p-confirmDialog` estándar.

### 6.6 Integración en Admin Settings

Se agrega un nuevo `<p-tabPanel header="Impresoras">` en `admin-settings.component.html`. El componente `AdminPrinterSettingsComponent` se renderiza dentro con `<app-admin-printer-settings />`. El tab incluye el ícono `pi pi-print` en el header.

---

## 7. Esquema Dexie — `DatabaseService`

### 7.1 Nueva tabla `printerDestinations`

| Campo indexado | Razón |
|---------------|-------|
| `++id` | PK autoincrement |
| `isDefault` | Búsqueda rápida del destino default al imprimir |
| `isActive` | Filtrado para dropdown de productos |

### 7.2 Bump de versión

La versión del store Dexie se incrementa en +1. La migración (`upgrade`) del bloque de versión anterior es vacía (solo agrega la tabla; datos existentes no se tocan).

---

## 8. Archivos a Crear / Modificar

### 8.1 Archivos nuevos

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `src/app/core/models/printer.model.ts` | Modelo | `PrinterConnectionType`, `PrinterDestination`, `PrinterDestinationForm` |
| `src/app/core/services/printer-destination.service.ts` | Service | CRUD + Signals de destinos |
| `src/app/core/services/print.service.ts` | Service | Orquestador de impresión multi-destino |
| `src/app/modules/admin/components/settings/printer-settings/admin-printer-settings.component.ts` | Component | UI de gestión de impresoras |
| `src/app/modules/admin/components/settings/printer-settings/admin-printer-settings.component.html` | Template | Tabla + diálogo |
| `src/app/modules/admin/components/settings/printer-settings/admin-printer-settings.component.scss` | Styles | Estilos del tab |

### 8.2 Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/app/core/models/product.model.ts` | Agregar `printingDestinationId?: number \| null` a `Product` |
| `src/app/core/models/index.ts` | Re-exportar `PrinterDestination`, `PrinterConnectionType` |
| `src/app/core/services/database.service.ts` | Agregar tabla `printerDestinations`, bump versión |
| `src/app/modules/admin/components/products/admin-products.component.ts` | Extender `ProductForm`, inyectar `PrinterDestinationService`, actualizar métodos |
| `src/app/modules/admin/components/products/admin-products.component.html` | Agregar dropdown en diálogo de producto |
| `src/app/modules/admin/components/settings/admin-settings.component.html` | Agregar tab "Impresoras" |
| `src/app/modules/admin/components/settings/admin-settings.component.ts` | Importar `AdminPrinterSettingsComponent` |

---

## 9. Orden de Implementación Sugerido

1. **`printer.model.ts`** — Definir types e interfaces (no tiene dependencias)
2. **`DatabaseService`** — Agregar tabla `printerDestinations` (base para todo)
3. **`PrinterDestinationService`** — Service completo con Signals
4. **Extensión de `Product`** — Agregar `printingDestinationId` al modelo
5. **`AdminPrinterSettingsComponent`** — UI de gestión de impresoras
6. **Tab "Impresoras" en Admin Settings** — Integrar el componente
7. **Extensión de `AdminProductsComponent`** — Dropdown en formulario de producto
8. **`PrintService`** — Orquestador (último, depende de todos los anteriores)

---

## 10. Consideraciones y Restricciones

### 10.1 Compatibilidad hacia atrás

`printingDestinationId` es `optional`. Todos los productos existentes en Dexie conservan su comportamiento actual (sin impresión de cocina) sin necesidad de migración de datos.

### 10.2 Offline-first

`PrinterDestinationService` solo interactúa con Dexie. Las configuraciones de impresoras son 100% locales (sin sync al API). Esto es intencional: la configuración de hardware es específica de cada dispositivo físico.

### 10.3 Impresión en Phase 19 — Alcance real

- ✅ Configuración completa de destinos (UI funcional)
- ✅ Asignación de destino por producto (campo en formulario)
- ✅ Agrupación lógica de items por destino en `PrintService`
- ✅ Dispatch funcional vía `window.print()` para `connectionType: 'none'`
- ⚠️ Drivers de red/USB/Bluetooth: stubs con `console.warn` (Phase 20+)

### 10.4 Invariante del destino default

Si se elimina el destino marcado como default, el ticket del cliente se imprime igualmente usando `window.print()` (no falla silenciosamente). El `PrintService` trata `defaultDestination = null` como equivalente a `connectionType: 'none'`.

### 10.5 Patrones de código a respetar

- Todo estado en el nuevo componente se maneja con `signal()` y `computed()` — cero `BehaviorSubject`
- Regiones `#region` / `#endregion` en todos los nuevos archivos `.ts`
- `inject()` en lugar de constructor injection donde sea posible (Angular 18)
- Atributos HTML en el orden definido en `html-standards.md`
- Monetary values: NO aplica aquí (no hay precios en impresoras)
