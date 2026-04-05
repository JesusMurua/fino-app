# Frontend Design Document: Hybrid Counter-to-Table Flow

## FDD-001 — Assign Table from POS Cart

**Fecha:** 2026-04-02
**Autor:** Documento generado por análisis de arquitectura
**Estado:** Draft — pendiente de confirmación

---

## 1. Feature Overview

**Objetivo:** Permitir al cajero asignar una mesa física a una orden walk-up existente (sin mesa) directamente desde el panel del carrito en el POS, sin necesidad de salir al módulo de mesas.

**Problema actual:** Cuando un cliente pide en mostrador (walk-up) y luego decide sentarse, no hay forma de asociar esa orden ya creada con una mesa desde el flujo POS. El cajero tendría que ir al módulo de mesas, buscar la orden, y hacer la asignación manualmente.

**Solución:** Un botón secundario "Asignar a Mesa" en el `cart-panel` que abre un modal de selección de mesas disponibles, ejecuta una mutación optimista en Dexie, y encola la sincronización.

---

## 2. Scope & Boundaries

### In Scope
- Botón "Asignar a Mesa" en `cart-panel` (condicional)
- Componente `TableSelectorDialogComponent` (modal `p-dialog`)
- Mutación optimista en Dexie (order + restaurantTable)
- Nuevo tipo de operación en el Sync Engine para asignación de mesa
- Manejo de 409 Conflict con rollback en Dexie + toast de error
- Signal `activeOrder` para rastrear la orden activa en contexto

### Out of Scope
- Reasignación de mesa (cambiar de una mesa a otra) — feature futuro
- Creación de orden desde el modal de mesas
- Cambios en el backend (.NET API)
- Modificaciones al módulo `tables.component`

---

## 3. Architecture & State Flow

### 3.1 State Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  CART-PANEL                                                 │
│                                                             │
│  [activeOrder().tableId === null]                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────────┐    click    ┌──────────────────────┐  │
│  │ "Asignar a Mesa" │ ─────────► │ TableSelectorDialog  │  │
│  └──────────────────┘            │  (p-dialog modal)    │  │
│                                  │                      │  │
│                                  │  Available tables    │  │
│                                  │  grouped by zone     │  │
│                                  │                      │  │
│                                  │  [Select Table #3]   │  │
│                                  └──────────┬───────────┘  │
│                                             │               │
└─────────────────────────────────────────────┼───────────────┘
                                              │
                                              ▼
                          ┌───────────────────────────────────┐
                          │  TableAssignmentService           │
                          │  .assignTableToOrder(orderId,     │
                          │       tableId, tableName)         │
                          └───────────────────┬───────────────┘
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    │                         │                          │
                    ▼                         ▼                          ▼
          ┌─────────────────┐    ┌────────────────────┐    ┌─────────────────────┐
          │ Dexie: orders   │    │ Dexie: restaurant   │    │ SyncService          │
          │ UPDATE tableId, │    │ Tables UPDATE       │    │ Queue: syncStatus    │
          │ tableName,      │    │ status='occupied'   │    │ = 'Pending'          │
          │ syncStatus=     │    └────────────────────┘    └──────────┬──────────┘
          │ 'Pending'       │                                         │
          └─────────────────┘                                         │
                                                                      ▼
                                                          ┌──────────────────────┐
                                                          │ POST /orders/sync    │
                                                          │ (includes tableId)   │
                                                          └──────────┬───────────┘
                                                                     │
                                                    ┌────────────────┼───────────────┐
                                                    │                │               │
                                                    ▼                ▼               ▼
                                              ┌──────────┐   ┌──────────┐   ┌──────────────┐
                                              │ 200 OK   │   │ 409      │   │ 5xx/network  │
                                              │ → Synced  │   │ Conflict │   │ → retry      │
                                              └──────────┘   │ → REVERT │   │   w/ backoff  │
                                                             └────┬─────┘   └──────────────┘
                                                                  │
                                                                  ▼
                                                    ┌──────────────────────────┐
                                                    │ ROLLBACK in Dexie:       │
                                                    │ • order.tableId = null   │
                                                    │ • order.tableName = null │
                                                    │ • table.status='available│
                                                    │ Toast: "Mesa ya ocupada" │
                                                    └──────────────────────────┘
```

### 3.2 Signal Dependency Graph

```
CartService.items ──────────────────────────────► cart-panel template
                                                       │
OrderContextService.activeOrder ◄── set on             │
  │  createKitchenOrder /                              │
  │  addingToOrder load                                │
  │                                                    │
  ├──► computed: hasTable = activeOrder()?.tableId != null
  │                                                    │
  └──► computed: canAssignTable =                      │
         activeOrder() !== null                        │
         && activeOrder().tableId === null             │
         && activeOrder().kitchenStatus !== undefined   │
                        │                              │
                        ▼                              │
              "Asignar a Mesa" button visibility        │
                                                       │
TableSelectorDialog                                    │
  ├── availableTables: Signal<RestaurantTable[]>       │
  ├── loading: Signal<boolean>                         │
  └── output: tableSelected(table) ─────────────────► assignTableToOrder()
```

---

## 4. New & Modified Components

### 4.1 `OrderContextService` (NEW)

**Location:** `src/app/core/services/order-context.service.ts`

**Purpose:** Centralized signal that tracks the "active order" being worked on in the POS. Replaces scattered sessionStorage reads for `addingToOrder`.

**Signals:**

| Signal | Type | Default | Description |
|--------|------|---------|-------------|
| `activeOrder` | `WritableSignal<Order \| null>` | `null` | The order currently being modified/viewed in cart context |

**Computed Signals:**

| Computed | Type | Logic |
|----------|------|-------|
| `canAssignTable` | `Signal<boolean>` | `activeOrder() !== null && activeOrder().tableId == null && activeOrder().kitchenStatus != null` |
| `activeTableName` | `Signal<string \| null>` | `activeOrder()?.tableName ?? null` |

**Methods:**

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `setActiveOrder` | `order: Order` | `void` | Sets the active order (called after kitchen send, or when loading addingToOrder context) |
| `clearActiveOrder` | — | `void` | Resets to null (called on cart clear, cancel, or checkout complete) |
| `updateTableAssignment` | `tableId: number, tableName: string` | `void` | Patches the activeOrder signal in-memory with table data |

**Rationale:** El cart-panel actualmente usa `sessionStorage` para `activeTable` y `addingToOrder`. Este servicio centraliza ese estado como signals reactivos, eliminando lectura manual de sessionStorage y permitiendo que el template reaccione a cambios en la orden activa.

---

### 4.2 `TableSelectorDialogComponent` (NEW)

**Location:** `src/app/modules/pos/components/table-selector-dialog/`

**Type:** Standalone component, lazy-loaded on demand.

**Selector:** `app-table-selector-dialog`

**PrimeNG Components:**
- `p-dialog` — modal container
- `p-button` — table cards / confirm / cancel
- `p-progressSpinner` — loading state
- `p-tag` — zone labels

**Inputs:**

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `visible` | `model<boolean>` (two-way) | Yes | Controls dialog visibility via Angular 18 model inputs |
| `branchId` | `input<number>` | Yes | Branch to filter tables |

**Outputs:**

| Output | Type | Description |
|--------|------|-------------|
| `tableSelected` | `OutputEmitterRef<{ tableId: number; tableName: string }>` | Emits when user confirms table selection |

**Internal Signals:**

| Signal | Type | Description |
|--------|------|-------------|
| `tables` | `Signal<RestaurantTable[]>` | Available (active + status=available) tables from Dexie |
| `loading` | `Signal<boolean>` | True while loading from Dexie/API |
| `selectedTable` | `WritableSignal<RestaurantTable \| null>` | User's current selection (before confirm) |
| `zoneGroups` | `computed` | Tables grouped by `zoneId` for visual organization |

**Lifecycle:**

1. On `visible` becoming `true` → load available tables from `TableService.getTables(branchId)` (reads from Dexie, offline-safe)
2. User taps a table card → sets `selectedTable`
3. User taps "Confirmar" → emits `tableSelected` with `{ tableId, tableName }`, sets `visible` to `false`
4. User taps outside dialog or "Cancelar" → closes without emitting

**Template Layout:**

```
┌──────────────────────────────────────┐
│  ✕  Seleccionar Mesa                 │
├──────────────────────────────────────┤
│                                      │
│  [Zone: Terraza]                     │
│  ┌──────┐  ┌──────┐  ┌──────┐       │
│  │Mesa 1│  │Mesa 2│  │Mesa 3│       │
│  │ 4 🪑 │  │ 2 🪑 │  │ 6 🪑 │       │
│  └──────┘  └──────┘  └──────┘       │
│                                      │
│  [Zone: Interior]                    │
│  ┌──────┐  ┌──────┐                 │
│  │Mesa 4│  │Mesa 5│                 │
│  │ 4 🪑 │  │ 4 🪑 │                 │
│  └──────┘  └──────┘                 │
│                                      │
├──────────────────────────────────────┤
│         [Cancelar]  [Confirmar ✓]    │
└──────────────────────────────────────┘
```

**Grid specs:**
- CSS Grid: `repeat(auto-fill, minmax(120px, 1fr))` — responsive
- Table cards: 120×100px minimum, border-radius 12px, touch-friendly (>64px)
- Selected state: 2px solid primary (#16A34A) + light green background
- Capacity shown as subtitle (optional, only if `capacity` exists)
- Zone headers: subheading style (500 weight, #6B7280)

**Dialog specs:**
- `p-dialog`: `[modal]="true"`, `[draggable]="false"`, `[resizable]="false"`, `[breakpoints]="{ '960px': '90vw' }"`, `[style]="{ width: '600px' }"`, `borderRadius: 16px`
- `[closeOnEscape]="true"`, `[dismissableMask]="true"`

**Empty state:** Si no hay mesas disponibles → mostrar mensaje: "No hay mesas disponibles" con icono `pi-info-circle`.

---

### 4.3 `TableAssignmentService` (NEW)

**Location:** `src/app/core/services/table-assignment.service.ts`

**Purpose:** Encapsula la lógica de mutación optimista para asignar mesa a orden. Separado de `TableService` porque combina operaciones en Dexie (orders + restaurantTables) en una transacción atómica.

**Dependencies:** `DatabaseService`, `SyncService`, `OrderContextService`, `MessageService` (PrimeNG)

**Methods:**

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `assignTable` | `orderId: string, tableId: number, tableName: string` | `Promise<boolean>` | Transacción Dexie: actualiza order + table status. Encola sync. Retorna true si la escritura local fue exitosa. |
| `revertTableAssignment` | `orderId: string, tableId: number` | `Promise<void>` | Rollback: restaura order.tableId=null, table.status=available. Llamado por el sync engine en 409. |

#### `assignTable` — Detailed Logic

1. **Pre-validation (in-memory):**
   - Verify order exists in Dexie by `orderId`
   - Verify order has no existing `tableId` (guard against race)
   - Verify table exists in Dexie and `status === 'available'`
   - If any validation fails → return `false` + toast warning

2. **Dexie Transaction (`rw`, tables: `orders`, `restaurantTables`):**
   - `orders.update(orderId, { tableId, tableName, syncStatus: 'Pending', lastSyncAttempt: undefined, retryCount: 0 })`
   - `restaurantTables.update(tableId, { status: 'occupied', orderId })`

3. **Post-transaction:**
   - Update `OrderContextService.updateTableAssignment(tableId, tableName)`
   - Trigger `SyncService.syncPendingOrders()` (fire-and-forget, respects online check)
   - Return `true`

4. **Error handling (Dexie write failure):**
   - Catch → toast error "Error al asignar mesa" → return `false`

#### `revertTableAssignment` — Detailed Logic

1. **Dexie Transaction (`rw`, tables: `orders`, `restaurantTables`):**
   - `orders.update(orderId, { tableId: undefined, tableName: undefined, syncStatus: 'PermanentlyFailed' })`
   - `restaurantTables.update(tableId, { status: 'available', orderId: undefined })`

2. **Post-transaction:**
   - Update `OrderContextService.updateTableAssignment(null, null)` (if activeOrder matches)
   - Toast error: `severity: 'error', summary: 'Mesa ya ocupada', detail: 'Otra orden ya tomó esta mesa. Se revirtió la asignación.', life: 5000`

---

### 4.4 `cart-panel.component` (MODIFIED)

**File:** `src/app/modules/pos/components/cart-panel/cart-panel.component.ts`

**New Dependencies to Inject:**
- `OrderContextService`
- `TableAssignmentService`

**New Signals:**

| Signal | Type | Source | Description |
|--------|------|--------|-------------|
| `showTableSelector` | `WritableSignal<boolean>` | Local | Controls TableSelectorDialog visibility |
| `canAssignTable` | `Signal<boolean>` | From `OrderContextService.canAssignTable` | Reactively shows/hides button |
| `activeTableDisplay` | `Signal<string \| null>` | From `OrderContextService.activeTableName` | Shows assigned table name badge |

**New Methods:**

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `onAssignTable` | — | `void` | Sets `showTableSelector(true)` |
| `onTableSelected` | `event: { tableId: number; tableName: string }` | `Promise<void>` | Calls `TableAssignmentService.assignTable()`, updates UI on success |

#### `onTableSelected` — Logic

1. Get `orderId` from `orderContextService.activeOrder().id`
2. Call `await tableAssignmentService.assignTable(orderId, event.tableId, event.tableName)`
3. If result is `true` → toast success: `"Orden asignada a {tableName}"`
4. If result is `false` → no action (service already showed error toast)

#### Template Changes (HTML)

**1. Replace current `activeTableName` badge logic** — Instead of reading from sessionStorage, use `activeTableDisplay()` signal from `OrderContextService`.

**2. New button location** — In the footer action buttons area, BEFORE the checkout/kitchen buttons:

```
Placement spec:
- Position: Below the cart summary, above "Enviar a Cocina" / "Cobrar"
- Type: p-button with severity="secondary", outlined style
- Icon: pi pi-map-marker (left)
- Label: "Asignar a Mesa"
- Visibility: @if (canAssignTable())
- Min height: 48px (touch target compliance)
- Full width to match other action buttons
```

**3. Add `<app-table-selector-dialog>` to template:**
- Place at the bottom of the template (outside main content flow)
- Bind `[(visible)]="showTableSelector"` (two-way model)
- Bind `[branchId]` from config/auth
- Bind `(tableSelected)="onTableSelected($event)"`

#### Modifications to existing methods

- **`createKitchenOrder()`**: After successfully creating the order and saving via `syncService.saveOrder()`, call `orderContextService.setActiveOrder(order)` to track it.
- **`addItemsToExistingOrder()`**: On init when `addingToOrder` is loaded from sessionStorage, load the full order from Dexie and call `orderContextService.setActiveOrder(order)`.
- **`onCancelOrder()`**: Call `orderContextService.clearActiveOrder()`.
- **`onCheckout()`**: No change needed (active order stays until checkout completes).

---

### 4.5 `SyncService` (MODIFIED)

**File:** `src/app/core/services/sync.service.ts`

**Change: Explicit 409 Handling in `syncOrder()`**

Currently, `syncOrder()` treats all 4xx (except 408/429) as `PermanentlyFailed`. We need to intercept **409 specifically** for table-assignment conflicts and trigger a rollback.

**New dependency:** `TableAssignmentService`

**Modified logic in `syncOrder()` error handler:**

| HTTP Status | Current Behavior | New Behavior |
|-------------|-----------------|--------------|
| 409 Conflict | `PermanentlyFailed` (generic) | Check if order has `tableId`. If yes → call `tableAssignmentService.revertTableAssignment(orderId, tableId)`. Mark `syncStatus = 'Pending'` (to retry sync WITHOUT the tableId). If no tableId → keep existing `PermanentlyFailed` behavior. |
| Other 4xx | `PermanentlyFailed` | No change |
| 5xx/network | `Failed` + retry | No change |

#### Detailed 409 handling pseudocode

```
On 409 Conflict for order:
  1. Read the order from Dexie (fresh, not from closure)
  2. IF order.tableId exists:
     a. Store tableId and orderId before revert
     b. Call tableAssignmentService.revertTableAssignment(orderId, tableId)
     c. Re-read the order from Dexie (now without tableId)
     d. Set syncStatus = 'Pending', retryCount = 0
     e. Save back to Dexie
     → The order will be retried in next sync cycle WITHOUT tableId
  3. ELSE:
     a. Mark as PermanentlyFailed (existing behavior)
```

**Rationale:** Un 409 en el contexto de asignación de mesa significa que otra terminal ya ocupó esa mesa. El rollback restaura la mesa como disponible localmente y remueve el `tableId` de la orden. La orden en sí sigue siendo válida y se sincronizará en el siguiente ciclo sin la asignación de mesa conflictiva.

---

## 5. Dexie Schema Impact

### No schema version change needed

Los campos `tableId` y `tableName` ya existen en la interfaz `Order` y se almacenan en la tabla `orders` de Dexie. La tabla `restaurantTables` ya tiene `status` y `orderId`. No se requieren nuevos índices ni migración de versión.

**Tables affected by mutations:**

| Dexie Table | Field | Mutation | Transaction |
|-------------|-------|----------|-------------|
| `orders` | `tableId`, `tableName`, `syncStatus` | UPDATE | `rw` (atomic with restaurantTables) |
| `restaurantTables` | `status`, `orderId` | UPDATE | `rw` (atomic with orders) |

---

## 6. Offline-First Sequence Diagram

```
              CASHIER              DEXIE (Local)           SYNC ENGINE           BACKEND API
                │                       │                       │                      │
                │  tap "Asignar Mesa"   │                       │                      │
                │──────────────────────►│                       │                      │
                │                       │                       │                      │
                │  select Mesa #3       │                       │                      │
                │──────────────────────►│                       │                      │
                │                       │                       │                      │
                │          ┌────────────┤  Dexie.transaction()  │                      │
                │          │ orders.update(tableId=3)           │                      │
                │          │ tables.update(status=occupied)     │                      │
                │          └────────────┤                       │                      │
                │                       │                       │                      │
                │  ◄── UI updates ──────┤                       │                      │
                │  (badge "Mesa #3")    │                       │                      │
                │                       │                       │                      │
                │                       │  syncPendingOrders()  │                      │
                │                       │──────────────────────►│                      │
                │                       │                       │  POST /orders/sync   │
                │                       │                       │─────────────────────►│
                │                       │                       │                      │
                │                       │                       │    CASE A: 200 OK    │
                │                       │                       │◄─────────────────────│
                │                       │  syncStatus='Synced'  │                      │
                │                       │◄──────────────────────│                      │
                │                       │                       │                      │
                │                       │                       │    CASE B: 409       │
                │                       │                       │◄─────────────────────│
                │                       │                       │                      │
                │                       │  revertTableAssignment│                      │
                │          ┌────────────┤◄──────────────────────│                      │
                │          │ orders.update(tableId=null)        │                      │
                │          │ tables.update(status=available)    │                      │
                │          └────────────┤                       │                      │
                │                       │                       │                      │
                │  ◄── Toast ERROR ─────┤  "Mesa ya ocupada"   │                      │
                │  (badge removed)      │                       │                      │
                │                       │  retry order w/o table│                      │
                │                       │──────────────────────►│  POST /orders/sync   │
                │                       │                       │─────────────────────►│
                │                       │                       │      200 OK          │
                │                       │                       │◄─────────────────────│
```

---

## 7. Edge Cases & Error Matrix

| Scenario | Detection | Behavior |
|----------|-----------|----------|
| Mesa seleccionada ya fue ocupada por otra terminal (offline race) | 409 Conflict from backend | Revert Dexie, toast "Mesa ya ocupada, se revirtió la asignación", re-sync order sin tableId |
| Orden ya tiene mesa asignada | `canAssignTable` computed returns `false` | Botón "Asignar a Mesa" no visible |
| No hay mesas disponibles | `tables` signal empty after load | Modal muestra empty state "No hay mesas disponibles" |
| Dexie write fails | `catch` en transaction | Toast "Error al asignar mesa", operación cancelada, no se encola sync |
| User offline al momento de asignar | No network | UI actualiza inmediatamente (optimistic). Sync se ejecutará cuando haya red. |
| User cierra app antes de sync | Order en Dexie con syncStatus='Pending' | Al reabrir, `SyncService.initialize()` retoma pendientes |
| Doble-tap en mesa | `isProcessing` signal guard | Deshabilitar botón "Confirmar" durante la escritura en Dexie |

---

## 8. Component Contracts Summary

### New Files

| File | Type | Purpose |
|------|------|---------|
| `src/app/core/services/order-context.service.ts` | Service (singleton, `providedIn: 'root'`) | Signal-based active order tracking |
| `src/app/core/services/table-assignment.service.ts` | Service (singleton, `providedIn: 'root'`) | Dexie transaction + rollback for table assignment |
| `src/app/modules/pos/components/table-selector-dialog/table-selector-dialog.component.ts` | Standalone component | Modal UI for table selection |
| `src/app/modules/pos/components/table-selector-dialog/table-selector-dialog.component.html` | Template | Dialog layout |
| `src/app/modules/pos/components/table-selector-dialog/table-selector-dialog.component.scss` | Styles | Grid, cards, responsive |

### Modified Files

| File | Change |
|------|--------|
| `src/app/modules/pos/components/cart-panel/cart-panel.component.ts` | Inject new services, add signals, add methods, set activeOrder on kitchen send |
| `src/app/modules/pos/components/cart-panel/cart-panel.component.html` | Add button "Asignar a Mesa", add `<app-table-selector-dialog>`, replace sessionStorage badge |
| `src/app/core/services/sync.service.ts` | Add explicit 409 handling with table revert logic |

---

## 9. Design Tokens & UX Specs

### "Asignar a Mesa" Button
- **Type:** `p-button`, `severity="secondary"`, `[outlined]="true"`
- **Icon:** `pi pi-map-marker`
- **Min height:** 48px
- **Width:** 100% (full width in cart footer)
- **Font:** 16px, weight 500
- **Border:** 1px solid #D1D5DB, border-radius 8px
- **Hover/Active:** light green background (#F0FDF4), border color primary (#16A34A)

### Table Card (in modal)
- **Size:** min 120×100px
- **Border-radius:** 12px
- **Box-shadow:** `0 1px 3px rgba(0,0,0,0.1)`
- **Default state:** bg white, text #374151
- **Selected state:** border 2px solid #16A34A, bg #F0FDF4
- **Content:** table name (700 weight, 18px), capacity subtitle (400 weight, 14px, #6B7280)
- **Touch target:** entire card is tappable (>64×64px)

### Toast Messages

| Event | Severity | Summary | Detail | Life |
|-------|----------|---------|--------|------|
| Assignment success | `success` | `Orden asignada a {tableName}` | — | 3000ms |
| 409 Conflict revert | `error` | `Mesa ya ocupada` | `Otra orden ya tomó esta mesa. Se revirtió la asignación.` | 5000ms |
| Dexie write error | `error` | `Error al asignar mesa` | `Intenta de nuevo.` | 4000ms |
| No tables available | `warn` | `No hay mesas disponibles` | — | 3000ms |

---

## 10. Backend Dependencies

| Endpoint | Required Change | Priority |
|----------|----------------|----------|
| `POST /orders/sync` | Validate that if `tableId` is present, the table has no active order from another device. If conflict → HTTP 409 with body `{ "code": "TABLE_CONFLICT", "tableId": N }` | Required |
| `GET /table/status` | No changes — already returns `TableStatusDto[]` with `displayStatus` | None |

---

## 11. Testing Strategy (Spec Outline)

### `TableSelectorDialogComponent`
- Renders available tables grouped by zone
- Emits `tableSelected` on confirm with correct payload
- Does not emit on cancel/dismiss
- Shows empty state when no tables available
- Disables confirm button when no table selected

### `TableAssignmentService`
- `assignTable`: Updates both Dexie tables in single transaction
- `assignTable`: Returns false if order already has tableId
- `assignTable`: Returns false if table is not available
- `revertTableAssignment`: Restores both Dexie tables
- `revertTableAssignment`: Shows error toast

### `SyncService` (409 handling)
- On 409 for order WITH tableId → calls revert + re-queues order
- On 409 for order WITHOUT tableId → marks PermanentlyFailed (existing)

### `cart-panel` (integration)
- "Asignar a Mesa" visible only when `canAssignTable` is true
- "Asignar a Mesa" hidden when order already has table
- "Asignar a Mesa" hidden when no active order
- Opens dialog on tap, closes on cancel
- Updates badge on successful assignment
