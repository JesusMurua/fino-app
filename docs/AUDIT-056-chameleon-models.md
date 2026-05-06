# AUDIT-056 — Chameleon Readiness: Frontend Core Models

**Branch:** `fix/giro-ux`
**Fecha:** 2026-05-05
**Alcance:** TypeScript core models — `Customer`, `Product`, `Order`, `OrderItem` (a.k.a. `CartItem`)
**Tipo:** Auditoría de _read-only_ — sin propuestas de fix, sin FDD.

---

## 0. Objetivo

Documentar exactamente cómo el frontend tipa los modelos centrales hoy, para alinear el upcoming refactor del Backend (extracción de lógica vertical-specific de Gym hacia _strongly-typed Metadata interfaces_ y tablas dedicadas). El audit responde dos preguntas:

1. ¿Existe `metadata` en `Product` / `OrderItem`? ¿Cómo está tipado?
2. ¿Qué campos vertical-specific contaminan `Customer` actualmente?

---

## 1. Mapa rápido (TL;DR)

| Modelo | Archivo | Campo `metadata` | Tipo |
|---|---|---|---|
| `Product` | [src/app/core/models/product.model.ts](../src/app/core/models/product.model.ts) | ✅ existe | `Record<string, unknown>` |
| `CartItem` (= OrderItem en el lenguaje del usuario) | [src/app/core/models/cart-item.model.ts](../src/app/core/models/cart-item.model.ts) | ✅ existe | `Record<string, unknown>` |
| `OrderPayment` | [src/app/core/models/order.model.ts](../src/app/core/models/order.model.ts#L21-L40) | ✅ existe (`paymentMetadata`) | `Record<string, unknown>` |
| `Order` | [src/app/core/models/order.model.ts](../src/app/core/models/order.model.ts#L93-L168) | ❌ **NO existe** | — |
| `Customer` | [src/app/core/models/customer.model.ts](../src/app/core/models/customer.model.ts) | ❌ no existe | — |

**Cero interfaces `*Metadata` strongly-typed** en todo `src/`. Búsqueda `interface .*Metadata|type .*Metadata` retornó 0 matches.

---

## 2. `Product` — [product.model.ts](../src/app/core/models/product.model.ts)

### 2.1. Shape actual

```typescript
export interface Product {
  id: number;
  name: string;
  description?: string;
  barcode?: string;
  priceCents: number;
  categoryId: number;
  imageUrl?: string;                 // legacy
  images?: ProductImage[];
  isAvailable: boolean;
  isPopular?: boolean;
  trackStock?: boolean;
  currentStock?: number;
  lowStockThreshold?: number;
  sizes: ProductSize[];
  modifierGroups?: ProductModifierGroup[];
  satProductCode?: string;
  satUnitCode?: string;
  taxRate?: number;
  isTaxIncluded?: boolean;
  printingDestinationId?: number | null;
  metadata?: Record<string, unknown>;   // ← Hueco vertical-specific
}
```

### 2.2. `metadata` — análisis

- **Tipo:** `Record<string, unknown>` (no `any`, no interfaz estricta).
- **JSDoc en línea ([product.model.ts:91-98](../src/app/core/models/product.model.ts#L91-L98))** declara explícitamente que es _“free-form catalog metadata that drives vertical-specific behavior”_ y menciona la convención Gym: `{ membershipDurationDays: number }`.
- **Consumidores conocidos** (todos accesan vía bracket-notation `metadata?.['key']`, sin guards de tipo):
  - [src/app/modules/admin/components/products/product-form/product-form.component.ts:448](../src/app/modules/admin/components/products/product-form/product-form.component.ts#L448) — lectura/derivación del flag `isMembership` desde `product.metadata?.['membershipDurationDays']`.
  - [src/app/modules/admin/components/products/product-form/product-form.component.ts:574](../src/app/modules/admin/components/products/product-form/product-form.component.ts#L574) — composición vía helper `composeMetadata(...)` que sobreescribe **solo** `membershipDurationDays` y respeta sibling keys.
  - [src/app/modules/pos/components/cart-panel/cart-panel.component.ts:442](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L442) — gating de UI (selector de beneficiario) cuando `metadata?.['membershipDurationDays']` está definido.
  - [src/app/modules/pos/components/checkout/checkout.component.ts:273](../src/app/modules/pos/components/checkout/checkout.component.ts#L273) — mismo gating en flujo F&B.

### 2.3. Otros campos con sesgo vertical (no son `metadata`)

- `taxRate`, `isTaxIncluded`, `satProductCode`, `satUnitCode` → fiscal MX (no es vertical, es jurisdicción).
- `printingDestinationId` → restaurante / cocina.
- `trackStock`, `currentStock`, `lowStockThreshold` → retail / abarrotes.
- `modifierGroups`, `sizes` → F&B / Counter (irrelevantes para Gym).

Estos viven como columnas de primer nivel — **no migran al hueco `metadata`**.

---

## 3. `CartItem` (OrderItem) — [cart-item.model.ts](../src/app/core/models/cart-item.model.ts)

### 3.1. Shape actual

```typescript
export interface CartItem {
  id: string;                            // client-side UUID
  product: Product;                      // referencia inflada (nested object)
  quantity: number;
  size?: ProductSize;
  extras: ProductExtra[];
  unitPriceCents: number;
  totalPriceCents: number;
  notes?: string;
  taxRate?: number;
  taxAmountCents?: number;
  discountCents: number;
  promotionId?: number;
  promotionName?: string;
  metadata?: Record<string, unknown>;    // ← Hueco vertical-specific
}
```

### 3.2. `metadata` — análisis

- **Tipo:** `Record<string, unknown>`.
- **Convención documentada** en JSDoc ([cart-item.model.ts:34-42](../src/app/core/models/cart-item.model.ts#L34-L42)): _“travels through sync to the backend so the server can apply the authoritative state”_ — payload tipo `{ beneficiaryCustomerId: number, membershipDurationDays: number }`.
- **Consumidores principales:**
  - [src/app/core/services/sync.service.ts:253-254](../src/app/core/services/sync.service.ts#L253-L254) — `applyOfflineMembershipExtensions()` lee `meta['beneficiaryCustomerId']` + `meta['membershipDurationDays']` para mutar el row de Dexie del beneficiario antes de sync (efecto offline).
  - [src/app/core/services/sync.service.ts:351](../src/app/core/services/sync.service.ts#L351) — segundo punto de lectura para reconciliar customers post-sync.
  - [src/app/core/services/sync.service.ts:682](../src/app/core/services/sync.service.ts#L682) — el outbound DTO al BE incluye `metadata: item.metadata ?? null` (passthrough opaco).
  - [src/app/modules/pos/components/cart-panel/cart-panel.component.ts:506-507](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L506-L507) — punto de _escritura_ donde el cashier asigna el beneficiario.
  - [src/app/modules/pos/components/checkout/checkout.component.ts:267-276](../src/app/modules/pos/components/checkout/checkout.component.ts#L267-L276) — gating del CTA “falta beneficiario” en flujo F&B.

### 3.3. `extrasJson` — ojo

El frontend **no almacena** `extrasJson` en `CartItem`. La transformación a string vive **solo en el boundary de sync**, [sync.service.ts:680](../src/app/core/services/sync.service.ts#L680):

```typescript
extrasJson: item.extras.length > 0 ? JSON.stringify(item.extras) : null,
```

Esto significa que el frontend modela `extras` como `ProductExtra[]` tipado, y sólo serializa al cruzar la frontera HTTP. El BE persiste como `text` opaco según el audit BE previo (AUDIT-024).

---

## 4. `Order` — [order.model.ts](../src/app/core/models/order.model.ts#L93-L168)

### 4.1. Hallazgo clave

**`Order` NO tiene un campo `metadata`.** Los hooks vertical-specific viven como **columnas escalares de primer nivel**, asimétricamente con `Product` / `CartItem`:

| Campo | Vertical | Línea |
|---|---|---|
| `tableId`, `tableName` | F&B (mesas) | 142-144 |
| `kitchenStatusId` | F&B (cocina) | 124 |
| `orderSource` | Aggregators (UberEats / Rappi / DiDi) | 159 |
| `externalOrderId` | Aggregators | 161 |
| `deliveryStatus` | Aggregators (delivery) | 163 |
| `deliveryCustomerName` | Aggregators | 165 |
| `estimatedPickupAt` | Aggregators | 167 |
| `paymentProvider`, `externalReference` | Pagos integrados (Clip, MercadoPago) | 108-110 |
| `invoiceRequest` | Fiscal MX (CFDI) | 157 |
| `cashRegisterSessionId` | Cash drawer | 151 |
| `customerId`, `customerName` | CRM (cross-vertical) | 153-155 |
| `cancellationReason`, `cancelledAt` | Lifecycle (cross-vertical) | 126-128 |

**Implicación para el refactor BE:** si la propuesta es introducir `Order.Metadata` strongly-typed, el frontend está vacío en esta dimensión — _no existe migration cost para campos ya migrados_, pero sí hay una decisión arquitectónica: ¿F&B-fields (`tableId`, `kitchenStatusId`) y Aggregator-fields (`orderSource`, `externalOrderId`) deben moverse a `metadata` tipado o quedarse como columnas? Hoy son columnas; el frontend las consume como tal en TODO el grafo (ver §6).

### 4.2. `OrderPayment.paymentMetadata`

```typescript
paymentMetadata?: Record<string, unknown>;   // line 35
```

Único `metadata` dentro del subgraph de `Order`. JSDoc dice _“receipt ID, terminal info, etc.”_. **No tiene tipado estricto.** No encontré consumidores activos en código de producción que lo lean — parece un hueco preventivo de cara a integraciones de terminal.

---

## 5. `Customer` — [customer.model.ts](../src/app/core/models/customer.model.ts)

### 5.1. Shape actual

```typescript
export interface Customer {
  id: number;
  businessId: number;
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  rfc?: string;
  notes?: string;
  pointsBalance: number;
  creditBalanceCents: number;
  creditLimitCents: number;
  totalOrderCount: number;
  totalSpentCents: number;
  lastVisitAt?: Date;
  membershipValidUntil?: string | Date;   // ← VERTICAL POLLUTION (Gym)
  lastPaymentAt?: string | Date;          // ← VERTICAL POLLUTION (Gym)
  createdAt: Date;
  isActive: boolean;
}
```

### 5.2. Pollution Gym — confirmada

Dos campos vertical-specific viven en el agregado genérico `Customer`:

#### `membershipValidUntil?: string | Date`
- **Tipo unión:** acepta `string` (server emite ISO) y `Date` (offline hook escribe instancia nativa) — JSDoc lo declara explícitamente ([customer.model.ts:37-42](../src/app/core/models/customer.model.ts#L37-L42)).
- **Escrituras:**
  - [src/app/core/services/sync.service.ts:273](../src/app/core/services/sync.service.ts#L273) — offline membership-extension hook (escribe `Date`).
- **Lecturas:**
  - [src/app/modules/reception/pages/access-control/access-control.component.ts:80](../src/app/modules/reception/pages/access-control/access-control.component.ts#L80) — gate de acceso al gym.
  - [src/app/modules/reception/pages/access-control/access-control.component.html:64,79](../src/app/modules/reception/pages/access-control/access-control.component.html#L64) — render de fechas vigente/vencida.
  - [src/app/modules/admin/components/dashboard/dashboard.component.ts:80,97-103,110-111](../src/app/modules/admin/components/dashboard/dashboard.component.ts#L80) — widget de socios próximos a vencer (ventana ±7d).
  - [src/app/modules/admin/components/dashboard/dashboard.component.html:360](../src/app/modules/admin/components/dashboard/dashboard.component.html#L360) — render fila “Próximos a vencer”.

#### `lastPaymentAt?: string | Date`
- **Tipo unión:** mismo patrón.
- **Escrituras:** [sync.service.ts:274](../src/app/core/services/sync.service.ts#L274) — pareja con la extensión de membresía.
- **Lecturas:** ninguna directa encontrada en componentes (solo se escribe — útil para trazabilidad/admin futuro pero hoy no se renderiza).

### 5.3. ¿Hay otros campos con sesgo vertical en `Customer`?

- `creditBalanceCents`, `creditLimitCents`, `pointsBalance` → CRM transversal (Retail + F&B + Gym los usan). No es pollution.
- `totalOrderCount`, `totalSpentCents`, `lastVisitAt` → analytics transversal. No es pollution.
- `rfc` → fiscal MX (jurisdicción). No es pollution.

**Conclusión §5:** únicamente `membershipValidUntil` + `lastPaymentAt` califican como vertical-specific pollution. Todo lo demás es transversal o jurisdiccional.

---

## 6. Cómo se compara con el BE (cross-reference AUDIT-024)

| Aspecto | Frontend (este audit) | Backend (AUDIT-024) |
|---|---|---|
| `Product.Metadata` | `Record<string, unknown>` opaco con convención documentada | `string?` (text) opaco, parseo manual con `JsonDocument` |
| `OrderItem.Metadata` | `Record<string, unknown>` opaco, _passthrough_ al BE | `string?` (text) opaco |
| `OrderItem.ExtrasJson` | NO existe en el modelo — se construye en sync boundary | `string?` (text) |
| `OrderPayment.PaymentMetadata` | `Record<string, unknown>` opaco | `string?` (text) opaco |
| `Order.Metadata` | **No existe** — hooks como columnas (`tableId`, `orderSource`, etc.) | **No existe** (asimetría confirmada) |
| `Customer.Metadata` | **No existe** | **No existe** |
| Vertical-specific en `Customer` | `membershipValidUntil` + `lastPaymentAt` | `MembershipValidUntil` + `LastPaymentAt` (timestamp tz) — espejado |
| Strongly-typed `*Metadata` interface | **0 ocurrencias** | **0 ocurrencias** (`OwnsOne`/`ToJson` sin estrenar) |

El frontend es **un poco más expresivo** que el BE: tipa `metadata` como `Record<string, unknown>` (no `any`), lo que fuerza al consumidor a hacer narrowing antes de usar valores. El BE lo guarda como `text` y deja la responsabilidad de parseo a cada caller.

---

## 7. Resumen ejecutivo

1. **`Product.metadata` y `CartItem.metadata` existen, ambos tipados como `Record<string, unknown>`** — abierto, sin schema. Es el _knob_ vertical-specific actual.
2. **`Order` y `Customer` no tienen `metadata`.** Cualquier ampliación vertical en `Order` viaja como columna escalar nueva (patrón ya establecido para mesas, kitchen, aggregator, fiscal).
3. **Pollution confirmada en `Customer`:** únicamente `membershipValidUntil` y `lastPaymentAt`. Ambos son `string | Date` por la doble fuente (server ISO vs offline `Date`).
4. **Cero interfaces `*Metadata` strongly-typed en todo el frontend.** No hay `ProductMetadata`, `OrderItemMetadata`, `CustomerMetadata` ni equivalentes — el contrato se documenta vía JSDoc y convención de keys.
5. **Riesgo del refactor BE → FE:** si el BE adopta `OwnsOne`/columnas JSON tipadas con shape estricto, el frontend tiene **bajo costo de migración** porque los consumidores acceden por bracket-notation; un mapping a interfaz estricta `ProductMetadata { membershipDurationDays?: number; ... }` se puede introducir sin romper writers ni readers existentes.

---

## 8. Anexos — archivos consultados

- [src/app/core/models/customer.model.ts](../src/app/core/models/customer.model.ts)
- [src/app/core/models/product.model.ts](../src/app/core/models/product.model.ts)
- [src/app/core/models/order.model.ts](../src/app/core/models/order.model.ts)
- [src/app/core/models/cart-item.model.ts](../src/app/core/models/cart-item.model.ts)
- [src/app/core/services/sync.service.ts](../src/app/core/services/sync.service.ts) (sync boundary + membership hook)
- [src/app/modules/admin/components/products/product-form/product-form.component.ts](../src/app/modules/admin/components/products/product-form/product-form.component.ts) (writer de `Product.metadata`)
- [src/app/modules/pos/components/cart-panel/cart-panel.component.ts](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts) (writer de `CartItem.metadata`)
- [src/app/modules/pos/components/checkout/checkout.component.ts](../src/app/modules/pos/components/checkout/checkout.component.ts) (gating + lectura)
- [src/app/modules/reception/pages/access-control/access-control.component.ts](../src/app/modules/reception/pages/access-control/access-control.component.ts) (lector de `membershipValidUntil`)
- [src/app/modules/admin/components/dashboard/dashboard.component.ts](../src/app/modules/admin/components/dashboard/dashboard.component.ts) (lector de `membershipValidUntil`)

**Búsquedas guard:**
- `interface .*Metadata|type .*Metadata` → 0 matches en `src/`.
- `membershipValidUntil|lastPaymentAt|membershipDurationDays|beneficiaryCustomerId` → coincide con los puntos enumerados arriba; ningún consumidor/escritor adicional fuera del set.
