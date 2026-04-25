# AUDIT-038 — Offline Sync & Local DB: Readiness para venta de membresías offline

**Fecha:** 2026-04-25
**Branch:** `feat/retail-gym`
**Tipo:** Auditoría arquitectónica (read-only)
**Pregunta:** ¿Podemos vender una membresía offline y reflejar inmediatamente la nueva `MembershipValidUntil` del cliente en la UI antes de que el orden se sincronice al backend?

---

## Resumen ejecutivo

**Veredicto:** No. El flujo offline está sólido para órdenes "puras" (productos + pago), pero hay **5 huecos** que bloquean la extensión de membresía:

1. El modelo `Customer` no tiene campos de membresía.
2. `CartItem` no tiene `metadata` — no hay dónde guardar `BeneficiaryCustomerId` ni `MembershipDays`.
3. El sync **no envía** metadata al backend ni la recibe en pulls.
4. No existe un side-effect hook en `saveOrder()` que escanee items y mute al cliente.
5. `CustomerService` no se entera si alguien muta directo en Dexie — la signal `selectedCustomer()` no refrescaría sola.

Ninguno requiere reescritura. Son extensiones por composición.

---

## 1. Capa local (Dexie)

**Servicio:** [database.service.ts](src/app/core/services/database.service.ts) (v23 schema).

Tabla relevante:

- `customers: Table<Customer, number>` con índices `++id, branchId, phone, name, isActive` (definidos desde v16, [database.service.ts:42](src/app/core/services/database.service.ts#L42)).

**Modelo `Customer`** ([customer.model.ts:5-34](src/app/core/models/customer.model.ts#L5)):

```ts
{ id, branchId, name, phone, email?, rfc?, notes?,
  pointsBalance, creditBalanceCents, creditLimitCents,
  totalOrderCount, totalSpentCents, lastVisitAt?,
  createdAt, isActive }
```

❌ **No existen** `membershipValidUntil` ni `lastPaymentAt`. Tampoco hay índice por estos campos (no hace falta inicialmente, pero tener índice por `membershipValidUntil` ayudaría a queries de "miembros por vencer").

**Modelo `CartItem`** ([cart-item.model.ts:10-34](src/app/core/models/cart-item.model.ts#L10)):

```ts
{ id, product, quantity, size?, extras, unitPriceCents,
  totalPriceCents, notes?, taxRate?, taxAmountCents?,
  discountCents, promotionId?, promotionName? }
```

❌ **No existe** un campo `metadata` ni equivalente. `Order.items: CartItem[]` ([order.model.ts:93-168](src/app/core/models/order.model.ts#L93)) hereda la misma carencia. **No hay slot persistente** para `BeneficiaryCustomerId` / `MembershipDays`.

---

## 2. Flujo de guardado offline

**Entry point:** [checkout.component.ts:648](src/app/modules/pos/components/checkout/checkout.component.ts#L648) → `confirmPayment()`.

Cadena (resumida):

1. **checkout.component.ts:690-714** — construye `Order` con `items: this.cartItems()` y `customerId: customerService.selectedCustomer()?.id`.
2. **checkout.component.ts:716** → `await this.syncService.saveOrder(order)`.
3. **sync.service.ts:202-216** — `saveOrder()`:
   - `await this.db.orders.put({ ...order, syncStatusId: Pending, retryCount: 0 })`
   - `pendingCount.update(...)` — bumps counter
   - Si está online, dispara `syncPendingOrders()` fire-and-forget.

**Punto crítico:** entre `db.orders.put` ([sync.service.ts:210](src/app/core/services/sync.service.ts#L210)) y el final del método, hay **un solo lugar** donde podría inyectarse el side-effect de membresía. Es exactamente análogo al patrón ya establecido por `ProductService.deductLocalStock()` ([product.service.ts:160-172](src/app/core/services/product.service.ts#L160), llamado desde [cart.service.ts:148](src/app/core/services/cart.service.ts#L148)) que decrementa stock localmente al agregar al carrito.

❌ **No existe** ningún hook actual que lea `order.items[*].metadata` después del save y mute registros relacionados.

---

## 3. Sync al backend

**Servicio:** [sync.service.ts](src/app/core/services/sync.service.ts).

### Push (`POST /orders/sync`)

`mapOrderToDto()` ([sync.service.ts:523-569](src/app/core/services/sync.service.ts#L523)) aplana cada CartItem a:

```ts
{ productId, productName, quantity, unitPriceCents,
  discountCents, promotionId, promotionName,
  sizeName, extrasJson, notes }
```

❌ **No incluye** `metadata`. Aunque pongamos el campo en `CartItem`, el sync lo dropearía silenciosamente.

### Pull (`GET /orders/pull`)

`OrderItemPullDto` ([sync.service.ts:29-41](src/app/core/services/sync.service.ts#L29)):

```ts
{ id, productId?, productName, quantity, unitPriceCents,
  discountCents?, promotionId?, promotionName?,
  sizeName?, extras?, notes? }
```

❌ Tampoco contempla `metadata`. `mapPullDto()` ([sync.service.ts:366-429](src/app/core/services/sync.service.ts#L366)) skip-ea órdenes locales en estado `Pending/Failed` ([:334-338](src/app/core/services/sync.service.ts#L334)), así que el merge es defensivo, pero no hay reconciliación de estado de cliente: si el server responde con `membershipValidUntil` distinto al local, hoy no lo aplicamos.

---

## 4. Customer service / reactividad

**Servicio:** [customer.service.ts](src/app/core/services/customer.service.ts).

Patrón **stale-while-revalidate** ([:45-70](src/app/core/services/customer.service.ts#L45)): primero sirve de Dexie, luego refresca desde API y `bulkPut`.

Signals expuestos:

- `customers` — array signal.
- `selectedCustomer` — el cliente actualmente atado al carrito ([:30](src/app/core/services/customer.service.ts#L30)). Lo lee tanto el cart-panel como checkout ([checkout.component.ts:324](src/app/modules/pos/components/checkout/checkout.component.ts#L324)).

**Mutador autorizado:** `updateCustomer()` ([:125-134](src/app/core/services/customer.service.ts#L125)) — hace `db.customers.put` + sincroniza el array signal y `selectedCustomer` si coincide el id ([:202-204](src/app/core/services/customer.service.ts#L202)).

❌ **Si alguien escribe directo en `db.customers.put/update` desde otro servicio**, los signals NO se enteran. La UI seguiría mostrando el `membershipValidUntil` viejo hasta una recarga o un nuevo `loadCustomers()`.

---

## 5. Huecos lógicos a parchear

| # | Archivo | Cambio |
|---|---|---|
| **A** | [customer.model.ts](src/app/core/models/customer.model.ts) | Agregar `membershipValidUntil?: Date` y `lastPaymentAt?: Date` al interface `Customer`. |
| **B** | [cart-item.model.ts](src/app/core/models/cart-item.model.ts) | Agregar `metadata?: Record<string, unknown>` (o tipado `{ beneficiaryCustomerId?, membershipDays? }` si solo se prevé membresías). El usuario decide tipado vs flexible. |
| **C.1** | [sync.service.ts:29-41](src/app/core/services/sync.service.ts#L29) | Agregar `metadata?` al `OrderItemPullDto`. |
| **C.2** | [sync.service.ts:407-427](src/app/core/services/sync.service.ts#L407) | Pasar `metadata` en `mapPullDto()` para que el merge no la pierda. |
| **C.3** | [sync.service.ts:556-567](src/app/core/services/sync.service.ts#L556) | Incluir `metadata` en `mapOrderToDto()` para que el push lo lleve al backend. |
| **D** | [sync.service.ts:210](src/app/core/services/sync.service.ts#L210) | Después del `db.orders.put`, llamar a un nuevo `applyOrderItemSideEffects(order)`: itera `order.items`, detecta `metadata.beneficiaryCustomerId + membershipDays`, calcula nuevo `validUntil = max(now, currentValidUntil) + days`, hace `db.customers.update(...)` y notifica al `CustomerService`. **Crítico:** el cálculo correcto **no es `now + days`**; es `max(now, validUntilActual) + days` para no desperdiciar días vigentes cuando el socio renueva antes de vencer. |
| **E** | [customer.service.ts](src/app/core/services/customer.service.ts) | Agregar método público `refreshFromDb(customerId)` que relea de Dexie y actualice el array signal + `selectedCustomer`. Llamado por el side-effect hook del paso D para mantener reactividad. |

### Bonus — backend contract

Antes de mergear B/C, confirmar con el equipo backend que el endpoint `POST /orders/sync` ya acepta `items[*].metadata` y que la regla de extensión vive server-side (el server debe ser la verdad: el cliente mete una predicción optimista, el backend la confirma). Si el backend aún no lo soporta, el push enviará el campo y será ignorado — no rompe nada, pero el cliente quedará temporalmente "más vigente" que el server hasta que el backend valide.

---

## 6. Consideraciones de robustez

### Idempotencia del side-effect
El `saveOrder()` se llama una sola vez por orden (`Order.id` es UUID generado client-side, [checkout.component.ts:690](src/app/modules/pos/components/checkout/checkout.component.ts#L690)). Pero si la orden falla al syncar y reintenta, NO debe re-aplicar la extensión local (ya está aplicada). El side-effect hook debe correr **solo una vez** — está naturalmente protegido si lo colgamos justo después del primer `db.orders.put` en `saveOrder()`, no en `syncOrder()`.

### Reconciliación con server
Cuando el server responde al sync con el `MembershipValidUntil` autoritativo, hay que aplicarlo localmente para corregir desviación. Hoy no existe ese paso — habría que extender la respuesta de `/orders/sync` para devolver el customer mutado, y agregar un merge en [sync.service.ts:455](src/app/core/services/sync.service.ts#L455) (donde se setea `Synced`) que llame a `customerService.refreshFromDb(...)`.

### Conflictos offline largos
Si el cajero vende dos membresías al mismo cliente offline antes de un sync (e.g. por error), el segundo cálculo debe partir del `validUntil` ya extendido por el primero (queda en Dexie). El `max(now, current) + days` lo cubre automáticamente.

### Persistencia del CartItem.metadata
[cart.service.ts:269](src/app/core/services/cart.service.ts#L269) hace `db.cart.bulkAdd(items)` — Dexie persiste el objeto completo, así que el campo `metadata` añadido al modelo viaja gratis. Verificar al implementar.

---

## 7. Plan de implementación sugerido (no ejecutado)

Fase 3.2 candidatos en orden:

1. **3.2.a** Modelos — A, B (1 archivo cada uno, mínimo riesgo).
2. **3.2.b** Sync DTOs — C.1, C.2, C.3 (todo en sync.service.ts, sin cambio de comportamiento mientras nadie llene `metadata`).
3. **3.2.c** Side-effect hook — D + E (lógica nueva). Tests: vender membresía offline, verificar `customers.get(id).membershipValidUntil` actualizado y signal reflejado en UI sin recargar.
4. **3.2.d** Reconciliación con server (opcional, depende de contrato backend).

Cada fase es mergeable independientemente y no rompe lo existente.
