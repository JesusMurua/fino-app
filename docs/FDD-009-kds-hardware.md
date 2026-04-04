# FDD-009 — KDS Hardware Integration & ESC/POS Native Printing (Phase 20)

**Fecha:** 2026-04-04
**Estado:** Borrador — Pendiente aprobación
**Fase Angular:** 18 (Signals-first)
**Continuación de:** FDD-008 (Phase 19 — Printing Destinations UI)
**Objetivo:** Cero deuda técnica en impresión. Eliminar todos los stubs `window.print()` del flujo multi-destino y mejorar el KDS para consumir un backend `PrintJobController`.

---

## 1. Contexto y Estado Actual (Phase 19)

### 1.1 Lo que Phase 19 entregó (no rediseñar)

| Artefacto | Archivo | Estado |
|-----------|---------|--------|
| `PrinterConnectionType` | `core/models/printer.model.ts` | ✅ `'none' \| 'usb' \| 'network' \| 'bluetooth'` |
| `PrinterDestination` model | `core/models/printer.model.ts` | ✅ Completo — id, name, connectionType, address, isDefault |
| `PrinterDestinationService` | `core/services/printer-destination.service.ts` | ✅ CRUD Dexie + signal reactivo |
| `PrintService.printOrder()` | `core/services/print.service.ts:363` | ✅ Orquestador multi-destino funcional |
| `PrintService.groupItemsByDestination()` | `core/services/print.service.ts:391` | ✅ Agrupa `CartItem[]` por `productingDestinationId` |
| `PrinterService` (ESC/POS físico) | `core/services/printer.service.ts` | ✅ Serial + Bluetooth, un transport activo |
| `SerialTransport` | `core/services/serial-transport.ts` | ✅ Web Serial API |
| `BluetoothTransport` | `core/services/bluetooth-transport.ts` | ✅ Web Bluetooth API |
| `KitchenDisplayComponent` | `modules/kitchen/kitchen-display.component.ts` | ✅ Funcional — ver auditoría §3 |
| `KitchenService` | `core/services/kitchen.service.ts` | ✅ Polling Dexie, markAsReady() |

### 1.2 La deuda técnica exacta (objetivo de Phase 20)

**En `PrintService.dispatchDestinationKitchenTicket()` (línea 406):**

```typescript
case 'network':
  console.warn(`[PrintService] Network printing not yet implemented. ...`);
  break;
case 'usb':
  console.warn(`[PrintService] USB printing not yet implemented. ...`);
  break;
case 'bluetooth':
  console.warn(`[PrintService] Bluetooth printing not yet implemented. ...`);
  break;
```

**En `PrintService.dispatchDestinationReceipt()` (línea 431):**

```typescript
console.warn(`[PrintService] ${connectionType} receipt printing not yet implemented. Falling back to window.print().`);
this.openDestinationReceiptWindow(order); // sigue llamando window.print()
```

**¿Cómo se imprimía antes del stub?**

El método original `PrintService.printKitchenComanda()` (línea 74) usaba `PrinterService` directamente para imprimir ESC/POS cuando `hasThermalPrinter()` era `true`. Esto funcionaba para **una sola impresora física conectada localmente** vía Serial o Bluetooth. Phase 19 introdujo el modelo multi-destino (`printOrder()`) pero no conectó los nuevos `PrinterDestination` al driver ESC/POS — dejó stubs. El flujo real ESC/POS siempre existió; solo se desconectó en el nuevo orchestrator.

---

## 2. Arquitectura de Impresión Nativa (Phase 20)

### 2.1 El problema: un transport vs. múltiples destinos

`PrinterService` maneja **un** transport activo (campo `private transport`). Phase 20 necesita enviar ESC/POS a **múltiples impresoras** simultáneamente (Cocina + Barra + Caja = 3 destinos diferentes). La refactorización clave es extraer la gestión de transports a un registro indexado por `PrinterDestination.id`.

### 2.2 `PrinterTransportRegistry` — Nuevo servicio

**Archivo:** `src/app/core/services/printer-transport-registry.service.ts`

Responsabilidades:
- Mantiene un `Map<destinationId: number, PrinterTransport>`
- Provee `connect(destination: PrinterDestination): Promise<void>`
- Provee `getTransport(destinationId: number): PrinterTransport | null`
- Provee `disconnectAll(): Promise<void>`
- Persiste qué transports están activos en `DeviceConfig` (localStorage)

El `PrinterService` existente **no cambia** — sigue siendo el transport para la impresora principal/legacy.

### 2.3 Estrategia por `connectionType`

| Tipo | Mecanismo Web | Flujo |
|------|---------------|-------|
| `'none'` | `window.open()` + `window.print()` | Ya funcional (Phase 19) |
| `'bluetooth'` | Web Bluetooth API (`BluetoothTransport`) | Un `BluetoothTransport` por destino, vinculado por `bluetoothDeviceId` guardado en `PrinterDestination.address` |
| `'usb'` | Web Serial API (`SerialTransport`) | Un `SerialTransport` por destino, vinculado por `{vendorId, productId}` guardado en `PrinterDestination.address` en formato `vid:pid` |
| `'network'` | WebSocket → Local Print Bridge | Ver §2.4 — requiere proceso local |

### 2.4 Impresión por Red (IP:Puerto) — Local Print Bridge

Los navegadores **no pueden abrir sockets TCP raw**. Las impresoras de red ESC/POS usan el protocolo `RAW` en el puerto 9100 (estándar Star/Epson).

**Solución: Local Print Bridge ligero**

Un pequeño proceso Node.js (empaquetado como ejecutable `.exe` para Windows con `pkg` o `nexe`) que:
1. Escucha un WebSocket local en `ws://localhost:8765`
2. Acepta mensajes `{ destinationId, bytes: Uint8Array }`
3. Abre una conexión TCP a `destination.address` (ej. `192.168.1.100:9100`)
4. Envía los bytes ESC/POS
5. Cierra la conexión TCP

La Angular app se conecta a `ws://localhost:8765` y el Bridge redirige a la IP real.

**Diagrama:**
```
Angular (browser)
   │  WebSocket ws://localhost:8765
   ▼
Local Print Bridge (Node.js, máquina del cajero)
   │  TCP Raw Socket :9100
   ▼
Epson/Star/Bixolon (IP 192.168.1.100)
```

**Alternativa sin Bridge:** Si la impresora soporte WebUSB (algunos modelos Epson TM-T88VI), puede conectarse directamente vía `SerialTransport` en modo USB.

### 2.5 Modelo de configuración de destinos actualizado

Se agrega semántica al campo `address` de `PrinterDestination`:

| `connectionType` | `address` contiene | Ejemplo |
|------------------|--------------------|---------|
| `'none'` | `undefined` | — |
| `'network'` | `ip:puerto` | `"192.168.1.100:9100"` |
| `'bluetooth'` | `bluetoothDeviceId` (guardado tras parear) | `"00:11:22:33:44:55"` |
| `'usb'` | `vendorId:productId` hex | `"04b8:0202"` |

La UI de settings (FDD-008) **ya captura** `address` como string — compatible. Solo se necesita documentar la convención de formato.

### 2.6 Flujo completo actualizado de `dispatchDestinationKitchenTicket()`

```
dispatchDestinationKitchenTicket(items, destination, context)
  ├── connectionType === 'none'     → openDestinationKitchenPrintWindow()  [ya funciona]
  ├── connectionType === 'bluetooth'
  │     → registry.getTransport(destination.id) ?? registry.connect(destination)
  │     → transport.write(buildKitchenComandaBytes(items, context))
  ├── connectionType === 'usb'
  │     → registry.getTransport(destination.id) ?? registry.connect(destination)
  │     → transport.write(buildKitchenComandaBytes(items, context))
  └── connectionType === 'network'
        → networkBridgeService.send(destination.address, buildKitchenComandaBytes(items, context))
```

La función `buildKitchenComandaBytes()` se extrae de `PrinterService.printKitchenComanda()` como una utilidad pura que devuelve `Uint8Array` sin asumir un transport específico.

---

## 3. Auditoría KDS Frontend

### 3.1 Componentes existentes

| Componente | Archivo | Responsabilidad |
|------------|---------|-----------------|
| `KitchenDisplayComponent` | `modules/kitchen/kitchen-display.component.ts` | Contenedor principal del KDS |
| `KitchenOrderCardComponent` | `modules/kitchen/kitchen-order-card.component.ts` | Tarjeta individual por orden |
| `KitchenService` | `core/services/kitchen.service.ts` | Estado reactivo + polling |
| Ruta `/kitchen` | `modules/kitchen/kitchen.routes.ts` | Lazy-loaded |

### 3.2 Lo que el KDS actual hace bien

- **Señal reactiva** `activeOrders = signal<Order[]>([])` — la template se actualiza sin suscripciones manuales
- **Polling cada 30 segundos** de Dexie (`KITCHEN_POLL_INTERVAL_MS = 30_000`)
- **Offline-first**: lee solo de Dexie local — funciona sin red
- **`markAsReady()`**: actualiza Dexie primero, luego hace API call best-effort (`PATCH /orders/:id/kitchen-status`)
- **Tarjeta completa**: número de orden, timer de elapsed, indicador de "vencida" (overdue), lista de ítems con size/extras/notas, botón "Listo" con fade-out de 3 segundos
- **Reloj en tiempo real**: `setInterval` cada segundo actualiza `now()` signal — timers siempre frescos
- **Filtro de branch**: solo órdenes del `branchId` activo

### 3.3 Limitaciones actuales (deuda para Phase 20)

| Limitación | Descripción |
|------------|-------------|
| **Sin filtro por área** | El header dice "Cocina" hardcodeado, pero muestra **todos** los ítems sin filtrar por `PrinterDestination`. Una Barra no puede tener su propia pantalla KDS. |
| **No consume `PrintJobController`** | El servicio solo lee Dexie (órdenes completas). No existe un concepto de `PrintJob` — no sabe si el ticket fue impreso o está en cola. |
| **`kitchenStatus` limitado** | Solo filtra `'Pending'`. No hay estado `'Preparing'` visible (la cocina no puede marcar "en preparación"). |
| **Sin filtro de ítems por destino** | La tarjeta muestra TODOS los ítems de la orden, aunque el KDS de Barra solo debería ver sus propios ítems. |
| **Polling** | Si llegan 20 órdenes en 1 minuto, el KDS las ve hasta el siguiente ciclo de 30s. No hay SSE/WebSocket push. |

---

## 4. Diseño `PrintJobController` — Backend (Phase 20)

### 4.1 Concepto de `PrintJob`

Un `PrintJob` representa **un ticket pendiente de impresión** (o ya impreso) para un destino específico. Se crea cuando se completa una orden y se agrupa por destino — no por orden completa.

**Modelo:**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | `Guid` | PK |
| `orderId` | `Guid` | FK a `Order` |
| `orderNumber` | `int` | Desnormalizado para display rápido |
| `destinationId` | `int` | FK a `PrinterDestination` |
| `destinationName` | `string` | Desnormalizado |
| `status` | `enum` | `Pending` \| `Printed` \| `Failed` |
| `ticketType` | `enum` | `Kitchen` \| `Receipt` |
| `itemsJson` | `string` | Ítems filtrados por destino (JSON) |
| `tableLabel` | `string?` | Mesa/área |
| `createdAt` | `DateTime` | Momento de creación |
| `printedAt` | `DateTime?` | Cuando se marcó como impreso |

### 4.2 Endpoints diseñados

```
GET  /api/print-jobs/pending?destinationId={id}
     → PrintJobDto[]  (solo status=Pending, hoy, del branch activo)

PATCH /api/print-jobs/{id}/status
     Body: { "status": "Printed" }
     → 204 No Content

POST /api/print-jobs/batch
     Body: { orderId, destinations: [{ destinationId, items, ticketType }] }
     → PrintJobDto[]  (crea todos los jobs de una orden en una sola llamada)
```

### 4.3 Cuándo se crean los `PrintJob`

En `PrintService.printOrder()`, **después** de despachar cada kitchen ticket, se registra el `PrintJob` en el backend (best-effort):

```
printOrder(order)
  ├── groupItemsByDestination(order.items)
  ├── Para cada destino:
  │     ├── dispatchDestinationKitchenTicket()  [ESC/POS real o window.print()]
  │     └── api.post('/print-jobs/batch', { orderId, ... })  [best-effort]
  └── dispatchDestinationReceipt()
```

Si el device está offline, los `PrintJob` se guardan en Dexie como `pendingPrintJobs` y se sincronizan al recuperar conexión (mismo patrón que `Order`).

---

## 5. Integración KDS ↔ `PrintJobController`

### 5.1 Nuevo modo de operación del KDS

El KDS pasa de "mostrar órdenes" a "mostrar print jobs pendientes". La diferencia es crítica:

- **Modo actual (Dexie/Order):** Muestra la orden completa con todos sus ítems → cocina ve ítems de barra y viceversa.
- **Modo nuevo (PrintJob):** Muestra solo los ítems que pertenecen al destino de este KDS → Cocina ve solo ítems de Cocina.

### 5.2 Cambios en `KitchenService`

```
KitchenService.start(destinationId?: number)
  ├── Si destinationId → modo PrintJob (consume /api/print-jobs/pending?destinationId=X)
  └── Si no → modo legacy (lee Dexie, compatibilidad hacia atrás)
```

Nuevo método:
- `loadPendingPrintJobs(destinationId: number): Promise<void>` — consulta API, fallback a Dexie local
- `markAsPrinted(printJobId: string): Promise<void>` — `PATCH /print-jobs/:id/status { status: Printed }`

### 5.3 Cambios en `KitchenDisplayComponent`

**Nuevo parámetro de ruta:** `/kitchen/:destinationId`

```typescript
// kitchen.routes.ts
{ path: ':destinationId', component: KitchenDisplayComponent }
{ path: '', component: KitchenDisplayComponent }  // legacy, muestra todos
```

Los cambios en la UI son mínimos:
1. El header muestra `destination.name` en lugar del "Cocina" hardcodeado
2. La lista viene de `PrintJob.itemsJson` en lugar de `Order.items` completo
3. El botón "Listo" llama `markAsPrinted(printJob.id)` en lugar de `markAsReady(order.id)`
4. La tarjeta muestra el `ticketType` (Kitchen vs Receipt) con un badge

### 5.4 Pantalla de selección de área

Nueva ruta `/kitchen` (sin destinationId) muestra una pantalla de selección:

```
┌─────────────────────────────────────────┐
│  ¿Cuál es tu área?                      │
│                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Cocina  │  │  Barra  │  │  Caja   │ │
│  │   🍳    │  │   🍹    │  │   🧾    │ │
│  └─────────┘  └─────────┘  └─────────┘ │
└─────────────────────────────────────────┘
```

Navega a `/kitchen/1`, `/kitchen/2`, etc. según el destino seleccionado. Los destinos se cargan de `PrinterDestinationService`.

---

## 6. Plan de Implementación (Fases)

### Phase 20a — ESC/POS multi-destino

1. Extraer `buildKitchenComandaBytes()` como función pura en `printer.utils.ts`
2. Crear `PrinterTransportRegistry` service
3. Adaptar `dispatchDestinationKitchenTicket()` para `'bluetooth'` y `'usb'`
4. Diseñar e implementar `LocalPrintBridgeService` para `'network'`
5. Adaptar `dispatchDestinationReceipt()` para eliminar el fallback a `window.print()`

### Phase 20b — Backend PrintJobController

1. `PrintJob` entity + migration EF Core
2. `IPrintJobRepository` + `PrintJobRepository`
3. `PrintJobService` (crear batch, listar pending, marcar printed)
4. `PrintJobController` con los 3 endpoints de §4.2
5. Autorización: solo el branch activo ve sus propios jobs

### Phase 20c — KDS multi-área

1. `KitchenService` — agregar modo PrintJob
2. `KitchenDisplayComponent` — leer `destinationId` de ruta
3. Pantalla de selección de área
4. Actualizar rutas en `kitchen.routes.ts`
5. Ajustar `KitchenOrderCardComponent` para renderizar `PrintJob` (no `Order`)

---

## 7. Constraints y Decisiones de Arquitectura

| Decisión | Razón |
|----------|-------|
| Local Print Bridge como ejecutable separado | Los navegadores no permiten sockets TCP raw. El Bridge es la única vía para red sin instalar drivers del sistema. |
| `PrinterTransportRegistry` separado de `PrinterService` | `PrinterService` es para la impresora principal/legacy. El registro multi-destino es un concern diferente. |
| Los `PrintJob` en Dexie como `pendingPrintJobs` | Homogéneo con el patrón existente de `Order`. Garantiza offline-first. |
| Ruta `/kitchen/:destinationId` opcional | Compatibilidad hacia atrás. Instalaciones sin multi-área siguen funcionando sin cambios. |
| `buildKitchenComandaBytes()` como función pura | Testeable sin transport. Reutilizable por Serial, BT, Bridge, y tests. |
| No SSE/WebSocket en Phase 20 | El polling de 30s es suficiente para el MVP. Push se prioriza en Phase 21+ si el feedback lo justifica. |

---

## 8. Archivos Afectados

### Frontend

| Archivo | Acción |
|---------|--------|
| `core/services/print.service.ts` | Modificar `dispatchDestinationKitchenTicket()` y `dispatchDestinationReceipt()` — eliminar stubs |
| `core/services/printer-transport-registry.service.ts` | **Nuevo** — registro de transports por destinationId |
| `core/services/local-print-bridge.service.ts` | **Nuevo** — WebSocket client para el bridge de red |
| `core/utils/printer.utils.ts` | **Nuevo** — `buildKitchenComandaBytes()` y `buildReceiptBytes()` como funciones puras |
| `core/services/kitchen.service.ts` | Agregar modo PrintJob, nuevo método `loadPendingPrintJobs()` |
| `modules/kitchen/kitchen-display.component.ts` | Leer `destinationId` de ruta, cambiar título dinámico |
| `modules/kitchen/kitchen-display.component.html` | Selector de área, badge de ticketType |
| `modules/kitchen/kitchen.routes.ts` | Agregar ruta `':destinationId'` |
| `core/models/print-job.model.ts` | **Nuevo** — interfaces `PrintJob`, `PrintJobDto` |
| `core/services/database.service.ts` | Agregar tabla Dexie `pendingPrintJobs` |

### Backend (.NET 9)

| Archivo | Acción |
|---------|--------|
| `Models/PrintJob.cs` | **Nuevo** — entidad EF Core |
| `Repositories/IPrintJobRepository.cs` | **Nuevo** |
| `Repositories/PrintJobRepository.cs` | **Nuevo** |
| `Services/IPrintJobService.cs` | **Nuevo** |
| `Services/PrintJobService.cs` | **Nuevo** |
| `Controllers/PrintJobController.cs` | **Nuevo** — 3 endpoints |
| `Data/Migrations/` | **Nueva migración** — tabla `PrintJobs` |

### Infraestructura

| Artefacto | Acción |
|-----------|--------|
| `tools/print-bridge/` | **Nuevo** — proyecto Node.js del Local Print Bridge |
| `tools/print-bridge/README.md` | Instrucciones de instalación para el usuario del negocio |

---

## 9. Criterios de Aceptación

- [ ] Un destino con `connectionType = 'bluetooth'` imprime ESC/POS al conectar la impresora bluetooth desde Configuración
- [ ] Un destino con `connectionType = 'network'` envía bytes al Local Print Bridge, que los reenvía a la IP:Puerto configurada
- [ ] El KDS en `/kitchen/1` muestra solo los ítems del destino "Cocina" (no ítems de Barra)
- [ ] El KDS en `/kitchen/2` muestra solo los ítems del destino "Barra"
- [ ] El botón "Listo" en el KDS llama `PATCH /print-jobs/:id/status` y elimina el job de la vista
- [ ] Si el API está offline, el KDS sigue mostrando jobs desde Dexie y los sincroniza al reconectar
- [ ] El header del KDS muestra el nombre del destino seleccionado, no "Cocina" hardcodeado
- [ ] `window.print()` y `window.open()` solo se usan cuando `connectionType === 'none'`
- [ ] `buildKitchenComandaBytes()` y `buildReceiptBytes()` tienen tests unitarios sin mocks de transport
