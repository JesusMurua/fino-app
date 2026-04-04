# Frontend Design Document: Mandatory Cash Register Session for Local Orders

## FDD-002 — UI Blocking Without Open Cash Session

**Fecha:** 2026-04-03
**Autor:** Documento generado por análisis de arquitectura
**Estado:** Draft — pendiente de confirmación

---

## 1. Feature Overview

**Objetivo:** Impedir que los cajeros procesen órdenes (enviar a cocina o cobrar) si no han abierto un turno de caja, y asegurar que toda orden creada lleve el `cashRegisterSessionId` de la sesión activa.

**Problema actual:** El POS muestra un banner informativo ("Sin turno de caja") en el header (`pos-header.component.html:139-143`), pero no impide que el cajero procese órdenes. Esto genera discrepancias financieras al no poder reconciliar ventas con sesiones de caja. Además, las órdenes creadas en `cart-panel` y `checkout` no incluyen `cashRegisterSessionId` en el payload.

**Solución:** Interceptar los botones de acción (Enviar a Cocina, Cobrar, Cobrar directo) para verificar `hasOpenSession()`, bloquear con un toast/modal Dribbble-style, e inyectar `cashRegisterSessionId` en el payload de cada `Order` antes de guardar en Dexie.

---

## 2. Scope & Boundaries

### In Scope
- Bloqueo de botones "Enviar a Cocina", "Cobrar directo", "Cobrar" en `cart-panel` si no hay sesión de caja
- Bloqueo del botón "Confirmar pago" en `checkout` si no hay sesión de caja
- Toast de error con copy claro y navegación al Back Office
- Nuevo campo `cashRegisterSessionId` en la interfaz `Order`
- Inyección del campo en los 3 puntos de creación de orden (cart-panel kitchen, cart-panel addItems, checkout)
- Mapeo del campo en `SyncService.mapOrderToDto()` y `mapPullDto()`
- Nuevo Dexie schema version (v16) si se requiere index

### Out of Scope
- Route guard que bloquee acceso al POS completo (demasiado disruptivo — el cajero necesita ver productos, solo se bloquea el procesamiento)
- Cambios en el backend (.NET API)
- Modificaciones al componente de apertura de caja (`cash-register.component`)
- Lógica de forzar cierre de caja

---

## 3. Análisis del Estado Actual

### 3.1 CashRegisterService (`core/services/cash-register.service.ts`)

**Signals ya existentes (listos para usar):**

| Signal | Tipo | Línea | Descripción |
|--------|------|-------|-------------|
| `_activeSession` | `WritableSignal<CashRegisterSession \| null>` | 25 | Sesión activa (privado) |
| `activeSession` | `Signal<CashRegisterSession \| null>` | 26 | ReadOnly público |
| `hasOpenSession` | `Signal<boolean>` | 27 | `computed(() => _activeSession() !== null)` |

**Método de carga:** `loadActiveSession(branchId)` — llamado en login (`pin.component.ts:211`) como background non-blocking.

**Estado:** Completamente funcional. No requiere cambios.

### 3.2 Banner Existente en POS Header (`pos-header.component`)

**Líneas 139-143 del template:**
```
@if (!cashRegisterService.hasOpenSession()) {
  <div class="pos-header__no-session" role="alert">
    <i class="pi pi-exclamation-triangle"></i>
    <span>Sin turno de caja — ve al Back Office para abrir uno</span>
  </div>
}
```

**Estado:** Banner solo informativo. No bloquea acciones. Se mantiene como está.

### 3.3 Order Model (`core/models/order.model.ts:54-113`)

**Campo faltante:** No existe `cashRegisterSessionId` en la interfaz `Order`.

### 3.4 Cart Panel (`pos/components/cart-panel/cart-panel.component.ts`)

**Puntos de creación de orden:**
1. **`createKitchenOrder()` (línea 156-190):** Crea orden con `kitchenStatus: 'Pending'`. No referencia `CashRegisterService`.
2. **`addItemsToExistingOrder()` (línea 193-216):** Actualiza orden existente. No inyecta session ID.
3. **`onCheckout()` (línea 129):** Navega a `/pos/checkout`. Sin validación previa.

### 3.5 Checkout Component (`pos/components/checkout/checkout.component.ts`)

**Puntos de creación de orden:**
1. **Nuevo order (líneas 524-542):** Crea orden completa con pagos. No referencia `CashRegisterService`.
2. **Existing order update (líneas 505-518):** Actualiza orden existente con pagos. No inyecta session ID.

### 3.6 SyncService DTO Mapping (`sync.service.ts:431-469`)

**`mapOrderToDto()`:** Mapea 21 campos al DTO del API. No incluye `cashRegisterSessionId`.
**`mapPullDto()`:** Mapea DTO del API a Order local. No extrae `cashRegisterSessionId`.

### 3.7 Dexie Schema (`database.service.ts`)

**Versión actual:** v15.
**Tabla `orders`:** `'id, syncStatus, createdAt, kitchenStatus, deliveryStatus, cancellationStatus, branchId'`
**No hay index para `cashRegisterSessionId`** — el campo se almacenará como dato no-indexado (suficiente, no se necesita query por este campo).

---

## 4. Architecture & State Flow

### 4.1 Flujo de Bloqueo

```
┌─────────────────────────────────────────────────────────────┐
│  CAJERO toca "Enviar a Cocina" / "Cobrar" / "Cobrar directo"│
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────┐
│  cashRegisterService.hasOpenSession() === ?  │
└──────────┬───────────────┬───────────────────┘
           │               │
     true ▼         false ▼
┌──────────────┐  ┌────────────────────────────────────────┐
│  Proceed     │  │  BLOCK                                 │
│  normally    │  │                                        │
│  (existing   │  │  1. Toast error (severity: 'warn')     │
│   flow)      │  │     summary: "Apertura de caja         │
│              │  │              requerida"                 │
│              │  │     detail: "Debes abrir un turno de    │
│              │  │             caja para procesar órdenes" │
│              │  │     life: 5000ms                        │
│              │  │                                        │
│              │  │  2. Return early (no navigation,       │
│              │  │     no order creation)                  │
│              │  │                                        │
└──────────────┘  └────────────────────────────────────────┘
```

### 4.2 Flujo de Inyección de `cashRegisterSessionId`

```
┌────────────────────────────┐
│  Order creation point      │
│  (cart-panel or checkout)  │
└──────────┬─────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  const session = cashRegisterService           │
│                    .activeSession();           │
│                                                │
│  order.cashRegisterSessionId = session?.id;    │
│  (undefined if no session — delivery orders)   │
└──────────┬─────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  syncService.saveOrder(order)                   │
│  → Dexie: order stored with sessionId          │
│  → mapOrderToDto: sends cashRegisterSessionId  │
│    to POST /orders/sync                         │
└────────────────────────────────────────────────┘
```

### 4.3 Signal Dependency Graph

```
CashRegisterService._activeSession (loaded at login)
    │
    ├── .activeSession (readonly)
    │       │
    │       └──► cart-panel: reads session?.id for order payload
    │       └──► checkout: reads session?.id for order payload
    │
    └── .hasOpenSession (computed: _activeSession !== null)
            │
            ├──► pos-header: banner "Sin turno de caja" (existing)
            ├──► cart-panel: guards onSendToKitchen(), onCheckout()
            └──► checkout: guards onConfirmPayment()
```

---

## 5. Componentes Afectados

| Componente/Archivo | Acción | Tipo |
|---|---|---|
| `Order` interface | Agregar campo `cashRegisterSessionId?: number` | Modificación |
| `cart-panel.component.ts` | Inyectar `CashRegisterService`, validar sesión, inyectar sessionId en orden | Modificación |
| `cart-panel.component.html` | Sin cambios en template (validación es en TS, toast vía `MessageService`) | Sin cambios |
| `checkout.component.ts` | Inyectar `CashRegisterService`, validar sesión, inyectar sessionId en orden | Modificación |
| `sync.service.ts` | Agregar `cashRegisterSessionId` a `mapOrderToDto()` y `mapPullDto()` | Modificación |

---

## 6. Especificaciones Detalladas

### 6.1 Modificación de `Order` Interface

**Archivo:** `src/app/core/models/order.model.ts`

**Nuevo campo** (agregar después de `tableName`, línea 102):

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `cashRegisterSessionId` | `number \| undefined` | No (delivery orders no tienen sesión) | ID del turno de caja activo cuando se creó la orden |

**Sin cambio en Dexie schema** — no se requiere nuevo index. El campo se almacena como parte del objeto `Order` en la tabla `orders` sin indexar. No incrementar versión de DB.

---

### 6.2 Modificación de `cart-panel.component.ts`

**Archivo:** `src/app/modules/pos/components/cart-panel/cart-panel.component.ts`

**Nueva dependencia a inyectar:** `CashRegisterService`

**Nuevo computed signal:**

| Signal | Tipo | Derivado de | Lógica |
|--------|------|-------------|--------|
| `sessionBlocked` | `Signal<boolean>` | `cashRegisterService.hasOpenSession()` | `computed(() => !this.cashRegisterService.hasOpenSession())` |

**Método helper privado:**

| Método | Params | Returns | Descripción |
|--------|--------|---------|-------------|
| `requireOpenSession` | — | `boolean` | Si `!hasOpenSession()`: muestra toast warn y retorna `false`. Si sí: retorna `true`. |

**Lógica de `requireOpenSession()`:**
1. Leer `cashRegisterService.hasOpenSession()`.
2. Si es `false`:
   - `messageService.add({ severity: 'warn', summary: 'Apertura de caja requerida', detail: 'Debes abrir un turno de caja para procesar órdenes.', life: 5000 })`
   - Retornar `false`.
3. Si es `true`: retornar `true`.

**Cambios en métodos existentes:**

#### `onSendToKitchen()` (línea 137)
- **Antes del guard `isProcessing`**, agregar: `if (!this.requireOpenSession()) return;`
- Si pasa la validación, el flujo continúa sin cambios.

#### `onCheckout()` (línea 129)
- **Antes de navegar**, agregar: `if (!this.requireOpenSession()) return;`
- Si pasa, navega a `/pos/checkout` normalmente.

#### `createKitchenOrder()` (línea 165)
- Al construir el objeto `Order`, agregar campo:
  - `cashRegisterSessionId: this.cashRegisterService.activeSession()?.id`
- Posición: después de `branchId`.

#### `addItemsToExistingOrder()` (línea 193)
- No necesita inyectar `cashRegisterSessionId` — la orden ya tiene el sessionId de cuando fue creada originalmente. Solo se agregan items.
- **Pero sí se valida** en `onSendToKitchen()` que haya sesión abierta antes de llegar aquí.

---

### 6.3 Modificación de `checkout.component.ts`

**Archivo:** `src/app/modules/pos/components/checkout/checkout.component.ts`

**Nueva dependencia a inyectar:** `CashRegisterService`

**Nuevo computed signal:**

| Signal | Tipo | Lógica |
|--------|------|--------|
| `sessionBlocked` | `Signal<boolean>` | `computed(() => !this.cashRegisterService.hasOpenSession())` |

**Método helper privado:**

| Método | Returns | Descripción |
|--------|---------|-------------|
| `requireOpenSession` | `boolean` | Misma lógica que en cart-panel: toast warn + return false si no hay sesión |

**Cambios en métodos existentes:**

#### `onConfirmPayment()` (línea 466)
- **Antes del guard `isProcessing`**, agregar: `if (!this.requireOpenSession()) return;`

#### `confirmPayment()` — Nuevo order (línea 524)
- Al construir el objeto `Order`, agregar campo:
  - `cashRegisterSessionId: this.cashRegisterService.activeSession()?.id`
- Posición: después de `branchId` (línea 539).

#### `confirmPayment()` — Existing order (línea 505)
- Al hacer el spread del existing order, agregar:
  - `cashRegisterSessionId: existing.cashRegisterSessionId ?? this.cashRegisterService.activeSession()?.id`
- Preserva el ID original si ya existía; lo inyecta si no.

#### Template — Botón "Confirmar pago"
- **Opcional adicional**: Agregar `[disabled]="sessionBlocked()"` al botón de confirmar pago como señal visual. El bloqueo real es en `onConfirmPayment()`, pero un botón disabled comunica inmediatamente que algo falta.
- Si se deshabilita, mostrar un micro-texto debajo: `@if (sessionBlocked()) { <span class="checkout__session-warning">Abre un turno de caja para cobrar</span> }`

---

### 6.4 Modificación de `SyncService`

**Archivo:** `src/app/core/services/sync.service.ts`

#### `mapOrderToDto()` (línea 431)
- Agregar al objeto retornado:
  - `cashRegisterSessionId: order.cashRegisterSessionId ?? null`
- Posición: después de `tableName`.

#### `mapPullDto()` (línea 293)
- Agregar al objeto retornado:
  - `cashRegisterSessionId: dto.cashRegisterSessionId ?? undefined`
- Posición: después de `tableName`.

---

## 7. Flujos End-to-End

### 7.1 Happy Path: Cajero con sesión abierta

```
1. Cajero hace login → pin.component llama loadActiveSession()
2. CashRegisterService._activeSession = { id: 42, status: 'open', ... }
3. hasOpenSession() = true
4. Cajero agrega productos al carrito
5. Toca "Enviar a cocina"
   → cart-panel.onSendToKitchen()
   → requireOpenSession() → true ✓
   → createKitchenOrder() con cashRegisterSessionId: 42
   → syncService.saveOrder(order)
   → Dexie: order guardada con sessionId=42
   → API sync: POST /orders/sync incluye cashRegisterSessionId=42
```

### 7.2 Blocked Path: Cajero sin sesión

```
1. Cajero hace login → loadActiveSession() → API retorna null
2. CashRegisterService._activeSession = null
3. hasOpenSession() = false
4. POS header muestra banner "Sin turno de caja" (existente)
5. Cajero agrega productos al carrito
6. Toca "Enviar a cocina"
   → cart-panel.onSendToKitchen()
   → requireOpenSession() → false ✗
   → Toast: "Apertura de caja requerida — Debes abrir un turno..."
   → Return early. No se crea orden.
7. Cajero toca "Cobrar directo"
   → cart-panel.onCheckout()
   → requireOpenSession() → false ✗
   → Toast (mismo mensaje)
   → No navega a checkout.
8. Cajero va al Back Office → abre turno de caja
   → openSession() → _activeSession.set(session)
   → hasOpenSession() = true
   → Cajero regresa al POS → botones funcionan normalmente
```

### 7.3 Edge Case: Checkout directo sin sesión

```
1. Cajero navega directamente a /pos/checkout (URL bar o bookmark)
2. checkout.component carga normalmente
3. sessionBlocked() = true → botón de confirmar pago disabled
4. Cajero intenta confirmar (programáticamente o bypass)
   → onConfirmPayment() → requireOpenSession() → false ✗
   → Toast: "Apertura de caja requerida"
   → No se procesa pago.
```

### 7.4 Edge Case: Sesión se cierra mientras cajero está en checkout

```
1. Cajero tiene sesión abierta, llega a checkout
2. Otro dispositivo o admin cierra la sesión
3. Next pullOrders() o background refresh actualiza _activeSession → null
   (Nota: actualmente no hay polling de sesión de caja — esto
    solo ocurriría si loadActiveSession() se llama de nuevo)
4. Cajero toca "Confirmar pago"
   → requireOpenSession() → false ✗
   → Toast de bloqueo
   → Cajero debe reabrir sesión
```

**Nota importante sobre este edge case:** `loadActiveSession()` solo se llama una vez al login. Si otro dispositivo cierra la sesión, el signal local no se actualiza hasta el siguiente login. Esto es **aceptable** para esta fase porque:
- Un solo cajero opera una caja física a la vez
- El backend validará el `cashRegisterSessionId` y puede rechazar con 4xx si la sesión ya no existe
- Polling de sesión es un feature futuro

---

## 8. Toast Messages

| Evento | Severity | Summary | Detail | Life |
|--------|----------|---------|--------|------|
| Bloqueo por falta de sesión | `warn` | `Apertura de caja requerida` | `Debes abrir un turno de caja para procesar órdenes.` | 5000ms |

**Decisión: Toast vs Modal**
Se eligió **Toast** sobre Modal por las siguientes razones:
1. El banner en el header ya informa proactivamente del estado
2. Un modal blocking requeriría un clic extra para cerrar — friction innecesaria
3. El toast es consistente con el patrón de feedback de la app (todas las validaciones usan toast)
4. El cajero ya sabe qué hacer (ir al Back Office) gracias al banner del header

---

## 9. Archivos a Crear/Modificar

### Archivos modificados (4)

| Archivo | Cambio |
|------|--------|
| `src/app/core/models/order.model.ts` | Agregar `cashRegisterSessionId?: number` a la interfaz `Order` |
| `src/app/modules/pos/components/cart-panel/cart-panel.component.ts` | Inyectar `CashRegisterService`, agregar `requireOpenSession()`, validar en `onSendToKitchen()` y `onCheckout()`, inyectar sessionId en `createKitchenOrder()` |
| `src/app/modules/pos/components/checkout/checkout.component.ts` | Inyectar `CashRegisterService`, agregar `sessionBlocked` computed + `requireOpenSession()`, validar en `onConfirmPayment()`, inyectar sessionId en `confirmPayment()`, optional disabled state en template |
| `src/app/core/services/sync.service.ts` | Agregar `cashRegisterSessionId` a `mapOrderToDto()` y `mapPullDto()` |

### Archivos nuevos: ninguno

---

## 10. Design Tokens & UX Specs

### Toast "Apertura de caja requerida"
- **Severity:** `warn` (amarillo — PrimeNG default warning toast style)
- **Icon:** `pi pi-exclamation-triangle` (inyectado por PrimeNG automáticamente para severity warn)
- **Life:** 5000ms (más largo que el default de 3000ms para dar tiempo de leer)
- **Position:** Top-right (posición default del `p-toast` global de la app)

### Botón disabled (checkout optional)
- **Visual:** PrimeNG default disabled style (opacity 0.5, cursor not-allowed)
- **Micro-texto warning debajo:**
  - Font: 13px, weight 500, color `#D97706` (warning color del design system)
  - Icono: `pi pi-exclamation-triangle` inline
  - Texto: "Abre un turno de caja para cobrar"

---

## 11. Consideraciones Offline-First

### Pregunta clave: ¿Qué pasa si el cajero está offline y la sesión de caja se cargó en login?

**Respuesta:** El signal `_activeSession` persiste en memoria mientras la app esté abierta. La sesión fue cargada al login (con fallback a Dexie si el API estaba offline). No se limpia hasta que:
- El usuario cierra sesión
- Se llama `closeSession()` explícitamente

Por lo tanto, **mientras la app esté abierta, `hasOpenSession()` es confiable** incluso sin conexión. El `cashRegisterSessionId` se inyecta en la orden, se guarda en Dexie, y se sincroniza cuando haya red.

### ¿Qué pasa si la sesión en Dexie es stale?

Si la app fue cerrada y reabierta sin conexión, `loadActiveSession()` hará fallback a Dexie:
```
const local = await this.db.cashSessions
  .where({ branchId, status: 'open' })
  .first();
```
Esto retornará la última sesión abierta conocida localmente. El backend validará la vigencia al recibir el sync.

---

## 12. Edge Cases & Error Matrix

| Escenario | Detección | Comportamiento |
|-----------|-----------|----------------|
| Sin sesión de caja → toca "Enviar a cocina" | `hasOpenSession() === false` | Toast warn, return early, no se crea orden |
| Sin sesión de caja → toca "Cobrar directo" | `hasOpenSession() === false` | Toast warn, no navega a checkout |
| Sin sesión de caja → llega a checkout por URL | `sessionBlocked() === true` | Botón disabled + micro-texto. Guard en `onConfirmPayment()` |
| Con sesión → crea orden → sesión se cierra → sync | Backend rechaza si sesión inválida | SyncService marca como Failed, retry cuando sesión reabra |
| Delivery/external order (sin sesión local) | `orderSource !== 'Direct'` | `cashRegisterSessionId` queda `undefined` — delivery orders no pasan por cart-panel local |
| Cajero abre app offline con sesión en Dexie | Fallback local en `loadActiveSession()` | Signal se popula desde Dexie, bloqueo no se activa innecesariamente |

---

## 13. Backend Dependencies

| Endpoint | Cambio sugerido | Prioridad |
|----------|----------------|----------|
| `POST /orders/sync` | Aceptar campo `cashRegisterSessionId` en el DTO. Validar que la sesión exista y pertenezca al branch. Si es inválida, responder 422 (no 409, ya que no es conflicto de mesa). | Recomendado |
| `GET /orders/pull` | Incluir `cashRegisterSessionId` en el DTO de respuesta para que `mapPullDto()` lo preserve. | Recomendado |

---

## 14. Testing Strategy (Spec Outline)

### `cart-panel.component`
- `onSendToKitchen()`: Si `hasOpenSession() === false` → no llama `createKitchenOrder()`, muestra toast
- `onSendToKitchen()`: Si `hasOpenSession() === true` → procede normalmente
- `onCheckout()`: Si `hasOpenSession() === false` → no navega, muestra toast
- `createKitchenOrder()`: Orden creada incluye `cashRegisterSessionId` del `activeSession().id`

### `checkout.component`
- `onConfirmPayment()`: Si `hasOpenSession() === false` → no llama `confirmPayment()`, muestra toast
- `confirmPayment()` (new order): Orden incluye `cashRegisterSessionId`
- `confirmPayment()` (existing order): Preserva `cashRegisterSessionId` original o inyecta si falta
- `sessionBlocked` signal: Refleja estado inverso de `hasOpenSession()`

### `sync.service.ts`
- `mapOrderToDto()`: Incluye `cashRegisterSessionId` o `null` en el DTO
- `mapPullDto()`: Extrae `cashRegisterSessionId` del DTO remoto

### `order.model.ts`
- Interfaz compilará con el nuevo campo opcional
