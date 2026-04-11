# AUDIT-028: Cash Register Session Flow (Open & Close)

**Date:** 2026-04-11
**Scope:** `cash-register.component.ts/html`, `cash-register.service.ts`, `cash-register.model.ts`
**Goal:** Validar que el flujo operativo del turno de caja sea robusto, no permita malas prácticas (blind-close violation, apertura accidental con $0) y esté sincronizado con el signal central del service tras la Fase 8.

---

## 1. Respuestas a las cuatro preguntas

### 1.1 Flujo de Apertura — ¿exige un fondo inicial válido?

**Respuesta corta:** no lo exige. La UI deja abrir un turno con $0.00 con un solo click accidental, y el handler no tiene manejo de errores.

**Archivos:** [cash-register.component.ts:161-182](src/app/modules/admin/components/cash-register/cash-register.component.ts#L161-L182), [cash-register.component.html:132-175](src/app/modules/admin/components/cash-register/cash-register.component.html#L132-L175).

**Lo que encontré:**

1. **Valor inicial `openAmount = 0`** ([línea 80](src/app/modules/admin/components/cash-register/cash-register.component.ts#L80)). El field arranca en cero y la UI muestra `$0.00` pre-llenado. El cajero que apresuradamente abre el dialog puede hacer click en "Abrir turno" sin siquiera tipear.

2. **Validación laxa en el botón:**
   ```html
   [disabled]="openAmount < 0"
   ```
   `0` pasa la validación. Solo bloquea valores negativos (que el `p-inputNumber [min]="0"` ya evita). Efectivamente el botón NUNCA está deshabilitado.

3. **Sin validación de "touched" en el input.** No hay dirty check, no hay required marker, no hay error visible si el usuario no ingresó nada. El hint dice *"El fondo es el dinero disponible para dar cambio"* — informativo pero no bloqueante.

4. **Sin error handling en `openSession()`** ([línea 162](src/app/modules/admin/components/cash-register/cash-register.component.ts#L162-L182)):
   ```typescript
   async openSession(): Promise<void> {
     const user = this.authService.currentUser();
     if (!user) return;
     await this.cashRegisterService.openSession({
       initialAmountCents: Math.round(this.openAmount * 100),
       openedBy: user.name,
     });
     // ...
   }
   ```
   No hay `try / catch`. Si el service lanza (por ejemplo, "Device is not linked to a physical register" — [cash-register.service.ts:187-189](src/app/core/services/cash-register.service.ts#L187-L189)), la excepción se propaga sin capturar, el dialog queda abierto, el usuario no ve ningún toast, y el flujo se cuelga.

5. **Sin loading/disabled del botón durante el await.** Si el cajero hace double-click, dispara dos `POST /cashregister/session/open`. El backend probablemente rechaza el segundo con 409, pero el frontend ignora el error (ver punto 4).

6. **Sin reset al abrir el dialog.** `openCloseDialog` ([línea 301-305](src/app/modules/admin/components/cash-register/cash-register.component.ts#L301-L305)) sí resetea `closeAmount` y `closeNotes`. Pero no existe `openOpenDialog()` — se llama `showOpenDialog.set(true)` directamente en el template ([línea 166](src/app/modules/admin/components/cash-register/cash-register.component.html#L166)). El valor residual de `openAmount` de un intento previo se conserva.

### 1.2 Flujo de Cierre (Arqueo) — ¿hay blind-close violation?

**Respuesta corta:** sí, hay una violación clásica. La UI muestra el monto esperado **antes** de que el cajero ingrese su conteo físico, lo cual invalida el propósito de un arqueo ciego.

**Archivo:** [cash-register.component.html:188-239](src/app/modules/admin/components/cash-register/cash-register.component.html#L188-L239).

**Estructura actual del dialog de cierre:**

```
┌──────────────────────────────────────────┐
│  Cerrar turno                            │
├──────────────────────────────────────────┤
│  Fondo inicial          $500.00          │ ← summary
│  Ventas efectivo      $2,340.00          │ ← summary
│  Movimientos           -$120.00          │ ← summary
│  ─────────────────────────────           │
│  Esperado en caja     $2,720.00  ◄────── │ ★ BLIND-CLOSE VIOLATION
├──────────────────────────────────────────┤
│  ¿Cuánto hay físicamente en caja?        │
│  [ inputNumber ]                         │
│                                          │
│  @if (closeAmount > 0) {                 │
│    Diferencia: $0.00 — Cuadra ✓          │
│  }                                       │
│                                          │
│  Notas: [ textarea ]                     │
├──────────────────────────────────────────┤
│  [Cancelar]          [Cerrar turno]      │
└──────────────────────────────────────────┘
```

**Por qué es violación:**

El arqueo tiene sentido económico **solo si es ciego**. El punto es: el cajero cuenta el dinero físico y declara el monto **sin saber cuánto debería haber**. Si la UI le dice "esperado $2,720.00" antes de contar, el cajero simplemente:

- Cuenta aproximado
- Ve el esperado
- Mete $2,720.00 para evitar discrepancias con su gerente
- El sistema reporta "cuadra" falsamente

Un faltante real queda oculto. Un sobrante queda oculto. El arqueo se convierte en teatro.

**Estado de la render lógica:**

- [líneas 192-209](src/app/modules/admin/components/cash-register/cash-register.component.html#L192-L209): el bloque `<div class="close-summary">` renderiza `Fondo inicial`, `Ventas efectivo`, `Movimientos` y `Esperado en caja` de forma incondicional al abrir el dialog. No hay `@if` que lo oculte.
- [líneas 230-240](src/app/modules/admin/components/cash-register/cash-register.component.html#L230-L240): el bloque `.close-diff` sí está gated por `@if (difference() !== null)`, y `difference()` retorna `null` hasta que `closeAmount > 0`. Pero ese gate es para la etiqueta "Cuadra / Faltante" — llega tarde, el esperado ya fue expuesto arriba.

**Mitigación existente (inadecuada):** ninguna. El hint de la etiqueta del input (`¿Cuánto hay físicamente en caja?`) asume honestidad del usuario, que es precisamente lo que un arqueo NO asume.

**Lo que debería ser:**

Flow en dos pasos:

1. **Paso 1 — Conteo ciego:** el dialog arranca mostrando solo `Fondo inicial` (dato público — ya lo sabe el cajero porque él mismo lo puso) y el input de conteo. NINGÚN otro dato. El botón primario dice "Verificar conteo".
2. **Paso 2 — Revelación:** tras tocar "Verificar conteo", el UI revela `Ventas efectivo`, `Movimientos`, `Esperado en caja` y `Diferencia`. El cajero ya no puede editar el conteo (readonly). El botón primario cambia a "Cerrar turno".

Alternativa más ligera si dos pasos son mucho refactor: mantener el single-step pero ocultar `Esperado en caja` y `Diferencia` hasta que `closeAmount > 0`, y deshabilitar la edición del input una vez que se ingresa un valor y el usuario hace blur (one-shot commit). Menos ideal pero cierra la fuga.

### 1.3 API Payload — ¿coincide con el backend?

**Respuesta corta:** sí coincide en shape, pero con dos puntos de deuda técnica: un parámetro vestigial y el faltante de `sessionId` en el body de cierre.

**Interfaces** ([cash-register.model.ts](src/app/core/models/cash-register.model.ts)):

```typescript
export interface OpenSessionRequest {
  initialAmountCents: number;
  openedBy: string;
  cashRegisterId?: number;
}

export interface CloseSessionRequest {
  countedAmountCents: number;
  closedBy: string;
  notes?: string;
}
```

**Endpoints consumidos** ([cash-register.service.ts:185-213](src/app/core/services/cash-register.service.ts#L185-L213)):

```
POST /cashregister/session/open   body: OpenSessionRequest
POST /cashregister/session/close  body: CloseSessionRequest
```

**Hallazgos:**

1. **`OpenSessionRequest.cashRegisterId` es inyectado por el service** ([cash-register.service.ts:190-193](src/app/core/services/cash-register.service.ts#L190-L193)):
   ```typescript
   const payload: OpenSessionRequest = {
     ...request,
     cashRegisterId: registerId,
   };
   ```
   El componente no lo pasa — el service lo resuelve desde `_linkedRegister()?.id`. Esto es correcto post-fase 8.1. ✓

2. **`CloseSessionRequest` no incluye un identificador de sesión.** El backend debe inferir qué sesión cerrar desde el JWT + `cashRegisterId` linkeado al device. Esto funciona hoy porque un device solo tiene una sesión abierta a la vez, pero es frágil:
   - Si el frontend tiene una sesión stale (el polling no detectó el cierre remoto), el cierre apunta a una sesión distinta a la que el usuario cree.
   - Un `sessionId: number` explícito en el body cerraría el circuito.
   
   **Nota:** esto depende del contrato del backend. Si el endpoint ya requiere `sessionId`, el frontend tiene un bug de omisión. Si no lo requiere, es deuda arquitectural menor pero real.

3. **`closeSession(branchId, request)` del service sigue aceptando `branchId` vestigial** ([cash-register.service.ts:207](src/app/core/services/cash-register.service.ts#L207)):
   ```typescript
   async closeSession(branchId: number, request: CloseSessionRequest): Promise<CashRegisterSession> {
     const session = await firstValueFrom(
       this.api.post<CashRegisterSession>('/cashregister/session/close', request),
     );
     // ...
   }
   ```
   El parámetro `branchId` se recibe y se ignora — no se pasa al body ni a la URL. Este olor ya fue detectado en [AUDIT-025 §2 / G10](docs/AUDIT-025-device-binding-shift-gating.md) como deuda técnica de baja severidad. La fase 8.1 solo limpió `openSession` porque el task lo pidió explícitamente; `closeSession`, `addMovement` y `getHistory` quedaron con su firma vestigial.

4. **`addMovement(branchId, request)` tiene el mismo problema** ([cash-register.service.ts:221](src/app/core/services/cash-register.service.ts#L221)) y `getHistory(branchId, from, to)` también. Fuera del scope explícito de este audit pero forma parte del mismo patrón.

5. **No se envía `sessionId` en `AddMovementRequest` tampoco.** Misma arquitectura: el backend debe inferir "movimiento para la sesión activa del device caller". Funciona con la asunción de una-sesión-por-device.

6. **No hay reintento / retry lógico para errores transientes.** Un 500 temporal al cerrar turno propaga el error sin reintentar y el cajero tiene que darle click de nuevo. Para cierre es aceptable (el usuario confirma cada intento); para apertura no es crítico.

### 1.4 Sincronización de Estado — ¿los modales reaccionan al signal central?

**Respuesta corta:** sí, correctamente — el refactor de fase 8.1 está limpio. Pero hay un riesgo de flicker visual en transiciones síncronas y un edge case en el polling.

**Lo que funciona bien:**

- [cash-register.component.ts:67-71](src/app/modules/admin/components/cash-register/cash-register.component.ts#L67-L71):
  ```typescript
  readonly activeSession = this.cashRegisterService.activeSession;
  ```
  Referencia directa al signal del service. Zero mirroring. ✓

- `isSessionOpen`, `movements`, `expectedAmount` son computeds que leen `activeSession()` — se recalculan reactivamente cuando el signal cambia. ✓

- El dialog de apertura (`@if (showOpenDialog())`) no depende del signal para renderizar (solo pide `openAmount`), así que la transición `null → session` no causa glitches. ✓

- El dialog de cierre (`@if (activeSession(); as session)`) usa el alias `as session` para bindings estables dentro del `@if`. Cuando el signal cambia a `null`, el bloque se desmonta limpiamente. ✓

**Riesgos detectados:**

1. **Flicker en el close dialog al cerrar exitosamente.** Secuencia actual:
   ```
   await closeSession(...)
     ↳ service.closeSession(...) hace _activeSession.set(null)   [signal flip]
     ↳ @if (activeSession(); as session) ahora es false          [contenido del dialog desaparece]
   this.showCloseDialog.set(false)                                [dialog se cierra]
   ```
   Entre el `_activeSession.set(null)` y el `showCloseDialog.set(false)`, Angular puede disparar un ciclo de CD donde el dialog sigue visible pero con el contenido vacío. Un frame de "dialog blanco". No rompe funcionalidad, pero es visualmente feo.

   **Fix:** cerrar el dialog **antes** de `await cashRegisterService.closeSession(...)`, o envolver el close en un `try/finally` que haga el set en paralelo.

2. **Flicker por polling externo.** El service hace polling de la sesión cada 3 minutos ([cash-register.service.ts:399-415](src/app/core/services/cash-register.service.ts#L399-L415)). Si otro dispositivo cierra la sesión mientras el cajero tiene el dialog de cierre abierto, el polling detecta `null` y dispara `_activeSession.set(null)` → el dialog se queda blanco sin que el cajero haya interactuado. No hay mensaje, no hay explicación.

   **Fix:** cuando el dialog de cierre está abierto y detectamos un flip externo a null, mostrar un toast tipo *"La sesión fue cerrada desde otro dispositivo"* y cerrar el dialog con un reason.

3. **`cashSalesTotalCents` no reacciona al polling.** Se calcula en `loadSession()` → `loadCashSales()` ([cash-register.component.ts:320-334](src/app/modules/admin/components/cash-register/cash-register.component.ts#L320-L334)) escaneando `db.orders` filtrado por fecha. Se ejecuta solo al abrir la pantalla. Si llegan ventas nuevas mientras la pantalla está abierta, el KPI "Ventas efectivo" queda stale — y por ende el `expectedAmount` que deriva de él también.

   **Fix:** un `effect()` que escuche `sync.lastPullAt` (o similar) y re-calcule `cashSalesTotalCents`. Fuera del scope estricto de apertura/cierre pero afecta el cálculo que se le muestra al cajero en el arqueo.

4. **`this.closeAmount = 0` después de cerrar exitosamente** ([cash-register.component.ts:224](src/app/modules/admin/components/cash-register/cash-register.component.ts#L224)): se resetea, pero como `_activeSession` ya es `null`, el dialog ya se desmontó por el `@if`. El reset es inofensivo pero redundante.

5. **`loadCashSales()` escanea toda la tabla `orders` con `.filter()` + `.toArray()`** ([cash-register.component.ts:320-333](src/app/modules/admin/components/cash-register/cash-register.component.ts#L320-L333)). En un branch con alto volumen diario esto es lento. Existe un índice compuesto alternativo sugerido en AUDIT-025. No es un problema de sincronización pero contribuye a la latencia de apertura del modal.

**Conclusión de estado:** el refactor de fase 8.1 fue correcto y la sincronización base funciona. Los problemas que quedan son de **transición** (flicker) y **responsividad en segundo plano** (stale sales total), no de shape del signal.

---

## 2. Matriz de hallazgos

| ID | Severidad | Título | Ubicación |
|---|---|---|---|
| O1 | **Alta** | Blind-close violation — `Esperado en caja` visible antes del conteo | [cash-register.component.html:192-209](src/app/modules/admin/components/cash-register/cash-register.component.html#L192-L209) |
| O2 | Media | Open dialog permite abrir con $0 con un solo click accidental | [cash-register.component.html:168-172](src/app/modules/admin/components/cash-register/cash-register.component.html#L168-L172) |
| O3 | Media | `openSession()` sin try/catch — errores del service se propagan sin toast | [cash-register.component.ts:162-182](src/app/modules/admin/components/cash-register/cash-register.component.ts#L162-L182) |
| O4 | Media | `closeSession()` sin try/catch — mismo patrón | [cash-register.component.ts:210-232](src/app/modules/admin/components/cash-register/cash-register.component.ts#L210-L232) |
| O5 | Media | Sin loading/disabled durante el await — double-click posible | [cash-register.component.html:165-173, 260-270](src/app/modules/admin/components/cash-register/cash-register.component.html#L165) |
| O6 | Baja | `cashRegisterService.closeSession(branchId, request)` firma vestigial | [cash-register.service.ts:207](src/app/core/services/cash-register.service.ts#L207) |
| O7 | Baja | `CloseSessionRequest` no incluye `sessionId` explícito | [cash-register.model.ts:50-54](src/app/core/models/cash-register.model.ts#L50-L54) |
| O8 | Baja | Flicker visual al cerrar dialog tras `_activeSession.set(null)` | [cash-register.component.ts:210-232](src/app/modules/admin/components/cash-register/cash-register.component.ts#L210-L232) |
| O9 | Baja | Polling externo puede dejar dialog blanco sin explicación | [cash-register.service.ts:399-415](src/app/core/services/cash-register.service.ts#L399-L415) |
| O10 | Baja | `cashSalesTotalCents` stale si llegan ventas mientras el dialog está abierto | [cash-register.component.ts:320-333](src/app/modules/admin/components/cash-register/cash-register.component.ts#L320-L333) |
| O11 | Baja | Sin reset de `openAmount` al abrir el dialog — valor residual persiste | [cash-register.component.ts:80](src/app/modules/admin/components/cash-register/cash-register.component.ts#L80) |
| O12 | Baja | `loadCashSales()` full-table scan sin índice compuesto | [cash-register.component.ts:320-333](src/app/modules/admin/components/cash-register/cash-register.component.ts#L320-L333) |

---

## 3. Preguntas abiertas antes de diseñar la solución

1. **¿El arqueo ciego es un requisito de negocio o una preferencia?** Si es requisito (auditoría, compliance, políticas internas del cliente), la fase de solución debe ser un refactor serio al dialog de cierre con dos pasos o staged reveal. Si es preferencia, la mitigación ligera (ocultar `Esperado` hasta que `closeAmount > 0`) basta.

2. **¿`CloseSessionRequest` debe llevar `sessionId` explícito?** Depende del contrato actual del backend. Si el endpoint ya lo requiere y el frontend no lo manda, hay un bug de integración latente que aparecerá si el backend valida estrictamente.

3. **¿Queremos impedir apertura con fondo $0 o solo advertir?** Algunos negocios legítimamente arrancan el día con $0 en caja (no dan cambio, solo cobro electrónico). Un hard-block sería fricción. Una confirmación modal *"¿Estás seguro? Vas a abrir sin fondo de cambio"* es un buen compromiso.

4. **¿El flicker visual del polling externo amerita un refactor de coordinación** o lo dejamos como edge case conocido? La solución ideal es un evento "session closed by other device" que cierre el dialog con toast; la solución barata es `@if (activeSession() && !isClosingDialogExternally)`.

5. **¿Limpiamos las firmas vestigiales (`branchId` en `closeSession`, `addMovement`, `getHistory`)** en el mismo commit que el fix del arqueo, o lo dejamos para un housekeeping separado? Mi recomendación es aprovechar el refactor del dialog de cierre para hacer la limpieza (los dos tocan los mismos archivos).

6. **¿El error toast del `openSession`/`closeSession` debe ser genérico o diferenciado por status code?** 400 "invalid amount", 409 "session already open", 503 "offline", etc. Cada uno amerita un mensaje distinto. La implementación barata es un `mapError(err)` con switch por status.

7. **¿`cashSalesTotalCents` debe reaccionar al sync en tiempo real** o basta con un botón "Actualizar" manual en el dialog? Reactivo es más pulido; manual es más simple.

---

## 4. Recomendación preliminar de solución (alto nivel)

Tres commits secuenciales, de menos a más riesgo:

### 4.1 Commit A — Robustez (fix-pattern, bajo riesgo)

- Envolver `openSession()` y `closeSession()` en try/catch con toast diferenciado por status
- Agregar `isOpeningSession = signal(false)` / `isClosingSession = signal(false)` y gatear los botones
- Resetear `openAmount = 0` al abrir el dialog (nuevo helper `openOpenDialog()` simétrico a `openCloseDialog()`)
- Cerrar el dialog **antes** de `await` el service para evitar el flicker
- **No toca** el layout visual ni el arqueo

**Archivos:** `cash-register.component.ts`, `cash-register.component.html`.

### 4.2 Commit B — Blind-close fix (medio riesgo, UX-heavy)

Opción ligera (recomendada como primer round):
- Ocultar `Esperado en caja` del summary hasta que `closeAmount > 0`
- Ocultar `Ventas efectivo` y `Movimientos` también, para no dar pistas derivadas
- El summary expandido solo aparece después del primer typing del cajero

Opción completa (si el cliente lo pide):
- Refactor a dos pasos con signal `closeStep = signal<'counting' | 'reveal'>('counting')`
- Step 1: solo inputNumber + hint "Cuenta el dinero físico"
- Step 2: revela summary + permite commit final
- Input readonly en Step 2

**Archivos:** `cash-register.component.ts`, `cash-register.component.html`.

### 4.3 Commit C — Housekeeping (muy bajo riesgo)

- Quitar `branchId` vestigial de `closeSession`, `addMovement`, `getHistory` en el service
- Actualizar los callsites (un solo consumidor por método — el propio `cash-register.component.ts` y `pos-header.component.ts` para `addMovement` si aplica)
- Opcionalmente agregar `sessionId` a `CloseSessionRequest` si el backend lo requiere

**Archivos:** `cash-register.service.ts`, `cash-register.component.ts`, `cash-register.model.ts`.

---

## 5. Próximo paso

**Esperando confirmación.** Con respuestas a §3 — especialmente §3.1 (arqueo ciego obligatorio o opcional) y §3.2 (contrato del `CloseSessionRequest` en el backend) — puedo proponer el diseño detallado del Commit B.

Sugerencia de priorización si hay que elegir:
1. **Commit A** primero (5 issues Media, quick win de UX)
2. **Commit B** segundo (el gap de diseño del arqueo, alto valor)
3. **Commit C** cuando haya ventana para housekeeping

---

*Generated by Claude Code — AUDIT-028*
