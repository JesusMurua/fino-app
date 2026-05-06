# AUDIT-055 — Admin Customer Drawer: historial vacío + UI revamp para membresías

**Status:** Read-only audit. No file modifications.
**Date:** 2026-05-04
**Branch:** `fix/giro-ux`
**Scope:** [`admin-customers.component`](../src/app/modules/admin/components/customers/), [`customer.service.ts`](../src/app/core/services/customer.service.ts), [`order.model.ts`](../src/app/core/models/order.model.ts), [`quick-pay.component.ts`](../src/app/modules/pos/components/quick-pay/quick-pay.component.ts), [`checkout.component.ts`](../src/app/modules/pos/components/checkout/checkout.component.ts), [`cart-panel.component.ts`](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts)
**Related:** AUDIT-054 (modal cliente), FDD-026 (split de modelo Customer)

---

## 1. Resumen ejecutivo

El drawer de Admin → Clientes muestra "Sin órdenes registradas" y stats en `0` para clientes que **sí tuvieron compras en el POS**. El fetch del drawer está correcto. La causa raíz está aguas arriba: **`QuickPayComponent` (path inline de pago no-F&B usado por Gym/Retail/Counter/QuickService) NO incluye `customerId` ni `customerName` en el `Order` payload que envía a `SyncService.saveOrder()`**. Como consecuencia, el backend recibe órdenes "huérfanas" sin atribución a cliente — el endpoint `GET /customers/{id}/orders` filtra por `customerId` y retorna lista vacía, y los agregados `totalOrderCount` / `totalSpentCents` / `lastVisitAt` en el modelo `Customer` se quedan en cero porque el server-side no tiene de dónde calcularlos.

Adicionalmente, el modelo `Customer` ya expone los campos `membershipValidUntil` y `lastPaymentAt` (vertical-specific Gym), pero el drawer **no los renderiza**. El revamp de UI puede inyectar esa información sin cambios en backend ni en el modelo.

---

## 2. Hallazgo A — Payload Check del POS (causa raíz del historial vacío)

### 2.1 Modelo `Order` declara `customerId` opcional

[`order.model.ts:153`](../src/app/core/models/order.model.ts#L153):

```
customerId?: number;
```

El campo existe en el contrato, opcional. Cualquier path puede o no atribuir el order a un cliente.

### 2.2 Comparativo de los tres paths de saveOrder

| Path | Archivo / línea | Envía `customerId`? | Envía `customerName`? |
|---|---|---|---|
| **F&B mesa (Pa' Llevar)** | [`cart-panel.component.ts:275-277`](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L275-L277) | ✅ Sí | ✅ Sí (vía `formatCustomerName`) |
| **F&B checkout principal** | [`checkout.component.ts:726-728`](../src/app/modules/pos/components/checkout/checkout.component.ts#L726-L728) | ✅ Sí | ✅ Sí (vía `formatCustomerName`) |
| **Quick-pay inline (non-F&B: Gym, Retail, Counter, Quick)** | [`quick-pay.component.ts:163-177`](../src/app/modules/pos/components/quick-pay/quick-pay.component.ts#L163-L177) | ❌ **NO** | ❌ **NO** |

### 2.3 El payload tal cual sale hoy desde quick-pay

```
const order: Order = {
  id: crypto.randomUUID(),
  orderNumber,
  items,
  subtotalCents: totalCents,
  totalCents,
  payments: [payment],
  paidCents,
  changeCents: Math.max(0, paidCents - totalCents),
  paymentProvider: null,
  createdAt: new Date(),
  syncStatusId: SyncStatusId.Pending,
  branchId: this.authService.branchId,
  cashRegisterSessionId: sessionId,
};
```

**No hay `customerId`, no hay `customerName`.** El cliente que el cashier seleccionó en `cart-panel` (chip arriba del cart) sí está en `customerService.selectedCustomer()`, pero quick-pay no lo lee al armar el order.

### 2.4 Implicación

Toda venta de un Gym (vertical Services) que pasa por el botón "Cobrar" del cart-panel termina en quick-pay, sale al BE **sin atribución**, y por tanto:

- `GET /customers/{id}/orders` retorna `[]` (no hay match por customerId)
- `Customer.totalOrderCount` queda en `0` (no incrementa)
- `Customer.totalSpentCents` queda en `0` (sin agregación)
- `Customer.lastVisitAt` queda `null` (no se actualiza)
- `Customer.lastPaymentAt` queda `null` para verticals con membresía
- `Customer.membershipValidUntil` puede quedarse desactualizado si el hook offline de extensión de membresía se dispara desde el order-side y necesita el `customerId` para correlacionar (pendiente verificar — fuera del scope de este audit)

### 2.5 Severidad

🔴 **Crítico** — el bug invalida toda la propuesta de valor del CRM (lealtad, gasto histórico, vigencia, segmentación) para clientes que solo compran vía quick-pay. Es el patrón dominante en Gym/Retail/Counter/Quick.

---

## 3. Hallazgo B — UI Fetch del Admin (correcto; el problema NO está aquí)

### 3.1 Disparo del fetch

[`admin-customers.component.ts:142-154`](../src/app/modules/admin/components/customers/admin-customers.component.ts#L142-L154):

```
async onRowClick(customer: Customer): Promise<void> {
  this.drawerCustomer.set(customer);
  this.showDrawer.set(true);
  this.customerOrders.set([]);
  this.isLoadingOrders.set(true);

  try {
    const orders = await this.customerService.getCustomerOrders(customer.id);
    this.customerOrders.set(orders);
  } finally {
    this.isLoadingOrders.set(false);
  }
}
```

Observable: tap en row → set drawer → fetch orders → set signal. Limpio.

### 3.2 Endpoint y manejo de errores

[`customer.service.ts:163-171`](../src/app/core/services/customer.service.ts#L163-L171):

```
async getCustomerOrders(customerId: number): Promise<any[]> {
  try {
    return await firstValueFrom(
      this.api.get<any[]>(`/customers/${customerId}/orders`),
    );
  } catch {
    return [];
  }
}
```

El service llama al endpoint correcto. El catch silencioso retorna `[]` en error de red — eso es defensivo y no es el problema (el screenshot del user no muestra error de red, simplemente muestra el empty state limpio).

### 3.3 Renderizado del estado

[`admin-customers.component.html:294-305`](../src/app/modules/admin/components/customers/admin-customers.component.html#L294-L305):

```
<h3 class="drawer-section__title">Historial de órdenes</h3>

@if (isLoadingOrders()) {
  <div class="drawer-orders-loading">…</div>
} @else if (customerOrders().length === 0) {
  <p class="drawer-section__empty">Sin órdenes registradas</p>
} @else {
  <div class="drawer-orders">…</div>
}
```

UI tri-state correcta: loading / empty / list. El "Sin órdenes registradas" es la rama empty, alcanzada legítimamente cuando el BE retorna `[]` — que sí ocurre porque el POS no atribuyó las órdenes.

### 3.4 Tipado opaco del response

[`customer.service.ts:163`](../src/app/core/services/customer.service.ts#L163) usa `Promise<any[]>` y la interfaz interna `CustomerOrderRow` solo se usa en el componente:

```
interface CustomerOrderRow {
  orderNumber: number;
  createdAt: string;
  totalCents: number;
  paymentMethod: string;
}
```

🟡 Deuda menor: el service debería tipar la respuesta como `Promise<CustomerOrderRow[]>` (o un tipo compartido). No bloquea funcionalidad; es de robustez.

### 3.5 Severidad

🟢 **No hay bug en el fetch.** Está correcto end-to-end.

---

## 4. Hallazgo C — UI Structure del drawer + dónde inyectar "Membership Status"

### 4.1 Estructura actual del drawer (ranking visual top → bottom)

| Sección | Markup | Ubicación |
|---|---|---|
| `drawer-header` (avatar + nombre + teléfono + email) | flex | [html:209-222](../src/app/modules/admin/components/customers/admin-customers.component.html#L209-L222) |
| `drawer-balances` (Puntos lealtad + Crédito tienda) | 2 `balance-card` lado a lado | [html:225-254](../src/app/modules/admin/components/customers/admin-customers.component.html#L225-L254) |
| `drawer-stats` (Órdenes / Total gastado / Última visita) | 3 `drawer-stat` columnas | [html:257-276](../src/app/modules/admin/components/customers/admin-customers.component.html#L257-L276) |
| `drawer-section` Datos fiscales (RFC) — **gated por `c.rfc`** | h3 + span | [html:279-284](../src/app/modules/admin/components/customers/admin-customers.component.html#L279-L284) |
| `drawer-section` Notas — gated por `c.notes` | h3 + p | [html:287-292](../src/app/modules/admin/components/customers/admin-customers.component.html#L287-L292) |
| `drawer-section` Historial de órdenes | h3 + tri-state | [html:294-318+](../src/app/modules/admin/components/customers/admin-customers.component.html#L294) |

### 4.2 Datos disponibles HOY en el modelo `Customer` para una sección de membresía

[`customer.model.ts:30-45`](../src/app/core/models/customer.model.ts#L30-L45):

| Campo | Tipo | Comentario actual |
|---|---|---|
| `membershipValidUntil` | `string \| Date \| undefined` | "Vertical-specific: end of the current membership window for Gym (and similar service verticals)" |
| `lastPaymentAt` | `string \| Date \| undefined` | "Vertical-specific: timestamp of the last paid transaction tied to this customer. Updated by the offline membership-extension hook" |

**Ambos campos ya existen en el contrato BE → FE.** No requiere cambios de modelo ni de backend para mostrarlos. Lo único que falta es la sección de UI.

### 4.3 Lugar limpio para inyectar la nueva sección

**Recomendación**: una nueva `<section class="drawer-section drawer-section--membership">` posicionada **entre `drawer-stats` y `drawer-section` Datos fiscales** (i.e., después de [línea 276](../src/app/modules/admin/components/customers/admin-customers.component.html#L276) y antes de [línea 279](../src/app/modules/admin/components/customers/admin-customers.component.html#L279)).

Razón:
- Conceptualmente "estado del cliente" (puntos / crédito / membresía) están relacionados — ya lo están "balance-cards" arriba; la nueva membership card extiende el bloque de identidad/balance
- Datos fiscales y notas son metadata operativa; deben quedarse abajo
- Historial de órdenes es el closing visual del drawer — no se toca
- Gate por `c.membershipValidUntil != null` (igual que `c.rfc`/`c.notes` ya son condicionales) — vertical-specific sin afectar non-Gym

### 4.4 Estados visuales que la nueva sección debe cubrir

| Estado | Lógica | Badge / surface (Stripe/Linear style) |
|---|---|---|
| **Vigente** | `membershipValidUntil > now()` | Badge verde "Activa", fecha de vencimiento, días restantes calculados |
| **Vencida** | `membershipValidUntil < now()` | Badge rojo "Vencida", fecha de vencimiento, días desde el vencimiento |
| **Sin membresía** | `membershipValidUntil == null` | Sección oculta (gated, no render) |
| **A punto de vencer** (opcional) | `0 < (validUntil - now()) <= 7 días` | Badge ámbar "Por vencer", énfasis en días restantes |

### 4.5 Tokens visuales del design system actual a respetar

[admin-customers.component.scss](../src/app/modules/admin/components/customers/admin-customers.component.scss):

- `balance-card` y `drawer-stat` ya usan: `border-radius` 12px, `box-shadow` suave, `padding` en escala 8/16/24px
- `drawer-section__title` es un `h3` con `font-weight` semibold
- Colores: el primary verde brand (#16A34A) ya es token; rojos/ámbares para badges siguen patrón de PrimeNG severity
- Spacing: `gap` de 16px entre cards, `padding` 16px o 24px en surfaces

La nueva sección debe **reutilizar las clases existentes** (`drawer-section`, `drawer-section__title`) y agregar modifiers BEM (`drawer-section--membership`, badges nuevos) sin introducir tokens nuevos. Cero deuda visual.

### 4.6 Severidad

🟢 **Sin bug**, solo gap de feature. La UI está lista para extenderse — el modelo ya tiene los datos.

---

## 5. Hallazgo D adicional — `lastPaymentAt` también queda sin actualizar

Por la misma razón que el hallazgo A: si el hook offline de "extender membresía al cobrar" depende del `customerId` para asociar pago ↔ cliente, y quick-pay no envía `customerId`, ese hook nunca dispara para ventas hechas vía quick-pay. Esto erosiona también la integridad de `membershipValidUntil` para cualquier renovación realizada con el flujo de cashier-not-knowing-the-customer.

Verificación pendiente (fuera de scope de este audit): confirmar dónde está el hook de membership-extension y si correlaciona por `customerId` del order, por `metadata.beneficiaryCustomerId` del cart item, o por ambos. Si solo lee del item-level metadata, podría escapar al bug de A — pero la falta de `customerId` a nivel order sigue rompiendo el resto de stats.

🟡 **Severidad media-alta** — derivativo del hallazgo A pero específico al vertical Gym.

---

## 6. Severidad consolidada

| ID | Hallazgo | Severidad | Bloquea release? |
|---|---|---|---|
| A | quick-pay payload sin `customerId` ni `customerName` | 🔴 Crítico | Sí — bloquea CRM en non-F&B |
| B | UI fetch del admin drawer | 🟢 OK | No |
| C | Drawer no renderiza membership status | 🟢 Feature gap | No (solo UX gap) |
| D | `lastPaymentAt` posiblemente afectado por A | 🟡 Medio | Pendiente verificar |
| Bonus | `getCustomerOrders` retorna `Promise<any[]>` | 🟢 Bajo | No (deuda tipo-safety) |

---

## 7. Rutas de fix (enumeradas, NO parte del audit)

### A. Fix de quick-pay (1 commit)

Replicar el patrón de [`cart-panel.component.ts:276-277`](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L276-L277) en quick-pay:

```
customerId: this.customerService.selectedCustomer()?.id,
customerName: formatCustomerName(this.customerService.selectedCustomer()) || undefined,
```

Inyectar `CustomerService` y el helper `formatCustomerName`. Mismo pattern que checkout.component. Trivial.

### B. UI revamp del drawer (1 commit con FDD opcional)

Inyectar la sección `drawer-section--membership` entre stats y fiscal data. Calcular el badge state vía un computed signal `membershipState` derivado de `c.membershipValidUntil`. Reutilizar tokens existentes.

Para C completo (Stripe/Linear aesthetic con badges soft) probablemente justifica un FDD chico — pero ese es decisión del usuario.

---

## 8. Resumen ejecutivo (lo solicitado)

> **Pregunta del audit:** "¿Está el POS enviando el `customerId` al backend cuando se coloca una orden? ¿Cómo recupera el historial el componente Admin?"

### Respuesta corta

**El POS envía `customerId` solo en 2 de los 3 paths.** El path `quick-pay` (usado por Gym/Retail/Counter/Quick — el flujo del usuario) **NO lo envía** ([quick-pay.component.ts:163-177](../src/app/modules/pos/components/quick-pay/quick-pay.component.ts#L163-L177)). Cart-panel y checkout sí lo envían correctamente. Esa omisión es la causa raíz del historial vacío y de los stats en cero.

**El componente Admin recupera el historial correctamente** — `onRowClick → customerService.getCustomerOrders(customer.id) → GET /customers/{id}/orders` ([admin-customers.component.ts:149](../src/app/modules/admin/components/customers/admin-customers.component.ts#L149) + [customer.service.ts:163](../src/app/core/services/customer.service.ts#L163)). El fetch es defensivo (catch retorna `[]`). El "Sin órdenes registradas" es la rama empty legítima del tri-state, alcanzada porque el BE retorna `[]` por falta de atribución upstream.

**Conclusión arquitectónica:** el bug NO está en la lectura (admin), está en la escritura (quick-pay del POS). Cualquier fix de UI en el drawer (incluyendo la nueva sección de Membership Status) solo será cosmético hasta que quick-pay propague `customerId` correctamente.

---

**Fin del audit.** Documento descriptivo, sin modificaciones de código. Implementación queda a la espera de FDD o fix directo según decisión.
