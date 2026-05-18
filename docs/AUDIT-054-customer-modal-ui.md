# AUDIT-054 — Modal "Nuevo cliente": UI/UX y Data Mapping

**Status:** Read-only audit. No file modifications.
**Date:** 2026-05-04
**Branch:** `fix/giro-ux`
**Scope:** [`src/app/shared/components/customer-selector/`](../src/app/shared/components/customer-selector/), [`src/app/core/models/customer.model.ts`](../src/app/core/models/customer.model.ts), [`src/app/core/services/customer.service.ts`](../src/app/core/services/customer.service.ts)
**Related:** consumido por [`cart-panel.component.html:320-339`](../src/app/modules/pos/components/cart-panel/cart-panel.component.html#L320-L339) (beneficiary selector — Gym vertical).

---

## 1. Resumen ejecutivo

El modal "Nuevo cliente" vive en el componente compartido `CustomerSelectorComponent` (`/shared/components/`) y se invoca desde el `cart-panel` del POS para resolver el beneficiario de membresías Gym. La auditoría reportada por el usuario incluye tres síntomas distintos pero relacionados:

| # | Síntoma | Causa raíz identificada |
|---|---|---|
| A | API responde **400 Bad Request — `FirstName` is required** al guardar | El frontend envía `{ name, phone }` literal, sin transformación. El backend exige `firstName` (probablemente también `lastName`). **No existe capa de mapping** entre el `CreateCustomerRequest` del FE y el contrato del BE. |
| B | El `<p-dialog>` queda **atrapado en el sidebar** y no se centra en pantalla | El dialog **no declara `appendTo="body"`**. Se renderiza inline dentro del DOM del padre, hereda su stacking context (cart-panel `<aside>` + un `<p-dialog>` exterior cuando se invoca como beneficiary selector). |
| C | Inputs con **placeholders redundantes** ("Juan Pérez", "6671234567") junto a labels explícitos | Patrón legacy de duplicar info — los `<label for=...>` ya identifican cada campo. |

Adicionalmente surgieron dos hallazgos secundarios durante el audit (§6) que el equipo debería evaluar:

- **D.** El error 400 se está **silenciando** silenciosamente — no llega ningún toast al cashier.
- **E.** Inconsistencia con `.claude/html-standards.md`: el form usa `[(ngModel)]` sobre un objeto plain en vez de Reactive Forms.

---

## 2. Componentes y archivos involucrados

| Archivo | Líneas relevantes | Rol |
|---|---|---|
| [`customer-selector.component.ts`](../src/app/shared/components/customer-selector/customer-selector.component.ts) | 18-135 | Smart component: search + quick-create dialog |
| [`customer-selector.component.html`](../src/app/shared/components/customer-selector/customer-selector.component.html) | 63-113 | Markup del `<p-dialog>` "Nuevo cliente" |
| [`customer.model.ts`](../src/app/core/models/customer.model.ts) | 5-46, 49-56 | Interfaces `Customer` y `CreateCustomerRequest` |
| [`customer.service.ts`](../src/app/core/services/customer.service.ts) | 111-118 | `createCustomer(data)` — POST a `/customers` |
| [`cart-panel.component.html`](../src/app/modules/pos/components/cart-panel/cart-panel.component.html) | 320-339 | Caller (envuelto en `<p-dialog>` exterior — beneficiary selector) |

---

## 3. Hallazgo A — Data Mapping (Nombre → payload)

### 3.1 Estado actual

**Form definido en TS** ([`customer-selector.component.ts:44`](../src/app/shared/components/customer-selector/customer-selector.component.ts#L44)):

```
createForm: CreateCustomerRequest = { name: '', phone: '' };
```

El form **es un objeto plain tipado como `CreateCustomerRequest`** — no `FormGroup`, no transformación, no validators más allá de `trim().length > 0`.

**Input "Nombre"** ([`customer-selector.component.html:74-81`](../src/app/shared/components/customer-selector/customer-selector.component.html#L74-L81)):

```
<input
  id="cs-name"
  type="text"
  pInputText
  [(ngModel)]="createForm.name"
  placeholder="Juan Pérez"
  class="cs-create-form__input"
/>
```

Captura un solo string en `createForm.name`.

**`CreateCustomerRequest` interface** ([`customer.model.ts:49-56`](../src/app/core/models/customer.model.ts#L49-L56)):

```
export interface CreateCustomerRequest {
  name: string;
  phone: string;
  email?: string;
  rfc?: string;
  notes?: string;
  creditLimitCents?: number;
}
```

**Llamada al servicio** ([`customer-selector.component.ts:111`](../src/app/shared/components/customer-selector/customer-selector.component.ts#L111)):

```
const customer = await this.customerService.createCustomer(this.createForm);
```

**Servicio: POST directo sin mapping** ([`customer.service.ts:111-118`](../src/app/core/services/customer.service.ts#L111-L118)):

```
async createCustomer(data: CreateCustomerRequest): Promise<Customer> {
  const customer = await firstValueFrom(
    this.api.post<Customer>('/customers', data),
  );
  …
}
```

### 3.2 Payload que se envía actualmente

```json
POST /customers
Content-Type: application/json

{ "name": "Juan Pérez", "phone": "6671234567" }
```

### 3.3 Lo que el backend espera

Según el error reportado (`FirstName is required`), el contrato real del BE es:

```json
{ "firstName": "...", "lastName": "...", "phone": "..." }
```

(`lastName` no se confirma desde el error, pero es el patrón usual cuando el BE separa firstName.)

### 3.4 Diagnóstico

**No existe capa de mapping/transformación entre el form FE y el contrato BE.**

| Capa | ¿Existe transformación? |
|---|---|
| Template → `createForm` (vía `[(ngModel)]`) | No — binding directo string ↔ string |
| `createForm` → `customerService.createCustomer(data)` | No — pass-through |
| `customerService` → `api.post('/customers', data)` | No — body es `data` literal |
| `Customer` interface (read path) en `customer.model.ts:5-46` | Modelo FE sigue usando `name` (single field) |

**El mismatch es structural**:
- El frontend modela cliente como `{ name }` (campo único).
- El backend modela cliente como `{ firstName, lastName?, ... }` (campos separados).
- No hay adaptador en ninguna capa.

**Implicación**: arreglar esto requiere una decisión arquitectónica (no parte de este audit), entre tres opciones razonables:

| Opción | Descripción | Costo aproximado |
|---|---|---|
| 1 | Dividir el modelo FE: `Customer.firstName + lastName`, partir el input "Nombre" en dos inputs separados | Alto — toca model, search, sort, display, todos los consumers |
| 2 | Dejar el modelo FE como `name` único; agregar mapper antes del POST que parta `name` por el primer espacio (`firstName = before, lastName = after`) | Medio — un mapper en el service |
| 3 | El BE acepta tanto `name` como `firstName/lastName` y normaliza internamente | Out of scope FE; requiere ticket de BE |

### 3.5 Validación del form (estado actual)

[`customer-selector.component.ts:107`](../src/app/shared/components/customer-selector/customer-selector.component.ts#L107):

```
if (!this.createForm.name.trim() || !this.createForm.phone.trim()) return;
```

Solo verifica que ambos campos sean **no-vacíos**. No hay:
- Min length
- Format check (teléfono e.164, RFC, email)
- Detección de espacios para separar firstName/lastName
- Cross-field validation

---

## 4. Hallazgo B — Dialog Layout (stacking context atrapado)

### 4.1 Configuración actual del `<p-dialog>`

[`customer-selector.component.html:63-70`](../src/app/shared/components/customer-selector/customer-selector.component.html#L63-L70):

```
<p-dialog
  header="Nuevo cliente"
  [(visible)]="showCreateDialog"
  [modal]="true"
  [draggable]="false"
  [style]="{ width: '360px' }"
  styleClass="cs-create-dialog"
>
```

**Atributos presentes:**
- `[modal]="true"` ✓ (overlay oscuro)
- `[draggable]="false"` ✓
- `[style]` — define ancho 360px

**Atributo crítico AUSENTE:**
- ❌ **`appendTo="body"`** — no está declarado.

### 4.2 ¿Por qué se rompe el centrado?

PrimeNG `<p-dialog>` por defecto se inserta como hijo del DOM del componente que lo declara. Sin `appendTo="body"`, el modal queda dentro de:

```
<aside class="cart-panel">                  ← Contiene cart-panel
  <p-dialog (beneficiary selector)>          ← Outer dialog (visible cuando isMembership)
    <app-customer-selector>                  ← Componente actual
      <p-dialog (Nuevo cliente)>             ← ❌ Atrapado aquí dentro
```

Si CUALQUIER ancestro define un nuevo stacking context (`transform`, `filter`, `position: fixed`, `will-change`, `contain`, `clip-path`, `perspective`, `mask`, `mix-blend-mode`, etc.), el `<p-dialog>` interno **no escapa** y queda confinado a las dimensiones del ancestro.

**El cart-panel `<aside>` y el `<p-dialog>` outer ya generan stacking contexts** — el dialog interno por design queda atrapado.

### 4.3 Consecuencia visual

El usuario reportó: "constrained inside the right sidebar, breaking the stacking context (it should be centered on the screen)".

Esto coincide exactamente con el síntoma de `appendTo` no declarado en un dialog anidado.

### 4.4 Patrón en otros componentes del proyecto

Verifico inferencialmente: el `product-form` del admin sí usa `[appendTo]="'body'"` en sus dropdowns ([`product-form.component.html:81`](../src/app/modules/admin/components/products/product-form/product-form.component.html#L81)). Es el patrón conocido en el proyecto para overlays anidados — solo este `<p-dialog>` lo omitió.

---

## 5. Hallazgo C — Placeholders redundantes

### 5.1 Inputs en el dialog "Nuevo cliente"

| Input | Línea HTML | `<label>` explícito | `placeholder` | Redundancia |
|---|---|---|---|---|
| Nombre | [74-81](../src/app/shared/components/customer-selector/customer-selector.component.html#L74-L81) | ✓ `<label for="cs-name">Nombre *</label>` (línea 73) | `"Juan Pérez"` | 🔴 Sí |
| Teléfono | [85-93](../src/app/shared/components/customer-selector/customer-selector.component.html#L85-L93) | ✓ `<label for="cs-phone">Teléfono *</label>` (línea 84) | `"6671234567"` | 🔴 Sí |

Ambos inputs tienen `<label>` con `for="..."` correctamente asociado al `id` del input. Los placeholders solo agregan ruido visual y duplican la función del label.

### 5.2 Inputs fuera del dialog (no aplican al scope del audit)

Para completitud — los siguientes inputs del componente **NO** son redundantes y no deben tocarse:

| Input | Línea | Razón |
|---|---|---|
| Search input | [27-36](../src/app/shared/components/customer-selector/customer-selector.component.html#L27-L36) | NO tiene `<label>` visible — solo ícono `pi pi-search`. El placeholder (`[placeholder]="placeholder()"` bindado desde el parent) es el único affordance textual. **No es redundante.** |

---

## 6. Hallazgos adicionales (fuera del scope estricto, pero relevantes)

### 6.1 🔴 D — Error 400 silenciado (sin toast)

[`customer-selector.component.ts:106-119`](../src/app/shared/components/customer-selector/customer-selector.component.ts#L106-L119):

```
async saveNewCustomer(): Promise<void> {
  …
  this.isSavingNew.set(true);
  try {
    const customer = await this.customerService.createCustomer(this.createForm);
    this.selectResult(customer);
    this.showCreateDialog.set(false);
  } catch {
    // Error handled by CustomerService toast
  } finally {
    this.isSavingNew.set(false);
  }
}
```

El comentario dice "Error handled by CustomerService toast". **Pero `CustomerService.createCustomer` NO maneja errores** — [líneas 111-118](../src/app/core/services/customer.service.ts#L111-L118):

```
async createCustomer(data: CreateCustomerRequest): Promise<Customer> {
  const customer = await firstValueFrom(
    this.api.post<Customer>('/customers', data),
  );
  await this.db.customers.put(customer);
  …
  return customer;
}
```

No hay try/catch ni `MessageService.add` en el service. El error 400 se propaga al `await firstValueFrom`, lanza, y el componente lo atrapa con `catch {}` vacío. **El cashier nunca ve el error.** El dialog se queda abierto, el spinner desaparece, y "no pasa nada" aparente.

Esto es deuda técnica adicional — el comentario es incorrecto.

### 6.2 🟡 E — Form usa `[(ngModel)]` sobre objeto plain (no Reactive Forms)

[`.claude/html-standards.md:97-105`](../.claude/html-standards.md#L97-L105) manda `<form [formGroup]>` con `FormGroup` y `Validators`. El componente usa:

```
createForm: CreateCustomerRequest = { name: '', phone: '' };
```

Con `[(ngModel)]` en cada input. Mismo gris ya documentado en FDD-024 y FDD-025: el doc lo manda, varios components no lo siguen.

### 6.3 🟢 F — `Customer` model FE usa `name` único en read path también

[`customer.model.ts:9`](../src/app/core/models/customer.model.ts#L9):

```
/** Full name */
name: string;
```

Y los métodos de search ordenan por `name` ([`customer.service.ts:53, 116, 204`](../src/app/core/services/customer.service.ts#L53)). Si el backend ya migró a `firstName`/`lastName`, **el read path también podría romperse** — pero el usuario solo reportó el create path. **Verificación pendiente**: traer un `Customer` desde `/customers` y revisar si sus campos llegan como `name` o como `firstName/lastName`. No estoy en posición de verificar runtime.

### 6.4 🟢 G — `openCreate` usa el query como semilla del nombre

[`customer-selector.component.ts:100-103`](../src/app/shared/components/customer-selector/customer-selector.component.ts#L100-L103):

```
openCreate(): void {
  this.createForm = { name: this.query().trim(), phone: '' };
  this.showCreateDialog.set(true);
}
```

Si la búsqueda escribió "Juan Pérez", el dialog abre con el nombre pre-llenado. Buena UX — pero refuerza el problema A: el string llega entero al payload sin partirse.

---

## 7. Resumen de severidad

| ID | Hallazgo | Severidad | Bloquea uso? |
|---|---|---|---|
| A | Payload mismatch — FE envía `name`, BE exige `firstName` | 🔴 **Crítico** | **Sí** — bloquea el create completamente |
| B | `<p-dialog>` sin `appendTo="body"` | 🔴 Alto | UX roto pero no bloquea (modal sí abre, mal posicionado) |
| C | Placeholders redundantes (Nombre, Teléfono) | 🟢 Bajo | No |
| D | Error 400 silenciado, sin toast | 🔴 Alto | Indirectamente sí — el cashier no sabe que falló |
| E | Form sin Reactive Forms (no Validators) | 🟡 Medio | No — convención del proyecto |
| F | Posible mismatch de read path (FE `name` vs BE `firstName/lastName`) | 🟡 Medio | Pendiente verificar |
| G | Query como semilla del nombre | 🟢 Info | No |

---

## 8. Resumen del payload mapping actual (lo solicitado)

> **Pregunta del audit:** "Analyze how the form values (specifically the 'Nombre' field) are being mapped to the payload before calling the service."

### Cadena completa de transformación

```
┌────────────────────────────────────────────────────────────────┐
│ Usuario teclea en input "Nombre" (placeholder "Juan Pérez")   │
│                          ↓                                     │
│ [(ngModel)]="createForm.name"                                  │
│                          ↓ (sin transformar)                   │
│ createForm: CreateCustomerRequest = { name: 'Juan Pérez', … } │
│                          ↓ (sin transformar)                   │
│ customerService.createCustomer(this.createForm)                │
│                          ↓ (sin transformar)                   │
│ api.post<Customer>('/customers', data)                         │
│                          ↓                                     │
│ HTTP body: {"name":"Juan Pérez","phone":"6671234567"}          │
└────────────────────────────────────────────────────────────────┘

         ❌ Backend rechaza con 400: "FirstName is required"
```

### Verdict

**Mapping actual = identidad (pass-through).** El campo "Nombre" (string único) se envía verbatim como `name` en el payload. **No hay división por espacios, no hay alias, no hay capa adaptadora.**

El frontend nunca aprendió que el backend cambió a `firstName/lastName` (o el backend se construyó con un contrato distinto al asumido por el modelo FE). **La causa del 400 es structural, no de UI.**

### Las tres rutas posibles para resolverlo (no parte del audit, solo enumeradas)

1. **FE-only mapper en `CustomerService`**: partir `data.name` por el primer espacio → `{ firstName, lastName }` antes del POST. Mínimo refactor; no toca model.
2. **Refactor del modelo FE**: dividir `Customer.name` → `firstName + lastName + computed name getter`. Toca todos los consumers (search, sort, chip, dropdown).
3. **Backend acepta `name`**: si el contrato BE ya soporta `name` en algún feature flag, activarlo. Out of scope del FE.

---

**Fin del audit.** Este documento describe el estado actual sin modificar archivos. Implementación queda a la espera de FDD que no es parte de esta task.
