# FDD-029 F1 — Smoke Test Checklist

**Fecha:** 2026-05-26
**Scope:** Verificación end-to-end del comportamiento de `product-form` tras la migración de validators al shared library (FDD-029 sub-phase d).
**Cuándo correrlo:** Antes de mergear `development` a `main`, o antes del próximo production deploy que incluya los commits FDD-029 F1.

> **No es smoke pre-commit** — el smoke se difirió a verification gate pre-merge per decisión del developer (2026-05-26). Los commits 6295b9c (sub-phases a+b) y el siguiente (sub-phases c+d) landearon sin smoke previo, apostando a que el shim conservador (rebind a nivel runtime de `FIELD_VALIDATORS`) no introduce drift observacional.

---

## Goal

Confirmar **zero behavioral regression** en product-form. F1 NO agrega features user-visible — el template del POC sigue usando sus componentes locales. El cambio único es que `FIELD_VALIDATORS` ahora resuelve los 6 keys (`required`, `maxLength60`, `positiveNumber`, `min1`, `max3650`, `nonBlank`) a funciones del shared library en vez de defs locales.

Si alguna de estas validations dispara distinto a como lo hacía antes, hay drift en el rebind.

---

## Setup

```bash
npm start
# Abrir /admin/products (o donde sea reachable product-form en el tenant activo)
# Click "Nuevo producto" o "Editar producto"
```

---

## Risk areas y steps

### 1. REQUIRED rebind

Validator: `Validators.required` → ahora `requiredValidator` desde `shared/forms`.

- [ ] **Step 1** — Dejar "Nombre" vacío, intentar guardar.
  Esperado: validation bloquea submit. Submit button deshabilitado o toast de error.

### 2. NON-BLANK rebind

Validator: local function POC → ahora `nonBlankValidator` desde shared (copia mecánica del POC).

- [ ] **Step 2** — Escribir `"   "` (tres espacios) en "Nombre", intentar guardar.
  Esperado: validation bloquea submit. Error key distinto al required (key `nonBlank`).

### 3. POSITIVE-NUMBER rebind

Validator: local function POC → ahora `positiveNumberValidator` desde shared.

- [ ] **Step 3** — Escribir `-1` en "Precio", intentar guardar.
  Esperado: validation bloquea submit.
- [ ] **Step 4** — Escribir `0` en "Precio".
  Esperado: pasa validation (positiveNumber acepta 0, sólo rechaza negativos).

### 4. MAX-LENGTH rebind

Validator: `Validators.maxLength(60)` → ahora `maxLengthValidator(60)` desde shared (wrapper sobre Angular built-in).

- [ ] **Step 5** — Escribir un nombre con >60 caracteres en "Nombre", intentar guardar.
  Esperado: validation bloquea submit a 61+ chars.

### 5. MIN/MAX rebind (solo tenants Services / Quick con membership visible)

Validators: `Validators.min(1)` / `Validators.max(3650)` → ahora `minValidator(1)` / `maxValidator(3650)`.

Pre-requisito: sección "Vigencia y membresía" visible en el form. Aplica en tenants `Services` o `Quick`.

- [ ] **Step 6** — Activar "¿Es un producto con vigencia?". Poner duración = `0`.
  Esperado: validation bloquea submit (min1, mensaje "Valor mínimo: 1").
- [ ] **Step 7** — Poner duración = `4000`.
  Esperado: validation bloquea submit (max3650, mensaje "Valor máximo: 3650").

### 6. Happy path

- [ ] **Step 8** — Llenar todos los campos requeridos con valores válidos, save.
  Esperado: success toast, producto aparece en la lista.
- [ ] **Step 9** — Reload de la página, edit el mismo producto, cambiar un campo, save.
  Esperado: cambios persisten al reload siguiente.

### 7. FormArrays (solo F&B tenants — POC owns, NOT rebound)

Pre-requisito: tenant `Restaurant` o `Counter`. Sección "Modificadores" visible.

- [ ] **Step 10a** — Agregar fila "Tamaño" en Modifiers (ej. "Mediano", +5.00), save.
  Esperado: persistencia al reload. Mismo behavior que pre-F1.
- [ ] **Step 10b** — Agregar fila "Modifier group" (ej. "Sin cebolla / Sin tomate"), save.
  Esperado: persistencia al reload.

---

## Acceptance

✅ **Smoke passing**: todos los steps 1-10 comportan idéntico al pre-F1.

❌ **Smoke failing**: cualquier step difiere — drift detectado en el rebind. Acciones:

1. Identificar el step específico que falla.
2. Comparar contra la implementación previa al `feat(forms): add shared platform` commit (`git show 6295b9c~1:src/app/modules/admin/components/products/product-form/schemas/product-form-validators.ts`).
3. Hot-fix encima o `git revert` del commit-2 (deja sub-phases a+b intactas, retira sub-phases c+d).

---

## Risk areas NOT covered en smoke (cubrir aparte)

- **Type-level compatibility** del shim: cubierto por `ng build` verde — TypeScript ya validó que `ProductFormSchema`, `FieldDescriptor`, `SectionDescriptor` se siguen tipando bien después del shim.
- **`<app-dynamic-form>` orchestrator behavior**: aún sin consumer en F1 — su comportamiento se valida en F2 (admin-users, admin-devices) cuando lo consuman.
- **Cross-vertical schema rendering**: misma razón.

---

## Apéndice — Commits cubiertos por este smoke

```
<commit-2-sha>  feat(forms): add DynamicForm orchestrator + migrate product-form validators to shared (FDD-029 c+d)
6295b9c          feat(forms): add shared platform — PrintControlError + core abstractions (FDD-029 a+b)
```

El smoke valida principalmente el commit-2 (el shim). El commit-1 (a+b) introdujo código nuevo sin consumers — su contribución al riesgo de regression es nula.
