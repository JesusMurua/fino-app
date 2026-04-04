# Frontend Design Document: Payment Integration (Clip + MercadoPago)

## FDD-003 — Phase 14: Payment Provider UI & Provider Logic

**Fecha:** 2026-04-03
**Autor:** Documento generado por análisis de arquitectura
**Estado:** Draft — pendiente de confirmación

---

## 1. Feature Overview

**Objetivo:** Evolucionar el flujo de checkout para soportar proveedores de pago digitales/físicos (Clip terminal y MercadoPago QR) junto al efectivo tradicional, con una UI premium que comunique claramente el estado de cada transacción.

**Problema actual:** El checkout solo registra método de pago + monto + referencia opcional. El campo `paymentProvider` está hardcoded como `null`. No existe comunicación con terminales de pago ni generación de QR. Todos los pagos con tarjeta se registran como "confianza" sin validación contra un proveedor externo.

**Solución:** Un sistema de Payment Providers pluggable que:
1. Detecta qué proveedores están habilitados para la sucursal (config del backend)
2. Muestra una UI diferenciada por proveedor en el checkout
3. Maneja el ciclo de vida async de cada transacción (pendiente → aprobado/rechazado)
4. Persiste optimísticamente en Dexie con estado de transacción
5. Sincroniza con el backend que valida contra las APIs de los proveedores

---

## 2. Scope & Boundaries

### In Scope
- Nuevo servicio `PaymentProviderService` que orquesta la lógica de cada proveedor
- `ClipPaymentAdapter` para transacciones vía terminal Clip (manual reference entry + future Bluetooth)
- `MercadoPagoPaymentAdapter` para transacciones vía QR estático o dinámico
- Evolución del `OrderPayment` interface con campos de proveedor y estado de transacción
- `PaymentProcessingDialog` — modal que muestra el estado de la transacción en curso (spinner, QR, resultado)
- Refactor del Payment Method Selector en checkout con provider-awareness
- Mapeo de nuevos campos en `SyncService.mapOrderToDto()` y `mapPullDto()`
- Feature flags en `AppConfig` para habilitar/deshabilitar proveedores por sucursal
- Ticket formatting para incluir referencia del proveedor

### Out of Scope
- SDK nativo de Clip (Bluetooth BLE) — primera fase es manual reference; SDK es Phase 15
- Webhooks backend — el backend hace polling/validación; el frontend solo presenta estado
- Refunds UI — feature futuro separado
- MercadoPago Point (terminal físico) — solo QR en esta fase
- Manejo de chargebacks

---

## 3. Análisis del Estado Actual

### 3.1 Order Model (`core/models/order.model.ts`)

**PaymentMethod enum (línea 5):**
```
Cash = 'Cash', Card = 'Card', Transfer = 'Transfer', Other = 'Other'
```
— Necesita extensión para `Clip` y `MercadoPagoQR`.

**OrderPayment interface (línea 13):**
```
{ id?, method, amountCents, reference? }
```
— Mínima. No tiene: `providerId`, `externalTransactionId`, `status`, `authorizedAt`.

**Order interface (línea 54):**
- `paymentProvider: string | null` — existe pero hardcoded `null`
- `externalReference?: string` — existe pero nunca se popula

**PAYMENT_METHOD_OPTIONS (línea 30):**
4 opciones fijas (Cash, Card, Transfer, Other) — no diferencia entre "Card genérica" y "Card vía Clip".

### 3.2 Checkout Component (`checkout.component.ts`)

**Payment collection flow:**
1. `openAddPayment(method)` → abre dialog con monto pre-llenado
2. `confirmAddPayment()` → crea `OrderPayment` simple, push a `pendingPayments`
3. `confirmPayment()` → ensambla `Order` con `payments: pendingPayments()`, `paymentProvider: null`

**No hay:**
- Comunicación con APIs de proveedores
- UI de "esperando terminal" o "escaneando QR"
- Estado de transacción por pago individual
- Distinción entre proveedores de tarjeta

### 3.3 SyncService (`sync.service.ts`)

**`mapOrderToDto()` (línea 431):**
```
payments: (order.payments ?? []).map(p => ({
  method: p.method,
  amountCents: p.amountCents,
  reference: p.reference ?? null,
}))
```
— Solo serializa 3 campos. No envía `providerId`, `externalTransactionId`, `status`.

### 3.4 AppConfig (`app-config.model.ts`)

No contiene flags de payment providers. Sin `hasClip`, `hasMercadoPago`.

### 3.5 Environment files

No contienen API keys ni URLs de proveedores. Toda la config debería venir del backend vía `/branch/{id}/config`.

---

## 4. Architecture

### 4.1 Provider Architecture — Adapter Pattern

```
┌────────────────────────────────────────────────────────────────┐
│  checkout.component                                            │
│                                                                │
│  "Agregar pago" tap                                            │
│       │                                                        │
│       ▼                                                        │
│  ┌─────────────────────────────────────────┐                   │
│  │  PaymentProviderService (Orchestrator)  │                   │
│  │                                         │                   │
│  │  resolveProvider(method) → adapter      │                   │
│  │  processPayment(adapter, amount)        │                   │
│  │  checkStatus(adapter, txId) → polling   │                   │
│  └─────────┬──────────────┬────────────────┘                   │
│            │              │                                    │
│     ┌──────▼──────┐ ┌────▼────────────┐                       │
│     │ ClipAdapter │ │ MercadoPagoAdapter│                      │
│     │             │ │                  │                       │
│     │ Manual ref  │ │ Generate QR      │                       │
│     │ entry       │ │ Poll status      │                       │
│     │ (Phase 14)  │ │ Handle timeout   │                       │
│     │             │ │                  │                       │
│     │ BLE SDK     │ │ Webhook-driven   │                       │
│     │ (Phase 15)  │ │ (backend)        │                       │
│     └─────────────┘ └──────────────────┘                       │
│                                                                │
│  ┌───────────────────────────────────────────┐                 │
│  │  PaymentProcessingDialog (p-dialog)       │                 │
│  │                                           │                 │
│  │  State: Idle → Processing → Success/Error │                 │
│  │                                           │                 │
│  │  Clip:         Spinner + "Esperando       │                 │
│  │                terminal..." + ref input   │                 │
│  │                                           │                 │
│  │  MercadoPago:  QR image + "Esperando      │                 │
│  │                escaneo..." + polling       │                 │
│  │                                           │                 │
│  │  Success:      ✓ icon + "Pago aprobado"   │                 │
│  │  Error:        ✗ icon + "Pago rechazado"  │                 │
│  └───────────────────────────────────────────┘                 │
└────────────────────────────────────────────────────────────────┘
```

### 4.2 Payment State Machine

```
                    ┌──────────┐
                    │  Idle    │
                    └────┬─────┘
                         │ user selects payment method
                         ▼
              ┌────────────────────┐
              │  MethodSelected    │
              │  (open dialog)     │
              └────────┬───────────┘
                       │ user enters amount + confirms
                       ▼
            ┌──────────────────────┐
            │  Processing          │
            │                      │
            │  Cash:     instant   │──── skip → Approved
            │  Transfer: instant   │──── skip → Approved
            │  Clip:     wait ref  │──── user inputs ref → Approved
            │  MP QR:    polling   │──── poll API → Approved/Declined/Timeout
            └──────┬───────┬───────┘
                   │       │
          ┌────────▼┐  ┌───▼──────┐
          │Approved │  │ Declined │
          │         │  │          │
          │ → add   │  │ → show   │
          │   to    │  │   error  │
          │ pending │  │ → retry  │
          │ payments│  │   or     │
          │         │  │   cancel │
          └─────────┘  └──────────┘
```

### 4.3 Signal Dependency Graph

```
AppConfig
  └── paymentProviders: Signal<PaymentProviderConfig[]>  (NEW, from branch config)
        │
        ├──► checkout: paymentOptions computed
        │     (filters PAYMENT_METHOD_OPTIONS by enabled providers)
        │
        └──► PaymentProviderService: available adapters

PaymentProviderService
  ├── activeTransaction: Signal<PaymentTransaction | null>
  │     │
  │     ├──► PaymentProcessingDialog: shows state
  │     └──► checkout: blocks confirm until resolved
  │
  └── transactionResult: Signal<TransactionResult | null>
        │
        └──► checkout: enriches OrderPayment with provider data

checkout.pendingPayments: Signal<OrderPayment[]>
  │
  ├──► totalPaidCents, remainingCents, changeCents (existing computed chain)
  └──► canConfirm (existing, plus check for no 'pending' transactions)
```

---

## 5. New & Modified Interfaces

### 5.1 Extended `PaymentMethod` Enum

**Archivo:** `src/app/core/models/order.model.ts`

**Nuevos valores en el enum:**

| Valor | Descripción |
|-------|-------------|
| `Clip` | Pago vía terminal Clip (tarjeta) |
| `MercadoPagoQR` | Pago vía escaneo de QR MercadoPago |

Los valores existentes (`Cash`, `Card`, `Transfer`, `Other`) se mantienen. `Card` sigue representando una tarjeta genérica sin proveedor específico.

### 5.2 Extended `OrderPayment` Interface

**Archivo:** `src/app/core/models/order.model.ts`

**Nuevos campos:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `providerId` | `string \| undefined` | Identificador del proveedor: `'clip'`, `'mercadopago'`, `undefined` para cash/transfer |
| `externalTransactionId` | `string \| undefined` | ID de la transacción en el sistema del proveedor |
| `transactionStatus` | `'approved' \| 'pending' \| 'declined' \| undefined` | Estado de la transacción. `undefined` para cash/transfer (siempre aprobados implícitamente) |
| `authorizedAt` | `Date \| undefined` | Timestamp de la autorización del proveedor |

**Compatibilidad:** Todos los campos nuevos son opcionales. Órdenes existentes sin estos campos siguen funcionando.

### 5.3 Extended `PAYMENT_METHOD_OPTIONS`

**Archivo:** `src/app/core/models/order.model.ts`

**Nuevas opciones (se agregan condicionalmente según config):**

| Method | Label | Icon | requiresProvider |
|--------|-------|------|------------------|
| `Clip` | `Clip` | `pi-credit-card` | `true` |
| `MercadoPagoQR` | `MercadoPago` | `pi-qrcode` | `true` |

**Nuevo campo `requiresProvider`** en `PaymentMethodOption`: `boolean` — indica si el método necesita procesamiento async vía proveedor. `Cash` y `Transfer` no lo necesitan.

### 5.4 New `PaymentProviderConfig` Interface

**Archivo:** `src/app/core/models/app-config.model.ts` (agregar)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `provider` | `'clip' \| 'mercadopago'` | Identificador del proveedor |
| `isActive` | `boolean` | Habilitado para esta sucursal |
| `terminalId` | `string \| undefined` | ID de terminal Clip (si aplica) |
| `merchantId` | `string \| undefined` | ID de comercio MercadoPago (si aplica) |

Este se carga como parte del `AppConfig` existente — el backend ya tiene el endpoint `/branch/{id}/config` y solo se necesita agregar estos campos.

### 5.5 New `PaymentTransaction` Interface

**Archivo:** `src/app/core/models/payment.model.ts` (NUEVO)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | `string` | UUID local (crypto.randomUUID) |
| `provider` | `'clip' \| 'mercadopago'` | Proveedor ejecutando la transacción |
| `method` | `PaymentMethod` | Método original seleccionado |
| `amountCents` | `number` | Monto a cobrar |
| `status` | `'idle' \| 'processing' \| 'approved' \| 'declined' \| 'timeout' \| 'cancelled'` | Estado actual |
| `externalTransactionId` | `string \| undefined` | ID del proveedor (se popula al iniciar) |
| `qrCodeData` | `string \| undefined` | Data para generar QR (solo MercadoPago) |
| `reference` | `string \| undefined` | Referencia manual (Clip terminal) |
| `startedAt` | `Date` | Inicio de la transacción |
| `resolvedAt` | `Date \| undefined` | Momento de resolución |
| `errorMessage` | `string \| undefined` | Mensaje de error si fue rechazado |

---

## 6. New Services

### 6.1 `PaymentProviderService` (Orchestrator)

**Archivo:** `src/app/core/services/payment-provider.service.ts` (NUEVO)

**Tipo:** `providedIn: 'root'`, singleton

**Signals:**

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `activeTransaction` | `WritableSignal<PaymentTransaction \| null>` | Transacción en progreso (solo una a la vez) |
| `enabledProviders` | `Signal<PaymentProviderConfig[]>` | Proveedores habilitados (derivado de AppConfig) |
| `hasClip` | `Signal<boolean>` | Computed: algún provider activo es `'clip'` |
| `hasMercadoPago` | `Signal<boolean>` | Computed: algún provider activo es `'mercadopago'` |

**Métodos:**

| Método | Params | Returns | Descripción |
|--------|--------|---------|-------------|
| `getAvailableOptions` | — | `PaymentMethodOption[]` | Retorna las opciones base (Cash, Transfer, Other) + las opciones de proveedor según config |
| `requiresProcessing` | `method: PaymentMethod` | `boolean` | `true` para Clip y MercadoPagoQR; `false` para Cash/Transfer/Card/Other |
| `startTransaction` | `method: PaymentMethod, amountCents: number` | `Promise<PaymentTransaction>` | Crea transacción, llama al adapter correspondiente, setea `activeTransaction` |
| `confirmClipReference` | `reference: string` | `Promise<void>` | Confirma la referencia manual de Clip → marca `approved` |
| `pollMercadoPagoStatus` | — | `Promise<void>` | Poll al API para verificar pago de QR → actualiza `activeTransaction` |
| `cancelTransaction` | — | `void` | Cancela la transacción activa → status `'cancelled'`, limpia signal |
| `resolveTransaction` | — | `OrderPayment` | Convierte la transacción resuelta a `OrderPayment` para agregar a `pendingPayments` |

**Lógica de `startTransaction`:**

1. Validar que no haya transacción activa (guard)
2. Crear `PaymentTransaction` con status `'processing'`
3. Setear `activeTransaction` signal
4. Según el provider:
   - **Clip:** POST al backend `/payments/clip/create` con `{ amountCents, terminalId }`. Backend inicia la transacción en Clip API y retorna `{ externalTransactionId }`. Frontend queda en estado "Esperando terminal — ingresa referencia".
   - **MercadoPago:** POST al backend `/payments/mercadopago/qr` con `{ amountCents, merchantId }`. Backend genera el QR vía API de MercadoPago y retorna `{ externalTransactionId, qrCodeData }`. Frontend muestra QR e inicia polling.
5. Actualizar `activeTransaction` con datos del backend

**Lógica de polling (MercadoPago):**

1. Cada 3 segundos, GET `/payments/mercadopago/{transactionId}/status`
2. Si status es `'approved'` → actualizar transaction, detener polling
3. Si status es `'declined'` → actualizar transaction, detener polling
4. Después de 120 segundos sin resolución → timeout
5. El polling se ejecuta con `setInterval` limpiado en `cancelTransaction` o resolución

### 6.2 `ClipPaymentAdapter`

**No es un servicio Angular separado** — es lógica interna del `PaymentProviderService`. En Phase 14, Clip es "semi-manual":

1. El cajero selecciona "Clip" como método
2. El monto se envía al backend que crea la transacción en Clip
3. El cajero procesa la tarjeta en la terminal física Clip
4. El cajero ingresa la referencia/últimos 4 dígitos en el modal
5. Se marca como `approved`

**Phase 15 (futuro):** SDK Bluetooth de Clip para comunicación directa desde la PWA.

### 6.3 `MercadoPagoPaymentAdapter`

También lógica interna del `PaymentProviderService`:

1. El cajero selecciona "MercadoPago" como método
2. El backend genera un QR dinámico vía API de MercadoPago
3. El frontend muestra el QR en el modal
4. El cliente escanea con su app de MercadoPago
5. El frontend hace polling al backend cada 3s
6. El backend consulta la API de MercadoPago por el status
7. Cuando se aprueba, el frontend actualiza el estado

---

## 7. New Components

### 7.1 `PaymentProcessingDialogComponent` (NUEVO)

**Ubicación:** `src/app/modules/pos/components/payment-processing-dialog/`

**Tipo:** Standalone, importado por `checkout.component`

**Selector:** `app-payment-processing-dialog`

**Inputs/Outputs:**

| Nombre | Tipo | Dirección | Descripción |
|--------|------|-----------|-------------|
| `visible` | `model<boolean>` | Two-way | Controla apertura/cierre del dialog |
| `transaction` | `input<PaymentTransaction \| null>` | Input | La transacción activa a mostrar |
| `paymentConfirmed` | `output<OrderPayment>` | Output | Emite cuando el pago fue exitoso y debe agregarse a pendingPayments |
| `paymentCancelled` | `output<void>` | Output | Emite cuando el usuario cancela |

**Internal Signals:**

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `clipReference` | `WritableSignal<string>` | Input de referencia para Clip |
| `elapsedSeconds` | `WritableSignal<number>` | Segundos transcurridos (para timeout visual) |
| `pollingActive` | `WritableSignal<boolean>` | True mientras se hace polling a MP |

**Template Structure — State Machine Visual:**

```
p-dialog [modal, no draggable, no close-on-escape while processing]
│
├── STATUS: 'processing' + provider === 'clip'
│   ┌─────────────────────────────────────────┐
│   │  ┌───────┐                              │
│   │  │  💳   │  Procesando con Clip         │
│   │  └───────┘                              │
│   │                                         │
│   │  Monto: $150.00                         │
│   │                                         │
│   │  ┌─────────────────────────────────┐    │
│   │  │ Referencia / últimos 4 dígitos  │    │
│   │  └─────────────────────────────────┘    │
│   │                                         │
│   │  [Cancelar]          [Confirmar pago]   │
│   └─────────────────────────────────────────┘
│
├── STATUS: 'processing' + provider === 'mercadopago'
│   ┌─────────────────────────────────────────┐
│   │                                         │
│   │  ┌─────────────────┐                    │
│   │  │                 │                    │
│   │  │   [QR CODE]     │                    │
│   │  │                 │                    │
│   │  └─────────────────┘                    │
│   │                                         │
│   │  Escanea con MercadoPago                │
│   │  Monto: $150.00                         │
│   │                                         │
│   │  ◔ Esperando escaneo... (45s)           │
│   │  ━━━━━━━━━━░░░░░░░░  progress bar       │
│   │                                         │
│   │  [Cancelar]                             │
│   └─────────────────────────────────────────┘
│
├── STATUS: 'approved'
│   ┌─────────────────────────────────────────┐
│   │          ┌───┐                          │
│   │          │ ✓ │  Pago aprobado           │
│   │          └───┘                          │
│   │                                         │
│   │  $150.00 — Clip ref. 4532              │
│   │                                         │
│   │              [Continuar]                │
│   └─────────────────────────────────────────┘
│
├── STATUS: 'declined'
│   ┌─────────────────────────────────────────┐
│   │          ┌───┐                          │
│   │          │ ✗ │  Pago rechazado          │
│   │          └───┘                          │
│   │                                         │
│   │  "Fondos insuficientes"                 │
│   │                                         │
│   │  [Cancelar]          [Reintentar]       │
│   └─────────────────────────────────────────┘
│
└── STATUS: 'timeout'
    ┌─────────────────────────────────────────┐
    │          ┌───┐                          │
    │          │ ⏱ │  Tiempo expirado         │
    │          └───┘                          │
    │                                         │
    │  No se recibió confirmación             │
    │                                         │
    │  [Cancelar]          [Reintentar]       │
    └─────────────────────────────────────────┘
```

**Dialog Specs:**
- `p-dialog`: `[modal]="true"`, `[draggable]="false"`, `[closable]="false"` (while processing), `[style]="{ width: '420px' }"`, `borderRadius: 16px`
- QR image: 200×200px, centered, `border-radius: 12px`, white bg padding 16px
- Progress bar: linear, 120s timeout, PrimeFlex `border-radius: 8px`, height 6px
- Success icon: 64×64px circle, `background: #F0FDF4`, `color: #16A34A`
- Error icon: 64×64px circle, `background: #FEF2F2`, `color: #DC2626`
- Timeout icon: 64×64px circle, `background: #FFF7ED`, `color: #D97706`

**Touch targets:**
- Buttons: min 48px height, 16px font
- Reference input: 48px height, centered, large font (20px) for easy finger entry

---

## 8. Modifications to Existing Components

### 8.1 `checkout.component.ts`

**Nuevas dependencias:** `PaymentProviderService`

**Nuevos signals:**

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `showProcessingDialog` | `WritableSignal<boolean>` | Controla visibilidad del PaymentProcessingDialog |
| `paymentOptions` | `Signal<PaymentMethodOption[]>` | Computed: opciones disponibles según config del branch |

**`paymentOptions` computed logic:**
1. Leer `PaymentProviderService.getAvailableOptions()`
2. Esto retorna las 4 opciones base + Clip/MercadoPago si están habilitados

**Cambio en `openAddPayment(method)`:**

1. Si `PaymentProviderService.requiresProcessing(method)` es `false` → flujo actual (dialog simple con monto + referencia)
2. Si es `true` → nuevo flujo:
   - Calcular `amountCents` desde `remainingCents()`
   - Llamar `paymentProviderService.startTransaction(method, amountCents)`
   - Abrir `showProcessingDialog.set(true)`
   - Esperar resultado vía output del dialog

**Cambio en template — Payment Method Buttons:**

Reemplazar `paymentMethodOptions` estático por `paymentOptions()` computed. Cada botón puede tener un estilo diferenciado:
- Cash/Transfer/Other: icono estándar PrimeNG
- Clip: icono custom o badge "Terminal"
- MercadoPago: icono QR o logo brand

**Nuevo handler `onPaymentConfirmed(payment: OrderPayment)`:**
1. Agregar a `pendingPayments`
2. Cerrar processing dialog

**Nuevo handler `onPaymentCancelled()`:**
1. Llamar `paymentProviderService.cancelTransaction()`
2. Cerrar processing dialog

**Cambio en `confirmPayment()`:**
- Al construir el Order, setear `paymentProvider` si algún payment tiene `providerId`:
  - Si todos los pagos son del mismo proveedor → `paymentProvider = ese providerId`
  - Si hay mezcla → `paymentProvider = 'mixed'`
  - Si ninguno tiene proveedor → `paymentProvider = null` (current behavior)

### 8.2 `checkout.component.html`

**Cambio en sección de botones de pago:**

Reemplazar el `@for` actual de `paymentMethodOptions` por `paymentOptions()`:
- Agregar conditional styling para proveedores (badge, brand color)
- Clip button: borde con accent color del brand Clip (`#00D4AA`)
- MercadoPago button: borde con brand color MP (`#009EE3`)

**Agregar `<app-payment-processing-dialog>` al final del template:**
- `[(visible)]="showProcessingDialog"`
- `[transaction]="paymentProviderService.activeTransaction()"`
- `(paymentConfirmed)="onPaymentConfirmed($event)"`
- `(paymentCancelled)="onPaymentCancelled()"`

### 8.3 `SyncService.mapOrderToDto()`

**Cambio en serialización de payments:**

Agregar los nuevos campos al mapper de cada payment:

| Campo actual | Campo nuevo |
|---|---|
| `method` | sin cambio |
| `amountCents` | sin cambio |
| `reference` | sin cambio |
| — | `providerId: p.providerId ?? null` |
| — | `externalTransactionId: p.externalTransactionId ?? null` |
| — | `transactionStatus: p.transactionStatus ?? null` |
| — | `authorizedAt: p.authorizedAt ?? null` |

### 8.4 `SyncService.mapPullDto()`

Extraer los nuevos campos del DTO remoto al mapear payments:

```
payments: (dto.payments ?? []).map(p => ({
  ...existing fields...,
  providerId: p.providerId ?? undefined,
  externalTransactionId: p.externalTransactionId ?? undefined,
  transactionStatus: p.transactionStatus ?? undefined,
  authorizedAt: p.authorizedAt ? new Date(p.authorizedAt) : undefined,
}))
```

### 8.5 `AppConfig` / `ConfigService`

**Agregar a `AppConfig`:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `paymentProviders` | `PaymentProviderConfig[]` | Array de proveedores configurados para este branch |

**Agregar a `BranchConfigResponse` (en `config.service.ts`):**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `paymentProviders` | `PaymentProviderConfig[]` | Del endpoint `/branch/{id}/config` |

**Agregar signal a `ConfigService`:**

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `paymentProviders` | `Signal<PaymentProviderConfig[]>` | Proveedores de pago del branch |

### 8.6 `PrintService.getTicketHtml()`

**Cambio:** Cuando un payment tiene `providerId`, incluir en el ticket:
- Label del proveedor (e.g., "Clip", "MercadoPago")
- Referencia o transaction ID truncado
- Ejemplo: `"Clip •••4532 | $150.00"` en lugar de `"Tarjeta | $150.00"`

---

## 9. Checkout UI Layout — Enhanced Payment Section

### 9.1 Current Layout (Single Column Scroll)

```
┌─────────────────────────────────────┐
│ ← Cancelar    Cobrar orden   Mesa 3 │
├─────────────────────────────────────┤
│ Order Summary (items list)          │
│ Discount toggle                     │
│ Totals (subtotal, discount, total)  │
│ ─────────────────────────────────── │
│ Forma de pago                       │
│ [Dividir cuenta]                    │
│ [Efectivo][Tarjeta][Transf.][Otro]  │
│ Pending payments list               │
│ Payment summary                     │
├─────────────────────────────────────┤
│ [✓ Confirmar pago]                  │
└─────────────────────────────────────┘
```

### 9.2 Proposed Layout (Enhanced with Providers)

Se mantiene la estructura single-column (optimizada para tablets/touch) pero los botones de pago se reorganizan visualmente:

```
┌─────────────────────────────────────────────┐
│ ← Cancelar    Cobrar orden          Mesa 3  │
├─────────────────────────────────────────────┤
│ Order Summary (items list, compact)         │
│ Totals + Discount                           │
│ ────────────────────────────────────────── │
│                                             │
│ FORMA DE PAGO              Falta: $150.00  │
│                                             │
│ ┌──── Efectivo ────┐ ┌──── Tarjeta ────┐   │
│ │  💵              │ │  💳             │   │
│ │  Efectivo        │ │  Tarjeta        │   │
│ └──────────────────┘ └─────────────────┘   │
│                                             │
│ ┌──── Proveedores digitales ─────────────┐  │
│ │                                        │  │
│ │ ┌── Clip ──────┐ ┌── MercadoPago ──┐  │  │
│ │ │  💳 Terminal │ │  📱 QR Code    │  │  │
│ │ └──────────────┘ └────────────────┘  │  │
│ │                                        │  │
│ └────────────────────────────────────────┘  │
│                                             │
│ ┌──── Otros ──────┐ ┌── Dividir ────────┐  │
│ │  Transferencia  │ │  % Dividir cuenta │  │
│ └─────────────────┘ └──────────────────┘   │
│                                             │
│ ┌─ Pagos registrados ─────────────────────┐ │
│ │ Efectivo          $100.00           ✕   │ │
│ │ Clip •••4532      $50.00            ✕   │ │
│ ├─────────────────────────────────────────┤ │
│ │ Total             $150.00               │ │
│ │ Pagado            $150.00               │ │
│ │ Vuelto            $0.00                 │ │
│ └─────────────────────────────────────────┘ │
│                                             │
├─────────────────────────────────────────────┤
│ [✓ Confirmar pago]                          │
└─────────────────────────────────────────────┘
```

**Decisión: No 3-column layout.** El checkout actual es single-column optimizado para tablets touch (7"–10"). Un layout de 3 columnas requeriría pantallas >14" y complicaría la UX touch. El layout propuesto agrupa los métodos de pago en categorías visuales claras con un grid de 2 columnas responsive.

### 9.3 Payment Method Button Specs

**Standard methods (Cash, Card, Transfer, Other):**
- Min size: 140×64px
- `border-radius: 12px`
- `border: 2px solid $color-border-soft`
- `background: white`
- Icon: 24px, `color: $color-text-title`
- Label: 14px, weight 600
- Hover: `border-color: $color-primary`, `background: $color-primary-light`

**Provider methods (Clip, MercadoPago):**
- Same base dimensions
- Clip: `border-left: 3px solid #00D4AA` (Clip brand green)
- MercadoPago: `border-left: 3px solid #009EE3` (MP brand blue)
- Badge "Terminal" or "QR" in top-right corner, 10px font, pill-shaped

**Grid layout:**
- CSS Grid: `grid-template-columns: repeat(2, 1fr)`, `gap: 12px`
- Provider section: subtle background (`#F8FAFC`), `border-radius: 12px`, `padding: 12px`
- Section labels: 12px, weight 500, `color: $color-text-sub`, uppercase, `letter-spacing: 0.05em`

---

## 10. Optimistic Payment — Dexie Strategy

### 10.1 Flow

```
1. User completes payment via provider (Clip/MercadoPago)
   → PaymentProcessingDialog shows "Aprobado"

2. Payment added to pendingPayments signal
   → OrderPayment includes: method, amountCents, providerId,
     externalTransactionId, transactionStatus: 'approved'

3. User confirms order (Confirmar pago)
   → Order assembled with full payments array
   → Saved to Dexie with syncStatus: 'Pending'
   → Order includes paymentProvider field

4. SyncService syncs to backend
   → Backend receives externalTransactionId
   → Backend validates against Clip/MercadoPago API
   → If valid: marks synced
   → If invalid: returns 422 → order marked Failed for retry

5. If offline:
   → Order stays in Dexie with 'Pending'
   → On reconnect, SyncService retries
   → Backend validates transaction (may be stale but still valid in provider's system)
```

### 10.2 Key Principle

El pago se registra **optimísticamente** en el momento que el proveedor confirma (paso 1-2), no cuando el backend lo valida (paso 4). Esto permite que el cajero continúe atendiendo clientes sin esperar al sync. El backend es la fuente de verdad final pero no bloquea la operación.

---

## 11. Edge Cases & Error Matrix

| Escenario | Detección | Comportamiento |
|-----------|-----------|----------------|
| MercadoPago QR timeout (120s sin escaneo) | Timer expira | Mostrar estado "Tiempo expirado" → Reintentar o Cancelar |
| Clip terminal offline | Backend retorna error al crear transacción | Toast error: "Terminal no disponible" → usar Card genérica |
| QR escaneado pero pago rechazado (fondos) | Polling retorna 'declined' | Mostrar "Pago rechazado — Fondos insuficientes" → Reintentar o Cancelar |
| Cajero cancela mientras polling activo | User toca Cancelar | Detener polling, cancelar transacción en backend, cerrar dialog |
| Internet se cae durante polling de MP | Polling falla | Mostrar "Sin conexión — verificando..." → retry automático al reconectar |
| Dos pagos del mismo proveedor en una orden | Split payment con 2x Clip | Cada pago tiene su propio `externalTransactionId` — no hay conflicto |
| Branch no tiene Clip/MP configurado | `paymentProviders` vacío o sin el provider | Botones de Clip/MP no aparecen → solo métodos base |
| Backend rechaza transactionId en sync | 422 en POST /orders/sync | SyncService marca Failed → retry. La orden local sigue válida |

---

## 12. Backend Dependencies

| Endpoint | Método | Descripción | Prioridad |
|----------|--------|-------------|-----------|
| `GET /branch/{id}/config` | GET | Incluir `paymentProviders[]` en la respuesta | Obligatorio |
| `POST /payments/clip/create` | POST | Inicia transacción en Clip. Body: `{ amountCents, terminalId }`. Retorna: `{ externalTransactionId }` | Obligatorio |
| `POST /payments/mercadopago/qr` | POST | Genera QR dinámico. Body: `{ amountCents, merchantId }`. Retorna: `{ externalTransactionId, qrCodeData }` | Obligatorio |
| `GET /payments/mercadopago/{txId}/status` | GET | Retorna status actual: `{ status: 'pending'\|'approved'\|'declined' }` | Obligatorio |
| `POST /orders/sync` | POST | Aceptar nuevos campos en payment DTO: `providerId`, `externalTransactionId`, `transactionStatus`, `authorizedAt` | Obligatorio |
| `GET /orders/pull` | GET | Incluir nuevos campos de payment en respuesta | Recomendado |

---

## 13. Files Summary

### New Files (3)

| Archivo | Tipo | Propósito |
|---------|------|-----------|
| `src/app/core/models/payment.model.ts` | Interfaces | `PaymentTransaction`, `PaymentProviderConfig`, `TransactionStatus` |
| `src/app/core/services/payment-provider.service.ts` | Service (singleton) | Orquesta Clip/MercadoPago adapters, manages activeTransaction signal |
| `src/app/modules/pos/components/payment-processing-dialog/` | Standalone component (TS+HTML+SCSS) | Modal con estado de transacción, QR display, Clip reference input |

### Modified Files (6)

| Archivo | Cambio |
|---------|--------|
| `src/app/core/models/order.model.ts` | Extend `PaymentMethod` enum, `OrderPayment` interface, `PaymentMethodOption`, `PAYMENT_METHOD_OPTIONS` |
| `src/app/core/models/app-config.model.ts` | Add `paymentProviders: PaymentProviderConfig[]` to `AppConfig` |
| `src/app/core/services/config.service.ts` | Add `paymentProviders` signal, parse from branch config response |
| `src/app/modules/pos/components/checkout/checkout.component.ts` | Inject `PaymentProviderService`, add `paymentOptions` computed, handle provider flow |
| `src/app/modules/pos/components/checkout/checkout.component.html` | Replace static options with `paymentOptions()`, add `<app-payment-processing-dialog>`, provider badges |
| `src/app/core/services/sync.service.ts` | Extend `mapOrderToDto()` and `mapPullDto()` with payment provider fields |

### Optionally Modified (1)

| Archivo | Cambio |
|---------|--------|
| `src/app/core/services/print.service.ts` | Enhance ticket formatting for provider payments |

---

## 14. Testing Strategy

### `PaymentProviderService`
- `getAvailableOptions()`: Retorna opciones correctas según config (con/sin Clip, con/sin MP)
- `startTransaction(Clip, 15000)`: Crea transacción, llama API, setea activeTransaction
- `startTransaction(MercadoPagoQR, 15000)`: Crea transacción con qrCodeData
- `confirmClipReference('4532')`: Marca approved, popula reference
- `pollMercadoPagoStatus()`: Actualiza status según respuesta del API
- `cancelTransaction()`: Limpia activeTransaction, status cancelled

### `PaymentProcessingDialog`
- Clip flow: Muestra input de referencia → confirma → emite paymentConfirmed
- MercadoPago flow: Muestra QR → polling → aprobado → emite paymentConfirmed
- Declined: Muestra error → retry o cancel
- Timeout: Muestra timeout → retry o cancel

### `checkout.component`
- Provider-aware options: Solo muestra Clip/MP si están habilitados
- `openAddPayment(Clip)`: Abre processing dialog en vez de amount dialog
- `onPaymentConfirmed`: Agrega a pendingPayments con provider fields
- `confirmPayment()`: Order incluye `paymentProvider` correcto
- Split con provider: Cada split puede usar diferente provider

### `SyncService`
- `mapOrderToDto()`: Serializa nuevos campos de payment (providerId, externalTransactionId, etc.)
- `mapPullDto()`: Deserializa nuevos campos de payment del API
