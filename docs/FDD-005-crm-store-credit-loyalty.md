# Frontend Design Document: CRM UI, Store Credit & Loyalty

## FDD-005 — Phase 16: Customer Database, Store Credit & Loyalty Points

**Fecha:** 2026-04-03
**Autor:** Documento generado por análisis de arquitectura
**Estado:** Draft — pendiente de confirmación

---

## 1. Feature Overview

**Objetivo:** Permitir que cajeros vinculen un cliente a una orden o reservación, usar crédito de tienda y puntos de lealtad como métodos de pago, y dar a los managers un backoffice para gestionar la base de clientes.

**Problema actual:** No existe entidad "Customer" en el sistema. Las órdenes no tienen referencia a cliente. Las reservaciones solo capturan `guestName` y `guestPhone` como texto libre sin vinculación a un registro maestro. Los feature keys `LoyaltyProgram` y `ClientsAndCredit` existen en `plan.model.ts` (Pro plan) pero sin implementación.

**Solución:** Un sistema CRM ligero con tres pilares:
1. **Admin Customers** (`/admin/customers`) — CRUD de clientes con perfil, historial, saldo.
2. **POS Customer Selector** — Autocomplete en checkout y cart-panel para vincular cliente a orden.
3. **Payment Integration** — "Crédito de Tienda" y "Puntos" como métodos de pago válidos.

---

## 2. Scope & Boundaries

### In Scope
- Interface `Customer` con campos: nombre, teléfono, email, RFC fiscal, puntos, crédito
- `CustomerService` — Signal-based CRUD + search con Dexie offline cache
- Tabla Dexie `customers` (nueva, versión 16)
- `CustomerSelectorComponent` — Autocomplete reutilizable (POS + Reservaciones)
- Admin Customers route con data table + profile drawer
- Campos `customerId` y `customerName` en `Order` interface
- `PaymentMethod.StoreCredit` y `PaymentMethod.LoyaltyPoints` como nuevos métodos de pago
- Vinculación opcional de `Reservation.customerId` al crear reservaciones
- Ticket: imprimir nombre del cliente si está vinculado
- Feature-gated: `FeatureKey.ClientsAndCredit` (Pro plan)

### Out of Scope
- App móvil para clientes (programa de lealtad self-service)
- Notificaciones push/SMS a clientes
- Segmentación avanzada / campañas de marketing
- Importación masiva de clientes (CSV)
- Integración con CRM externos (HubSpot, etc.)
- Recarga de crédito vía pasarela de pagos
- Cálculo automático de puntos por orden (reglas configurables — fase posterior)

---

## 3. Análisis del Estado Actual

### 3.1 Order Model (`order.model.ts:84-147`)

**Campos existentes relevantes:**
- `deliveryCustomerName?: string` — solo para órdenes de plataformas de delivery
- **Sin `customerId`**, `customerName`, `customerPhone`, `loyaltyPointsRedeemed`, `creditAppliedCents`

### 3.2 PaymentMethod Enum (`order.model.ts:6-13`)

**Valores actuales:** `Cash`, `Card`, `Transfer`, `Other`, `Clip`, `MercadoPagoQR`
**Faltan:** `StoreCredit`, `LoyaltyPoints`

### 3.3 Reservation Model (`reservation.model.ts`)

```
guestName: string         ← texto libre, sin vínculo a Customer
guestPhone: string | null ← texto libre
```
**Sin `customerId`** — el nombre es texto libre sin relación a un registro maestro.

### 3.4 Checkout Component (`checkout.component.ts`)

- Header muestra solo: back button, "Cobrar orden", table badge
- **Sin selector de cliente** — no hay dónde mostrar nombre/puntos/crédito
- `confirmPayment()` crea Order sin campos de cliente

### 3.5 Cart Panel (`cart-panel.component.ts`)

- Header muestra: order number, table badge, item count
- **Sin selector de cliente** en la sidebar

### 3.6 Feature Keys (`plan.model.ts`)

- `FeatureKey.ClientsAndCredit` → Pro plan (ya definido)
- `FeatureKey.LoyaltyProgram` → Pro plan (ya definido)
- Ambos existen como constantes pero sin uso funcional

### 3.7 Print Service (`print.service.ts:91-193`)

- Ticket muestra: negocio, fecha, orden, mesa, items, total, pago, cambio
- **Sin nombre de cliente** en ninguna parte del ticket

---

## 4. Data Model

### 4.1 `Customer` Interface (NUEVO)

**Archivo:** `src/app/core/models/customer.model.ts`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | `number` | Primary key (auto-increment Dexie, synced from API) |
| `branchId` | `number` | Branch owner |
| `name` | `string` | Nombre completo |
| `phone` | `string` | Teléfono (clave principal de búsqueda, único por branch) |
| `email` | `string \| undefined` | Email opcional |
| `rfc` | `string \| undefined` | RFC fiscal (pre-llena modal de facturación) |
| `notes` | `string \| undefined` | Notas internas del negocio |
| `pointsBalance` | `number` | Puntos de lealtad acumulados (entero) |
| `creditBalanceCents` | `number` | Saldo de crédito de tienda en centavos |
| `creditLimitCents` | `number` | Límite máximo de crédito (0 = sin crédito) |
| `totalOrderCount` | `number` | Total de órdenes históricas |
| `totalSpentCents` | `number` | Total gastado históricamente en centavos |
| `lastVisitAt` | `Date \| undefined` | Última fecha de compra |
| `createdAt` | `Date` | Fecha de creación del registro |
| `isActive` | `boolean` | Soft delete |

**Validaciones:**
- `phone`: Requerido, 10 dígitos para México, único por branch
- `name`: Requerido, min 2 chars
- `pointsBalance`: >= 0 (nunca negativo)
- `creditBalanceCents`: puede ser negativo (deuda) hasta `creditLimitCents`

### 4.2 Campos nuevos en `Order` interface

**Archivo:** `src/app/core/models/order.model.ts`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `customerId` | `number \| undefined` | FK al Customer vinculado |
| `customerName` | `string \| undefined` | Snapshot del nombre (para display sin JOIN) |

### 4.3 Campo nuevo en `Reservation` interface

**Archivo:** `src/app/core/models/reservation.model.ts`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `customerId` | `number \| undefined` | FK al Customer vinculado (opcional) |

### 4.4 Nuevos valores en `PaymentMethod` enum

| Valor | Label | Icon | Descripción |
|-------|-------|------|-------------|
| `StoreCredit` | `Crédito` | `pi-wallet` | Paga con saldo de crédito de tienda |
| `LoyaltyPoints` | `Puntos` | `pi-star` | Redime puntos (1 punto = $1 MXN por defecto) |

### 4.5 Dexie Schema Update (v16)

**Nueva tabla:**
```
customers: '++id, branchId, phone, name, isActive'
```
Indexes en `phone` y `name` para búsqueda rápida offline.

---

## 5. Nuevo Servicio: `CustomerService`

**Archivo:** `src/app/core/services/customer.service.ts`

**Tipo:** `providedIn: 'root'`, singleton

### Signals

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `customers` | `Signal<Customer[]>` | Todos los clientes del branch (cacheados en Dexie) |
| `selectedCustomer` | `WritableSignal<Customer \| null>` | Cliente vinculado a la orden actual |
| `isLoading` | `Signal<boolean>` | Loading state para la tabla admin |
| `searchResults` | `Signal<Customer[]>` | Resultados del autocomplete |

### Métodos

| Método | Params | Returns | Descripción |
|--------|--------|---------|-------------|
| `loadCustomers` | `branchId: number` | `Promise<void>` | API → Dexie → signal. Stale-while-revalidate |
| `searchByPhoneOrName` | `query: string` | `Promise<Customer[]>` | Busca en Dexie local (offline-safe) |
| `createCustomer` | `data: CreateCustomerRequest` | `Promise<Customer>` | POST API + Dexie put |
| `updateCustomer` | `id: number, data: Partial<Customer>` | `Promise<Customer>` | PUT API + Dexie put |
| `getCustomerOrders` | `customerId: number` | `Promise<Order[]>` | GET API historial de órdenes |
| `adjustPoints` | `customerId: number, delta: number, reason: string` | `Promise<void>` | POST API ajuste de puntos |
| `adjustCredit` | `customerId: number, deltaCents: number, reason: string` | `Promise<void>` | POST API ajuste de crédito |
| `selectCustomer` | `customer: Customer \| null` | `void` | Sets `selectedCustomer` signal |
| `clearSelection` | — | `void` | Resets `selectedCustomer` to null |

### Lógica de `searchByPhoneOrName()`

1. Si `query` es numérico (solo dígitos) → buscar en Dexie por `phone` startsWith
2. Si es texto → buscar en Dexie por `name` contains (case-insensitive)
3. Limit a 10 resultados
4. Actualizar `searchResults` signal
5. 100% offline — no requiere API

### Lógica de búsqueda offline en Dexie

```
// Phone search: index-based prefix match
db.customers.where('phone').startsWith(query).limit(10).toArray()

// Name search: collection filter (no prefix match on names)
db.customers
  .where('branchId').equals(branchId)
  .filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
  .limit(10)
  .toArray()
```

---

## 6. Nuevos Componentes

### 6.1 `CustomerSelectorComponent` (Shared, Reutilizable)

**Ubicación:** `src/app/shared/components/customer-selector/`

**Selector:** `app-customer-selector`

**Usado en:** `cart-panel`, `checkout`, `reservation-form`

#### Inputs/Outputs

| Nombre | Tipo | Dirección | Descripción |
|--------|------|-----------|-------------|
| `selectedCustomer` | `model<Customer \| null>` | Two-way | Cliente seleccionado |
| `placeholder` | `input<string>` | Input | Placeholder del input (default: "Buscar cliente...") |
| `compact` | `input<boolean>` | Input | Modo compacto para cart-panel sidebar (solo nombre) |

#### Internal Signals

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `query` | `WritableSignal<string>` | Texto del input de búsqueda |
| `results` | `Signal<Customer[]>` | Resultados del autocomplete |
| `showDropdown` | `Signal<boolean>` | Visibilidad del dropdown de resultados |
| `showCreateDialog` | `Signal<boolean>` | Visibilidad del dialog de crear cliente rápido |

#### Template Layout

```
┌──────────────────────────────────────────────────────────┐
│ Estado: Sin cliente seleccionado                          │
│                                                          │
│  ┌────────────────────────────────────────┐ ┌──────────┐│
│  │ 🔍 Buscar cliente por nombre o tel... │ │ + Nuevo  ││
│  └────────────────────────────────────────┘ └──────────┘│
│                                                          │
│  ┌─ Resultados (dropdown) ─────────────────────────────┐ │
│  │  Juan Pérez — 667 123 4567 — ⭐ 150 pts            │ │
│  │  Juan García — 667 987 6543 — ⭐ 0 pts             │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│ Estado: Cliente seleccionado                              │
│                                                          │
│  ┌─ Chip ──────────────────────────────────────────────┐ │
│  │  👤 Juan Pérez  ⭐ 150 pts  💰 $200.00 créd   ✕  │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Comportamiento:**
- Debounce de 300ms en el input de búsqueda
- Busca por teléfono si el input es numérico, por nombre si es texto
- Dropdown con max 10 resultados — cada resultado muestra: nombre, teléfono, puntos
- Al seleccionar → muestra chip con nombre, puntos, crédito, botón ✕ para desvincular
- Botón "+ Nuevo" abre dialog rápido de crear cliente (nombre + teléfono mínimo)
- Modo `compact`: chip inline sin dropdown extendido (para cart-panel sidebar)

#### Quick-Create Dialog (dentro del componente)

```
p-dialog [320px, modal]
├── Nombre *
├── Teléfono *
├── Email (opcional)
└── [Cancelar] [Crear y seleccionar]
```

### 6.2 `AdminCustomersComponent` (Admin)

**Ubicación:** `src/app/modules/admin/components/customers/`

**Ruta:** `/admin/customers`

#### Signals

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `customers` | `Signal<Customer[]>` | Lista completa del branch |
| `loading` | `Signal<boolean>` | Estado de carga |
| `selectedCustomer` | `WritableSignal<Customer \| null>` | Cliente seleccionado para el drawer |
| `showDrawer` | `WritableSignal<boolean>` | Visibilidad del profile drawer |
| `showCreateDialog` | `WritableSignal<boolean>` | Dialog de crear cliente |
| `searchQuery` | `WritableSignal<string>` | Filtro de búsqueda en la tabla |
| `customerOrders` | `Signal<Order[]>` | Historial del cliente seleccionado |

#### Template Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Clientes                           [🔍 Buscar]  [+ Nuevo]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  p-table:                                                        │
│  ┌─────────────┬────────────┬──────────┬──────────┬───────────┐ │
│  │ Nombre      │ Teléfono   │ Puntos   │ Crédito  │ Últ.visita│ │
│  ├─────────────┼────────────┼──────────┼──────────┼───────────┤ │
│  │ Juan Pérez  │ 667 123... │ ⭐ 150   │ $200.00  │ 02/04/26  │ │
│  │ María López │ 614 456... │ ⭐ 80    │ $0.00    │ 01/04/26  │ │
│  └─────────────┴────────────┴──────────┴──────────┴───────────┘ │
│                                                                  │
│  Clic en fila → abre Profile Drawer →                           │
│                                                                  │
│  ┌─ Customer Profile Drawer (p-sidebar) ──────────────────────┐ │
│  │                                                             │ │
│  │  👤 Juan Pérez                                              │ │
│  │  📱 667 123 4567                                            │ │
│  │  ✉ juan@email.com                                           │ │
│  │                                                             │ │
│  │  ┌─── Saldos ───────────────────────────────────────┐      │ │
│  │  │  ⭐ 150 puntos        💰 $200.00 crédito         │      │ │
│  │  │  [Ajustar puntos]    [Ajustar crédito]           │      │ │
│  │  └──────────────────────────────────────────────────┘      │ │
│  │                                                             │ │
│  │  ── Historial de órdenes ──                                │ │
│  │  ┌──────────────────────────────────────────────────┐      │ │
│  │  │ #47 — 02/04 — $350.00 — Efectivo                │      │ │
│  │  │ #42 — 01/04 — $180.00 — Tarjeta                 │      │ │
│  │  │ #38 — 28/03 — $520.00 — Efectivo + Crédito      │      │ │
│  │  └──────────────────────────────────────────────────┘      │ │
│  │                                                             │ │
│  │  ── Datos fiscales ──                                      │ │
│  │  RFC: XAXX010101000                                        │ │
│  │  [Editar datos fiscales]                                   │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### Adjust Dialogs

**Ajustar Puntos:**
```
p-dialog [380px]
├── "Ajustar puntos de Juan Pérez"
├── Saldo actual: ⭐ 150
├── Tipo: [Agregar / Restar] (radio)
├── Cantidad: [input number, min 1]
├── Motivo: [text input, requerido]
└── [Cancelar] [Confirmar ajuste]
```

**Ajustar Crédito (similar):**
```
p-dialog [380px]
├── "Ajustar crédito de Juan Pérez"
├── Saldo actual: $200.00
├── Tipo: [Abonar / Restar] (radio)
├── Monto (MXN): [p-inputNumber currency]
├── Motivo: [text input, requerido]
└── [Cancelar] [Confirmar ajuste]
```

---

## 7. Integración en POS & Checkout

### 7.1 Cart Panel (`cart-panel.component`)

**Cambio:** Agregar `<app-customer-selector>` debajo del header, antes de los items.

```
cart-panel__header (existente)
────────────────────
app-customer-selector [compact=true]   ← NUEVO
────────────────────
cart-panel__items (existente)
```

**Lógica:** Cuando el cajero selecciona un cliente:
- `customerService.selectCustomer(customer)` actualiza el signal global
- El nombre se muestra como chip compacto en el cart-panel
- Al enviar a cocina (`createKitchenOrder`), se inyecta `customerId` y `customerName` en la Order

### 7.2 Checkout Component

**Cambio 1 — Header:** Mostrar el cliente seleccionado (si hay) como badge junto a la mesa:

```html
@if (customerName()) {
  <span class="checkout-header__customer-badge">👤 {{ customerName() }}</span>
}
```

**Cambio 2 — Payment Section:** Si hay cliente con `creditBalanceCents > 0` o `pointsBalance > 0`, mostrar botones de pago adicionales:

```
┌── Forma de pago ──────────────────────────────────────────┐
│                                                           │
│  [Efectivo] [Tarjeta] [Transf.] [Otro]                   │
│                                                           │
│  @if (selectedCustomer()?.creditBalanceCents > 0) {       │
│    [💰 Crédito ($200.00)]                                 │
│  }                                                        │
│  @if (selectedCustomer()?.pointsBalance > 0) {            │
│    [⭐ Puntos (150 pts = $150.00)]                        │
│  }                                                        │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

**Cambio 3 — `confirmPayment()`:** Al crear la Order, inyectar:
- `customerId: customerService.selectedCustomer()?.id`
- `customerName: customerService.selectedCustomer()?.name`

**Cambio 4 — Post-payment:** Si se usaron puntos o crédito, el backend los descuenta automáticamente al sincronizar. No hay descuento local — es optimistic write.

### 7.3 Lógica de Pago con Crédito

Cuando el cajero selecciona "Crédito" como método de pago:
1. El monto máximo es `min(remainingCents, customer.creditBalanceCents)`
2. Se pre-llena el dialog con ese máximo
3. Se crea un `OrderPayment` con `method: PaymentMethod.StoreCredit`
4. Al sync, el backend descuenta del saldo del cliente
5. **No se requiere procesamiento externo** — es instantáneo como Cash

### 7.4 Lógica de Pago con Puntos

Similar a crédito, pero con conversión:
1. Tasa de conversión: 1 punto = $1.00 MXN (configurable en futuro)
2. Monto máximo: `min(remainingCents, customer.pointsBalance * 100)`
3. Se crea `OrderPayment` con `method: PaymentMethod.LoyaltyPoints`
4. Al sync, el backend descuenta los puntos

---

## 8. Integración en Reservaciones

### 8.1 `reservation-form.component`

**Cambio:** Agregar `<app-customer-selector>` antes del campo `guestName`.

**Lógica:**
1. Si el usuario selecciona un cliente existente → pre-llenar `guestName` y `guestPhone` del Customer
2. Si crea un cliente nuevo desde el quick-create → se pre-llena también
3. Si escribe nombre/teléfono manualmente sin seleccionar → no se vincula (backwards-compatible)
4. Al guardar: `customerId` se envía al backend junto con la reservación
5. `guestName` y `guestPhone` siguen siendo campos editables (el usuario puede modificarlos)

---

## 9. Print Service Enhancement

### 9.1 Ticket con nombre de cliente

**Cambio en `getTicketHtml()`:**

Si `order.customerName` está definido, agregar debajo de la mesa:
```
Mesa: Mesa 3
Cliente: Juan Pérez          ← NUEVO (solo si existe)
```

### 9.2 Ticket con puntos ganados

Si el negocio tiene loyalty y el cliente está vinculado:
```
────────────────────
⭐ +35 puntos acumulados
   Saldo: 185 puntos
────────────────────
```

---

## 10. SyncService Updates

### 10.1 `mapOrderToDto()`

Agregar:
```
customerId: order.customerId ?? null,
customerName: order.customerName ?? null,
```

### 10.2 `mapPullDto()`

Extraer:
```
customerId: dto.customerId ?? undefined,
customerName: dto.customerName ?? undefined,
```

---

## 11. Dexie Schema (v16)

**Nueva tabla:**
```
customers: '++id, branchId, phone, name, isActive'
```

**Sin cambios a tabla `orders`** — `customerId` se almacena como campo no-indexado del objeto Order.

---

## 12. Backend Dependencies

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `GET /customers` | GET | Lista de clientes del branch (paginado) |
| `GET /customers/search?q={query}` | GET | Búsqueda por nombre/teléfono |
| `POST /customers` | POST | Crear cliente |
| `PUT /customers/{id}` | PUT | Actualizar cliente |
| `GET /customers/{id}/orders` | GET | Historial de órdenes del cliente |
| `POST /customers/{id}/adjust-points` | POST | `{ delta: number, reason: string }` |
| `POST /customers/{id}/adjust-credit` | POST | `{ deltaCents: number, reason: string }` |
| `POST /orders/sync` | POST | Aceptar `customerId`, `customerName` en el DTO |

---

## 13. Archivos Resumen

### Nuevos (5-6)

| Archivo | Tipo | Propósito |
|---------|------|-----------|
| `src/app/core/models/customer.model.ts` | Interfaces | `Customer`, `CreateCustomerRequest` |
| `src/app/core/services/customer.service.ts` | Service | Signal-based CRUD + search + selection |
| `src/app/shared/components/customer-selector/` | Standalone (TS+HTML+SCSS) | Autocomplete con quick-create dialog |
| `src/app/modules/admin/components/customers/` | Standalone (TS+HTML+SCSS) | Data table + profile drawer + adjust dialogs |

### Modificados (8-10)

| Archivo | Cambio |
|---------|--------|
| `order.model.ts` | +`customerId?`, +`customerName?`, +`PaymentMethod.StoreCredit`, +`PaymentMethod.LoyaltyPoints` |
| `reservation.model.ts` | +`customerId?` |
| `database.service.ts` | v16: add `customers` table |
| `admin.routes.ts` | +Route `/customers` |
| `admin-shell.component.ts` | +Nav item "Clientes" con `FeatureKey.ClientsAndCredit` |
| `cart-panel.component.ts` + `.html` | +`<app-customer-selector compact>`, inject `CustomerService` |
| `checkout.component.ts` + `.html` | +Customer badge, +credit/points payment buttons, +inject fields in Order |
| `reservation-form.component.ts` + `.html` | +`<app-customer-selector>`, pre-fill guestName/Phone |
| `sync.service.ts` | +`customerId`/`customerName` in DTO mappers |
| `print.service.ts` | +Customer name on ticket, +loyalty points earned |
| `models/index.ts` | Export `customer.model.ts` |

---

## 14. Edge Cases & Error Matrix

| Escenario | Comportamiento |
|-----------|----------------|
| Cliente seleccionado pero sin crédito | Botón "Crédito" no aparece (condición `creditBalanceCents > 0`) |
| Pago con crédito excede saldo | Dialog pre-llena con max available; no permite exceder |
| Pago con puntos insuficientes | Mismo: pre-llena con max, usuario puede ajustar |
| Cliente seleccionado offline | Autocomplete busca solo en Dexie; crear nuevo falla con toast |
| Orden con cliente pero cliente eliminado después | `customerName` snapshot preserva el nombre en la orden |
| Dos cajeros crean mismo teléfono simultáneamente | Backend rechaza duplicado (unique constraint); frontend muestra error |
| Manager ajusta puntos a negativo | Validación: min 0, no permite `delta > pointsBalance` en resta |
| Reservación con cliente y nombre diferente | `guestName` es editable independiente de `customerId` — el cajero puede cambiar el nombre |

---

## 15. UX Specs

### Customer Selector (Autocomplete)
- Input: 48px height, `border-radius: 12px`, icon `pi-search` left
- Dropdown: max 10 items, each 48px height, shows name + phone + points pill
- Selected chip: green bg (`#F0FDF4`), name + points badge + credit badge + ✕ button
- Compact mode: chip only, no dropdown, smaller font (13px)
- Debounce: 300ms on keyup

### Customer Profile Drawer
- `p-sidebar` from right, 400px width
- Header: name (20px bold), phone, email
- Balance cards: 2-column grid, green for points, blue for credit
- Order history: compact list, max 20 entries, scrollable
- Adjust dialogs: p-dialog 380px, radio + input + reason

### Payment Buttons (Credit/Points)
- Same grid as existing payment-methods-row
- Credit: `border-left: 3px solid #3B82F6` (blue accent), badge shows available balance
- Points: `border-left: 3px solid #F59E0B` (amber accent), badge shows "X pts = $Y.00"
- Both conditionally rendered only when customer is selected AND has balance

---

## 16. Testing Strategy

### `CustomerService`
- `searchByPhoneOrName('667')`: returns phone-prefix matches from Dexie
- `searchByPhoneOrName('Juan')`: returns name-contains matches from Dexie
- `createCustomer`: saves to Dexie + API, updates `customers` signal
- `adjustPoints(id, -50, 'Redención')`: POST to API, updates local cache
- `selectCustomer/clearSelection`: updates `selectedCustomer` signal

### `CustomerSelectorComponent`
- Typing triggers search after 300ms debounce
- Selecting a result updates `selectedCustomer` model
- Quick-create dialog creates customer and auto-selects
- Compact mode renders chip without search dropdown

### `Checkout` (Credit/Points payments)
- Credit button shows only when customer has balance
- Credit payment amount capped at min(remaining, creditBalance)
- Points button shows only when customer has points
- Points payment converts at 1pt = $1.00 MXN
- `confirmPayment()` includes `customerId` and `customerName` in Order

### `Admin Customers`
- Data table loads from `CustomerService.customers` signal
- Search filters rows client-side
- Profile drawer opens on row click
- Adjust points/credit calls service and refreshes
