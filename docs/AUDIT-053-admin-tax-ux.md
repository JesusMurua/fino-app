# AUDIT-053 — Admin/Backoffice UX & Configuración Fiscal

**Date:** 2026-05-04
**Scope:** Auditoría del frontend Admin/Backoffice respecto a la configuración fiscal post-AUDIT-051 (motor relacional de impuestos backend con `DefaultTaxId` por business y `ProductTaxes` / `IsTaxIncluded` por producto). **Sin cambios de código** — solo análisis y propuesta UX.

---

## Executive Summary

**Veredicto: el backend está listo, el frontend está atrasado y descalibrado.** El motor fiscal del backend expone capacidades que el Admin UI **no consume hoy**:

| Capacidad backend | Estado en frontend |
|---|---|
| Catálogo de impuestos (`GET /api/taxes`) | ❌ **No existe TaxService.** Frontend tiene hardcoded `IVA_RATE_OPTIONS` con 3 opciones estáticas |
| `DefaultTaxId` por business | ❌ **No hay UI** para configurarlo. El admin no puede elegir tasa default del tenant |
| `IsTaxIncluded` por producto | ❌ **Modelo tiene el campo** pero el `product-form` **no lo expone** en el template (`grep` confirma: cero referencias en HTML) |
| `taxRate` por producto override | ⚠️ **Existe** pero hardcodeado a `16` por default + opciones limitadas |
| Copy/UX | ⚠️ **Mixto.** "Tasa de IVA" es aceptable, pero "Tasa cero" es ambiguo (confunde 0% con Exento — son conceptos legales distintos en México) |

**Riesgo concreto**: un dueño de gym o salón con servicios exentos hoy **no tiene cómo configurar** que sus servicios no llevan IVA. El frontend asume 16% por default y no le da forma al usuario de cambiarlo a nivel tenant. Resultado: tickets con IVA mal calculado y posible problema fiscal.

---

## 1 — Catálogo de Impuestos (Data Fetching)

### 1.1 Estado actual

**No existe `TaxService` en el frontend.** Verificación:

```bash
grep -rnE "TaxService|tax\.service|/api/taxes|taxes\.service" src/app
# (no matches)
```

No hay archivo `core/services/tax.service.ts`, no hay modelo `core/models/tax.model.ts`, ningún componente fetcha `GET /api/taxes`.

### 1.2 Lo que se usa en su lugar

[`src/app/core/models/invoice.model.ts:142`](src/app/core/models/invoice.model.ts#L142) define:

```typescript
export const IVA_RATE_OPTIONS: { value: number; label: string }[] = [
  { value: 16, label: '16% (General)' },
  { value: 8,  label: '8% (Frontera norte)' },
  { value: 0,  label: '0% (Tasa cero)' },
];
```

**Esto es un array estático.** El `product-form` lo importa directo y lo bindea al dropdown de `taxRate`. Implicaciones:

- El backend puede tener tasas adicionales (IEPS, regímenes especiales para Servicios profesionales con retenciones, etc.); el frontend nunca las verá sin un release.
- No hay forma de que el `DefaultTaxId` del business se propague — el frontend ni siquiera consume esos identificadores.
- El concepto "Exento" (no sujeto a impuesto) **no existe** en el dropdown; solo está "Tasa cero" que es legalmente distinto.

### 1.3 Acción requerida

Crear `src/app/core/services/tax.service.ts` con:
- `getCatalog(): Observable<Tax[]>` → `GET /api/taxes` (cacheable: la lista de impuestos cambia ~nunca; cachear en signal con TTL de horas o sesión)
- Modelo `Tax { id: number; code: string; name: string; ratePercent: number; kind: 'iva' | 'exento' | 'ieps' | ...; isDefault: boolean }`
- Hidratar el catálogo al login (junto con categories/products) para que el dropdown del product-form no tenga que esperar al editar
- Sustituir el `IVA_RATE_OPTIONS` hardcoded por el resultado del catálogo. **Conservar el constante como fallback** si el API falla (offline-first)

---

## 2 — Business Settings (Default Tax del Tenant)

### 2.1 Estado actual

`admin-settings.component.html` tiene 4 tabs: **Negocio, Hardware, Fiscal, Billing**.

- **Tab "Fiscal"** ([línea 406](src/app/modules/admin/components/settings/admin-settings.component.html#L406)) ya agrupa: RFC, Razón Social, Régimen Fiscal (dropdown SAT), Código Postal. **Es el lugar natural** para el Default Tax del business.
- **Tab "Negocio"** tiene nombre del negocio + giro; sería un upgrade conceptual confuso poner "tasa de IVA default" ahí (¿es info comercial o fiscal?).

`UpdateBusinessSettingsRequest` (no encontrado por nombre exacto en el frontend; el endpoint actual es `PUT /api/business/giro` que solo maneja macro+sub-giros). El backend probablemente expuso un nuevo endpoint `PUT /api/business/settings` con `defaultTaxId` post-AUDIT-051 — el frontend **no tiene ningún wireup hacia él aún**.

### 2.2 Dónde colocar el control

**Tab "Fiscal" → nueva sección debajo de "Datos Fiscales del Emisor"**, antes del botón "Guardar datos fiscales":

```
┌─────────────────────────────────────────────────────────┐
│ ⚙️  Impuestos por defecto                              │
│     Aplica a todos los productos nuevos que registres   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Impuesto que se aplica a tus ventas                    │
│ ┌─────────────────────────────────────────────────┐   │
│ │ IVA 16% (Tasa general)                       ▾ │   │
│ └─────────────────────────────────────────────────┘   │
│ Si vendes servicios o productos que no llevan IVA,    │
│ elige "Sin impuesto (Exento)".                        │
└─────────────────────────────────────────────────────────┘
```

Este patrón:
- **Default visible**: el usuario ve qué tiene activo sin abrir el dropdown.
- **Hint contextual**: una línea de copy explica cuándo cambiarlo, no jerga fiscal.
- **Vive en "Fiscal"**: misma carpeta mental que RFC y Régimen, no se mezcla con "Información del negocio".

Backend bind: el dropdown lista las opciones de `TaxService.getCatalog()`. El valor seleccionado se persiste vía nuevo endpoint (probablemente `PUT /api/business/settings` o ampliación del existente).

---

## 3 — Product Catalog (Excepciones e Inclusión)

### 3.1 `IsTaxIncluded` — el gap más crítico

El modelo lo define ([`product.model.ts:88`](src/app/core/models/product.model.ts#L88)):

```typescript
/** Whether the product price includes tax. Default: true (Mexican standard) */
isTaxIncluded?: boolean;
```

El cart lo consume ([`cart.service.ts:54`](src/app/core/services/cart.service.ts#L54)):

```typescript
const isTaxIncluded = item.product.isTaxIncluded !== false;
```

**Pero el `product-form` no lo expone**. Verificación:

```bash
grep -nE "isTaxIncluded" product-form.component.html
# (no matches — cero ocurrencias en el template)
```

Implicación: el campo siempre persiste como `undefined` → cart trata como `true` (precio con IVA incluido) por default. Para un negocio B2B que cotiza precios SIN IVA y suma el impuesto al cobrar, **no hay forma** de configurarlo desde el admin actual.

### 3.2 `taxRate` override por producto

[`product-form.component.ts:795`](src/app/modules/admin/components/products/product-form/product-form.component.ts#L795):

```typescript
taxRate: new FormControl(16, { nonNullable: true }),
```

Hardcodeado a `16` en init. Cuando se carga un producto existente, [línea 421](src/app/modules/admin/components/products/product-form/product-form.component.ts#L421):

```typescript
taxRate: product.taxRate ?? 16,
```

El `?? 16` significa que productos sin `taxRate` (la mayoría, porque el formulario nunca obliga al usuario) heredan 16% silenciosamente. **No hay opción "Usar el default del negocio"** — siempre se persiste un número específico.

Para un gym vendiendo agua (16%) Y servicios exentos, hoy:
- Crea producto "Agua" → taxRate=16 (correcto)
- Crea producto "Membresía mensual" → taxRate=16 (incorrecto si el régimen es exento)
- El admin no tiene forma de fijar a nivel tenant que el default sea "Exento" y solo el agua override a 16%.

### 3.3 Acción requerida en el form

Reorganizar la sección "Precio" del `product-form` con estos 3 controles:

**Control 1 — Toggle "El precio ya incluye impuestos"**
```
┌────────────────────────────────────────────────────────┐
│ ¿El precio que pusiste ya incluye impuestos?          │
│                                                  [⬤▢] │
│ Sí, el precio que muestro al cliente ya trae IVA.    │
└────────────────────────────────────────────────────────┘
```

(Default: ON, que es la expectativa mexicana — los precios al consumidor incluyen IVA por norma. El toggle off es para B2B / mayoreo donde se cotiza sin IVA y se suma al final.)

**Control 2 — Dropdown "Impuesto aplicable"**
```
Impuesto aplicable
┌───────────────────────────────────────────┐
│ ⚙️ Usar el del negocio (IVA 16%)       ▾ │
└───────────────────────────────────────────┘
```

Primera opción siempre: "Usar el del negocio (X%)" donde X es el `defaultTaxRate` del business — esto deja `taxRate: undefined` en el modelo y permite que el backend resuelva por `DefaultTaxId`. Las demás opciones del dropdown vienen del `TaxService.getCatalog()`.

**Control 3 — (auto, no visible)** — `isTaxIncluded` del Control 1 se persiste como `boolean` real, no `undefined`.

---

## 4 — UX Assessment & Copy Idiot-Proof

### 4.1 Jergas que NO debe ver un dueño no-técnico

| Jerga actual | Problema | Reemplazo propuesto |
|---|---|---|
| "Tasa de IVA" | Asume conocimiento de qué es IVA | "Impuesto aplicable" *(label)* + "IVA 16% (Tasa general)" *(option label)* |
| "Tasa cero" | Confunde 0% con Exento; legalmente son distintos | Separar en dos opciones del dropdown: **"IVA 0% (Tasa cero — alimentos, libros)"** y **"Sin impuesto (Exento — servicios profesionales)"** |
| "Frontera norte" | Específico de México, asume el contexto | "IVA 8% (Frontera norte de México)" |
| "Régimen Fiscal" | Dropdown con códigos SAT | OK conservar — solo aparece en Fiscal-CFDI, audiencia técnica/contable |
| "isTaxIncluded" *(database field, nunca visible)* | n/a | UI: **"¿El precio que pusiste ya incluye impuestos?"** |

### 4.2 Copy completa propuesta — Settings/Fiscal (Default Tax)

**Card title**: `Impuestos por defecto`
**Subtitle**: `Aplica a todos los productos nuevos que registres`

**Field label**: `Impuesto que se aplica a tus ventas`
**Hint** (debajo del dropdown): `Si vendes servicios o productos que no llevan IVA, elige "Sin impuesto (Exento)".`

**Dropdown options** (orden recomendado):
1. `IVA 16% (Tasa general)` — default para la mayoría
2. `IVA 8% (Frontera norte de México)` — solo tenants en zona fronteriza
3. `IVA 0% (Tasa cero — alimentos, libros, medicinas)` — alimentos básicos, etc.
4. `Sin impuesto (Exento)` — servicios profesionales, educación, salud

### 4.3 Copy completa propuesta — Product Form (Precio)

Sección **Precio** reorganizada:

```
┌─────────────────────────────────────────────────────────┐
│ 🏷️ Precio                                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Precio al cliente (MXN)                                 │
│ ┌──────────────────────┐                               │
│ │ $ 0.00               │                               │
│ └──────────────────────┘                               │
│                                                         │
│ ─────────────────────────────────────────────────────  │
│                                                         │
│ ¿El precio ya incluye impuestos?              [⬤▢]    │
│ Activado: el cliente paga lo que ves arriba.           │
│ Desactivado: al cobrar le sumamos el impuesto.         │
│                                                         │
│ Impuesto aplicable                                      │
│ ┌─────────────────────────────────────────────────┐   │
│ │ ⚙️ Usar el del negocio (IVA 16%)             ▾ │   │
│ └─────────────────────────────────────────────────┘   │
│ Solo cambia esto si este producto es la excepción.    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Notas críticas:
- **"Precio al cliente"** en lugar de "Precio base" — habla el lenguaje del dueño, no el del DBA.
- El toggle de incluye-impuestos tiene **microcopy bicéfalo** (qué pasa cuando ON, qué pasa cuando OFF) para que un dueño que nunca ha visto la diferencia entre B2C y B2B la entienda en 3 segundos.
- El dropdown **siempre tiene "Usar el del negocio"** como primera opción, mostrando el valor heredado entre paréntesis. El hint refuerza que es excepción, no regla.

### 4.4 Lo que NO debe pasar

- ❌ Mostrar números crudos sin etiqueta semántica: `16%` solo, sin "IVA"
- ❌ Etiquetas con palabras del dominio fiscal sin contexto: "ISR", "Retención", "IEPS" — si surgen del catálogo, agregar paréntesis explicativo
- ❌ Dropdowns sin opción de "default del negocio" — obliga al usuario a re-decidir en cada producto
- ❌ Toggles sin microcopy de qué hace el ON vs OFF — el usuario va a apretarlo al azar

---

## 5 — Action Plan

### Phase 1 — Foundations (sin UI, ~1 día)

1. Crear `src/app/core/services/tax.service.ts` con `getCatalog()` cacheable y signal-backed
2. Crear `src/app/core/models/tax.model.ts` con interface `Tax`
3. Hidratar el catálogo al login junto con categories (`AuthService` → `TaxService.preload()`)
4. Sustituir `IVA_RATE_OPTIONS` hardcoded en `invoice.model.ts` por consumo del catálogo. Conservar como fallback offline.

### Phase 2 — Default Tax del Business (~0.5 día)

5. En `admin-settings` tab "Fiscal", agregar card "Impuestos por defecto" con dropdown bindeado al catálogo
6. Wirear save al endpoint backend (probablemente `PUT /api/business/settings` con `defaultTaxId`)
7. Exponer `tenantContext.defaultTaxRate()` derivado del catálogo + `defaultTaxId` para que el cart preview pueda usarlo y cerrar el TODO de [`cart.service.ts:184`](src/app/core/services/cart.service.ts#L184)

### Phase 3 — Product Form (~0.5 día)

8. Agregar toggle `isTaxIncluded` con microcopy bicéfalo en sección "Precio"
9. Reorganizar dropdown de `taxRate` con primera opción "Usar el del negocio (X%)" → persiste `undefined`; demás opciones desde catálogo
10. Cambiar label de "Precio base" a "Precio al cliente"
11. Cambiar default de `taxRate` form control de `16` a `null` (= heredar del negocio)

### Phase 4 — Copy & Polish (~0.5 día)

12. Aplicar la copy idiot-proof propuesta en §4 a todos los labels/hints
13. Verificar que no quede `Tasa cero` ambiguo — separar en "0% (Tasa cero)" + "Exento" como opciones distintas del catálogo
14. Smoke-test E2E: gym tenant exento crea producto sin override → ticket sale correcto; gym vende botella de agua con override 16% → ticket sale correcto
15. Cierre del TODO en `cart.service.ts:addQuickItem` cuando `tenantContext.defaultTaxRate()` esté wirieado

### Out of scope para AUDIT-053

- Migración de productos existentes con `taxRate=16` hardcodeado (probablemente nada que migrar pre-launch — ZERO usuarios)
- IEPS, retenciones por servicios profesionales, regímenes con cálculo compuesto (entran en un audit fiscal aparte si surgen tenants que los necesiten)
- CFDI 4.0 update — el régimen ya está en Fiscal tab; si AUDIT-051 cambió la mecánica, otro audit

---

## Apéndice — Métricas

```
Archivos modificados estimados (Phases 1-4):
  core/services/tax.service.ts ............... NUEVO  ~80 LOC
  core/models/tax.model.ts ................... NUEVO  ~25 LOC
  core/models/invoice.model.ts ............... ~10 LOC (fallback wiring)
  admin-settings.component.{ts,html,scss} .... ~120 LOC (nueva card Fiscal)
  product-form.component.{ts,html} ........... ~80 LOC (toggle + reorg dropdown)
  cart.service.ts (cierre TODO addQuickItem).. ~5 LOC
  ──────────────────────────────────────────────────────
  Total .................................... ~320 LOC

Líneas borradas:
  IVA_RATE_OPTIONS hardcoded reemplazado por catálogo: -10 LOC
```

---

**Author:** Claude (AUDIT-053)
**Status:** Análisis completo. Sin cambios de código. Pendiente aprobación para Phase 1-4.
