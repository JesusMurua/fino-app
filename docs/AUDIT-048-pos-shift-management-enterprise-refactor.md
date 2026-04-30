# AUDIT-048: POS Shift Management — Enterprise Refactor

**Fecha:** 2026-04-29
**Branch:** `fix/gym-reception-admin-devices`
**Predecesores:** [AUDIT-006](docs/AUDIT-006-multi-till-frontend-gaps.md), [AUDIT-024](docs/AUDIT-024-frontend-register-handshake.md), [AUDIT-025](docs/AUDIT-025-device-binding-shift-gating.md), [AUDIT-028](docs/AUDIT-028-cash-register-shift-flow.md), [AUDIT-047](docs/AUDIT-047-registers-shifts-branch-selector-ux.md)
**Alcance:**
- API contracts: [cash-register.model.ts](src/app/core/models/cash-register.model.ts), [cash-register.service.ts](src/app/core/services/cash-register.service.ts)
- Cold-boot race: [pin.component.ts](src/app/modules/pin/pin.component.ts), [cash-register.service.ts](src/app/core/services/cash-register.service.ts)
- POS UX comparativa: [pos-header.component.ts/html](src/app/modules/pos/components/pos-header), [admin/cash-register.component.ts/html](src/app/modules/admin/components/cash-register)
- Framework / patrones existentes: PrimeNG, [delivery-panel](src/app/modules/pos/components/delivery-panel) (precedente de sidebar)

**Objetivo:** Diagnosticar el estado actual y proponer una arquitectura de componentes para promover la gestión de turnos al POS de forma nativa, con calidad enterprise.

> **Aviso:** este reporte NO escribe código de refactor — sólo prepara la decisión arquitectónica.

---

## 1. Contratos de API — qué quitar para alinear con el backend modernizado

### 1.1 `OpenSessionRequest`

[cash-register.model.ts:43-47](src/app/core/models/cash-register.model.ts#L43-L47):

```ts
export interface OpenSessionRequest {
  initialAmountCents: number;
  openedBy: string;          // ❌ ELIMINAR — deriva del JWT en backend
  cashRegisterId?: number;
}
```

**Acción:** quitar `openedBy`. El backend ahora resuelve `OpenedBy` desde el JWT (claims del usuario). Mantener `cashRegisterId` (que ya es el path por el que se resuelve `DeviceId` server-side).

**Call sites a limpiar:**
- [cash-register.component.ts:307-310](src/app/modules/admin/components/cash-register/cash-register.component.ts#L307-L310) (admin)
- [pos-header.component.ts:738-741](src/app/modules/pos/components/pos-header/pos-header.component.ts#L738-L741) (session blocker)
- [cash-register.service.ts:185-200](src/app/core/services/cash-register.service.ts#L185-L200) (service body merge)

### 1.2 `CloseSessionRequest`

[cash-register.model.ts:50-63](src/app/core/models/cash-register.model.ts#L50-L63):

```ts
export interface CloseSessionRequest {
  sessionId: number;            // ✅ KEEP — explicit so backend rejects stale closes with 409
  countedAmountCents: number;
  closedBy: string;             // ❌ ELIMINAR — deriva del JWT
  notes?: string;
}
```

**Acción:** quitar `closedBy`. Mantener `sessionId` (anti-race), `countedAmountCents` y `notes`.

**Call sites a limpiar:**
- [cash-register.component.ts:454-459](src/app/modules/admin/components/cash-register/cash-register.component.ts#L454-L459)

### 1.3 `AddMovementRequest`

[cash-register.model.ts:66-72](src/app/core/models/cash-register.model.ts#L66-L72):

```ts
export interface AddMovementRequest {
  cashMovementTypeId: CashMovementType;
  amountCents: number;
  description: string;
  createdBy: string;            // ❌ ELIMINAR — deriva del JWT
}
```

**Acción:** quitar `createdBy`.

**Call sites a limpiar:**
- [cash-register.component.ts:507-512](src/app/modules/admin/components/cash-register/cash-register.component.ts#L507-L512)

### 1.4 `getRegisterByDeviceUuid` — estado actual

El método **no se llama así** en este repo. El nombre real es:

```ts
// cash-register.service.ts:363-385
async getRegisterByDevice(uuid: string): Promise<CashRegister | null> {
  const register = await firstValueFrom(
    this.api.get<CashRegister | null>(`/cashregister/registers/by-device/${uuid}`),
  );
  // 404 → null (silencioso)
  // otros errores → fallback a Dexie por deviceUuid
}
```

**Implicaciones del cambio backend (DeviceUuid → DeviceId):**
- El **endpoint** sigue siendo `/cashregister/registers/by-device/{uuid}`. El backend ahora **resuelve internamente** ese UUID a un `DeviceId` estricto. **No requiere cambio en el cliente.**
- Sin embargo, el modelo `CashRegister` ([cash-register.model.ts:4-11](src/app/core/models/cash-register.model.ts#L4-L11)) hoy expone solo `deviceUuid?: string`. Si el backend ahora devuelve también `deviceId: number` en el DTO, deberíamos sumarlo al cliente para futuras llamadas que prefieran ID sobre UUID:

```ts
export interface CashRegister {
  id: number;
  branchId: number;
  name: string;
  isActive: boolean;
  deviceUuid?: string;
  deviceId?: number;            // ← nuevo, si el DTO lo trae
  createdAt?: string;
}
```

- El fallback Dexie en [cash-register.service.ts:380-383](src/app/core/services/cash-register.service.ts#L380-L383) sigue indexando por `deviceUuid` — eso está bien para offline (el device sólo conoce su propio UUID local; nunca conoce su `DeviceId` server-side hasta hablar con la API).
- `linkDevice` ([:333-339](src/app/core/services/cash-register.service.ts#L333-L339)) hoy hace `PATCH /cashregister/registers/{id}/link-device` con `{ deviceUuid }`. Si el backend ahora resuelve UUID→ID server-side, el payload sigue igual. **No-op para el cliente.**

### 1.5 Resumen tabla — Phase 2 backend alignment

| Cambio | Archivo | Línea | Acción |
|--------|---------|-------|--------|
| Quitar `openedBy` | cash-register.model.ts | L45 | Borrar campo |
| Quitar `closedBy` | cash-register.model.ts | L61 | Borrar campo |
| Quitar `createdBy` | cash-register.model.ts | L71 | Borrar campo |
| Quitar `openedBy` del payload | cash-register.component.ts | L309 | Borrar línea |
| Quitar `openedBy` del payload | pos-header.component.ts | L740 | Borrar línea |
| Quitar `closedBy` del payload | cash-register.component.ts | L457 | Borrar línea |
| Quitar `createdBy` del payload | cash-register.component.ts | L511 | Borrar línea |
| Sumar `deviceId?: number` (opcional) | cash-register.model.ts | L9 | Añadir campo |
| `getRegisterByDevice` rename | — | — | NO hacer rename: `by-device/{uuid}` sigue siendo el endpoint público |

---

## 2. Race condition en cold-boot (`pin.component.ts`)

### 2.1 Línea exacta del problema

[pin.component.ts:194](src/app/modules/pin/pin.component.ts#L194), dentro de `submit()` tras login exitoso:

```ts
// Background loads — don't block navigation
this.cashRegisterService.loadActiveSession(this.authService.activeBranchId()).catch(() => {});
this.syncService.pullTodayOrders().catch(() => {});
this.authService.refreshSubscriptionStatus();
```

`loadActiveSession` se dispara **sin `await`** — fire-and-forget. Inmediatamente después, [línea 226](src/app/modules/pin/pin.component.ts#L226) hace `this.router.navigateByUrl(targetUrl)` y entra al POS.

### 2.2 Por qué hay flash de “Caja Cerrada”

Cadena de eventos en cold-boot:

```
1. PIN OK → pinLogin() retorna
2. Promise.all preload (config, products, inventory, tables)  ← awaiteado
3. cashRegisterService.loadActiveSession(branchId)             ← FIRE-AND-FORGET
4. router.navigateByUrl('/pos')
5. RestaurantHubComponent monta + pos-header monta
6. pos-header lee cashRegisterService.hasOpenSession() → false  (aún no resolvió)
7. session-blocker computed flips → showSessionBlocker() = true
8. Pantalla "Caja Cerrada" visible 200-1500ms
9. (paralelo) loadActiveSession completa →
   pero corre SIN registerId porque silentlyRecoverLinkedRegister
   también es asíncrono y aún no resolvió _linkedRegister
10. silentlyRecoverLinkedRegister termina → setea _linkedRegister →
    refreshActiveSession corre con registerId correcto →
    _activeSession.set(session) → blocker desaparece
```

### 2.3 Dos races independientes

**Race A — orden de fetch.**
[cash-register.service.ts:114-118](src/app/core/services/cash-register.service.ts#L114-L118): `loadActiveSession` consulta `/cashregister/session` filtrando por `registerId` **solo si `_linkedRegister` ya está seteado**. En cold-boot **no lo está** (el effect de `silentlyRecoverLinkedRegister` corre en paralelo). Resultado: la primera consulta puede regresar `null` aunque exista turno abierto en backend.

```ts
async getOpenSession(branchId: number): Promise<CashRegisterSession | null> {
  const registerId = this._linkedRegister()?.id;     // ← null en cold-boot
  const url = registerId
    ? `/cashregister/session?registerId=${registerId}`
    : '/cashregister/session';                        // ← path sin filtro
  ...
}
```

`silentlyRecoverLinkedRegister` ([:87-104](src/app/core/services/cash-register.service.ts#L87-L104)) corrige eventualmente, pero entre `loadActiveSession` (paso 3) y la corrección final hay un delta variable.

**Race B — sin `await` en `pin.component`.**
Aunque arregláramos race A (ej. await `silentlyRecoverLinkedRegister` antes de la primera query), el navigate sucede antes que cualquier consulta termine. El blocker arranca asumiendo `hasOpenSession() === false` por defecto (signal init = `null`).

### 2.4 Fixes posibles (no implementar aún)

| Opción | Esfuerzo | Trade-off |
|--------|----------|-----------|
| **A.** `await this.cashRegisterService.loadActiveSession(...)` antes de `navigateByUrl` | XS | + ~150-400ms de pantalla PIN tras el OK; elimina el flash en 100% de los casos |
| **B.** Refactor `loadActiveSession` → primero `await silentlyRecoverLinkedRegister()`, luego query con `registerId` correcto | S | Captura race A pero no race B (sigue sin awaitear en pin) |
| **C.** Estado tri-valuado en `_activeSession`: `'unresolved' \| null \| Session`, blocker solo aparece cuando es `null` y no `unresolved` | M | Elimina flash en 100% sin esperar; lógica ligeramente más compleja en consumidores |
| **D.** Suspense overlay (skeleton) hasta que `_activeSession` resuelva por primera vez | M | UX óptima; consistente con los preloads ya awaiteados (config, products) |

**Recomendación:** combinación A+B. Awaitear en pin garantiza el caso feliz; el refactor de `getOpenSession` para usar el registerId correcto desde el primer disparo elimina el side-effect de “sesión existe pero no la encontramos en el primer try”.

---

## 3. Reusabilidad — `session-blocker` vs `cash-register.component`

### 3.1 Inventario de capacidades

| Feature | session-blocker (POS) | cash-register.component (Admin) |
|--------|:-:|:-:|
| Bloquea POS cuando no hay sesión | ✅ | ❌ |
| Self-link device → caja (Owner/Manager) | ✅ | ❌ |
| Takeover dialog 409 | ✅ | ❌ |
| Apertura: input fondo inicial | ✅ | ✅ |
| Apertura: confirm $0 (proteger contra accidente) | ❌ | ✅ ([cash-register.component.ts:359-372](src/app/modules/admin/components/cash-register/cash-register.component.ts#L359-L372)) |
| Apertura: pop cash drawer | ❌ | ✅ ([:317](src/app/modules/admin/components/cash-register/cash-register.component.ts#L317)) |
| Apertura: error mapping (409/400/0/“not linked”) | ❌ | ✅ ([:374-396](src/app/modules/admin/components/cash-register/cash-register.component.ts#L374-L396)) |
| Cierre con conteo ciego (counting → reveal) | ❌ | ✅ ([:130, 585-610](src/app/modules/admin/components/cash-register/cash-register.component.ts#L130)) |
| Cierre: detección de órdenes sin cobrar | ❌ | ✅ ([:402-421](src/app/modules/admin/components/cash-register/cash-register.component.ts#L402-L421)) |
| Cierre: detección de cierre remoto via polling | ❌ | ✅ ([:240-257](src/app/modules/admin/components/cash-register/cash-register.component.ts#L240-L257)) |
| Cierre: error mapping | ❌ | ✅ ([:480-500](src/app/modules/admin/components/cash-register/cash-register.component.ts#L480-L500)) |
| Movimientos (retiro / gasto / ajuste) | ❌ | ✅ |
| KPI cards (fondo, ventas, movimientos, esperado) | ❌ | ✅ ([:67-92](src/app/modules/admin/components/cash-register/cash-register.component.html#L67-L92)) |
| Tabla de movimientos del turno | ❌ | ✅ ([:94-128](src/app/modules/admin/components/cash-register/cash-register.component.html#L94-L128)) |
| Historial 30 días | ❌ | ✅ ([:413-474](src/app/modules/admin/components/cash-register/cash-register.component.html#L413-L474)) |
| “Abrir cajón” manual (no-sale) | ❌ | ✅ ([:340-352](src/app/modules/admin/components/cash-register/cash-register.component.ts#L340-L352)) |

**Conclusión cuantitativa:** el blocker hoy cubre ~25% del feature-set. El admin cubre ~100% pero está atrapado en una ruta del back office.

### 3.2 ¿Es viable extraer un componente compartido?

**Sí, con condiciones.** El admin component es ya bastante autocontenido — su acoplamiento al back-office es:

- Layout (`.cash-page` con `<h1>` y página completa). En POS se quiere un overlay/sidebar, no una página.
- Botón “Historial” en header. En POS puede ir como acción secundaria del modal/sidebar.
- Referencias a `printerService`, `authService`, `db.orders`, `cashRegisterService`. Todos son singletons `providedIn: 'root'` — funcionan idénticos desde POS.

**Lo que NO se puede extraer 1:1:**

- La estructura de páginas con header propio. Un sidebar/modal POS necesita un wrapper distinto.
- El polling de session ya vive en `cash-register.service` (singleton) — no se duplica.
- Algunos textos están centrados en lenguaje admin (“Caja”, “Historial de cortes”). Reusables tras tunning.

### 3.3 Opciones de arquitectura

#### Opción 1 — Sidebar POS dedicado (recomendado)

Patrón: `p-sidebar` lateral derecho, mismo que ya usa [delivery-panel.component.ts](src/app/modules/pos/components/delivery-panel/delivery-panel.component.ts) (precedente probado, [línea 2 import](src/app/modules/pos/components/delivery-panel/delivery-panel.component.ts#L2): `import { SidebarModule } from 'primeng/sidebar'`).

```
+--------------------------------------+----------------+
|  pos-header  [Caja $1,234.00]        |   ◀─ icon     |
+------+-------------------------------+ Caja          |
|      |                               | ─────────     |
|      |                               | Turno abierto |
| cat  |     product grid              | Hace 2h 15m   |
| side |                               |               |
|      |                               | KPI cards     |
|      |                               |  Fondo $500   |
|      |                               |  Ventas $2.3k |
|      |                               |  Mov  -$120   |
|      |                               |  Esperado     |
+------+-------------------------------+               |
                                       | [Movimiento]  |
                                       | [Abrir cajón] |
                                       | [Cerrar turno]|
                                       +---------------+
```

**Justificación enterprise:**
- El cajero NO sale del POS para abrir/cerrar/registrar.
- El sidebar es no-modal sobre el grid → puede revisar productos al fondo mientras cuenta efectivo.
- Pop in/out con animación lateral existente.
- Touch-friendly: `p-sidebar` es deslizable.

**Ventajas frente a un dialog modal:**
- En tablet, el dialog tapa el grid completo → ansiedad de pérdida de contexto. Sidebar deja 60-70% del grid visible.
- `delivery-panel` ya validó el patrón con cajeros reales.
- Encaja con la estética “Linear / Stripe / Dribbble” pedida — drawers laterales son canónicos en esos sistemas.

#### Opción 2 — Componente puro standalone reutilizable

Crear `<app-shift-management>` (standalone) que **encapsule** las 3 acciones (Open / Close / Movement) sin imponer wrapper. Que el caller decida si lo monta dentro de un `p-dialog`, `p-sidebar` o página completa. El admin actual se vuelve un *consumer* del nuevo componente, garantizando paridad permanente.

**Costo:** mayor (separación cuidadosa de presentación vs orquestación). Beneficio a largo plazo: cero duplicación.

#### Opción 3 — Recomendada (híbrido)

```
src/app/shared/components/shift-management/
├── shift-management.component.ts        ← Componente puro reutilizable
├── shift-management.component.html      ← KPI grid + 3 sub-dialogs (open / close / movement)
└── shift-management.component.scss

src/app/modules/pos/components/shift-panel/
├── shift-panel.component.ts             ← Sidebar wrapper POS
├── shift-panel.component.html            ← <p-sidebar> + <app-shift-management>
└── shift-panel.component.scss

src/app/modules/admin/components/cash-register/
└── (refactorizado a wrapper de página) ← <div class="cash-page"> + <app-shift-management>
```

- `<app-shift-management>` recibe inputs como `mode: 'pos' | 'admin'` para tunear copy / botón “Historial”.
- El sidebar POS y la página admin son ambos shells finos; la lógica vive una sola vez.
- Migración incremental: extraer el componente; admin migra; POS estrena.

### 3.4 Sub-componentes naturales

Dentro de `<app-shift-management>` el HTML actual sugiere romper en piezas finas:

| Sub-componente | Contenido | Reuso |
|----------------|-----------|-------|
| `<shift-status-card>` | Badge “Turno abierto/cerrado” + tiempo transcurrido | POS header (compact) + sidebar (full) |
| `<shift-kpi-grid>` | 4 cards (Fondo / Ventas / Mov / Esperado) | Sidebar + admin page |
| `<open-shift-dialog>` | Dialog con monto + confirm $0 + drawer-pop | Sidebar trigger + blocker |
| `<close-shift-dialog>` | Dialog con conteo ciego (counting/reveal) | Sidebar trigger + admin |
| `<movement-dialog>` | Selector tipo + monto + descripción | Sidebar + admin |
| `<shift-history-dialog>` | Tabla 30 días | Admin (no en sidebar POS) |
| `<movements-list>` | Tabla de movimientos del turno actual | Sidebar + admin |

El `session-blocker` actual se mantiene como pantalla full-screen (caso fail) y dispara internamente `<open-shift-dialog>` o el self-link flow. **No se mezcla** con el sidebar — el blocker es exclusivo del estado “no se puede vender”.

---

## 4. Framework UI y arquitectura de estilos

### 4.1 Stack actual

- **PrimeNG 17** ([CLAUDE.md](CLAUDE.md)): primitivas — `p-dialog`, `p-sidebar`, `p-overlayPanel`, `p-dropdown`, `p-inputNumber`, `p-confirmDialog`, `p-table`, `p-inputText`, `p-inputTextarea`, `p-inputSwitch`, `p-tooltip`. Tema oscuro/claro por CSS custom properties (`--bg`, `--surface`, `--text1`…).
- **PrimeFlex** — utility grid (no Tailwind).
- **SCSS custom por componente** + tokens globales en `src/styles/_variables.scss` (`$space-1..8`, `$color-primary`, `$color-text-title`, `$touch-target-pos`).
- **Sin Tailwind, sin Material Design 3, sin Headless UI.**
- Patrón BEM en clases (`.cash-page__header`, `.session-bar__actions`).
- `:host ::ng-deep` para overrides puntuales de PrimeNG (ver delivery-panel.scss).

### 4.2 Tokens de diseño relevantes

De [CLAUDE.md](CLAUDE.md):

```
Primary:   #16A34A   (verde — totales, confirmaciones)
Error:     #DC2626
Warning:   #D97706
Neutral:   #6B7280
Spacing:   8 / 16 / 24 / 32 / 48 / 64 px (estricto)
Type:      headings 700/#111827, body 400/#374151, prices 700/≥20px
Radius:    cards 12px, modals 16px
Touch:     interactive ≥64×64px, product cards ≥120×120px
```

### 4.3 Precedentes de “Dribbble-quality” en este repo

| Componente | Patrón | Lecciones |
|-----------|--------|-----------|
| `delivery-panel` | Sidebar derecho 480px en desktop, 100vw en mobile, animación PrimeNG | Ya valida el patrón sidebar-en-POS |
| `pos-header` user overlay | `p-overlayPanel` con avatar + acciones | Pattern para chip “Caja $1,234” en topbar |
| Session blocker | Full-screen dark backdrop + card centrado, máquina de estados | Pattern para fail-state |
| `cash-register.component` | Página con KPI grid + `section-card` + `data-table` | Estética casi lista; falta densificar para sidebar |

### 4.4 Recomendaciones para la nueva UI

**Layout sidebar POS (`shift-panel`):**

- Width: **480px** desktop / **100vw** mobile (igual que delivery-panel — paridad visual).
- Header sticky con: badge estado + botón cerrar (X). Subtítulo: tiempo transcurrido del turno.
- Cuerpo:
  1. KPI grid 2×2 (no 4 cards en línea — sidebar es estrecho).
  2. Stack de acciones primarias (Movimiento / Abrir cajón / Cerrar turno) como botones de **64px de alto**, full-width, con icono + label, separados con divider.
  3. Lista colapsable “Movimientos del turno” con badges de tipo y montos.
- Footer no-sticky con botón secundario “Ver historial completo” (abre dialog admin).

**Trigger en `pos-header`:**

- Reemplazar el banner amber actual “Sin turno de caja — ve al Back Office para abrir uno” por un **chip de estado interactivo** ([pos-header.component.html:191-197](src/app/modules/pos/components/pos-header/pos-header.component.html#L191-L197)):

```
[● Turno abierto · $1,234.00]   ← verde, hover lift, click → abre sidebar
[● Turno cerrado · Abrir]        ← amber, click → abre sidebar (modo open)
```

- Vivir entre `.pos-header__divider` y los íconos de delivery/inventory para que sea siempre visible, no oculto detrás de un banner.
- Tipografía: monto a 18px/700 — cumple regla de precios mínimos.

**Animaciones (Dribbble-tier sin fireworks):**

- Sidebar slide 240ms `cubic-bezier(0.32, 0.72, 0, 1)`.
- Conteo en KPI cards: animar el número con CSS `@property --num` o `Number.toLocaleString` + transition (no obligatorio, pero da el feel premium).
- Estados loading: skeletons con shimmer (ya existe `@keyframes skeleton-shimmer` en [admin-registers.component.scss:215](src/app/modules/admin/components/admin-registers/admin-registers.component.scss#L215)). Reusar.
- Botones primarios con escala 0.97 al press (tactil).

**Theming:**

- Dark mode usa los mismos custom properties (`--surface`, `--text1`) que el admin shell — el sidebar hereda automáticamente al colocarse en `.shell.l` o `.shell.d`.
- POS no tiene dark mode hoy. Decisión de producto: lanzar shift-panel solo en light o sumar dark al POS al mismo tiempo. **Recomendación:** lanzar light primero, dark en Phase 3.

---

## 5. Arquitectura de componentes propuesta — diagrama

```
┌─────────────────────────────────────────────────────────────────┐
│ PUBLIC SHARED                                                    │
│                                                                  │
│  src/app/shared/components/shift-management/                     │
│    └── shift-management.component.ts  (standalone, providedIn=any)
│        Inputs: mode: 'pos' | 'admin'                             │
│        Composes:                                                 │
│          ├── shift-status-card                                   │
│          ├── shift-kpi-grid                                      │
│          ├── movements-list                                      │
│          ├── open-shift-dialog       (lazy, p-dialog)            │
│          ├── close-shift-dialog      (lazy, p-dialog, blind)     │
│          ├── movement-dialog         (lazy, p-dialog)            │
│          └── shift-history-dialog    (admin-only, lazy)          │
│        Calls:                                                    │
│          cashRegisterService (singleton)                         │
│          printerService (drawer-pop)                             │
│          authService (only for currentUser display, NOT body)    │
└─────────────────────────────────────────────────────────────────┘
                               ▲                ▲
                               │                │
            ┌──────────────────┘                └─────────────────┐
            │                                                      │
┌────────────────────────────┐              ┌────────────────────────────┐
│ POS WRAPPER                 │              │ ADMIN WRAPPER               │
│                             │              │                             │
│ pos/components/shift-panel/ │              │ admin/components/cash-      │
│   <p-sidebar position=right │              │   register/ (refactor)      │
│             [(visible)]>    │              │   <div class="cash-page">  │
│     <app-shift-management   │              │     <app-shift-management   │
│       mode="pos"/>          │              │       mode="admin"/>        │
│   </p-sidebar>              │              │   </div>                    │
│                             │              │                             │
│ Triggered from:             │              │ Triggered from: route       │
│   pos-header chip           │              │   /admin/cash-register      │
└────────────────────────────┘              └────────────────────────────┘
            ▲
            │
┌────────────────────────────────────────────────────────────────┐
│ POS HEADER — pos-header.component.html                         │
│                                                                 │
│  [Turno abierto · $1,234.00]   ← <shift-status-chip>           │
│   click → opens shift-panel sidebar                            │
│                                                                 │
│  Existing session-blocker (full-screen) stays for fail state    │
│  but invokes <open-shift-dialog> from shared internally.        │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. Plan de migración sugerido (orden de PRs)

| # | Cambio | Tamaño | Bloqueante de |
|---|--------|--------|---------------|
| 1 | API contracts: borrar `openedBy` / `closedBy` / `createdBy` de los 3 interfaces y los call sites | XS | Todo — alinear con backend modernizado |
| 2 | Race fix: await en `pin.component` + refactor de `getOpenSession` para resolver register primero | S | UX cold-boot; independiente del UI refactor |
| 3 | Extraer `<app-shift-management>` desde el admin actual (cero cambio de comportamiento, sólo reubicación) | M | Sub-componentes reusables |
| 4 | Crear `<shift-panel>` (sidebar POS) que monta el shared component | S | UX nativo en POS |
| 5 | Reemplazar banner “Sin turno de caja” por chip interactivo en pos-header | XS | UX |
| 6 | Refactor session-blocker: que delegue su dialog interno al `<open-shift-dialog>` shared | S | Paridad de features (drawer-pop, $0-confirm, error mapping) en el blocker |
| 7 | Sumar `deviceId?: number` al modelo `CashRegister` (cuando el backend lo expone) | XS | Futuro |

---

## 7. Resumen ejecutivo

- **Backend alignment:** quitar 3 campos string (`openedBy`, `closedBy`, `createdBy`) de los interfaces y de 4 call sites. `getRegisterByDevice(uuid)` se llama así (no `…ByDeviceUuid`) y el endpoint `/by-device/{uuid}` no cambia — el backend resuelve UUID→DeviceId server-side.
- **Cold-boot race:** dos races coexisten — fire-and-forget en pin + ausencia del registerId en la primera consulta. Recomendación combinada: `await loadActiveSession` en pin + ordenar `silentlyRecoverLinkedRegister` antes del primer fetch.
- **Refactor UI:** el admin component ya tiene el ~100% del feature-set; el POS solo el ~25%. La extracción a `<app-shift-management>` standalone + sidebar wrapper POS es claramente factible, con [delivery-panel](src/app/modules/pos/components/delivery-panel) como precedente probado del patrón sidebar.
- **Stack:** PrimeNG + PrimeFlex + SCSS BEM + tokens globales. No Tailwind. Dark mode existe en admin (CSS custom properties); el POS aún es light-only — decidir si lanzar en paralelo o aplazar.
- **No-op para cliente:** el endpoint `/cashregister/registers/by-device/{uuid}` y `PATCH /link-device` con `{ deviceUuid }` siguen funcionando idénticos tras la modernización backend.
