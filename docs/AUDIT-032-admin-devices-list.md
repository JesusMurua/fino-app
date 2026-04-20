# AUDIT-032 — Back Office Device List UI

**Tipo:** Análisis puro (sin modificaciones)
**Branch:** `fix/pos-to-admin-routing-auth`
**Fecha:** 2026-04-20
**Scope:** Sección "Dispositivos vinculados" en el Back Office (lista de equipos administrables).

---

## 1. Archivos inspeccionados

| Artefacto | Ubicación |
|---|---|
| Component | [admin-devices.component.ts](../src/app/modules/admin/components/devices/admin-devices.component.ts) |
| Template  | [admin-devices.component.html](../src/app/modules/admin/components/devices/admin-devices.component.html) |
| Service   | [device.service.ts](../src/app/core/services/device.service.ts) |
| Model file | [device-config.model.ts](../src/app/core/models/device-config.model.ts) (único archivo; no existe `device.model.ts`) |

---

## 2. Respuestas a las cuatro preguntas

### 2.1 ¿Cómo se representa la lista de dispositivos hoy?

**No existe tabla — es un placeholder textual estático.**

En [admin-devices.component.html:96-121](../src/app/modules/admin/components/devices/admin-devices.component.html#L96-L121):

```html
<section class="settings-card">
  <div class="settings-card-header">
    <div class="card-icon"><i class="pi pi-tablet"></i></div>
    <div>
      <div class="card-title">Dispositivos vinculados</div>
      <div class="card-subtitle">...</div>
    </div>
  </div>

  <div class="devices-empty">
    <i class="pi pi-tablet devices-empty__icon"></i>
    <p class="devices-empty__title">Listado en camino</p>
    <p class="devices-empty__text">...</p>
    <span class="devices-empty__badge">
      <i class="pi pi-clock"></i> Próximamente
    </span>
  </div>
</section>
```

- **Sin `p-table`**, sin `tbody`, sin `@for`.
- El componente importa `TableModule` ([admin-devices.component.ts:7](../src/app/modules/admin/components/devices/admin-devices.component.ts#L7) y en `imports[]`), pero no lo usa — queda colgado del build anterior.
- Copy teaser menciona futuras capacidades ("estado en tiempo real, revocar accesos y renombrarlos") sin markup asociado.

### 2.2 ¿Qué columnas están preparadas?

**Ninguna.** No hay `<p-table>`, no hay `<ng-template pTemplate="header">`, no hay array de column defs en el `.ts`. La sección es 100 % placeholder. Para listar devices habría que crear desde cero:

- Cabeceras (Nombre · Sucursal · Modo · Estado · Última actividad · Acciones).
- Template de columna por cada una.
- Signal/señal reactiva con el array.

El componente tampoco tiene un `readonly devices = signal<Device[]>([])` ni nada equivalente — no hay estado para poblar. Solo existen los campos del generador de código y el signal `branches`.

### 2.3 ¿`device.service.ts` tiene HTTP para listar devices?

**No.** Revisando [device.service.ts](../src/app/core/services/device.service.ts) en su totalidad, los únicos métodos HTTP son:

| Método | Endpoint | Propósito |
|---|---|---|
| `registerDevice(branchId, mode, name)` | `POST /devices/register` | Alta desde el terminal |
| `validateDevice()` | `GET /devices/validate/{uuid}` | Auto-recovery del propio dispositivo |
| `sendHeartbeat()` (privado) | `PUT /devices/heartbeat/{uuid}` | Ping cada 5 min (solo el device en curso) |

**Faltantes críticos:**
- No hay `getAll()` / `list()` / `fetchDevices()` para `GET /api/devices`.
- No existe interfaz `Device` pública — solo los privados `DeviceRegisterResponse` y `DeviceValidateResponse` en el propio service, que describen payloads individuales.
- No hay archivo `src/app/core/models/device.model.ts` — solo `device-config.model.ts`, que modela la config local del device-in-use (no la vista admin de todos los devices).
- No hay endpoints para `DELETE /devices/{id}` (revocar), `PATCH /devices/{id}` (renombrar), ni `POST /devices/{id}/revoke`.

### 2.4 ¿Qué acciones por fila están planeadas?

**Ninguna implementada.** En el template no hay botones, menús contextuales ni columna de acciones. La copia en `.devices-empty__text` menciona como futuras:

1. **Revocar acceso** (implicaría backend `DELETE /devices/{id}` o `POST /devices/{id}/revoke`).
2. **Renombrar** (implicaría `PATCH /devices/{id}` con `{ name }`).
3. **Estado en tiempo real** (visualizar Online/Offline derivado de `lastSeenAt`).

Ninguna de las tres tiene handler, método en el service, tipo de datos ni UI. Son solo promesas en copy.

### 2.5 Bonus — ¿Cómo piensan mostrar Online/Offline?

**No hay lógica implementada para derivar el estado** porque no hay lista que lo requiera. Lo que sí existe server-side-friendly es el heartbeat: cada device hace `PUT /devices/heartbeat/{uuid}` cada 5 min ([device.service.ts:200-208](../src/app/core/services/device.service.ts#L200-L208)), así que el backend tiene un `lastSeenAt` que alimentaría el cálculo.

Cuando se construya la vista, el patrón esperable sería:

```
isOnline = (now - lastSeenAt) < (HEARTBEAT_INTERVAL_MS * 2) // 10 min grace
```

Pero **ni el tipo `Device` ni el cálculo existen hoy** — son parte del trabajo pendiente que el placeholder enuncia.

---

## 3. Resumen ejecutivo

| Dimensión | Estado |
|---|---|
| Tabla HTML | Placeholder estático (`.devices-empty`); sin `p-table` |
| Columnas preparadas | Ninguna |
| Service: método list | Inexistente |
| Modelo `Device` | Inexistente (solo `DeviceConfig` local) |
| Endpoints backend consumidos | `register`, `validate`, `heartbeat` — ninguno de lista/gestión |
| Acciones por fila | Ninguna (copy tease: revocar, renombrar) |
| Online/Offline | Sin cálculo; solo heartbeat server-side alimenta `lastSeenAt` |

**Conclusión:** La sección de lista de dispositivos es 100 % greenfield. No hay deuda técnica que re-trabajar — sólo trabajo nuevo. El scope de implementación mínima cubre: modelo `Device`, método `DeviceService.getAll()`, tabla PrimeNG con 6 columnas (Nombre, Sucursal, Modo, Estado, Última actividad, Acciones), y dos endpoints backend (`GET /devices`, `DELETE` o `PATCH /devices/{id}`).

Sin modificaciones a archivos. Documento cerrado.
