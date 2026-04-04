# Frontend Design Document: Invoicing UI & Customer Fiscal Data

## FDD-004 — Customer Fiscal Data Capture & Auto-Factura Flow

**Fecha:** 2026-04-03
**Autor:** Documento generado por análisis de arquitectura
**Estado:** Draft — pendiente de confirmación

---

## 1. Feature Overview

**Objetivo:** Permitir a cajeros capturar datos fiscales del cliente (RFC, Razón Social, Régimen, Uso CFDI, Email, C.P.) durante o después del checkout, y ofrecer un flujo de "auto-factura" donde el cliente puede facturar por su cuenta vía un QR/URL impreso en el ticket.

**Problema actual:** No existe ninguna infraestructura de facturación. El `Order` no tiene campos de cliente fiscal. No hay servicio de invoicing. El ticket no imprime QR ni URL de auto-factura. La CFDI aparece como feature en el plan Pro pero sin implementación real (`admin-settings.component.ts:203` — solo label de marketing).

**Solución:** Un sistema de facturación en dos capas:
1. **Facturación inmediata (cajero):** Modal en el paso "confirmed" del checkout para capturar datos fiscales → enviar al backend para timbrado CFDI → mostrar resultado.
2. **Auto-factura (cliente):** QR/URL impreso en el ticket que lleva a un portal web donde el cliente ingresa sus datos fiscales y genera la factura por su cuenta.

---

## 2. Scope & Boundaries

### In Scope
- Interface `CustomerFiscalData` con campos SAT obligatorios
- Nuevo campo opcional `invoiceRequest` en la interfaz `Order`
- `CustomerFiscalModalComponent` — modal Dribbble-style con formulario reactivo
- `InvoicingService` — servicio signal-based para comunicación con backend
- Botón "Facturar" en el paso confirmed del checkout (post-pago)
- Auto-factura: URL/QR impreso al pie del ticket
- Feature flag `hasInvoicing` en `BusinessConfig` (controlado desde backend)
- Catálogos SAT: Régimen Fiscal y Uso CFDI como dropdowns con datos hardcoded (SAT no cambia frecuentemente)
- Mapeo del `invoiceRequest` en `SyncService.mapOrderToDto()`

### Out of Scope
- Timbrado CFDI real (eso es backend + PAC — Proveedor Autorizado de Certificación)
- Upload de certificados CSD (.cer/.key) — eso va en admin backend
- Cancelación de facturas CFDI
- Portal web de auto-factura (es una app separada, frontend solo genera la URL)
- Listado/historial de facturas emitidas
- Notas de crédito
- Complementos de pago CFDI

---

## 3. Análisis del Estado Actual

### 3.1 Order Model (`order.model.ts`)

**Campos relevantes existentes:**
- `id: string` — UUID, se usa como referencia para vincular la factura
- `orderNumber: number` — Folio del ticket (no confundir con folio fiscal)
- `totalCents: number` — Monto total para la factura
- `payments: OrderPayment[]` — Forma de pago (mapeable a catálogo SAT)
- `branchId: number` — Sucursal emisora

**Campos ausentes:**
- `invoiceRequest?: InvoiceRequest` — Datos fiscales del receptor + estado de la solicitud
- Sin `customerId`, `customerRfc`, ni `customerEmail`

### 3.2 Checkout Confirmed Step (`checkout.component.html:312-401`)

**Estructura actual post-pago:**
1. Icono de check + "Orden completada"
2. Detalle: número de orden, subtotal, descuento, total, método de pago, cambio
3. Botón "Ver ticket" (condicional, fallback sin impresora)
4. Sección de liberar mesa (si aplica)
5. Botón "Nueva orden" o "Volver a mesas"

**Punto de inserción:** Entre "Ver ticket" (línea 365) y "table-release" (línea 370). Ahí va el botón "Facturar".

### 3.3 Ticket HTML (`print.service.ts:89-190`)

**Formato:** 280px de ancho (80mm térmica), Courier New, inline styles.
**Footer actual:** `"¡Gracias por su visita!"` (línea 187).
**Punto de inserción para auto-factura:** Antes del footer, insertar bloque con URL y opcionalmente QR.

### 3.4 BusinessConfig (`business-config.model.ts`)

**Ausente:** No hay `hasInvoicing`, `businessRfc`, `businessLegalName`, ni ningún campo fiscal.

### 3.5 QR Code Library

**No instalada.** `package.json` no incluye `qrcode`, `ng-qrcode`, ni similar. Se necesitaría una dependencia para generar QR en el ticket.

**Decisión:** En lugar de agregar una librería QR al bundle, el auto-factura usará solo URL (texto plano en el ticket). El QR es opcional y se puede generar server-side como imagen en una fase posterior.

### 3.6 Catálogos SAT Relevantes

**Régimen Fiscal (c_RegimenFiscal)** — Los más comunes para receptores en México:

| Clave | Descripción |
|-------|-------------|
| 601 | General de Ley Personas Morales |
| 603 | Personas Morales con Fines no Lucrativos |
| 605 | Sueldos y Salarios |
| 606 | Arrendamiento |
| 612 | Personas Físicas con Actividades Empresariales y Profesionales |
| 616 | Sin obligaciones fiscales |
| 621 | Incorporación Fiscal |
| 625 | Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas |
| 626 | Régimen Simplificado de Confianza |

**Uso CFDI (c_UsoCFDI)** — Los más comunes para restaurantes:

| Clave | Descripción |
|-------|-------------|
| G01 | Adquisición de mercancías |
| G03 | Gastos en general |
| I04 | Equipo de computo y accesorios |
| P01 | Por definir |
| S01 | Sin efectos fiscales |

**Forma de Pago SAT (c_FormaPago)** — Mapeo desde PaymentMethod:

| PaymentMethod | SAT Clave | Descripción |
|---|---|---|
| Cash | 01 | Efectivo |
| Card | 04 | Tarjeta de crédito |
| Transfer | 03 | Transferencia electrónica de fondos |
| Clip | 04 | Tarjeta de crédito |
| MercadoPagoQR | 31 | Intermediario pagos |
| Other | 99 | Por definir |

---

## 4. Interfaces Nuevas

### 4.1 `CustomerFiscalData`

**Archivo:** `src/app/core/models/invoice.model.ts` (NUEVO)

| Campo | Tipo | Obligatorio | Validación | Descripción |
|-------|------|-------------|------------|-------------|
| `rfc` | `string` | Sí | 12-13 chars, regex SAT | RFC del receptor |
| `razonSocial` | `string` | Sí | min 1 char | Nombre o razón social |
| `regimenFiscal` | `string` | Sí | Catálogo SAT | Clave del régimen (e.g. "626") |
| `usoCfdi` | `string` | Sí | Catálogo SAT | Uso del CFDI (e.g. "G03") |
| `codigoPostal` | `string` | Sí | 5 dígitos | C.P. del domicilio fiscal |
| `email` | `string` | Sí | email format | Email para enviar la factura |

**Validación de RFC:**
- Personas Físicas: 13 caracteres (4 letras + 6 dígitos fecha + 3 homoclave)
- Personas Morales: 12 caracteres (3 letras + 6 dígitos fecha + 3 homoclave)
- Regex: `/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i`
- RFC genérico público general: `XAXX010101000`
- RFC genérico extranjeros: `XEXX010101000`

### 4.2 `InvoiceRequest`

**Archivo:** `src/app/core/models/invoice.model.ts`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `fiscalData` | `CustomerFiscalData` | Datos del receptor |
| `status` | `InvoiceRequestStatus` | Estado de la solicitud |
| `invoiceId` | `string \| undefined` | UUID de la factura generada (del backend) |
| `cfdiUuid` | `string \| undefined` | UUID fiscal CFDI (timbrado por PAC) |
| `requestedAt` | `Date` | Momento de la solicitud |
| `completedAt` | `Date \| undefined` | Momento del timbrado exitoso |
| `errorMessage` | `string \| undefined` | Mensaje de error si falló |

### 4.3 `InvoiceRequestStatus`

```
'pending' | 'processing' | 'completed' | 'failed'
```

- `pending` — Datos capturados, guardados en Dexie, aún no enviados al backend
- `processing` — Enviado al backend, esperando respuesta del PAC
- `completed` — CFDI timbrado exitosamente, `cfdiUuid` disponible
- `failed` — Error de timbrado (RFC inválido, datos inconsistentes, etc.)

### 4.4 SAT Catalog Types

**Archivo:** `src/app/core/models/invoice.model.ts`

```
RegimenFiscalOption: { clave: string; descripcion: string }
UsoCfdiOption: { clave: string; descripcion: string }
```

Constantes hardcoded `REGIMEN_FISCAL_OPTIONS` y `USO_CFDI_OPTIONS` con los valores más comunes (no se justifica una API call para catálogos que cambian una vez al año).

---

## 5. Cambios en el Modelo de Order

**Archivo:** `src/app/core/models/order.model.ts`

**Nuevo campo** (agregar después de `cashRegisterSessionId`):

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `invoiceRequest` | `InvoiceRequest \| undefined` | Datos fiscales + estado de la solicitud de factura |

**Sin cambio en Dexie schema** — es un campo no-indexado almacenado como parte del objeto Order.

---

## 6. Nuevo Servicio: `InvoicingService`

**Archivo:** `src/app/core/services/invoicing.service.ts` (NUEVO)

**Tipo:** `providedIn: 'root'`, singleton

### Signals

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `isSubmitting` | `WritableSignal<boolean>` | True mientras se envía la solicitud al backend |
| `lastResult` | `WritableSignal<InvoiceResult \| null>` | Resultado de la última solicitud (success/error) |

### Métodos

| Método | Params | Returns | Descripción |
|--------|--------|---------|-------------|
| `requestInvoice` | `orderId: string, fiscalData: CustomerFiscalData` | `Promise<InvoiceResult>` | Guarda localmente en Dexie + envía POST al backend |
| `getAutoFacturaUrl` | `orderId: string` | `string` | Construye la URL del portal de auto-factura |
| `mapPaymentMethodToSat` | `method: PaymentMethod` | `string` | Mapea PaymentMethod a clave SAT c_FormaPago |

### `InvoiceResult`

| Campo | Tipo |
|-------|------|
| `success` | `boolean` |
| `invoiceId` | `string \| undefined` |
| `cfdiUuid` | `string \| undefined` |
| `errorMessage` | `string \| undefined` |

### Lógica de `requestInvoice()`

1. Construir `InvoiceRequest` con status `'pending'`, `requestedAt: new Date()`
2. Actualizar la orden en Dexie: `db.orders.update(orderId, { invoiceRequest })`
3. POST al backend: `/invoices/create` con `{ orderId, ...fiscalData }`
4. Si éxito:
   - Actualizar status a `'completed'`, guardar `invoiceId` + `cfdiUuid`
   - Persistir en Dexie
   - Setear `lastResult` con success
5. Si error:
   - Actualizar status a `'failed'`, guardar `errorMessage`
   - Persistir en Dexie
   - Setear `lastResult` con error
   - La orden sigue siendo válida — la factura se puede reintentar

### Lógica de `getAutoFacturaUrl()`

```
{landingUrl}/factura?orderId={orderId}&branchId={branchId}
```

- `landingUrl` viene de `environment.landingUrl` (ya existe: `https://kaja.mx`)
- El portal web (out of scope) usará estos params para buscar la orden y presentar el formulario fiscal

---

## 7. Nuevo Componente: `CustomerFiscalModalComponent`

**Ubicación:** `src/app/shared/components/customer-fiscal-modal/`

**Tipo:** Standalone, importado por `checkout.component`

**Selector:** `app-customer-fiscal-modal`

### Inputs/Outputs

| Nombre | Tipo | Dirección | Descripción |
|--------|------|-----------|-------------|
| `visible` | `model<boolean>` | Two-way | Controla apertura/cierre del modal |
| `orderId` | `input.required<string>` | Input | ID de la orden a facturar |
| `totalCents` | `input<number>` | Input | Monto total (para mostrar en resumen) |
| `invoiceRequested` | `output<InvoiceRequest>` | Output | Emite cuando la factura fue solicitada exitosamente |

### Internal Signals

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `rfc` | `WritableSignal<string>` | Input RFC |
| `razonSocial` | `WritableSignal<string>` | Input Razón Social |
| `regimenFiscal` | `WritableSignal<string>` | Dropdown Régimen Fiscal |
| `usoCfdi` | `WritableSignal<string>` | Dropdown Uso CFDI |
| `codigoPostal` | `WritableSignal<string>` | Input C.P. |
| `email` | `WritableSignal<string>` | Input Email |
| `rfcValid` | `Signal<boolean>` | Computed: regex validation |
| `emailValid` | `Signal<boolean>` | Computed: email format |
| `cpValid` | `Signal<boolean>` | Computed: 5 dígitos |
| `canSubmit` | `Signal<boolean>` | Computed: todos los campos válidos + no submitting |
| `submitStatus` | `Signal<'idle' \| 'submitting' \| 'success' \| 'error'>` | Estado de la solicitud |
| `errorMessage` | `WritableSignal<string>` | Mensaje de error del backend |

### Template Layout

```
p-dialog [modal, 520px width, 16px radius]
│
├── HEADER: "Datos de facturación"
│
├── STATUS: 'idle' | 'error' (form visible)
│   ┌─────────────────────────────────────────────────────┐
│   │                                                      │
│   │  RFC *                                               │
│   │  ┌──────────────────────────────────────────────┐    │
│   │  │ XAXX010101000                                │    │
│   │  └──────────────────────────────────────────────┘    │
│   │  @if (!rfcValid() && rfc().length > 0)               │
│   │    RFC inválido — debe ser 12 o 13 caracteres        │
│   │                                                      │
│   │  Razón Social *                                      │
│   │  ┌──────────────────────────────────────────────┐    │
│   │  │ PÚBLICO EN GENERAL                           │    │
│   │  └──────────────────────────────────────────────┘    │
│   │                                                      │
│   │  ┌─── Régimen Fiscal ────┐  ┌─── Uso CFDI ────────┐ │
│   │  │  [v] 626 — RESICO     │  │  [v] G03 — Gastos   │ │
│   │  └───────────────────────┘  └──────────────────────┘ │
│   │                                                      │
│   │  ┌─── C.P. ────────────┐                            │
│   │  │ 83000               │                            │
│   │  └─────────────────────┘                            │
│   │                                                      │
│   │  Email *                                             │
│   │  ┌──────────────────────────────────────────────┐    │
│   │  │ cliente@email.com                            │    │
│   │  └──────────────────────────────────────────────┘    │
│   │                                                      │
│   │  @if (submitStatus() === 'error')                    │
│   │    ┌─ Error ──────────────────────────────────────┐  │
│   │    │ ⚠ RFC no registrado en el SAT               │  │
│   │    └──────────────────────────────────────────────┘  │
│   │                                                      │
│   └──────────────────────────────────────────────────────┘
│
├── STATUS: 'submitting'
│   ┌─────────────────────────────────────────────────────┐
│   │          ┌─────┐                                    │
│   │          │  ◔  │  Generando factura...              │
│   │          └─────┘                                    │
│   │          Monto: $150.00                             │
│   └─────────────────────────────────────────────────────┘
│
├── STATUS: 'success'
│   ┌─────────────────────────────────────────────────────┐
│   │          ┌───┐                                      │
│   │          │ ✓ │  Factura generada                    │
│   │          └───┘                                      │
│   │                                                     │
│   │  CFDI: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx         │
│   │  Se enviará a: cliente@email.com                    │
│   │                                                     │
│   │              [Cerrar]                               │
│   └─────────────────────────────────────────────────────┘
│
├── FOOTER (form states only):
│   [Cancelar]                        [Solicitar Factura]
└──
```

### Form Specs

- **RFC input:** uppercase auto-transform, max 13 chars, monospace font (20px)
- **Régimen Fiscal:** `p-dropdown` con `REGIMEN_FISCAL_OPTIONS`, filterable, placeholder "Selecciona régimen"
- **Uso CFDI:** `p-dropdown` con `USO_CFDI_OPTIONS`, filterable, placeholder "Selecciona uso"
- **C.P.:** numeric input, max 5 chars, pattern `\d{5}`
- **Email:** standard email input
- **All inputs:** min-height 48px (touch target), `border-radius: 12px`
- **Error messages:** 13px, `color: #DC2626`, below each field
- **Grid:** Régimen + Uso CFDI en 2 columnas (`grid-template-columns: 1fr 1fr`), resto full-width

### "Público en General" Shortcut

Un botón secondary debajo del campo RFC que pre-llena:
- RFC: `XAXX010101000`
- Razón Social: `PÚBLICO EN GENERAL`
- Régimen: `616` (Sin obligaciones fiscales)
- Uso CFDI: `S01` (Sin efectos fiscales)
- C.P.: el del negocio (si disponible)

Esto cubre el caso más común: cliente que pide factura genérica para deducir gastos.

---

## 8. Cambios en Componentes Existentes

### 8.1 `checkout.component.ts`

**Nueva dependencia:** `InvoicingService`

**Nuevos signals:**

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `showFiscalModal` | `WritableSignal<boolean>` | Controla visibilidad del modal fiscal |
| `canInvoice` | `Signal<boolean>` | Computed: `completedOrder() !== null && configService.hasInvoicing() && !completedOrder().invoiceRequest` |

**Nuevo método:**

| Método | Descripción |
|--------|-------------|
| `onRequestInvoice()` | Abre el modal fiscal: `showFiscalModal.set(true)` |
| `onInvoiceRequested(req: InvoiceRequest)` | Actualiza `completedOrder` con el `invoiceRequest`, cierra modal, muestra toast success |

### 8.2 `checkout.component.html`

**Inserción después de "Ver ticket" (línea 365):**

Nuevo botón "Facturar" visible cuando `canInvoice()` es true:
- Posición: entre el botón "Ver ticket" y la sección "table-release"
- Tipo: botón outlined, icon `pi-file-edit`, label "Facturar"
- Si `completedOrder()?.invoiceRequest?.status === 'completed'`: cambiar label a "Factura generada ✓" (disabled, success state)

Agregar `<app-customer-fiscal-modal>` al final del template con bindings.

### 8.3 `BusinessConfig` (`business-config.model.ts`)

**Nuevo campo:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `hasInvoicing` | `boolean` | Habilitado por branch (plan Pro/Enterprise) |

Default: `false` en `DEFAULT_BUSINESS_CONFIG`.

### 8.4 `ConfigService` (`config.service.ts`)

**Nuevo signal:**

| Signal | Tipo | Descripción |
|--------|------|-------------|
| `hasInvoicing` | `Signal<boolean>` | Computed desde config |

Parse `hasInvoicing` del response de `/branch/{id}/config` — mismo patrón que `hasKitchen`, `hasTables`, `hasDelivery`.

### 8.5 `SyncService` (`sync.service.ts`)

**`mapOrderToDto()`:** Agregar:
```
invoiceRequest: order.invoiceRequest ? {
  rfc: order.invoiceRequest.fiscalData.rfc,
  razonSocial: order.invoiceRequest.fiscalData.razonSocial,
  regimenFiscal: order.invoiceRequest.fiscalData.regimenFiscal,
  usoCfdi: order.invoiceRequest.fiscalData.usoCfdi,
  codigoPostal: order.invoiceRequest.fiscalData.codigoPostal,
  email: order.invoiceRequest.fiscalData.email,
  status: order.invoiceRequest.status,
  invoiceId: order.invoiceRequest.invoiceId ?? null,
  cfdiUuid: order.invoiceRequest.cfdiUuid ?? null,
} : null
```

**`mapPullDto()`:** Extraer `invoiceRequest` del DTO si presente.

### 8.6 `PrintService` (`print.service.ts`)

**Cambio en `getTicketHtml()`:**

Agregar bloque de auto-factura antes del footer "¡Gracias por su visita!" (línea 186-187):

```
@if (hasInvoicing) {
  ────────────────────
  Factura tu compra en:
  {autoFacturaUrl}
  ────────────────────
}
```

- `autoFacturaUrl` se construye como: `{landingUrl}/factura?order={orderId}&branch={branchId}`
- Texto plano (no QR) para Phase 1 — no requiere nueva dependencia
- El cajero puede dictar la URL o el cliente puede escanear con la cámara el texto

---

## 9. Auto-Factura Flow

### 9.1 Concepto

El ticket incluye una URL al pie que el cliente puede visitar para facturar su compra por cuenta propia, sin necesidad de pedirle al cajero que capture los datos fiscales.

### 9.2 Flow

```
1. Cajero completa la venta
2. Ticket se imprime con URL: kaja.mx/factura?order=abc-123&branch=1
3. Cliente escanea/visita la URL en su teléfono
4. Portal web (out of scope) muestra formulario fiscal
5. Cliente llena RFC, email, etc.
6. Portal llama al backend para generar CFDI
7. Cliente recibe la factura por email
```

### 9.3 Beneficios

- **Reduce fricción en caja:** El cajero no necesita capturar datos fiscales
- **Self-service:** El cliente lo hace cuando quiera, sin presión
- **Ventana de tiempo:** El negocio puede definir un límite (e.g., 72 horas) para auto-factura
- **Cero dependencia de QR lib:** URL en texto plano funciona en cualquier impresora

---

## 10. Flujos End-to-End

### 10.1 Facturación Inmediata (Cajero)

```
1. Cajero completa pago → paso "confirmed"
2. Ve botón "Facturar" (visible porque hasInvoicing = true)
3. Toca "Facturar" → se abre CustomerFiscalModal
4. Opción A: Toca "Público en General" → se pre-llenan campos genéricos
5. Opción B: Captura RFC, razón social, régimen, uso, C.P., email manualmente
6. Toca "Solicitar Factura"
   → InvoicingService.requestInvoice(orderId, fiscalData)
   → Dexie: order.invoiceRequest = { status: 'pending', ... }
   → POST /invoices/create { orderId, fiscalData }
   → Backend timbra con PAC
   → Si éxito: status = 'completed', cfdiUuid disponible
   → Si error: status = 'failed', errorMessage mostrado
7. Modal muestra resultado
8. Si success: botón "Facturar" cambia a "Factura generada ✓"
```

### 10.2 Auto-Factura (Cliente)

```
1. Cajero completa pago
2. Ticket se imprime con URL de auto-factura al pie
3. Cliente visita URL en su teléfono (hasta 72 horas después)
4. Portal web (app separada) presenta formulario fiscal
5. Cliente llena datos → portal llama backend
6. Backend timbra → envía factura por email al cliente
```

### 10.3 Offline Path

```
1. Cajero captura datos fiscales sin conexión
2. invoiceRequest se guarda en Dexie con status: 'pending'
3. Orden se sincroniza normalmente via SyncService
4. Backend recibe la orden con invoiceRequest
5. Backend timbra la factura como parte del procesamiento de la orden
6. En próximo pull, la orden se actualiza con cfdiUuid
```

---

## 11. Edge Cases & Error Matrix

| Escenario | Detección | Comportamiento |
|-----------|-----------|----------------|
| RFC inválido (formato incorrecto) | Regex validation en frontend | Campo se marca rojo, botón submit disabled |
| RFC no registrado en SAT | Backend retorna error del PAC | Modal muestra error "RFC no encontrado en el SAT" |
| Email no llega | Backend envía, delivery failure | No detectable en frontend — backend puede reintentar |
| Orden ya facturada | `completedOrder().invoiceRequest?.status === 'completed'` | Botón cambia a "Factura generada ✓", disabled |
| hasInvoicing = false | Plan Free/Basic | Botón "Facturar" no se renderiza |
| Backend offline al facturar | POST falla | invoiceRequest queda con status 'pending' en Dexie → retry manual posible |
| Doble-tap en "Solicitar Factura" | `isSubmitting` signal guard | Botón disabled mientras submitting |
| Cajero cierra modal antes de resultado | `visible.set(false)` | invoiceRequest ya guardada en Dexie con status 'pending', backend la procesará |

---

## 12. Design Tokens & UX Specs

### Modal Fiscal
- `p-dialog`: 520px width, 16px border-radius, modal, no draggable
- Inputs: 48px min-height, 12px border-radius
- RFC input: `text-transform: uppercase`, `font-family: monospace`, 20px font
- Dropdowns: `p-dropdown` con filtro, 48px height
- Error messages: 13px, #DC2626, `pi-exclamation-circle` icon
- "Público en General" shortcut: botón `severity="secondary"`, outlined, small size
- Submitting state: `p-progressSpinner` 48px + texto centrado
- Success state: 64px check icon circle (green), cfdiUuid en monospace

### Botón "Facturar" en Confirmed Step
- **Normal:** outlined, icon `pi-file-edit`, label "Facturar"
- **Completada:** solid green, icon `pi-check`, label "Factura generada", disabled
- **Min height:** 48px, full width, 12px border-radius
- **Color:** secondary/outline (no compete visualmente con "Nueva orden")

### Ticket Auto-Factura Block
- Courier New, 12px
- Separadores de guiones
- URL en texto plano
- Centrado

---

## 13. Backend Dependencies

| Endpoint | Método | Descripción | Prioridad |
|----------|--------|-------------|-----------|
| `GET /branch/{id}/config` | GET | Incluir `hasInvoicing: boolean` en respuesta | Obligatorio |
| `POST /invoices/create` | POST | Body: `{ orderId, rfc, razonSocial, regimenFiscal, usoCfdi, codigoPostal, email }`. Retorna: `{ invoiceId, cfdiUuid }` o error | Obligatorio |
| `POST /orders/sync` | POST | Aceptar `invoiceRequest` opcional en el DTO de orden | Recomendado |
| `GET /orders/pull` | GET | Incluir `invoiceRequest` en el DTO de respuesta | Recomendado |

---

## 14. Archivos a Crear/Modificar

### Archivos nuevos (3)

| Archivo | Tipo | Propósito |
|---------|------|-----------|
| `src/app/core/models/invoice.model.ts` | Interfaces | `CustomerFiscalData`, `InvoiceRequest`, `InvoiceRequestStatus`, `InvoiceResult`, catálogos SAT |
| `src/app/core/services/invoicing.service.ts` | Service (singleton) | Signal-based: `requestInvoice()`, `getAutoFacturaUrl()`, `mapPaymentMethodToSat()` |
| `src/app/shared/components/customer-fiscal-modal/` | Standalone component (TS+HTML+SCSS) | Formulario fiscal Dribbble-style con validación y estados |

### Archivos modificados (6)

| Archivo | Cambio |
|---------|--------|
| `src/app/core/models/order.model.ts` | Agregar `invoiceRequest?: InvoiceRequest` a Order interface |
| `src/app/core/models/business-config.model.ts` | Agregar `hasInvoicing: boolean` con default `false` |
| `src/app/core/models/index.ts` | Exportar `invoice.model.ts` |
| `src/app/core/services/config.service.ts` | Agregar signal `hasInvoicing`, parse de config |
| `src/app/modules/pos/components/checkout/checkout.component.ts` | Inyectar `InvoicingService`, signals `showFiscalModal`/`canInvoice`, handlers |
| `src/app/modules/pos/components/checkout/checkout.component.html` | Botón "Facturar" en confirmed step + `<app-customer-fiscal-modal>` |

### Opcionalmente modificados (2)

| Archivo | Cambio |
|---------|--------|
| `src/app/core/services/sync.service.ts` | Serializar/deserializar `invoiceRequest` en DTOs |
| `src/app/core/services/print.service.ts` | Agregar bloque auto-factura URL al ticket |

---

## 15. Testing Strategy

### `CustomerFiscalModalComponent`
- RFC validation: 12 chars (moral) y 13 chars (física) aceptados, <12 rechazado
- "Público en General": pre-llena todos los campos correctamente
- `canSubmit`: solo true cuando todos los campos son válidos
- Submit success: emite `invoiceRequested`, muestra estado success
- Submit error: muestra mensaje de error, permite reintentar

### `InvoicingService`
- `requestInvoice`: actualiza Dexie + POST al API
- `requestInvoice` offline: guarda en Dexie con status 'pending', no falla
- `getAutoFacturaUrl`: construye URL correcta con orderId y branchId
- `mapPaymentMethodToSat`: mapea correctamente todos los PaymentMethod

### `checkout.component`
- `canInvoice`: true solo cuando hay orden completada + hasInvoicing + no facturada
- Botón "Facturar": visible solo cuando `canInvoice()` true
- Post-factura: botón cambia a "Factura generada ✓"

### `PrintService`
- Ticket con auto-factura: URL aparece cuando `hasInvoicing` es true
- Ticket sin auto-factura: no aparece bloque cuando flag es false
