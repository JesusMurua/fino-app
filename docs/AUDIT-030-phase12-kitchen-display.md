# AUDIT-030 — Fase 12: Auditoría del Kitchen Display System (KDS)

**Fecha:** 2026-04-11
**Alcance:** [kitchen.service.ts](src/app/core/services/kitchen.service.ts), [kitchen-display.component.ts](src/app/modules/kitchen/kitchen-display.component.ts), [kitchen-order-card.component.ts](src/app/modules/kitchen/kitchen-order-card.component.ts) + `.html`, [print-job.model.ts](src/app/core/models/print-job.model.ts), [area-selector.component.ts](src/app/modules/kitchen/screens/area-selector/area-selector.component.ts), interacciones con [notification.service.ts](src/app/core/services/notification.service.ts) y [database.service.ts](src/app/core/services/database.service.ts).

**Observación arquitectónica importante antes de entrar al reporte:** El KDS en este proyecto **no consume órdenes directamente** — consume `PrintJobDto`. El backend crea un `PrintJob` por destino de impresión cuando una orden se completa; el KDS muestra esos print jobs. Esto significa que la UI no necesita conocer la jerarquía de `ProductModifierGroup` — el backend ya la aplana a `PrintJobItem.extras: string[]` antes de emitirla. Separación limpia, pero concentra toda la responsabilidad de presentación de modificadores en el serializer del backend (y eso es una dependencia invisible desde el frontend).

**Conclusión ejecutiva:** El KDS es **funcional pero frágil**. Tiene hallazgos en todos los cuadrantes:
- 🔴 **1 bug casi seguro**: `parseInt(id, 10)` sobre un UUID string genera URLs `NaN` — las transiciones de estado probablemente nunca llegan al backend y fallan silenciosamente al revert.
- 🔴 **1 gap de offline-first**: el KDS viola el principio declarado en `CLAUDE.md` — no puede avanzar estados sin red.
- 🟠 **3 bugs de resiliencia**: SignalR sin polling fallback real, sin feedback de estado de conexión, sin reconexión "para siempre".
- 🟡 **4 ítems de deuda técnica menor**: naming, dead code, CD thrash por `parsedItems` getter, `OnDestroy` en servicio root.

Detalle pregunta por pregunta abajo.

---

## 1. Resiliencia de red — ¿Qué pasa cuando SignalR muere?

### Comportamiento observado

**Conexión inicial** ([kitchen.service.ts:158-202](src/app/core/services/kitchen.service.ts#L158-L202)):
```ts
this.hubConnection = new HubConnectionBuilder()
  .withUrl(hubUrl, { accessTokenFactory: () => this.deviceService.getDeviceToken() ?? '' })
  .withAutomaticReconnect()
  .configureLogging(LogLevel.Warning)
  .build();
```

- ✅ `withAutomaticReconnect()` activa la política default de SignalR: intenta reconectar a 0ms, 2s, 10s, 30s, luego **abandona definitivamente**. No se pasa un array custom de delays.
- ✅ `onreconnected` ([kitchen.service.ts:191-195](src/app/core/services/kitchen.service.ts#L191-L195)) recarga los jobs después de reconectar — esto cubre el caso de eventos perdidos durante el gap.
- ❌ **`onclose` no está wired**. Cuando los 4 retries fallan, la conexión queda `Disconnected` sin que nada en el código lo detecte. El chef ve lo que tenía al momento del corte, para siempre.
- ❌ **`onreconnecting` tampoco**. No hay indicador en la UI de "estamos reintentando".
- ❌ El `catch` del `hubConnection.start()` inicial ([kitchen.service.ts:199-201](src/app/core/services/kitchen.service.ts#L199-L201)) solo hace `console.warn`. El usuario no sabe que arrancó sin real-time.

### ¿Hay polling fallback?

**No, a pesar del nombre.** El método se llama `startPolling(destinationId)` ([kitchen.service.ts:62-66](src/app/core/services/kitchen.service.ts#L62-L66)), pero hace UN solo `loadPendingPrintJobs()` y levanta SignalR. **Cero `setInterval`**. Si la hub se muere y no hay push notifications, no existe ningún mecanismo para refrescar los jobs hasta que el usuario recargue la página.

### Fallback vs Dexie

✅ `loadPendingPrintJobs` ([kitchen.service.ts:214-242](src/app/core/services/kitchen.service.ts#L214-L242)) sí cae elegantemente a Dexie cuando la llamada HTTP falla (offline o 500). El `pendingJobs` signal se alimenta de `this.db.pendingPrintJobs.where('destinationId').equals(...).toArray()`. Correcto.

### Caminos que refrescan después de que SignalR muere

Exhaustivamente:
1. **Push notification** vía `SwPush` → `notification.service.ts` → `kitchenService.refresh()` ([notification.service.ts:50](src/app/core/services/notification.service.ts#L50)). Solo funciona si push está habilitado Y el SW recibió el mensaje.
2. **Click en notificación** → mismo `refresh()` ([notification.service.ts:56](src/app/core/services/notification.service.ts#L56)).
3. **Page reload manual** por el usuario.

**No existe** un `setInterval` que recarge cada N segundos, ni un re-start de SignalR en `onclose`, ni un reintento con backoff después del default schedule.

### Veredicto

🟠 **Fragilidad alta en condiciones adversas**. En un entorno de cocina con WiFi inestable, el KDS puede quedar mostrando datos viejos sin que nadie lo note. No hay ni un `AlertHub disconnected` visible.

---

## 2. Estado de órdenes — ¿Pasa por la cola de sync offline?

### Transiciones

**Pending → InProgress** ([kitchen.service.ts:96-114](src/app/core/services/kitchen.service.ts#L96-L114)):
```ts
async markAsInProgress(id: string): Promise<void> {
  const snapshot = this.pendingJobs();
  this.pendingJobs.update(jobs => jobs.map(j => j.id === id ? { ...j, status: 'InProgress' } : j));
  await this.db.pendingPrintJobs.update(id, { status: 'InProgress' });

  try {
    const numericId = parseInt(id, 10);  // 👈 BUG potencial, ver 4.A
    await firstValueFrom(this.api.patch(`/print-jobs/${numericId}/in-progress`, {}));
  } catch {
    this.pendingJobs.set(snapshot);
    await this.db.pendingPrintJobs.update(id, { status: 'Pending' });
    this.showError('Could not update status — reverted to Pending.');
  }
}
```

Patrón: **optimistic UI + revert on error**, **NO offline queue**.

**InProgress → Printed** ([kitchen.service.ts:121-138](src/app/core/services/kitchen.service.ts#L121-L138)): mismo patrón con `/print-jobs/{id}/printed`.

### ¿Viola offline-first?

**Sí.** `CLAUDE.md` declara textualmente:
> All orders must work without internet. Flow: User action → IndexedDB → UI update → Background Sync Service → Backend API (when online). Never block the UI waiting for network.

El KDS **no tiene `SyncService`-equivalent para print jobs**. Si un chef marca "Listo" estando offline:
1. UI optimista muestra el cambio
2. Dexie local se actualiza
3. El `api.patch()` falla inmediatamente (sin red)
4. **Revert**: vuelve a `Pending`/`InProgress`, el chef ve un toast de error
5. El cambio **se pierde**

En una cocina real con un AP caído temporalmente, esto significa que el chef no puede operar el KDS hasta que vuelva la conexión. Contradice directamente el principio de la app.

**Lo correcto sería:** bajo offline, dejar el cambio persistido en Dexie con un flag `pendingSyncToBackend: true`, y que un background worker (similar a `SyncService.syncPendingOrders`) haga el patch cuando vuelva la red.

### Delay de 3 segundos en markDone

[kitchen-display.component.ts:86-99](src/app/modules/kitchen/kitchen-display.component.ts#L86-L99):
```ts
async onMarkDone(jobId: string): Promise<void> {
  this.fadingOut.update(s => { s.add(jobId); return new Set(s); });
  setTimeout(async () => {
    await this.kitchenService.markAsPrinted(jobId);
    this.fadingOut.update(s => { s.delete(jobId); return new Set(s); });
  }, 3000);
}
```

Hay una ventana de 3 segundos entre el click y el commit real. Si el chef navega fuera de la pantalla, cierra la tab, o pierde energía, el `setTimeout` nunca dispara y el patch nunca ocurre — la orden queda eternamente en `InProgress` en el backend, aunque visualmente "pasó" en el KDS.

---

## 3. Renderizado de modificadores — ¿El chef ve lo que necesita ver?

### Shape de datos

[print-job.model.ts:5-12](src/app/core/models/print-job.model.ts#L5-L12):
```ts
export interface PrintJobItem {
  id: string;
  quantity: number;
  productName: string;
  sizeLabel?: string;
  extras: string[];
  notes?: string;
}
```

**El backend aplana los modificadores.** La jerarquía `ProductModifierGroup` nunca llega al frontend del KDS. El frontend recibe un array de strings listos para mostrar.

### Renderizado

[kitchen-order-card.component.html:26-47](src/app/modules/kitchen/kitchen-order-card.component.html#L26-L47):
```html
<ul class="kds-card__items">
  @for (item of parsedItems; track item.id) {
    <li class="kds-card__item">
      <span class="kds-card__qty">{{ item.quantity }}×</span>
      <div class="kds-card__item-body">
        <span class="kds-card__name">{{ item.productName }}</span>
        @if (item.sizeLabel) {
          <span class="kds-card__meta">{{ item.sizeLabel }}</span>
        }
        @for (extra of item.extras; track $index) {
          <span class="kds-card__meta">+ {{ extra }}</span>
        }
        @if (item.notes) {
          <div class="kds-card__note">
            <i class="pi pi-comment"></i>
            {{ item.notes }}
          </div>
        }
      </div>
    </li>
  }
</ul>
```

✅ Tamaño renderizado si existe.
✅ Cada extra en su propia línea con `+` prefix — fácil de leer.
✅ Notas del cliente visibles con icono distintivo.
✅ Cantidad prominente a la izquierda.

### Limitaciones (no bugs)

- **No hay agrupación visual por grupo de modificadores.** Si un producto tiene un grupo "Proteína (obligatorio)" y otro "Salsas (hasta 3)", el chef ve todas las selecciones mezcladas en una lista plana. Para un taco con "carnitas + roja + verde" queda como tres líneas `+ Carnitas`, `+ Salsa roja`, `+ Salsa verde`, sin distinción de grupos. Para evitar errores, el backend podría prefijar con el nombre del grupo (`Proteína: Carnitas`) pero eso es trabajo de backend, fuera del scope frontend de esta auditoría.
- **No hay indicación de extras con precio 0 vs precio pagado.** El chef no lo necesita, pero potencialmente es ruido visual si hay muchos "gratis" mezclados con no-gratis.

### Hallazgo 3.A — `ticketType === 'Receipt'` llega al KDS

[kitchen-order-card.component.html:15](src/app/modules/kitchen/kitchen-order-card.component.html#L15):
```html
<span class="kds-card__type-badge">{{ job.ticketType === 'Receipt' ? 'Caja' : 'Cocina' }}</span>
```

¿Por qué el KDS renderiza tickets de tipo `Receipt`? Un receipt es un ticket de caja, no de cocina. El hecho de que el componente lo maneje sugiere que la query `/print-jobs/pending?destination={id}` devuelve **todos** los print jobs para esa destinación, sin filtrar por `ticketType`. Si un destino está mal configurado (ej. compartido entre caja y estación de cocina), los tickets de caja contaminan el KDS. Vale la pena filtrar en el servicio o pedir al backend que el endpoint KDS solo devuelva `Kitchen`.

**Severidad:** depende de la configuración de printer destinations real. Puede ser crítico si los destinos están compartidos; inocuo si no lo están.

---

## 4. Deuda técnica

### 🔴 4.A — `parseInt(id, 10)` sobre un UUID → NaN en la URL

[kitchen.service.ts:107](src/app/core/services/kitchen.service.ts#L107) y [kitchen.service.ts:129](src/app/core/services/kitchen.service.ts#L129):
```ts
const numericId = parseInt(id, 10);
await firstValueFrom(this.api.patch(`/print-jobs/${numericId}/in-progress`, {}));
```

**Problema:** `PrintJobDto.id` está declarado como `string` ([print-job.model.ts:22](src/app/core/models/print-job.model.ts#L22)), y todo el resto del código lo trata como un UUID:
- `parsedItems: PrintJobItem[]` se iteran con `track item.id` (string UUID)
- Dexie lo usa como clave primaria string
- El update/delete de Dexie usa el `id` directamente, no el parsed int

`parseInt("a1b2c3d4-...", 10)` devuelve `NaN` en la mayoría de los casos (si el UUID empieza con dígito, parsea el prefijo numérico y corta en el primer guion — ej. `parseInt("123abc-456", 10) === 123`). La URL resultante es `/print-jobs/NaN/in-progress` o `/print-jobs/123/in-progress` apuntando a un ID equivocado.

**Dos escenarios posibles:**

**Escenario A — ID es realmente numérico como string.** Si el backend genera IDs con auto-increment y los devuelve como strings (`"42"`), entonces `parseInt("42", 10) === 42` y el código funciona. En ese caso, la interfaz está mal tipada (debería ser `id: number` o al menos documentar que es un integer string) pero funciona en runtime.

**Escenario B — ID es UUID.** El código genera `NaN` URLs, el backend responde 400 o 404, el catch dispara el revert, el chef ve un toast "Could not update" **cada vez que intenta marcar algo**.

**Recomendación:** auditar el backend inmediatamente. Si es Escenario A, cambiar `PrintJobDto.id` a `number` y quitar el `parseInt`. Si es Escenario B, usar el `id` string directamente: `api.patch('/print-jobs/${id}/in-progress', {})`.

### 🟠 4.B — KDS viola offline-first (ver pregunta 2)

Las transiciones de estado no pasan por cola de sync. Candidato a crear un `PrintJobSyncService` análogo a `SyncService` existente, o añadir una tabla `pendingPrintJobUpdates` en Dexie que se drene cuando vuelva la red.

### 🟠 4.C — SignalR sin feedback visual de estado

No hay `hubState` signal expuesto por el servicio, no hay badge en el header tipo "Conectado / Reconectando / Desconectado". El usuario navega a ciegas.

**Recomendación:** añadir `hubState = signal<'connected' | 'reconnecting' | 'disconnected'>('disconnected')` en el servicio, wire `onreconnecting/onreconnected/onclose`, y mostrar un indicador en `kitchen-display.component.html`.

### 🟠 4.D — `startPolling` se llama polling pero no es polling

Naming misleading. Debería ser `start(destinationId)` o `subscribe(destinationId)`. El método es básicamente "load + wire real-time hub". Candidato a rename en el mismo PR que añada el fallback de polling real si se decide no depender exclusivamente de SignalR.

### 🟡 4.E — `parsedItems` getter parsea JSON en cada ciclo de CD

[kitchen-order-card.component.ts:33-40](src/app/modules/kitchen/kitchen-order-card.component.ts#L33-L40):
```ts
get parsedItems(): PrintJobItem[] {
  try {
    return JSON.parse(this.job.structuredContent) as PrintJobItem[];
  } catch {
    return [];
  }
}
```

Como el `now` signal del parent se actualiza cada segundo, **todos** los cards hacen CD cada segundo, y cada card llama `parsedItems` (usado en el template en `@for`). Para 20 cards activos, son **20 JSON.parse/segundo** generando nuevos objetos cada vez. El `track item.id` mitiga el re-render pero no el parsing.

**Recomendación:** convertir a `computed()` o a un campo calculado una sola vez en el setter del `@Input('job')`. Alternativamente, mover a `OnPush` + `@Input({ transform: ... })`.

### 🟡 4.F — `destinationName` muestra "KDS" hasta que llega el primer job

[kitchen-display.component.ts:35-37](src/app/modules/kitchen/kitchen-display.component.ts#L35-L37):
```ts
readonly destinationName = computed(
  () => this.pendingJobs()[0]?.destinationName ?? 'KDS',
);
```

El destinationId **ya se conoce desde la ruta** — el componente podría haber cargado el nombre vía `printerDestinationService.activeDestinations()` y mostrarlo inmediatamente. Tal como está, cuando el KDS arranca sin órdenes pendientes (estado 99% del tiempo fuera de hora pico), muestra un genérico "KDS" en lugar de "Cocina caliente" / "Barra". UX menor pero notorio.

### 🟡 4.G — `OnDestroy` en servicio `providedIn: 'root'`

[kitchen.service.ts:23](src/app/core/services/kitchen.service.ts#L23): `implements OnDestroy`, pero el servicio es root. Angular **nunca** llama `ngOnDestroy` en servicios root durante la vida de la app — solo cuando la app entera se destruye (efectivamente, nunca en runtime). El `stop()` se llama explícitamente desde el display component, lo cual es correcto, pero el `implements OnDestroy` es decorativo y confuso. Puede eliminarse.

### 🟡 4.H — `isHubConnected` getter sin consumidor

[kitchen.service.ts:205-207](src/app/core/services/kitchen.service.ts#L205-L207):
```ts
get isHubConnected(): boolean {
  return this.hubConnection?.state === HubConnectionState.Connected;
}
```

Nadie lo usa. Dead code, o placeholder para el indicador de estado de hub que no se terminó de construir. Vinculado a 4.C.

### ✅ Cosas bien

- **Cero HTTP directo en componentes.** Todo pasa por `KitchenService`. ✓
- **Cero suscripciones Rx sin cancelar.** Las únicas llamadas son `firstValueFrom` (auto-complete) y `SwPush.messages.subscribe()` en `notification.service.ts` (servicio root, vida de app). ✓
- **Window listeners** correctamente add/remove en ngOnInit/ngOnDestroy del display component. ✓
- **Clock timer** correctamente cleared en ngOnDestroy. ✓
- **Dexie fallback** cuando la API está caída. ✓
- **Optimistic UI con revert**, incluyendo restore del item removido en caso de fallo del `markAsPrinted`. ✓

---

## Resumen de hallazgos

| # | Sev | Hallazgo | Archivo clave |
|---|-----|----------|---------------|
| 4.A | 🔴 | `parseInt(id)` sobre UUID string → NaN/URL equivocada | [kitchen.service.ts:107, 129](src/app/core/services/kitchen.service.ts#L107) |
| 2   | 🔴 | Offline-first no implementado — cambios de estado se pierden sin red | [kitchen.service.ts:96-138](src/app/core/services/kitchen.service.ts#L96-L138) |
| 1   | 🟠 | SignalR sin reconexión permanente ni polling fallback | [kitchen.service.ts:178-202](src/app/core/services/kitchen.service.ts#L178-L202) |
| 4.C | 🟠 | Sin feedback visual del estado del hub | [kitchen.service.ts / kitchen-display.component.html](src/app/modules/kitchen/kitchen-display.component.html) |
| 3.A | 🟠 | Tickets `Receipt` llegan al KDS (depende de configuración de destinos) | [kitchen-order-card.component.html:15](src/app/modules/kitchen/kitchen-order-card.component.html#L15) |
| 4.D | 🟡 | `startPolling` nombra mal — no hace polling | [kitchen.service.ts:62](src/app/core/services/kitchen.service.ts#L62) |
| 4.E | 🟡 | `parsedItems` parsea JSON en cada CD cycle | [kitchen-order-card.component.ts:33-40](src/app/modules/kitchen/kitchen-order-card.component.ts#L33-L40) |
| 4.F | 🟡 | `destinationName` muestra "KDS" hasta primer job — debería leer de `PrinterDestinationService` | [kitchen-display.component.ts:35-37](src/app/modules/kitchen/kitchen-display.component.ts#L35-L37) |
| 4.G | 🟡 | `implements OnDestroy` en servicio root es decorativo | [kitchen.service.ts:23](src/app/core/services/kitchen.service.ts#L23) |
| 4.H | 🟡 | `isHubConnected` dead code | [kitchen.service.ts:205-207](src/app/core/services/kitchen.service.ts#L205-L207) |
| 2.B | 🟠 | Delay de 3s en `onMarkDone` — si la tab cierra en la ventana, el patch se pierde | [kitchen-display.component.ts:86-99](src/app/modules/kitchen/kitchen-display.component.ts#L86-L99) |

**Leyenda:** 🔴 Bug o gap funcional · 🟠 Bug operacional / UX · 🟡 Deuda menor · ✅ En orden

---

## Priorización sugerida (cuando se apruebe la fase 12.1)

### Bloque A — Integridad de datos (prioridad crítica)
1. **4.A** — resolver el `parseInt` sobre UUID. Primero auditar el backend para saber si el id es numérico o UUID, y alinear el tipo `PrintJobDto.id` con la realidad. Sin esto, las transiciones de estado pueden estar fallando en producción sin que nadie lo note.
2. **2** — implementar cola de sync offline para print job updates. Tabla `pendingPrintJobUpdates` en Dexie + drenaje reactivo al volver online. Alineado con el resto de la app.

### Bloque B — Resiliencia (prioridad alta)
3. **1 + 4.C** — exponer `hubState` signal, wire `onclose`/`onreconnecting`/`onreconnected` con reconexión permanente con backoff, mostrar indicador visual en el header del KDS.
4. **2.B** — eliminar el `setTimeout(3000)` del `onMarkDone` o persistir el intento antes del fade-out.

### Bloque C — Pulido UX (prioridad media)
5. **3.A** — filtrar tickets de tipo `Receipt` (cliente o servidor — decidir qué es más limpio).
6. **4.F** — `destinationName` leer de `PrinterDestinationService` usando el `destinationId` de la ruta.
7. **4.D** — rename `startPolling` → `start`.

### Bloque D — Deuda menor (prioridad baja)
8. **4.E** — `parsedItems` como `computed` o memoized.
9. **4.G** — quitar `implements OnDestroy` del servicio.
10. **4.H** — usar `isHubConnected` en la UI o eliminarlo.

---

**Esperando confirmación** antes de proponer patches. Cuando decidas qué bloques atacar, genero los diffs uno por uno.
