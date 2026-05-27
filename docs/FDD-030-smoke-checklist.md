# FDD-030 F2 — Smoke Test Checklist

**Fecha:** 2026-05-27
**Scope:** Verificación end-to-end del flujo de `admin-users` migrado al shared dynamic-form library (FDD-030 sub-phases a+b).
**Cuándo correrlo:** Antes de mergear el commit de FDD-030 a `main`, o antes del próximo production deploy.

---

## Goal

Confirmar **zero behavioral regression + nuevas mejoras user-facing** en admin-users post-migración a `<app-dynamic-form>`. A diferencia de FDD-029 (zero behavioral change), FDD-030 SÍ agrega features visibles — esta smoke valida que:

1. El form funciona end-to-end (create + edit + save persistance).
2. Conditional rendering (PIN vs email+password según rol) sigue activo.
3. Validation feedback NUEVO aparece inline (`<app-print-control-error>`) — antes admin-users no tenía.
4. Branch assignment subform sigue funcional (consumer-owned, fuera del dynamic form).

Si algún flujo se rompe, hay drift entre la migración y el comportamiento original del POC.

---

## Setup

```bash
npm start
# Abrir /admin (admin shell)
# Navegar a "Equipo" / "Usuarios" — admin-users component
# Necesita estar autenticado como Owner para ver branch assignment table en edit.
```

---

## Smoke steps

### Step 1 — Happy path CREATE (Cashier role)

- [ ] Click "Agregar usuario".
- [ ] Llenar `Nombre` con un valor válido (e.g. "Juan Pérez").
- [ ] Verificar que `Rol` default es "Cajero" (Cashier).
- [ ] Verificar que la sección "Credenciales" muestra **PIN field** (visible por `showWhen` predicate).
- [ ] Verificar que NO se muestran email / password (gated por `showWhen` opuesto).
- [ ] Verificar que NO se muestra la sección "Estado" / isActive toggle (gated por `_edit` flag — solo edit mode).
- [ ] Escribir `1234` en PIN.
- [ ] Click "Guardar".
- [ ] Esperado: success toast "Usuario creado", usuario aparece en la lista.

### Step 2 — Role switch (Cashier → Manager)

- [ ] Click "Agregar usuario" (nuevo dialog).
- [ ] Llenar `Nombre`.
- [ ] Cambiar el dropdown `Rol` de "Cajero" a "Gerente" (Manager).
- [ ] Esperado **immediate visual change**: PIN field desaparece, email + password fields aparecen (driven por `showWhen` predicates reactive al snapshot).
- [ ] Cambiar de vuelta a "Cajero" → PIN reaparece, email/password ocultan.

### Step 3 — Validation: empty name

- [ ] Click "Agregar usuario".
- [ ] Click "Guardar" sin llenar nada.
- [ ] Esperado: **NUEVA validation feedback inline** vía `<app-print-control-error>`: aparece "Campo requerido" debajo del input `Nombre`.
- [ ] Esperado: el foco se mueve al input `Nombre` automáticamente (per WCAG 3.3.1 — FDD-029 §10 prescribe focus management on invalid submit).
- [ ] El dialog NO se cierra (submit blocked silently aborted con focus side-effect).

### Step 4 — Validation: maxLength 100

- [ ] Click "Agregar usuario".
- [ ] Llenar `Nombre` con un string >100 caracteres (e.g. paste un párrafo entero).
- [ ] Click "Guardar".
- [ ] Esperado: validation feedback inline: "Máximo 100 caracteres".
- [ ] El dialog NO se cierra.

### Step 5 — Edit mode

- [ ] Click el icono lápiz junto a un usuario existente.
- [ ] Esperado: dialog abre con valores prepopulados.
- [ ] Esperado: la sección "Estado" AHORA SÍ aparece (gated por `_edit` flag, ahora true).
- [ ] Toggle el switch `Activo` (cambiar de true a false o viceversa).
- [ ] Click "Guardar".
- [ ] Esperado: success toast "Usuario actualizado".
- [ ] Reload la lista — el estado cambió. Reabrir el mismo usuario, verify isActive persistió.

### Step 6 — Branch assignment (Owner only)

- [ ] Estar logueado como **Owner**.
- [ ] Edit un usuario existente.
- [ ] Esperado: debajo del dynamic form aparece la tabla "Sucursales asignadas".
- [ ] Marcar/desmarcar checkboxes de sucursales.
- [ ] Cambiar el radio "Principal" a otra sucursal.
- [ ] Click "Guardar".
- [ ] Esperado: success toast + reabrir el usuario muestra las asignaciones persistidas.
- [ ] Verificar que la tabla está **fuera** del dynamic form (visualmente separada, después del último section accordion).

---

## Acceptance

✅ **Smoke passing**: todos los steps 1-6 funcionan como esperado, incluyendo las **nuevas validation feedback** del step 3 y 4.

❌ **Smoke failing**: si algún step falla, drift detectado entre el patrón POC y la nueva implementación. Posibles causas:

| Falla | Posible causa |
|---|---|
| Step 1 PIN no aparece | `showWhen` predicate del schema no evalúa correctamente. Revisar `admin-users.form.ts` predicate vs `PIN_ROLES`. |
| Step 2 role switch no actualiza fields | `formSnapshot` computed no propaga `valueChanges`. Revisar el computed en el component. |
| Step 3 sin "Campo requerido" inline | `<app-print-control-error>` no se está renderizando. Revisar template del FormFieldComponent en shared. |
| Step 3 sin focus al primer invalid | `DynamicForm.submit()` no está siendo llamado correctamente — verificar `(click)="onSaveClick()"` en footer button. |
| Step 5 sección Estado no aparece | `_edit` reserved key no llega al snapshot. Revisar `formSnapshot` computed expand del `editingUser()`. |
| Step 6 branch table no aparece | El `@if` condition (`isOwner() && editingUser() && availableBranches().length > 0`) cambió o las branches no se cargan. |

Acciones:
1. Identificar el step y causa.
2. Reproducir en dev (`npm start`).
3. Fix forward (hot-fix commit) o revert del commit FDD-030.

---

## Risk areas NOT covered en smoke (cubiertos aparte)

- **Build / type checks**: cubierto por `ng build` verde (pre-smoke gate).
- **F1 shared library regression**: cubierto por 42/42 specs (pre-smoke gate).
- **ESLint rule behavior**: cubierto por 7/7 mocha specs (pre-smoke gate).
- **Allow-list correctness**: cubierto por `npm run lint` ZERO `no-raw-form` errors (pre-smoke gate).
- **Visual styling regression** (BEM cleanup en admin-users.scss): smoke visual implícito — si algo se ve roto, flag.

---

## Apéndice — Lo que FDD-030 NO migra

Diferido a futuros FDDs (no parte del smoke):

- **admin-devices migration** → FDD-031 (needs reactive options for tenant-feature gating).
- **reservation-form migration** → FDD-031+ (needs custom widget kinds).
- **product-form template migration** → FDD-032+ (shim sigue activo).
- **Other forms** (admin-promotions, kiosk surfaces, product-detail) — pending future FDDs.

ESLint rule `no-raw-form` con allow-list bloquea NUEVOS forms hand-rolled, pero NO obliga a migrar los existentes — esa es la promise de futuros FDDs.

---

## Commit cubierto por este smoke

```
<commit-FDD-030-sha>  feat(admin): migrate admin-users to <app-dynamic-form> + ESLint no-raw-form rule (FDD-030)
```

El commit incluye:
- New: `admin-users.form.ts`, `eslint-rules/no-raw-form.js` + spec, `docs/FDD-030-smoke-checklist.md` (this doc).
- Modified: `admin-users.component.{ts,html,scss}`, `.eslintrc.json → .eslintrc.cjs`, `package.json` + `package-lock.json` (mocha + eslint-plugin-rulesdir devDeps).
- Hot-fix F1 lint cleanup: `form-field.component.ts`, `form-section.component.ts`, `dynamic-form-builder.service.spec.ts` (unused imports + quote style).
