# AUDIT-034 — Cajas & Settings (Facturación · Seguridad) Cleanup

**Fecha:** 2026-04-21
**Rama:** `audit/cajas-y-hardware`
**Alcance:** 3 áreas de deuda técnica / bugs de UI
**Modo:** Auditoría (sin cambios de código)

---

## 1. Cajas → tab "Equipos y Hardware"

### Ubicación
- Shell: [cajas-container.component.ts](src/app/modules/admin/components/cajas-container/cajas-container.component.ts)
- Shell HTML: [cajas-container.component.html](src/app/modules/admin/components/cajas-container/cajas-container.component.html)
- Tab content: [admin-registers.component.ts](src/app/modules/admin/components/admin-registers/admin-registers.component.ts)
- Tab content HTML: [admin-registers.component.html](src/app/modules/admin/components/admin-registers/admin-registers.component.html)
- Competencia: [admin-devices.component.ts](src/app/modules/admin/components/devices/admin-devices.component.ts) en `/admin/devices` (FDD-015)

### Qué hace hoy

El contenedor `CajasContainerComponent` renderiza 3 tabs bajo `/admin/registers`:

| Tab | Componente | Rol conceptual |
|-----|-----------|----------------|
| Turnos y Sesiones | `CashRegisterComponent` | Abrir/cerrar turno, movimientos de caja |
| Equipos y Hardware | `AdminRegistersComponent` | CRUD de "Cajas Físicas" + vinculación por `deviceUuid` |
| Ventas Huérfanas | `OrphanedOrdersComponent` | Rescate de órdenes sin turno |

El tab bajo análisis hace **dos cosas mezcladas**:

1. **CRUD de la entidad `CashRegister`** — crear/renombrar/activar cajas que luego se referencian en `CashRegisterSession.cashRegisterId` ([cash-register.model.ts:14-28](src/app/core/models/cash-register.model.ts#L14-L28)). Esta parte es **necesaria**: cada turno necesita una `cashRegister` válida.
2. **Vinculación por `deviceUuid`** — asocia el UUID del navegador con una `CashRegister` vía `cashRegisterService.linkDevice/unlinkDevice` ([admin-registers.component.ts:174-217](src/app/modules/admin/components/admin-registers/admin-registers.component.ts#L174-L217)). Esta parte **sí duplica** el flujo de devices que se centralizó en FDD-015.

### ¿Duplica `/admin/devices`?

**Parcialmente.** Los modelos son distintos pero solapan en el concepto "este navegador es X":

| Concepto | `/admin/devices` (FDD-015) | Tab Equipos y Hardware |
|----------|---------------------------|------------------------|
| Entidad | `Device` — terminal con `mode` (cashier/tables/kitchen/kiosk/mobile), `branchId`, `name`, activación por código de 6 dígitos | `CashRegister` — "caja física" contable con `name`, `branchId`, `deviceUuid` opcional |
| Propósito | Gestión de flota (roles, estado online/offline, revocar) | Contenedor contable para turnos |
| Vinculación | Código de activación de 6 dígitos emitido desde admin | UUID de navegador escrito desde el propio terminal |
| Rol multi-modo | Sí (KDS, Kiosko, Mesero…) | No — sólo marca "este navegador es X caja" |

El **banner amarillo** del tab (líneas 36-47 de `cajas-container.component.html`) dice textualmente:

> "Vinculación de equipos limitada. Tu plan permite vincular un equipo principal. Para asignar roles adicionales (KDS Cocina, Pantalla Mesero, Kiosko) actualiza a Pro."

El concepto de "roles adicionales (KDS Cocina, Pantalla Mesero, Kiosko)" **ya existe y está correctamente resuelto** en `AdminDevicesComponent.modes` ([admin-devices.component.ts:119-133](src/app/modules/admin/components/devices/admin-devices.component.ts#L119-L133)). El banner apunta a funcionalidad que no vive en este tab — pertenece a `/admin/devices`.

### Recomendación — **NO se puede borrar el tab en bloque**, pero sí limpiarlo

Borrar la pestaña completa rompe el CRUD de `CashRegister`, que sigue siendo necesario para abrir turnos (sesiones). En su lugar:

1. **Borrar el banner "Vinculación de equipos limitada"** ([cajas-container.component.html:36-47](src/app/modules/admin/components/cajas-container/cajas-container.component.html#L36-L47)) — es contenido legado de la era pre-FDD-015.
2. **Borrar el candado `isHardwareLocked` y su `computed`** ([cajas-container.component.ts:47-49](src/app/modules/admin/components/cajas-container/cajas-container.component.ts#L47-L49)) más su render en el header del tab ([cajas-container.component.html:27-33](src/app/modules/admin/components/cajas-container/cajas-container.component.html#L27-L33)).
3. **Renombrar el tab** de "Equipos y Hardware" → "Cajas Físicas" y el icono `pi-desktop` → `pi-wallet` o `pi-database`. Esto alinea la etiqueta con lo que la pestaña hace realmente: administrar entidades `CashRegister`.
4. **Borrar la columna "Dispositivo" y los botones Vincular/Desvincular** en [admin-registers.component.html:71-130](src/app/modules/admin/components/admin-registers/admin-registers.component.html#L71-L130) — ese linking por UUID de navegador está obsoleto frente al Device entity.
5. **Borrar del backend/servicio** `linkDevice/unlinkDevice/resolveLinkedRegister` y la columna `CashRegister.deviceUuid` — requiere migración y queda fuera de este audit.
6. **Considerar mover el tab a sus siblings del nav principal** en vez de esconderlo dentro de "Cajas": podría vivir bajo `/admin/settings` → Negocio, o al lado de Sucursales. El flujo diario del cajero no necesita ver el CRUD de cajas físicas.

> **Nota:** Si se quiere que `/admin/registers` sea estrictamente Turnos + Ventas Huérfanas, entonces el CRUD de `CashRegister` debe emigrar a otra ruta antes de borrar el tab. Emigrar es seguro porque el código ya permite crear la 1ª caja automáticamente; la gestión ongoing es de baja frecuencia.

---

## 2. Settings → tab "Facturación"

### Ubicación
- [admin-settings.component.ts](src/app/modules/admin/components/settings/admin-settings.component.ts) — métodos `openUpgrade`, `confirmCancel`, computeds `upgradeOptions`, `canCancel`
- [admin-settings.component.html:612-697](src/app/modules/admin/components/settings/admin-settings.component.html#L612-L697)
- [admin-settings.component.scss:74-97](src/app/modules/admin/components/settings/admin-settings.component.scss#L74-L97) — layout

### 2.1 Botón "Actualizar a Pro" — ¿por qué parece no hacer nada?

**El handler sí existe** — está cableado. [admin-settings.component.ts:600-602](src/app/modules/admin/components/settings/admin-settings.component.ts#L600-L602):

```ts
openUpgrade(): void {
  window.open(`${environment.landingUrl}/#precios`, '_blank');
}
```

`environment.landingUrl` resuelve a:
- Dev: `http://localhost:3000` ([environment.ts:4](src/environments/environment.ts#L4))
- Prod: `https://kaja.mx` ([environment.prod.ts:4](src/environments/environment.prod.ts#L4))

**Causas probables de que "no haga nada" percibido:**

1. **Bloqueador de pop-ups del navegador** — `window.open(..., '_blank')` sin gesto inmediato puede ser silenciado. La llamada sí ocurre dentro del click handler, así que esto es menos probable, pero sigue siendo el sospechoso #1 en móvil/tablet.
2. **En desarrollo**, si el usuario no corre el landing en `localhost:3000`, se abre una pestaña nueva en blanco que parece "no hacer nada".
3. **UX confusa** — el usuario espera un flujo de checkout inline (selección de ciclo + pago) y en lugar de eso lo mandan a la home de marketing. Sin animación ni feedback, parece un botón muerto.

**Recomendación:**

- **Opción A — rápida:** Cambiar `openUpgrade()` para navegar a la ruta interna `/admin/upgrade` (ya existe, ver [admin.routes.ts:44-48](src/app/modules/admin/admin.routes.ts#L44-L48) → `UpgradeComponent`). Ahí sí puede haber un flujo real.
  ```ts
  openUpgrade(): void { this.router.navigate(['/admin/upgrade']); }
  ```
- **Opción B — correcta:** Implementar flujo de checkout inline con el plan pre-seleccionado (`openUpgrade(planId)`) que abra el dialog de MercadoPago / Stripe con el plan ya cargado.
- **Mientras tanto**, si se mantiene `window.open`, añadir `MessageService.add({ severity: 'info', detail: 'Abriendo página de planes…' })` para dar feedback visible mientras carga la nueva pestaña.

### 2.2 Espacio vertical entre "Plan actual" y "Cancelar suscripción"

**Causa raíz:** el grid de 2 columnas.

[admin-settings.component.scss:74-97](src/app/modules/admin/components/settings/admin-settings.component.scss#L74-L97):

```scss
.settings-content {
  padding: $space-5;
  display: grid;
  grid-template-columns: 1fr 1fr;   // ← dos columnas
  gap: $space-4;
  align-items: start;
  ...
}
```

El tab Facturación renderiza 3 `<section>` consecutivos en ese grid ([admin-settings.component.html:614-697](src/app/modules/admin/components/settings/admin-settings.component.html#L614-L697)):

```
[ Sección 1: Tu plan actual     ] [ Sección 2: Mejorar plan (muy alta, 3 tarjetas) ]
[ Sección 3: Cancelar suscripción ]
```

- Fila 1 col 1 = "Plan actual" (baja, ~2 líneas).
- Fila 1 col 2 = "Mejorar plan" (alta — contiene `billing-upgrade-grid` con 1-3 tarjetas grandes con features y botón).
- Fila 2 col 1 = "Cancelar suscripción".

`align-items: start` alinea al top de cada celda, pero la **altura de la fila 1** la dicta la sección más alta ("Mejorar plan"). El resultado es que **debajo de "Plan actual" queda un hueco que se extiende hasta el final de "Mejorar plan"**, y sólo entonces aparece "Cancelar suscripción" en la fila 2. De ahí el gap visual.

Tabs hermanos (Seguridad, Fiscal) ya resuelven este problema aplicando `.settings-content--single .settings-content--narrow` — fuerzan 1 columna. Ver por ejemplo [admin-settings.component.html:426](src/app/modules/admin/components/settings/admin-settings.component.html#L426).

**Recomendación:** aplicar el mismo modificador en el tab Facturación. Línea 615:

```html
<!-- actual -->
<div class="settings-content">

<!-- propuesto -->
<div class="settings-content settings-content--single">
```

Esto apila las 3 secciones verticalmente sin huecos. Si se prefiere 2 columnas, alternativa: envolver "Plan actual" + "Cancelar suscripción" en un `<div>` de col 1 y dejar "Mejorar plan" solo en col 2 — pero la opción simple (apilar) concuerda con el estilo del resto de settings y rinde mejor en tablets.

---

## 3. Settings → tab "Seguridad" (PIN)

### Ubicación
- UI: [admin-settings.component.html:425-503](src/app/modules/admin/components/settings/admin-settings.component.html#L425-L503)
- Lógica: [admin-settings.component.ts:458-484](src/app/modules/admin/components/settings/admin-settings.component.ts#L458-L484) (`changePin`)
- Persistencia: [config.service.ts:194-210](src/app/core/services/config.service.ts#L194-L210) (`verifyPin`, `updatePin`)
- Modelo: [app-config.model.ts:15,22](src/app/core/models/app-config.model.ts#L15) — `AppConfig.pin: string` (default `'1234'`)

### ¿Qué PIN actualiza realmente?

**Respuesta corta: ninguno operativamente relevante.** El campo que edita vive sólo en IndexedDB del navegador y nadie más lo lee.

### Desglose

El sistema tiene **tres mecanismos de PIN distintos**, y el de la pantalla de Seguridad **no coincide con ninguno de los que usan los terminales reales**:

| PIN | Dónde se almacena | Quién lo verifica | Consumidor |
|-----|-------------------|-------------------|------------|
| **PIN de usuario (empleado)** | Server-side sobre `User.pin` ([user.model.ts:24,35](src/app/core/models/user.model.ts#L24)) | `POST /auth/pin-login` ([auth.service.ts:233](src/app/core/services/auth.service.ts#L233)) | Pantalla `/pin` del cajero tras login del owner ([pin.component.ts:169](src/app/modules/pin/pin.component.ts#L169)) |
| **PIN de sucursal (supervisor)** | Server-side sobre `Branch` | `POST /branch/{id}/verify-pin` ([pos-header.component.ts:347](src/app/modules/pos/components/pos-header/pos-header.component.ts#L347)) | Overrides en POS, p.ej. "Recibir mercancía" |
| **PIN de `AppConfig`** *(el editado en Seguridad)* | **IndexedDB local** (`config.pin === pin`, comparación en texto plano) | `configService.verifyPin` ([config.service.ts:198-201](src/app/core/services/config.service.ts#L198-L201)) | **Únicamente se auto-referencia**: en `changePin` se usa para validar el PIN actual antes de sobrescribirlo a sí mismo |

Búsqueda exhaustiva (`grep -r "verifyPin"` y `grep -r "AppConfig.*pin"`) confirma que **ningún otro código** consume `AppConfig.pin` — ni guards, ni interceptors, ni overlays de POS. Dicho de otra forma: **cambiar el PIN aquí no afecta a nada visible al usuario**. Es un ajuste huérfano heredado del prototipo antiguo.

### Recomendación

Dos caminos, de menor a mayor esfuerzo:

**Opción 1 — Borrar el tab Seguridad (recomendada).** Es funcionalidad muerta y confunde. Ambos PINs operativos (usuario y sucursal) se gestionan en otros lugares:
- PIN de usuario → [admin-users.component.ts](src/app/modules/admin/components/users/admin-users.component.ts)
- PIN de sucursal → [admin-branches.component.ts](src/app/modules/admin/components/branches/admin-branches.component.ts)

Eliminar el tab elimina la confusión del usuario y remueve el `changePin/verifyPin/updatePin` muerto. El campo `AppConfig.pin` puede deprecarse en un clean-up posterior.

**Opción 2 — Reasignar el tab a gestionar el PIN de la sucursal activa (más trabajo, más valor).**

Reconvertir la pantalla para que edite el PIN de sucursal vía `PATCH /branch/{id}/pin` (endpoint nuevo). Mejor copy:

- Título de tab: "Seguridad" → está bien.
- Título de la card: "PIN de acceso" → **"PIN de supervisor de esta sucursal"**.
- Subtítulo: "PIN de 4 dígitos para el equipo" → **"Autoriza acciones sensibles (recibir mercancía, anular venta, cancelar turno) en las tablets de `{{ branchName }}`."**
- Añadir nota explicativa:
  > "Cada empleado tiene su propio PIN para entrar al POS (Usuarios). Este PIN en cambio es del **negocio** y sólo debe conocerlo la persona responsable del turno."

Esto convierte una pantalla muerta en una pieza operativa que hoy requiere entrar a Sucursales → editar → PIN.

**Recomendación final:** Ir por Opción 1 ahora (quitar el ruido) y, si aparece la necesidad de gestionar el Branch PIN desde fuera del editor de Sucursales, retomar Opción 2 como historia nueva.

---

## Resumen ejecutivo

| # | Área | Veredicto | Acción corta |
|---|------|-----------|--------------|
| 1 | Cajas → Equipos y Hardware | No borrar el tab (tiene CRUD necesario), **pero sí limpiar**: quitar banner, candado y linking legado | Editar `cajas-container.component.{ts,html}` y `admin-registers.component.html` |
| 2.1 | Facturación → botón "Actualizar a Pro" | Sí tiene handler (`openUpgrade` → `window.open` al landing). Sensación de botón muerto viene de abrir otra pestaña en el sitio de marketing | Redirigir a `/admin/upgrade` interno |
| 2.2 | Facturación → gap vertical | Causado por `grid-template-columns: 1fr 1fr` con secciones de alturas dispares | Añadir `settings-content--single` al contenedor del tab |
| 3 | Seguridad → PIN | Actualiza sólo `AppConfig.pin` en Dexie local; **ningún otro código lo consume**. Es un feature huérfano | Borrar el tab (Opción 1) o re-cablear al PIN de sucursal (Opción 2) |

Siguiente paso sugerido: aprobar plan de ejecución uno por uno (empezando por el gap de Facturación por ser la fix más barata).
