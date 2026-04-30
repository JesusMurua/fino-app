# AUDIT-047: Cajas Físicas, Turnos y Selector Global de Sucursal

**Fecha:** 2026-04-29
**Branch:** `fix/gym-reception-admin-devices`
**Alcance:**
- [admin-shell.component.ts](src/app/modules/admin/admin-shell.component.ts) + [admin-shell.component.html](src/app/modules/admin/admin-shell.component.html)
- [tenant-context.service.ts](src/app/core/services/tenant-context.service.ts), [branch-context.service.ts](src/app/core/services/branch-context.service.ts), [auth.service.ts](src/app/core/services/auth.service.ts)
- [admin-registers.component.ts](src/app/modules/admin/components/admin-registers/admin-registers.component.ts) + [.html](src/app/modules/admin/components/admin-registers/admin-registers.component.html)
- [cash-register.service.ts](src/app/core/services/cash-register.service.ts), [cash-register.model.ts](src/app/core/models/cash-register.model.ts)
- [cash-register.component.ts](src/app/modules/admin/components/cash-register/cash-register.component.ts) (admin /admin/cash-register)
- [pos-header.component.ts](src/app/modules/pos/components/pos-header/pos-header.component.ts) + [.html](src/app/modules/pos/components/pos-header/pos-header.component.html)
- [pin.component.ts](src/app/modules/pin/pin.component.ts)

**Objetivo:** Diagnosticar el solapamiento entre Cajas Físicas y Dispositivos, evaluar dónde se abre/cierra un Turno y dimensionar la mudanza del selector de sucursal a un Top Header global.

---

## 1. Estado del Selector de Sucursal (Global Branch State)

### 1.1 ¿Ya existe estado global? — Sí.

La señal canónica vive en [`BranchContextService.activeBranchId`](src/app/core/services/branch-context.service.ts#L28-L29):

```ts
readonly activeBranchId = signal<number>(this.loadStored());
```

- Hidratada desde `localStorage` (clave `ACTIVE_BRANCH_KEY`) al construir el servicio → sobrevive un hard refresh.
- Re-exportada por [`AuthService.activeBranchId`](src/app/core/services/auth.service.ts#L88) como getter, para que cualquier consumidor mantenga la misma identidad reactiva.
- Cambia únicamente desde `AuthService` (login, `switchBranch`, re-auth offline, logout) → escritor único.
- 20 archivos del back-office y POS la observan vía `effect()` ([referencias en src/app/modules](src/app/modules) — p.ej. [product-grid.component.ts:90](src/app/modules/pos/components/product-grid/product-grid.component.ts#L90)).

### 1.2 ¿Dónde está el dropdown hoy?

En el **sidebar** del back-office, no en el top header — [admin-shell.component.html:23-50](src/app/modules/admin/admin-shell.component.html#L23-L50). Lógica en [admin-shell.component.ts:91-313](src/app/modules/admin/admin-shell.component.ts#L91-L313):

| Pieza | Ubicación |
|------|-----------|
| `selectedBranchId` (binding) | [.ts:94](src/app/modules/admin/admin-shell.component.ts#L94) |
| `canSwitchBranch` (Owner/Manager + ≥2 sucursales) | [.ts:97-101](src/app/modules/admin/admin-shell.component.ts#L97-L101) |
| `currentBranchName` (computed) | [.ts:104-108](src/app/modules/admin/admin-shell.component.ts#L104-L108) |
| `changeBranch()` → `authService.switchBranch()` + `productService.revalidateFromApi()` | [.ts:285-313](src/app/modules/admin/admin-shell.component.ts#L285-L313) |

El topbar actual ([admin-shell.component.html:117-142](src/app/modules/admin/admin-shell.component.html#L117-L142)) **solo** contiene el theme toggle, “Punto de Venta” y “Cerrar sesión”. No muestra ni el nombre de la sucursal activa.

### 1.3 Feasibility de mover el selector al Top Header

**Veredicto: trivial. Costo estructural ≈ 0.**

Argumentos:

1. **No hay que crear servicio nuevo.** El estado, los computeds y la acción ya viven en `AdminShellComponent`. Solo hay que mover el bloque HTML.
2. **No hay que tocar consumidores.** Cada vista que necesita la sucursal activa lee `authService.activeBranchId()` (señal). Es indiferente desde qué tag JSX/HTML se dispare `changeBranch()`.
3. **Marcado más simple en topbar.** Desaparece la rama del modo colapsado (`sidebar__branch-icon` con tooltip) — el topbar no se colapsa.
4. **Patrón consistente con el POS.** [`pos-header.component.ts:129-134`](src/app/modules/pos/components/pos-header/pos-header.component.ts#L129-L134) ya muestra `branchName()` derivada de la misma señal, en formato read-only. Llevar el selector al topbar admin alinea ambos shells.

**Caveat — alcance “verdaderamente global”:**
El topbar de `admin-shell` solo se renderiza dentro del back-office. Si el objetivo del usuario es *“el cajero ve y opcionalmente cambia la sucursal desde el POS también”*, hay un segundo paso: replicar el dropdown (gateado por `canSwitchBranch`) en [`pos-header.component.html:1-20`](src/app/modules/pos/components/pos-header/pos-header.component.html#L1-L20). Hoy el POS solo muestra el nombre, no permite switch. Recomendación: hacerlo en dos PRs — primero admin (cambio puramente visual), luego POS (decisión de producto: ¿el cajero debe poder cambiar de sucursal en plena venta?).

**Plan de cambio mínimo (admin):**

```
admin-shell.component.html
├── L24-L50  ← cortar bloque .sidebar__branch (incluye divider en L49)
└── L117-142 ← pegar dentro de .topbar, antes de .topbar__actions
admin-shell.component.scss
└── renombrar .sidebar__branch → .topbar__branch y ajustar grid del topbar
```

Sin tocar TS ni servicios.

---

## 2. UI de Cajas Físicas — Acoplamiento actual

### 2.1 Qué pide el formulario

[`admin-registers.component.html:140-195`](src/app/modules/admin/components/admin-registers/admin-registers.component.html#L140-L195) y [`admin-registers.component.ts:15-19, 234-236`](src/app/modules/admin/components/admin-registers/admin-registers.component.ts#L15-L19):

```ts
interface RegisterForm {
  name: string;       // ej. "Caja 1"
  isActive: boolean;  // toggle
}
```

**Eso es todo.** No se pide branchId (lo deriva el backend del JWT), ni saldo inicial, ni operador, ni tipo. Bien.

### 2.2 Cómo se enlaza a un Device — el problema central

El enlace **NO** ocurre al crear. Es una acción separada en cada fila de la tabla, vía botón `linkDevice` ([HTML:121-130](src/app/modules/admin/components/admin-registers/admin-registers.component.html#L121-L130) → [TS:174-193](src/app/modules/admin/components/admin-registers/admin-registers.component.ts#L174-L193)):

```ts
async linkDevice(register: CashRegister): Promise<void> {
  await this.cashRegisterService.linkDevice(register.id, this.currentDeviceUuid);
  // ...
}
```

donde `currentDeviceUuid = deviceService.deviceUuid` — **el UUID del navegador desde el que el admin está abriendo el back-office**.

Resultado: si el dueño administra desde su laptop en casa, “Caja 1” queda vinculada al UUID de esa laptop, no al iPad del establecimiento. La banda informativa de [HTML:23-39](src/app/modules/admin/components/admin-registers/admin-registers.component.html#L23-L39) muestra `UUID de este dispositivo: …` y el badge “Sin vincular” / “Vinculado a Caja N”, lo que **refuerza** la confusión: el admin ve “este dispositivo” en su laptop y cree que va a vincular el iPad físico.

### 2.3 Acoplamiento concepto-a-concepto

| Concepto | Naturaleza | Dónde vive |
|---------|-----------|------------|
| **Caja Física** (`CashRegister`) | Bucket contable: dónde se guarda el efectivo, qué turnos se abren ahí. Tiene `branchId`, `name`, `isActive`. | [cash-register.model.ts:4-11](src/app/core/models/cash-register.model.ts#L4-L11) |
| **Turno** (`CashRegisterSession`) | Período operativo: quién abrió, monto inicial, ventas, movimientos, monto de cierre. FK a una caja. | [cash-register.model.ts:14-28](src/app/core/models/cash-register.model.ts#L14-L28) |
| **Device** (UUID) | Hardware: identidad persistente del navegador/iPad. Tiene su propio JWT y módulo `/admin/devices`. | [device.service.ts](src/app/core/services/device.service.ts) |

La UI actual mete **los tres** en una sola pantalla (`/admin/registers`) y obliga al admin a operar el binding caja↔device desde el navegador equivocado. El módulo `/admin/devices` existe pero no aparece en la conversación de “cajas”.

### 2.4 Qué falta surfacear en `/admin/registers`

Solo se muestran ID, Nombre, Estado, UUID truncado, acciones link/edit. **Ausentes** (los datos ya existen en API):

- `branchId` (multi-sucursal: ¿qué sucursal posee esta caja?)
- Estado del turno: abierto / cerrado / monto inicial actual
- Último operador / fecha último turno
- Botones de “Abrir turno” / “Cerrar turno” / “Ver movimientos”

Las acciones de turno **solo** existen en [`/admin/cash-register`](src/app/modules/admin/components/cash-register/cash-register.component.ts) — una pantalla aparte que opera **sobre el turno activo del device actual**, no sobre la caja seleccionada en la lista. Es decir: dos pantallas que no se hablan entre sí.

### 2.5 Donde ya existe el patrón correcto (no inventarlo de cero)

[`pos-header.component.ts:567-755`](src/app/modules/pos/components/pos-header/pos-header.component.ts#L567-L755) implementa exactamente la separación buena: el blocker `session-blocker` arranca en estado `needsLinking`, y el cajero (sentado en el iPad real) hace **un click** en *“Vincular este equipo como Caja Principal”* — eso ejecuta create + link + resolve en una sola transacción ([`linkDeviceAsRegister()`](src/app/modules/pos/components/pos-header/pos-header.component.ts#L632-L643)), e incluso resuelve el 409 (`register_name_taken`) con un diálogo de takeover ([HTML:697-756](src/app/modules/pos/components/pos-header/pos-header.component.html#L697-L756)).

El admin debería poder **listar y editar** cajas en `/admin/registers`, pero el binding device↔caja **debería ser exclusivamente del POS** (en el iPad físico). Hoy `/admin/registers` ofrece ese botón de link y es la fuente de la confusión que reportó el usuario.

---

## 3. UI de Apertura de Turno en POS — Lo que falta

### 3.1 Lo que sí existe

`pos-header` ya bloquea la venta cuando no hay turno abierto ([HTML:605-693](src/app/modules/pos/components/pos-header/pos-header.component.html#L605-L693)):

- Máquina de estados estricta `loading | needsLinking | needsOpening | isOpen` ([TS:587-592](src/app/modules/pos/components/pos-header/pos-header.component.ts#L587-L592)).
- Si no hay caja vinculada → CTA self-link (Owner/Manager) o mensaje de bloqueo (Cashier).
- Si hay caja sin turno → input “Monto inicial en caja (MXN)” + botón “Abrir Turno”.
- Banner persistente en cabecera ([HTML:192-197](src/app/modules/pos/components/pos-header/pos-header.component.html#L192-L197)) cuando no hay sesión.
- 409 takeover si el nombre está tomado en otro device.

### 3.2 Lo que falta

**A) Detección en cold-boot puede tener un “falso negativo” transitorio.**
[pin.component.ts:194](src/app/modules/pin/pin.component.ts#L194) hace `cashRegisterService.loadActiveSession(branchId).catch(() => {})` — fire-and-forget, sin `await`. La query inicial corre **antes** de que `silentlyRecoverLinkedRegister` (effect en el constructor del service, [cash-register.service.ts:63-68](src/app/core/services/cash-register.service.ts#L63-L68)) resuelva la caja vinculada del device, así que `getOpenSession` viaja sin filtro `?registerId=` y puede regresar `null` aunque el turno SÍ exista en backend. El blocker entonces parpadea en `needsOpening` durante la ventana entre `loadActiveSession` y `refreshActiveSession`. La auto-recovery lo arregla, pero el cajero ve *“Caja Cerrada”* cuando técnicamente no lo está.

**B) Apertura sin paridad con `/admin/cash-register`.**
El blocker del POS pide solo el monto inicial. La pantalla admin ([cash-register.component.ts:293-329](src/app/modules/admin/components/cash-register/cash-register.component.ts#L293-L329)) tiene tres mejoras que el blocker NO reusa:

1. **Confirmación de fondo $0**: dialog “¿Abrir sin fondo de cambio?” ([cash-register.component.ts:359-372](src/app/modules/admin/components/cash-register/cash-register.component.ts#L359-L372)).
2. **Apertura de cajón** vía `printerService.openCashDrawer()` ([cash-register.component.ts:317](src/app/modules/admin/components/cash-register/cash-register.component.ts#L317)) — para que el cajero deposite físicamente el fondo.
3. **Mapeo de errores HTTP** a toast humano ([cash-register.component.ts:374-396](src/app/modules/admin/components/cash-register/cash-register.component.ts#L374-L396)).

El blocker solo muestra un toast genérico “No se pudo abrir la caja. Verifica tu conexión.” ([pos-header.component.ts:744-749](src/app/modules/pos/components/pos-header/pos-header.component.ts#L744-L749)). Si el backend responde 409 (turno duplicado) el cajero lee “Verifica tu conexión” cuando no es eso.

**C) Cierre de turno NO existe en el POS.**
El blocker maneja el caso `hasOpenSession === false`. No hay UI nativa en `pos-header` para **cerrar** el turno (arqueo, conteo ciego, monto declarado, diferencia). El cajero al final del día tiene que navegar al back-office (`/admin/cash-register`) para hacer arqueo, contradiciendo el principio “los turnos se abren y cierran desde el POS”.

`cash-register.component.ts` ya tiene la máquina de estados de cierre con conteo ciego en dos pasos (`counting` → `reveal`) ([cash-register.component.ts:130, 585-610](src/app/modules/admin/components/cash-register/cash-register.component.ts#L130)) — pero está atrapada en el shell admin.

**D) Ausencia de botón “Caja” en el header del POS.**
Una vez abierto el turno, no hay punto de entrada visible para: ver ventas en efectivo del día, registrar un retiro/gasto, abrir el cajón sin venta (No-Sale), o ir al cierre. El usuario solo ve la línea de banner si está cerrada y nada cuando está abierta.

### 3.3 Camino recomendado (implementación incremental)

| # | Cambio | Esfuerzo | Riesgo |
|---|--------|----------|--------|
| 1 | Mover el dropdown de sucursal de sidebar a topbar de `admin-shell` | XS | Bajo (visual) |
| 2 | Quitar el botón “Vincular este dispositivo” de `/admin/registers` (dejar solo CRUD lógico). El binding queda exclusivo del session blocker en POS. | S | Medio (rompe flujo actual de Owners que provisionan desde laptop) |
| 3 | Surfacear `branchId`, estado de turno, último operador en la tabla de `/admin/registers` | S | Bajo |
| 4 | Hacer `await` en `pin.component.ts` para `silentlyRecoverLinkedRegister` antes de navegar al POS, o esperar al `_linkedRegister()` antes de `loadActiveSession` | S | Medio (impacta tiempo de login) |
| 5 | Promover el dialog de apertura del blocker al patrón completo de `cash-register.component.ts` (confirm $0 + drawer-pop + error mapping) | M | Bajo (extracción a un componente compartido) |
| 6 | Botón “Caja” en `pos-header` que abre un panel con sales del día + Open/Close/Movement, reusando `cash-register.component` como child | M | Medio (layout responsive, foco) |

---

## 4. Resumen ejecutivo

- **Branch state global:** ya existe (`BranchContextService.activeBranchId`). Llevarlo del sidebar al topbar de `admin-shell` es un mover-de-HTML; no hay rework de servicios. Hacerlo verdaderamente global requiere replicar el dropdown en `pos-header` (decisión de producto pendiente).
- **Cajas Físicas vs Devices:** la confusión nace porque `/admin/registers` ofrece el botón “Vincular este dispositivo” usando el UUID del navegador del admin. El patrón correcto (self-link desde el iPad real) ya está implementado en el `session-blocker` del POS — solo hay que **quitarlo** del back-office y dejar `/admin/registers` como CRUD lógico puro.
- **Apertura de turno desde POS:** ya está implementada vía `session-blocker`. Faltan: paridad con la versión admin (confirm $0, drawer-pop, error mapping), `await` correcto en login para evitar flash, y sobre todo **cierre nativo de turno desde POS** (arqueo) — hoy obligatoriamente requiere ir al back-office.
