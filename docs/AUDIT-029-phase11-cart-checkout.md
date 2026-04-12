# AUDIT-029 — Fase 11: Auditoría del motor de ventas (Catálogo → Carrito → Checkout)

**Fecha:** 2026-04-11
**Alcance:** [cart.service.ts](src/app/core/services/cart.service.ts), [cart-panel.component.ts](src/app/modules/pos/components/cart-panel/cart-panel.component.ts), [checkout.component.ts](src/app/modules/pos/components/checkout/checkout.component.ts), [product-detail.component.ts](src/app/modules/pos/components/product-detail/product-detail.component.ts), modelos `cart-item.model.ts`, `order.model.ts`, `product.model.ts`, y `utils/tax.utils.ts`.

**Conclusión ejecutiva:** El núcleo matemático del motor de ventas es **sólido** (cents integers en todas las capas críticas). Existen **3 bugs menores** y **2 gaps funcionales** (reglas de modificadores y validación de sobrepago por método), pero **ninguno compromete la integridad financiera** a corto plazo. El sessionId de caja se inyecta correctamente en ambas rutas. Detalles por pregunta abajo.

---

## 1. Matemáticas del Carrito ¿Usa cents integer?

### SI — la arquitectura es correcta end-to-end.

**Precio unitario** ([cart-item.model.ts:44-52](src/app/core/models/cart-item.model.ts#L44-L52)):
```ts
export function calcUnitPriceCents(product, size, extras): number {
  const sizeDelta = size?.priceDeltaCents ?? 0;
  const extraTotal = extras.reduce((sum, e) => sum + e.priceCents, 0);
  return product.priceCents + sizeDelta + extraTotal;
}
```
Todos los operandos son integer-cents: `priceCents`, `priceDeltaCents`, `extras[i].priceCents`. La suma se mantiene en cents. **Libre de floating point.**

**Total del carrito** ([cart.service.ts:33-38](src/app/core/services/cart.service.ts#L33-L38)):
```ts
readonly totalCents = computed(() => {
  const evaluation = this.cartEvaluation();
  if (!evaluation) return 0;
  const subtotal = this.items().reduce((sum, i) => sum + i.totalPriceCents, 0);
  return Math.max(0, subtotal - evaluation.totalDiscountCents);
});
```
`totalPriceCents = unitPriceCents × quantity` (línea 138). Integer en todo el trayecto.

**Impuestos** ([tax.utils.ts:21-24](src/app/core/utils/tax.utils.ts#L21-L24)): usa `Math.round` para el redondeo inclusivo, consistente con la descripción del "Universal Tax Engine" del backend.

**Conversión pesos ↔ cents en el diálogo de pago** ([checkout.component.ts:410](src/app/modules/pos/components/checkout/checkout.component.ts#L410)):
```ts
const amountCents = Math.round(this.dialogAmountPesos * 100);
```
`Math.round` previene drift IEEE 754 para montos razonables (≤ 9 dígitos). Correcto.

**Descuento custom** ([checkout.component.ts:179-186](src/app/modules/pos/components/checkout/checkout.component.ts#L179-L186)): usa `Number((rawValue * 100).toFixed(0))` con un comentario explícito sobre IEEE 754. Deliberado y correcto.

### ⚠️ Hallazgo 1.A — Contrato de `taxRate` inconsistente en JSDoc

[cart-item.model.ts:24](src/app/core/models/cart-item.model.ts#L24) documenta `taxRate` como "decimal fraction (e.g. 0.16 for 16%)", pero [product.model.ts:64-65](src/app/core/models/product.model.ts#L64-L65) lo define como "integer percentage (e.g. 16, 8, 0)". El código real lo trata como **integer percentage** (ver [tax.utils.ts:23](src/app/core/utils/tax.utils.ts#L23) `1 + rate/100`). **Bug de documentación, no de runtime** — pero puede confundir a futuros desarrolladores y generar un bug real si alguien "corrige" el código para alinearlo al JSDoc.

### ⚠️ Hallazgo 1.B — Prorrateo de impuestos con rounding drift acumulable

[checkout.component.ts:197-211](src/app/modules/pos/components/checkout/checkout.component.ts#L197-L211) prorratea el descuento por ítem con `Math.round` por elemento:
```ts
const itemShare = Math.round(item.totalPriceCents * totalAfterDiscount / totalBeforeDiscount);
```
La suma de `itemShare` puede diferir hasta ±(N) cents frente al total real (donde N = número de ítems). Para órdenes pequeñas (< 10 items) el error es imperceptible (< 10¢), pero para órdenes grandes con descuentos puede haber un desfase visible de 1–2 cents entre ticket impreso y backend.

**Recomendación:** aplicar "last-item remainder" (el último ítem absorbe el residual) como ya se hace en `splitAmountCents` ([checkout.component.ts:265-273](src/app/modules/pos/components/checkout/checkout.component.ts#L265-L273)).

---

## 2. Reglas de Modificadores ¿Se validan grupos, mínimos y máximos?

### ❌ NO — El dominio NO soporta grupos de modificadores.

**Modelo actual** ([product.model.ts:5-20](src/app/core/models/product.model.ts#L5-L20)):
```ts
interface ProductExtra {
  id: number;
  label: string;
  priceCents: number;
}
```
No hay campos `groupId`, `minSelectable`, `maxSelectable`, `required`, ni `exclusive`. Los `extras` son una **lista plana**.

**UI actual** ([product-detail.component.ts:92-102](src/app/modules/pos/components/product-detail/product-detail.component.ts#L92-L102)): construye un `FormArray` de checkboxes sin ninguna validación. El usuario puede seleccionar 0 o *todos* los extras — no hay restricción.

**Sizes** sí son implícitamente "one-of" (un radio), pero:
- No hay validación de "size requerido": si el producto no tiene sizes, `sizeId` queda `null` y se acepta.
- Si tiene sizes, se preselecciona el primero ([product-detail:95](src/app/modules/pos/components/product-detail/product-detail.component.ts#L95)) — funciona en la práctica pero es frágil.

**Impacto:**
- **No bloqueante** si los menús actuales no usan reglas tipo "elige hasta 3 ingredientes".
- **Bloqueante** el día que un cliente real pida "Tacos: elige 1 carne (requerido), elige hasta 3 salsas" — hoy el sistema no lo puede representar ni validar.

**Esto es un gap de feature**, no un bug. Requiere:
1. Extender `Product` con `modifierGroups: ModifierGroup[]`.
2. Cada grupo con `min`, `max`, `required`, y una lista de `ProductExtra`.
3. Validación reactiva en `product-detail.component.ts` antes de habilitar "Agregar".

---

## 3. Checkout Efectivo ¿Cambio correcto? ¿Bloquea pagos insuficientes?

### ✅ SÍ — ambos casos funcionan correctamente. Con un matiz.

**Cálculo de cambio** ([checkout.component.ts:240-243](src/app/modules/pos/components/checkout/checkout.component.ts#L240-L243)):
```ts
readonly changeCents = computed(() =>
  Math.max(0, this.totalPaidCents() - this.totalWithDiscount()),
);
```
Correcto: `max(0, paid - total)` garantiza que nunca sea negativo. Cents integer.

**Bloqueo de pago insuficiente** ([checkout.component.ts:246-249](src/app/modules/pos/components/checkout/checkout.component.ts#L246-L249)):
```ts
readonly canConfirm = computed(() => {
  if (this.totalWithDiscount() === 0) return false;
  return this.totalPaidCents() >= this.totalWithDiscount();
});
```
El botón "Confirmar" está atado a `canConfirm()`, así que no se puede cobrar de menos. ✓

### ⚠️ Hallazgo 3.A — `canConfirm` bloquea órdenes de total 0

Si una promoción deja el total en 0 (100% off, o producto de regalo), `totalWithDiscount() === 0` devuelve `false` y el cashier **no puede cerrar la orden**. Esto fuerza a forzar un pago de 0 pesos, cosa que tampoco es válida (`amountCents <= 0` también se rechaza en [checkout.component.ts:411](src/app/modules/pos/components/checkout/checkout.component.ts#L411)).

**Mitigación actual:** el gap se esconde porque promos de 100% son raras. **Bloqueante potencial** cuando se active una promo tipo "Lleva 2 y paga 1 gratis".

### ⚠️ Hallazgo 3.B — Sobrepago permitido en métodos no-efectivo (menor)

`changeCents` se calcula sobre `totalPaidCents` sin discriminar método. Si un cashier teclea por error $500 de tarjeta para una orden de $320:
- `canConfirm = true`
- Se registra `amountCents: 50000` en el OrderPayment de tipo Card
- `changeCents = 18000` — el sistema reportará "cambio por $180" aunque **la tarjeta se cobró $500**.

En efectivo el comportamiento es correcto (la caja tiene los $500 físicos). En tarjeta / transferencia es incorrecto. El diálogo de monto sí pre-rellena el monto con `remaining` ([checkout.component.ts:399](src/app/modules/pos/components/checkout/checkout.component.ts#L399)), pero el usuario puede sobrescribirlo libremente.

**Recomendación:** para métodos distintos a `Cash`, bloquear `amountCents > remainingCents` en `confirmAddPayment()`.

---

## 4. Integración E2E Sesión ¿Se inyecta `cashRegisterSessionId`?

### ✅ SÍ — Ambas rutas inyectan el sessionId correctamente.

**Ruta A — Orden nueva** ([checkout.component.ts:677](src/app/modules/pos/components/checkout/checkout.component.ts#L677)):
```ts
cashRegisterSessionId: this.cashRegisterService.activeSession()?.id,
```
Garantizado por el guard `requireOpenSession()` llamado en [checkout.component.ts:600](src/app/modules/pos/components/checkout/checkout.component.ts#L600).

**Ruta B — Orden existente (cobrar mesa)** ([checkout.component.ts:651](src/app/modules/pos/components/checkout/checkout.component.ts#L651)):
```ts
cashRegisterSessionId: existing.cashRegisterSessionId ?? this.cashRegisterService.activeSession()?.id,
```
Preserva la sesión original si existe; cae al activo como fallback. Esta es una decisión semántica importante — si la mesa fue creada en el turno A y se cobra en el turno B, la venta queda atribuida al **turno A** (el que originó la cuenta). Si el negocio requiere atribuir al turno que efectivamente recibió el efectivo, esto necesita revisión.

**Ruta C — Enviar a cocina (sin cobrar)** ([cart-panel.component.ts:193](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L193)):
```ts
cashRegisterSessionId: this.cashRegisterService.activeSession()?.id,
```
También protegido por `requireOpenSession()` en [cart-panel.component.ts:138, 147](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L138).

### ⚠️ Hallazgo 4.A — Ventana de race entre guard y confirmación

En `onConfirmPayment()` el guard de sesión se llama **antes** del diálogo de cocina pendiente. Si el usuario confirma el diálogo (línea 608 → `confirmPayment()`), el guard **no se re-ejecuta**. Es teóricamente posible (aunque muy improbable en UX real) que la sesión se cierre desde otro tab entre `onConfirmPayment` y `confirmPayment`, generando una orden con `cashRegisterSessionId: undefined`.

**Mitigación:** re-evaluar `requireOpenSession()` en la primera línea de `confirmPayment()`.

---

## 5. Deuda Técnica ¿Estado duplicado, `any`, falta de reactividad?

### Estado general: **saludable**. Cero `any` en cart.service. Un solo `any` cosmético en checkout.

**Uso de signals:** excelente. Tanto `CartService` como `CheckoutComponent` están 100% basados en signals + `computed`. El efecto de sincronización del carrito ([checkout.component.ts:338-347](src/app/modules/pos/components/checkout/checkout.component.ts#L338-L347)) reemplazó un `cart$.subscribe()` huérfano (Fase 2 histórica, según comentario).

### Hallazgos de deuda técnica:

#### ⚠️ 5.A — `subtotalCents` duplicado con semántica rota en ruta kitchen

[cart-panel.component.ts:179-180](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L179-L180):
```ts
totalCents: this.cartService.totalCents(),
subtotalCents: this.cartService.totalCents(),   // 👈 mismo valor
```
Según [order.model.ts:130](src/app/core/models/order.model.ts#L130), `subtotalCents` se define como "sum of item prices **before any discounts**". Acá se escribe el total POST-promoción, no el pre-promoción. Si una orden enviada a cocina con promo aplicada se consulta por un reporte, el subtotal estará subestimado.

**Fix:** `subtotalCents: items.reduce((s, i) => s + i.totalPriceCents, 0)`.

#### ⚠️ 5.B — Órdenes de cocina no guardan `taxAmountCents`

Misma ruta ([cart-panel.component.ts:175-194](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L175-L194)): no se setea `taxAmountCents`. La orden viaja a la backend sin desglose fiscal. Cuando la orden se cobra en el checkout, sí se calcula, pero durante su estado "pending-kitchen" los reportes de IVA pendiente están ciegos.

**Fix:** usar `calculateOrderTaxFromSnapshot(items)` ya existente en `tax.utils.ts`.

#### ⚠️ 5.C — `existingTotalCents` como signal duplicado

[checkout.component.ts:165](src/app/modules/pos/components/checkout/checkout.component.ts#L165): `existingTotalCents` es una copia de `order.totalCents` en un signal separado. Podría derivarse directamente de `completedOrder()` o del `loadedOrder`, evitando que dos fuentes de verdad diverjan.

**Fix menor:** guardar el `order` completo en un signal y derivar `totalCents` vía `computed`.

#### ⚠️ 5.D — `http.get<any>` en loadOrderFromApi

[checkout.component.ts:585](src/app/modules/pos/components/checkout/checkout.component.ts#L585):
```ts
const dto = await firstValueFrom(this.http.get<any>(...));
```
Único `any` del archivo. Se justifica porque luego se pasa por `syncService.mapPullDto(dto)`, pero sería tipado correcto usar `OrderPullDto` o similar.

#### ⚠️ 5.E — `addingToOrder` no es signal

[cart-panel.component.ts:58](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L58):
```ts
addingToOrder: { orderId: string; orderNumber: number } | null = null;
```
Variable de instancia mutable mientras el resto del componente usa signals. No hay reactividad — si algún `@if` del template depende de esto, no se actualiza sin CD manual. En este caso no afecta runtime porque las mutaciones ocurren en hooks de vida o handlers imperativos, pero rompe consistencia del patrón.

#### ⚠️ 5.F — `sessionStorage` como SSOT de tabla activa

Patrón repetido en [cart-panel:93](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L93), [checkout:355](src/app/modules/pos/components/checkout/checkout.component.ts#L355). El `tableId` "activo" vive en `sessionStorage` como JSON string y se rehidrata en cada ngOnInit. `OrderContextService` tiene `activeTableName` como signal (línea 71), pero conviven ambas fuentes. **Existen 2 SSOT para el mismo dato.** Candidato a unificación en Fase 12.

---

## Resumen de hallazgos

| # | Severidad | Hallazgo | Archivo clave |
|---|-----------|----------|---------------|
| 1.A | 🟡 Documentación | JSDoc `taxRate` contradice contrato real | [cart-item.model.ts:24](src/app/core/models/cart-item.model.ts#L24) |
| 1.B | 🟡 Precisión | Prorrateo de impuestos acumula drift de rounding | [checkout.component.ts:197-211](src/app/modules/pos/components/checkout/checkout.component.ts#L197-L211) |
| 2 | 🔴 Gap feature | Modifier groups (min/max/required) **no implementados** | [product.model.ts:15-20](src/app/core/models/product.model.ts#L15-L20) |
| 3.A | 🟠 Bug latente | Promo 100% off bloquea `canConfirm` | [checkout.component.ts:246-249](src/app/modules/pos/components/checkout/checkout.component.ts#L246-L249) |
| 3.B | 🟠 UX/contabilidad | Sobrepago por tarjeta genera "cambio fantasma" | [checkout.component.ts:240-243](src/app/modules/pos/components/checkout/checkout.component.ts#L240-L243) |
| 4.A | 🟡 Race teórica | `requireOpenSession` no se revalúa tras kitchen dialog | [checkout.component.ts:621](src/app/modules/pos/components/checkout/checkout.component.ts#L621) |
| 5.A | 🟠 Datos | `subtotalCents` en orden de cocina = `totalCents` | [cart-panel.component.ts:179-180](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L179-L180) |
| 5.B | 🟠 Datos | Órdenes de cocina sin `taxAmountCents` | [cart-panel.component.ts:175-194](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L175-L194) |
| 5.C | 🟢 Menor | `existingTotalCents` duplicado | [checkout.component.ts:165](src/app/modules/pos/components/checkout/checkout.component.ts#L165) |
| 5.D | 🟢 Menor | `http.get<any>` sin tipar | [checkout.component.ts:585](src/app/modules/pos/components/checkout/checkout.component.ts#L585) |
| 5.E | 🟢 Menor | `addingToOrder` no es signal | [cart-panel.component.ts:58](src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L58) |
| 5.F | 🟡 Deuda arquitectural | Doble SSOT para "mesa activa" (sessionStorage + signal) | cart-panel + checkout |

**Leyenda:** 🔴 Gap funcional · 🟠 Bug operacional · 🟡 Deuda/corrección menor · 🟢 Cosmético

---

## Recomendación de priorización (cuando apruebes soluciones)

1. **Bloque A — correcciones de datos (30 min):** 5.A + 5.B + 1.A. Impacto directo en reportes e IVA.
2. **Bloque B — bugs operacionales (1 h):** 3.A (promo 100% off) + 3.B (sobrepago no-cash) + 4.A (re-guard). Evita incidentes visibles en el floor.
3. **Bloque C — deuda menor (30 min):** 1.B, 5.C, 5.D, 5.E.
4. **Bloque D — gap de feature (fuera de Fase 11):** punto 2. Requiere FDD propio (modifier groups), migración del modelo y UI nueva. **Proponer como FDD-00X**.
5. **Bloque E — refactor arquitectural (Fase 12):** 5.F. Unificar fuente de verdad de tabla activa.

---

**Esperando tu confirmación** antes de proponer patches concretos. Cuando decidas qué bloques atacar, genero los diffs uno por uno.
