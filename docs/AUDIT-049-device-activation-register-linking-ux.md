# AUDIT-049: Device Activation & Cash Register Linking — UX Deadlock

**Fecha:** 2026-04-29
**Branch:** `fix/gym-reception-admin-devices`
**Predecesores:** [AUDIT-024](docs/AUDIT-024-frontend-register-handshake.md), [AUDIT-025](docs/AUDIT-025-device-binding-shift-gating.md), [AUDIT-027](docs/AUDIT-027-device-provisioning-ui-and-fallbacks.md), [AUDIT-047](docs/AUDIT-047-registers-shifts-branch-selector-ux.md)
**Alcance:**
- [admin-registers.component.ts/html](src/app/modules/admin/components/admin-registers/) — listado de Cajas Físicas
- [pos-header.component.ts/html](src/app/modules/pos/components/pos-header/) — session blocker (`needsLinking`)
- [admin-devices.component.ts/html](src/app/modules/admin/components/devices/) — Pantallas y Accesos / generador de códigos
- [device.model.ts](src/app/core/models/device.model.ts) — DTOs
- [cash-register.service.ts:457-475](src/app/core/services/cash-register.service.ts#L457-L475) — `linkDevice` / `unlinkDevice`

**Objetivo:** Documentar el deadlock UX entre la creación de Cajas Físicas en backoffice y el binding del device físico — y proponer un flujo enterprise unificado.

---

## 1. Admin Registers UI (`/admin/registers` → Cajas Físicas)

### 1.1 Estado actual del componente

Tras AUDIT-047 + Phase 1, el componente quedó como **CRUD puro de cajas lógicas**:

| Acción | Disponibilidad |
|--------|---------------|
| Crear caja (nombre + activa) | ✅ |
| Editar caja (lápiz) | ✅ |
| **Ver dispositivo vinculado** | ✅ (badge read-only "Vinculado / Sin vincular") |
| **Vincular dispositivo desde aquí** | ❌ **Borrado intencionalmente** ([admin-registers.component.ts](src/app/modules/admin/components/admin-registers/admin-registers.component.ts)) |
| **Desvincular dispositivo desde aquí** | ❌ Idem |

[admin-registers.component.html:60-95](src/app/modules/admin/components/admin-registers/admin-registers.component.html#L60-L95):

```html
<td>
  @if (reg.deviceUuid) {
    <span class="admin-registers__linked-badge">Vinculado</span>
  } @else {
    <span class="admin-registers__unlinked-badge">Sin vincular</span>
  }
</td>
<td class="admin-registers__actions">
  <button class="btn-icon" (click)="openEditDialog(reg)">
    <i class="pi pi-pencil"></i>
  </button>
</td>
```

### 1.2 Razón de diseño (AUDIT-047)

El botón "Vincular este dispositivo" se eliminó porque tomaba el UUID del navegador del **admin** (que típicamente está en una laptop) y lo asignaba a la caja — vinculando la laptop del dueño en vez del iPad del establecimiento. Era el "bug binding error" reportado en AUDIT-047 §2.4.

### 1.3 Hueco actual — dropdown de devices remotos

**El componente NO tiene un dropdown que muestre devices remotos para vincular.** El edit dialog solo permite cambiar `name` y `isActive`. No hay forma desde el backoffice de:
- Listar los devices activados de la sucursal.
- Asociar uno específico (por nombre o UUID truncado) a una caja física.

**Confirmado:** [grep `cashRegister|registerId` en admin/components/devices](src/app/modules/admin/components/devices) → 0 matches. Ni el screen de devices conoce las cajas, ni el screen de cajas conoce los devices.

Hoy la única forma de lograr el binding es **physically going to the iPad** y usar el self-link del session-blocker.

---

## 2. POS Blocker UI (`pos-header` session blocker)

### 2.1 Lógica RBAC actual

[pos-header.component.ts:633-639](src/app/modules/pos/components/pos-header/pos-header.component.ts#L633-L639):

```ts
readonly canSelfLink = computed(() => {
  const roleId = this.authService.currentUser()?.roleId;
  return roleId === UserRoleId.Owner || roleId === UserRoleId.Manager;
});
```

Y el HTML del estado `needsLinking` ([pos-header.component.html:668-687](src/app/modules/pos/components/pos-header/pos-header.component.html#L668-L687)):

```html
@case ('needsLinking') {
  @if (canSelfLink()) {
    <button (click)="linkDeviceAsRegister()">Vincular este equipo como Caja Principal</button>
  } @else {
    <div class="session-blocker__register-danger">
      Dispositivo no vinculado. Asigna una caja en el panel de Admin para poder vender.
    </div>
  }
}
```

### 2.2 El deadlock confirmado

| Actor | Acción | Resultado |
|-------|--------|-----------|
| **Cashier (roleId=4)** abre el iPad | Ve el blocker `needsLinking` | `canSelfLink()` retorna `false` → **NO ve el botón**. Solo ve un mensaje "Asigna una caja en el panel de Admin" |
| **Admin entra a `/admin/registers`** desde su laptop | Busca cómo "asignar una caja" | El componente **no tiene** acción de vinculación remota (eliminada en AUDIT-047) |
| **Admin entra a `/admin/devices`** | Activa el iPad con código de 6 dígitos | El device queda registrado pero **sin caja asociada** (no hay campo en el form) |
| **Cashier vuelve a abrir el iPad** | Mismo blocker, mismo mensaje | **DEADLOCK** |

**El único workaround hoy:** que el dueño/manager se levante y vaya físicamente al iPad para hacer el self-link, o que le presten su PIN al cajero para usarlo en el iPad. Ambas son pésimas para producción.

### 2.3 Una salida medio escondida — Owner/Manager en el iPad

Si el dueño está físicamente en el iPad y hace su PIN, sí ve el botón "Vincular este equipo como Caja Principal" → crea automáticamente una caja llamada "Caja Principal" con `cashRegisterService.createRegister + linkDevice + resolveLinkedRegister`. Funciona, pero:
- Crea SIEMPRE una caja con nombre fijo "Caja Principal".
- No permite elegir una caja preexistente (la "caja recepción gimnasio" que ya creó en backoffice queda huérfana).
- Si ya existe ese nombre lanza el takeover dialog (toma la caja existente) — confuso si la caja ya tenía sesiones.

---

## 3. Screens & Accesses UI (`/admin/devices`)

### 3.1 Form reset post-generación — sí funciona, pero parcialmente

[admin-devices.component.ts:335-363](src/app/modules/admin/components/devices/admin-devices.component.ts#L335-L363):

```ts
async generateActivationCode(): Promise<void> {
  // ...
  const response = await firstValueFrom(this.deviceService.generateCode(payload));
  this.lastGeneratedCode.set(response);
  this.generateForm.reset({ branchId: 0, mode: 'cashier', name: '' });
  const first = this.branches()[0];
  if (first) this.generateForm.controls.branchId.setValue(first.id);
  await this.loadPendingCodes();
}
```

**El form SÍ se resetea** (con `branchId: 0`, `mode: 'cashier'`, `name: ''`) y vuelve a setear la primera sucursal. La queja del usuario (*"el form no se limpia"*) probablemente refiere a:

1. El **success card** sí persiste (`lastGeneratedCode`), por diseño — es lo que muestra el código de 6 dígitos para que el admin lo dicte al cashier. Esto NO es un bug, pero la UX visual puede confundir: el admin ve que el form se vacía pero el card de arriba sigue mostrando el código de la generación previa.
2. **No hay feedback claro** cuando el admin genera múltiples códigos en sesión — el card cambia de contenido sin animación, fácil de no notar.

### 3.2 Campo `cashRegister` en la generación — NO EXISTE

[device.model.ts:38-42](src/app/core/models/device.model.ts#L38-L42):

```ts
export interface GenerateCodePayload {
  branchId: number;
  mode: DeviceConfig['mode'];
  name: string;
  // ❌ NO HAY cashRegisterId
}
```

[admin-devices.component.ts:124-132](src/app/modules/admin/components/devices/admin-devices.component.ts#L124-L132) — el form NO tiene control de cashRegister:

```ts
readonly generateForm = this.fb.group({
  branchId: this.fb.control(0, [...]),
  mode: this.fb.control<DeviceConfig['mode']>('cashier', [...]),
  name: this.fb.control('', [...]),
  // ❌ NO HAY cashRegisterId
});
```

**Es decir: hoy es imposible asignar caja durante la activación.** Es un paso separado (que tampoco existe en el frontend).

### 3.3 Validación de límites de devices — backend-only, no preventivo

El frontend NO valida límites ANTES de mostrar el botón "Generar código". El flow es:
1. Admin llena el form y hace click.
2. Backend rechaza con 403 si excede plan limit.
3. `handleGenerateError` ([:371-392](src/app/modules/admin/components/devices/admin-devices.component.ts#L371-L392)) muestra un toast con el mensaje del backend.

Esto es aceptable para fail-safe pero **no preventivo**:
- El admin no sabe cuántos devices puede tener antes de intentar.
- Las features `MaxKdsScreens`/`MaxKiosks`/`MaxReceptionsPerBranch` solo gatean **visibilidad de modos** ([admin-devices.component.ts:159-177](src/app/modules/admin/components/devices/admin-devices.component.ts#L159-L177)), no cantidad.
- No hay un counter visible "Tienes 3 de 5 devices activos" — lo que sería onboarding-friendly.

---

## 4. Capacidades existentes en el backend (lo que ya podemos usar)

| Endpoint | Body | Ya existe |
|----------|------|-----------|
| `POST /api/device/generate-code` | `{ branchId, mode, name }` | ✅ |
| `POST /api/device/activate` | `{ code, deviceUuid }` | ✅ |
| `GET /api/devices?branchId=X` | — | ✅ (lista de fleet) |
| `PATCH /api/cashregister/registers/{id}/link-device` | `{ deviceUuid }` | ✅ ([cash-register.service.ts:457-462](src/app/core/services/cash-register.service.ts#L457-L462)) |
| `PATCH /api/cashregister/registers/{id}/unlink-device` | `{}` | ✅ ([:469-472](src/app/core/services/cash-register.service.ts#L469-L472)) |
| `GET /api/cashregister/registers/by-device/{uuid}` | — | ✅ |

**Conclusión:** todos los building blocks existen. El problema es 100% UX/orquestación.

---

## 5. Architectural Proposal — propuesta de flujo enterprise

### 5.1 Evaluación de las dos ideas planteadas

| | **Idea A:** Admin elige device en `/admin/registers` | **Idea B:** Admin elige caja al generar código en `/admin/devices` |
|---|---|---|
| Cuándo ocurre el binding | Después de que el device fue activado | Al momento de activar el device |
| ¿Requiere device ya activado? | Sí — el dropdown necesita listar devices ACTIVOS de la sucursal | No — el binding queda "pendiente" hasta que el device redime el código |
| Cambio backend | Ninguno (`linkDevice` ya existe) | Mínimo (`GenerateCodePayload` necesita `cashRegisterId?: number` opcional + lógica de auto-link al redimir) |
| Cambio frontend | Sumar dropdown en edit-dialog de admin-registers + listar devices | Sumar dropdown en form de admin-devices + DTO update |
| Caso de uso típico | Negocio en operación: "ya tengo iPads activados, ahora los asigno a cajas" | Onboarding: "compro iPad nuevo, lo asocio directo a la caja que voy a vender" |
| Riesgo | Admin asigna device equivocado a caja equivocada (mismatch de nombres) | Si el admin elige caja y el device nunca redime el código, queda "binding pendiente" zombie |

**Mi recomendación: AMBAS, no exclusivas.** Son complementarias:

- **Idea B** cubre el flow de **provisioning inicial** (gimnasio nuevo, instala iPad, asocia a caja "caja recepción gimnasio" en un solo paso). Reduce ~60% del trabajo en onboarding.
- **Idea A** cubre el flow de **operación diaria** (un iPad se rompe, el dueño reactiva otro y lo asocia a la caja existente sin necesidad de levantarse del backoffice).

Ambas convergen al mismo `linkDevice` endpoint del backend; la única diferencia es **cuándo** se invoca.

### 5.2 Tercer pilar — el cashier desbloqueado

Independiente de A y B, el blocker del POS necesita una **vía de escape para Cashiers** sin requerir Owner/Manager presente:

- **Opción C — código de 1 uso:** el admin genera desde backoffice un "código de vinculación de caja" (otro 6 dígitos, distinto al de activación de device). El cashier en el iPad ingresa el código → backend valida y vincula. No requiere que el Owner esté físicamente.
- **Opción D — escaneo QR:** el backoffice muestra un QR que codifica `{ cashRegisterId, signedToken }`. El cashier escanea con la cámara del iPad → fetch directo al `linkDevice`. Más rápido pero requiere cámara y endpoint nuevo.

**Mi recomendación: opción C** (código de vinculación). Es el patrón más probado en POS verticales (Square, Toast). Requiere endpoint backend nuevo `POST /cashregister/registers/{id}/generate-link-code` + `POST /cashregister/registers/redeem-link-code`.

---

## 6. Plan de refactor sugerido (cuando se ejecute)

### Phase 1 — Idea A (admin-side linker, sin cambio backend)

1. En `admin-registers.component.ts`, agregar un dropdown al edit-dialog:
   - `Devices disponibles en esta sucursal` (filtrados por `branchId === register.branchId`).
   - Pre-selecciona el device actualmente vinculado (si lo hay).
   - "Sin vincular" como opción explícita al final.
2. Al guardar: comparar valor anterior vs nuevo.
   - Si cambió a un device nuevo → llamar `linkDevice(registerId, newDeviceUuid)`.
   - Si cambió a "Sin vincular" → llamar `unlinkDevice(registerId)`.
   - Si no cambió → solo guardar name/isActive.
3. Listar devices via `deviceService.getAll({ branchId })`.
4. Manejar 409 (device ya vinculado a otra caja) con confirm dialog.

**Esfuerzo:** S (~80 líneas TS + 30 HTML).
**Backend:** ✅ ya existe.

### Phase 2 — Idea B (link-on-activation)

1. Backend: extender `GenerateCodePayload` con `cashRegisterId?: number | null`.
2. Backend: cuando el device redime el código, si `cashRegisterId` está presente, hacer auto-link.
3. Frontend: sumar dropdown "Vincular a caja (opcional)" en `generateForm` de admin-devices.
   - Mostrar solo cuando `mode === 'cashier'` (las otras modes no usan caja).
   - Listar cajas de la sucursal seleccionada (filtradas por `branchId`).
4. Pasar `cashRegisterId` en el payload.
5. UI feedback: "Caja: caja recepción gimnasio" en el success card y en pending-codes table.

**Esfuerzo:** M (~40 líneas TS + 25 HTML + cambio backend).

### Phase 3 — Opción C (código de vinculación para cashier)

1. Backend: dos endpoints nuevos:
   - `POST /cashregister/registers/{id}/generate-link-code` → retorna `{ code: '123456', expiresAt }`.
   - `POST /cashregister/registers/redeem-link-code` con body `{ code, deviceUuid }` → ejecuta link.
2. Frontend admin: en `admin-registers`, botón "Generar código de vinculación" en filas con `Sin vincular`. Modal muestra el código + countdown.
3. Frontend POS: en el `session-blocker` estado `needsLinking` para Cashier, agregar input "Ingresa código de vinculación" + botón Vincular.

**Esfuerzo:** M-L (~120 líneas TS + 50 HTML + 2 endpoints backend).

### Phase 4 — Mejoras transversales

- **Counter de devices**: en admin-devices.html, mostrar "3 de 5 devices activos" con barra de progreso. Lee de `MaxDevicesPerBranch` feature + count actual.
- **Animación del success card**: scale-pulse cuando `lastGeneratedCode` cambia (mismo patrón del chip de POS).
- **Toast tras reset del form**: "Form limpio para próximo código" — micro-feedback que clarifica.
- **Validación preventiva**: deshabilitar botón "Generar código" si `devices().length >= maxAllowed` con tooltip "Has alcanzado tu límite — elimina un device o sube de plan".

---

## 7. Resumen ejecutivo

| Bug | Ubicación | Estado |
|-----|-----------|--------|
| Admin no puede vincular device remoto desde `/admin/registers` | `admin-registers.component.html` | Funcionalidad eliminada por AUDIT-047, falta versión correcta |
| Cashier no puede vincular su iPad sin Owner/Manager | `pos-header.component.html:669` | RBAC restringe `canSelfLink` a Owner/Manager — no hay vía para cashier |
| `/admin/devices` no permite asignar caja durante activación | `device.model.ts:38-42`, `admin-devices.component.ts:124-132` | DTO sin `cashRegisterId`, form sin dropdown |
| Counter de devices no preventivo | `admin-devices.component.html` | Solo errores reactivos via 403 |

**Causa raíz unificada:** el frontend trata Devices y Cash Registers como dos dominios independientes, cuando enterprise-wise son **dos caras del mismo binding**. La cura es unificar la UX en los puntos donde el admin/cashier ya está pensando en uno de los dos.

**Prioridad sugerida:** Phase 1 (Idea A — quick win, sin backend) → Phase 2 (Idea B — onboarding) → Phase 3 (Opción C — production-grade cashier autonomy).

---

## 8. Phase 5 — Cierre (2026-04-29) ✅

### Estado final del deadlock

**Erradicado al 100%.** Las cuatro rutas de binding device↔caja están operativas:

| # | Camino | Implementación |
|---|--------|----------------|
| 1 | Owner/Manager hace self-link desde el iPad físico | Phase 1 — `linkDeviceAsRegister()` en pos-header |
| 2 | Admin pre-vincula caja durante activación | Phase 4 — `cashRegisterId` opcional en `GenerateCodePayload` + dropdown gateado por `mode='cashier'` en `/admin/devices` |
| 3 | Cashier redime código generado por admin | Phase 4 — `generateLinkCode` + `redeemLinkCode` + input en session-blocker |
| 4 | **Admin reasigna device manualmente desde `/admin/registers`** | **Phase 5 — dropdown "Dispositivo Vinculado" en edit dialog** |

### Implementación Phase 5

**5.1 Idea A — manual linking en `/admin/registers`:**
- Edit dialog ahora carga devices activos en modo cashier de la sucursal del register.
- Dropdown filtra a `unlinked || linked-to-this-register`; oculta cross-linked para evitar silent steals.
- Save secuencial: `updateRegister` → `linkDevice` / `unlinkDevice`. Toasts independientes por paso.
- Open-session guard híbrido (A+B): usa `register.hasOpenSession` cuando esté disponible, fallback a `getOpenSession(branchId)` con comparación por `cashRegisterId`. Si hay turno abierto y el admin cambia device → confirm dialog explicando que el iPad actual quedará bloqueado.

**5.2 Counter proactivo de devices en `/admin/devices`:**
- Endpoint nuevo: `GET /api/Devices/limits?branchId={id}` retornando `DeviceLimitsDto = { modes: DeviceModeQuotaDto[] }` con `usage`, `effectiveLimit`, `isLimitReached`, `isUnlimited` por modo.
- Counter card con 3 estados visuales: `unlimited` (gris + ∞), `normal` (verde + X/Y), `reached` (rojo + banner ámbar permanente).
- Banner permanente en lugar de tooltip (PrimeNG no dispara tooltip en botones disabled).
- Re-fetch de quotas en init, en branch change, post generate-code success, post toggle revoke/restore — siempre consistente con backend.

**5.3 Modelo extendido:**
- `CashRegister.hasOpenSession?: boolean` — opcional para que el backend pueda popularlo gradualmente; el frontend tiene fallback fetch.

### Archivos modificados (Phase 5)

| Archivo | Cambio |
|---------|--------|
| [device.model.ts](src/app/core/models/device.model.ts) | + `DeviceModeQuotaDto`, `DeviceLimitsDto` |
| [cash-register.model.ts](src/app/core/models/cash-register.model.ts) | + `hasOpenSession?: boolean` opcional |
| [device.service.ts](src/app/core/services/device.service.ts) | + `getDeviceLimits(branchId)` |
| [admin-devices.component.ts](src/app/modules/admin/components/devices/admin-devices.component.ts) | + signals para limits, `currentModeQuota` computed, `counterState` tri-state, refetch en mutations |
| [admin-devices.component.html](src/app/modules/admin/components/devices/admin-devices.component.html) | + counter card + banner ámbar |
| [admin-devices.component.scss](src/app/modules/admin/components/devices/admin-devices.component.scss) | + `.quota-counter` (3 modificadores) + `.quota-banner` |
| [admin-registers.component.ts](src/app/modules/admin/components/admin-registers/admin-registers.component.ts) | + DropdownModule + ConfirmationService + `branchDevices` signal + `deviceOptions` computed + `commitEdit` con diff + `confirmDeviceChangeIfSessionOpen` |
| [admin-registers.component.html](src/app/modules/admin/components/admin-registers/admin-registers.component.html) | + dropdown "Dispositivo Vinculado" + `<p-confirmDialog>` con key `register-device-reassign` |
| [admin-registers.component.scss](src/app/modules/admin/components/admin-registers/admin-registers.component.scss) | + `.register-form__hint` |

### Comportamiento garantizado tras Phase 5

| Escenario | Resultado |
|-----------|-----------|
| Admin abre `/admin/devices` para gimnasio Free con cuota 2 | Counter verde "Cajero · 1 / 2 dispositivos" |
| Admin intenta generar 3er código en Free | Counter rojo "2 / 2" + banner ámbar + botón disabled |
| Admin revoca un device → cuota baja a 1 | Counter vuelve a verde, botón se habilita |
| Admin cambia mode dropdown a Cocina | Counter actualiza al cuota de Cocina (puede ser unlimited en Pro) |
| Admin reasigna device en caja con turno abierto | Confirm dialog "¿Cambiar el dispositivo? Esta caja tiene un turno abierto..." |
| Admin reasigna device en caja sin turno | Save directo, 2 toasts (update + link) |
| Admin selecciona "— Ninguno / Desvincular —" | `unlinkDevice` directo, toast info |

### Sin pendientes — el deadlock original queda cerrado.
