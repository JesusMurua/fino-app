# AUDIT-057 — Re-invented Wheels: Custom UI vs PrimeNG

**Fecha:** 2026-05-09
**Branch:** `fix/giro-ux`
**Alcance:** Frontend (Angular 18 + PrimeNG 17). Solo auditoría — sin cambios de código.
**Objetivo:** Identificar dónde se reimplementan en HTML/CSS componentes que ya existen en PrimeNG (autocompletes, dropdowns, buttons, dialogs), y cuantificar la deuda de duplicación SCSS resultante.

---

## TL;DR

| Categoría | Severidad | Hallazgo principal |
|---|---|---|
| Custom dropdowns | 🔴 Alto | 2 autocompletes hechos a mano (`customer-selector`, `access-control`) que deberían ser `<p-autoComplete>` |
| Botones BEM duplicados | 🔴 Alto | ≥ 17 bloques `__btn` reimplementan `<p-button>` con el mismo shape visual; **comentario explícito en el código admite la duplicación** |
| Hacks de overflow en `<p-dialog>` | 🟡 Medio | 2 archivos fuerzan `overflow: visible` para que el dropdown custom se salga del cuerpo del diálogo |
| Toggles re-implementados | 🟡 Medio | `view-toggle` (3 copias pixel-idénticas) reimplementa `<p-selectButton>` |

La causa raíz transversal: **no se está usando la librería PrimeNG ya instalada** para componentes que requieren posicionamiento (autocomplete, dropdown, selectButton). Cada custom workaround arrastra:
1. SCSS duplicado en cada componente que lo consume.
2. Hacks en el contenedor (overflow visible) para que la capa absoluta no se recorte.
3. Comportamiento inconsistente en focus, teclado, accesibilidad y `appendTo="body"`.

---

## Sección 1 — Custom Dropdowns / Autocompletes

### 1.1 `customer-selector` — Autocomplete reimplementado

**Archivo:** [src/app/shared/components/customer-selector/customer-selector.component.html](src/app/shared/components/customer-selector/customer-selector.component.html#L42-L58)
**SCSS:** [customer-selector.component.scss:144](src/app/shared/components/customer-selector/customer-selector.component.scss#L144-L220)

Implementa a mano todo lo que `<p-autoComplete>` hace de fábrica:

```html
<!-- HTML actual (líneas 42-58) -->
<div class="cs-dropdown">
  @for (c of results(); track c.id) {
    <button type="button" class="cs-dropdown__item" (mousedown)="selectResult(c)">
      <span class="cs-dropdown__avatar">…</span>
      <div class="cs-dropdown__info">…</div>
    </button>
  }
</div>
```

```scss
/* SCSS — el dropdown es un layer absoluto manual */
.cs-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 10;
  …
}
```

**Lo que PrimeNG ya provee y aquí se reimplementa manualmente:**

| Feature | `<p-autoComplete>` | Custom `cs-dropdown` |
|---|---|---|
| Posicionamiento absoluto sobre input | ✅ built-in | Reimplementado con `position: absolute` |
| `appendTo="body"` para escapar dialogs | ✅ built-in | ❌ no existe → forza overflow hack |
| Manejo de focus / blur | ✅ built-in | `(blur)="onBlur()"` manual |
| Keyboard navigation (↑↓ Enter Esc) | ✅ built-in | ❌ ausente |
| ARIA roles / accesibilidad | ✅ built-in | Parcial |
| Item template | ✅ `pTemplate="item"` | `@for` con HTML duplicado |

**Consumidores afectados (heredan el problema):**

- [cart-panel.component.html:339](src/app/modules/pos/components/cart-panel/cart-panel.component.html#L339) — fuerza `overflow: visible` solo para que este dropdown no se recorte (ver Sección 3.1).
- [reservation-form.component.html:34](src/app/modules/admin/components/reservations/reservation-form.component.html#L34) — mismo problema, mismo hack ([reservation-form.component.html:8](src/app/modules/admin/components/reservations/reservation-form.component.html#L8)).

**Bonus de duplicación:** el modal de "Nuevo cliente" embebido en el mismo componente ([customer-selector.component.html:62-124](src/app/shared/components/customer-selector/customer-selector.component.html#L62-L124)) define **otro** par de botones custom `.cs-btn--primary` / `.cs-btn--ghost` ([customer-selector.component.scss:269-297](src/app/shared/components/customer-selector/customer-selector.component.scss#L269-L297)).

---

### 1.2 `access-control` (recepción / gym) — Autocomplete reimplementado con `<ul>`/`<li>`

**Archivo:** [src/app/modules/reception/pages/access-control/access-control.component.html:42-57](src/app/modules/reception/pages/access-control/access-control.component.html#L42-L57)
**SCSS:** [access-control.component.scss:95-143](src/app/modules/reception/pages/access-control/access-control.component.scss#L95-L143)

```html
<!-- Resultados de búsqueda con role="listbox" hecho a mano -->
@if (results().length > 0) {
  <ul class="access-control__results" role="listbox">
    @for (customer of results(); track customer.id) {
      <li>
        <button type="button" class="access-control__result" (click)="selectCustomer(customer)">
          <span class="access-control__result-name">…</span>
          <span class="access-control__result-phone">…</span>
        </button>
      </li>
    }
  </ul>
}
```

```scss
.access-control__results {
  position: absolute;          /* otra capa absoluta manual */
  top: calc(100% - 8px);
  left: 24px; right: 24px;
  list-style: none;
  background: #ffffff;
  border-radius: 12px;
  …
}
```

Caso de uso 100% análogo al anterior: input + dropdown de resultados → `<p-autoComplete>` con `[forceSelection]` y un `<ng-template pTemplate="item">` cubriría exactamente lo mismo, ganando keyboard nav + ARIA real + escape de contenedor automático.

---

### 1.3 Resumen Sección 1

| # | Componente | Líneas SCSS dedicadas | Reemplazo PrimeNG |
|---|---|---|---|
| 1 | `customer-selector` (`.cs-search` + `.cs-dropdown`) | ~140 | `<p-autoComplete>` |
| 2 | `access-control` (`.access-control__results`) | ~50 | `<p-autoComplete>` |

> Ambos casos son los **únicos** custom autocompletes encontrados. No se detectaron `<select>` nativos sustituibles por `<p-dropdown>` adicionales — el resto de pantallas ya usa `<p-dropdown>`/`<p-autoComplete>` (greppable: 49 archivos).

---

## Sección 2 — Botones & Duplicación SCSS (Encapsulation Debt)

### 2.1 El patrón duplicado

Un único patrón visual — botón de modal con variantes `--primary` (verde marca, hover #15803D) y `--ghost` (transparente, borde #E5E7EB) — está reimplementado **al menos 17 veces** bajo distintos prefijos BEM, cada uno encerrado en la encapsulación de su componente.

#### Inventario de bloques `__btn` duplicados

| # | Archivo | Bloque BEM | Líneas |
|---|---|---|---|
| 1 | [quick-pay.component.scss](src/app/modules/pos/components/quick-pay/quick-pay.component.scss#L285) | `.customer-form__btn` | 285-322 |
| 2 | [admin-customers.component.scss](src/app/modules/admin/components/customers/admin-customers.component.scss#L551) | `.customer-form__btn` | 551-584 |
| 3 | [payment-processing-dialog.component.scss](src/app/modules/pos/components/payment-processing-dialog/payment-processing-dialog.component.scss#L187) | `.ppd__btn` | 187-220 |
| 4 | [reservation-form.component.scss](src/app/modules/admin/components/reservations/reservation-form.component.scss#L341) | `.rf__btn` | 341-370 |
| 5 | [orders-list.component.scss](src/app/modules/orders/orders-list.component.scss#L198) | `.cancel-dialog__btn` | 198-232 |
| 6 | [orphaned-orders.component.scss](src/app/modules/admin/components/orphaned-orders/orphaned-orders.component.scss#L204) | `.reconcile-dialog__btn` | 204-236 |
| 7 | [checkout.component.scss](src/app/modules/pos/components/checkout/checkout.component.scss#L928) | `.table-release__btn` | 928-956 |
| 8 | [checkout.component.scss](src/app/modules/pos/components/checkout/checkout.component.scss#L1030) | `.kitchen-confirm__btn` | 1030-1055 |
| 9 | [pos-header.component.scss](src/app/modules/pos/components/pos-header/pos-header.component.scss#L999) | `.receipt-modal__btn-primary` / `__btn-ghost` / `__btn-icon` | 999-1050 |
| 10 | [pos-header.component.scss](src/app/modules/pos/components/pos-header/pos-header.component.scss#L1120) | `.sync-center__btn` | 1120-1149 |
| 11 | [customer-selector.component.scss](src/app/shared/components/customer-selector/customer-selector.component.scss#L269) | `.cs-btn` | 269-297 |
| 12 | [setup-required.component.scss](src/app/modules/setup-required/setup-required.component.scss#L64) | `.setup-required__btn` | 64+ |
| 13 | [kiosk-shell.component.scss](src/app/modules/kiosk/kiosk-shell.component.scss#L71) | `.idle-card__btn` | 71+ |
| 14 | [kitchen-order-card.component.scss](src/app/modules/kitchen/kitchen-order-card.component.scss#L155) | `.kds-card__btn` | 155+ |
| 15 | [update-banner.component.scss](src/app/shared/components/update-banner/update-banner.component.scss#L22) | `__btn` (banner) | 22+ |
| 16 | [install-banner.component.scss](src/app/shared/components/install-banner/install-banner.component.scss#L28) | `__btn` (banner) | 28+ |
| 17 | [error-config.component.ts](src/app/modules/pos/components/error-config/error-config.component.ts#L41) | `.error-config__btn` (estilos inline en el TS) | 41-50 |
| 18 | [admin-customers.component.scss](src/app/modules/admin/components/customers/admin-customers.component.scss#L16) | `.customers-header__btn` | 16+ |
| 19 | [admin-shell.component.scss](src/app/modules/admin/admin-shell.component.scss#L329) | `.topbar__btn` | 329+ |

### 2.2 Evidencia: el código admite la duplicación

[quick-pay.component.scss:277-283](src/app/modules/pos/components/quick-pay/quick-pay.component.scss#L277-L283) lo dice textual:

```scss
// ==========================================================================
// Footer action buttons — BEM classes mirror the dialog convention used in
// admin-customers.component.scss so cancel/confirm look identical across
// every modal in the app. Angular's view encapsulation requires the
// duplicate definition here; future cleanup may extract these to a shared
// `_dialog-buttons.scss` partial.
// ==========================================================================
```

> Es decir: el equipo es consciente de que está duplicando y dejó la nota para "future cleanup". Esa limpieza es justo el alcance de esta auditoría.

### 2.3 Diff visual entre las 17 copias

Casi todas comparten el mismo "shape":

```scss
display: inline-flex; align-items: center; justify-content: center;
gap: $space-2;
min-height: 40-48px;             // varía 40 / 44 / 48 / 56
padding: $space-2 $space-4;       // varía $space-3 $space-5 en algunas
border-radius: 8-12px;            // varía
font-weight: 600-700;
font-family: inherit;
cursor: pointer;
transition: …;

&--primary { background: $color-primary; color: white; &:hover { background: #15803D; } }
&--ghost   { background: transparent;     border: 1px solid #E5E7EB; color: $color-text-sub; }
```

Las pequeñas variaciones (40 vs 48, 8px vs 12px de radius) son probablemente **drift no intencional** por copy-paste, no decisiones de diseño — confirmable porque el design system en `CLAUDE.md` define una sola escala.

### 2.4 Bloques no-button también duplicados

#### `view-toggle` — toggle 2-opciones (debería ser `<p-selectButton>`)

Tres copias **pixel-idénticas** del mismo widget:

| Archivo | Líneas |
|---|---|
| [pos-header.component.scss](src/app/modules/pos/components/pos-header/pos-header.component.scss#L10) | 10+ |
| [product-grid.component.scss](src/app/modules/pos/components/product-grid/product-grid.component.scss#L47-L80) | 47-80 |
| [product-grid-inner.component.scss](src/app/modules/pos/components/product-grid-inner/product-grid-inner.component.scss#L87-L119) | 87-119 |

Cada una define el contenedor `.view-toggle` + el modificador `&__btn--active`. Es exactamente lo que `<p-selectButton>` resuelve con `[options]` y `optionLabel`/`optionValue`.

#### Botones outline aislados (no encajan en BEM dialog pero sí son `<p-button [outlined]>`):

- [checkout.component.scss:959](src/app/modules/pos/components/checkout/checkout.component.scss#L959) — `.btn-ticket`
- [checkout.component.scss:979](src/app/modules/pos/components/checkout/checkout.component.scss#L979) — `.btn-invoice`
- [cart-panel.component.scss:565](src/app/modules/pos/components/cart-panel/cart-panel.component.scss#L565) — `.coupon-input-row__btn`

### 2.5 Resumen Sección 2

| Métrica | Valor |
|---|---|
| Bloques `__btn` con shape duplicado | **≥ 17** |
| SCSS estimado redundante | ~600 líneas |
| Archivos involucrados | 14+ |
| Existe SCSS partial central (ej. `src/styles/_buttons.scss`)? | ❌ No (solo `_variables.scss`, `_layout.scss`, `_touch.scss`) |
| `<p-button>` / `pButton` ya en uso en el repo | ✅ 49 archivos — patrón mixto |

---

## Sección 3 — Hacks & Workarounds (Overflow patches en `<p-dialog>`)

### 3.1 `cart-panel` — gym beneficiary selector

**Archivo:** [cart-panel.component.html:326-352](src/app/modules/pos/components/cart-panel/cart-panel.component.html#L326-L352)

```html
<!-- Beneficiary selector dialog (Gym vertical).
     `contentStyle.overflow: 'visible'` lets the customer-selector's
     custom dropdown (`.cs-dropdown`, `position: absolute`) escape the
     dialog body bounds instead of getting clipped. The selector is a
     custom component, not a PrimeNG autocomplete, so the standard
     `appendTo="body"` knob does not apply here. -->
<p-dialog
  …
  [contentStyle]="{ overflow: 'visible' }"
  header="Selecciona el beneficiario"
>
  <app-customer-selector … />
</p-dialog>
```

El comentario in-source describe **textualmente la deuda**: el hack existe únicamente porque el `customer-selector` es custom y no soporta `appendTo="body"`. Reemplazar el selector por `<p-autoComplete appendTo="body">` elimina este `[contentStyle]`.

### 3.2 `reservation-form` — formulario de reservación

**Archivo:** [reservation-form.component.html:1-11](src/app/modules/admin/components/reservations/reservation-form.component.html#L1-L11)

```html
<p-dialog
  …
  [contentStyle]="{ padding: '0', overflow: 'visible' }"
  styleClass="rf-dialog"
>
```

Caso paralelo: el dialog contiene `<app-customer-selector>` (línea 34) + tres `<p-calendar [appendTo]="'body'">` (líneas 89-119). Los calendars sí escapan correctamente; el `overflow: visible` queda forzosamente porque el `customer-selector` no puede hacer `appendTo`. Mismo origen, misma cura.

### 3.3 Búsqueda transversal

`grep` confirma que **solo existen estas 2 instancias** de `[contentStyle]` con `overflow: 'visible'` en todo el repo. Ningún otro `::ng-deep p-dialog-content overflow` ni `!important` workarounds. Es decir: **eliminar el custom dropdown elimina 100% de los hacks de overflow del repo**.

### 3.4 Resumen Sección 3

| Hack | Archivo | Causa |
|---|---|---|
| `[contentStyle]="{ overflow: 'visible' }"` | [cart-panel.component.html:339](src/app/modules/pos/components/cart-panel/cart-panel.component.html#L339) | `customer-selector` custom dropdown |
| `[contentStyle]="{ padding: '0', overflow: 'visible' }"` | [reservation-form.component.html:8](src/app/modules/admin/components/reservations/reservation-form.component.html#L8) | `customer-selector` custom dropdown |

---

## Apéndice — Métricas globales

| Indicador | Valor |
|---|---|
| Archivos con clases BEM `__btn` definidas | 23 |
| Archivos consumiendo PrimeNG `<p-button>` / `pButton` | 49 |
| Archivos consumiendo `<p-autoComplete>` o `<p-dropdown>` | 49 |
| Archivos definiendo `position: absolute` para dropdowns custom | 21 (revisar caso por caso, no todos son dropdowns) |
| Globales SCSS reutilizables en `src/styles/` | 3 (`_variables`, `_layout`, `_touch`) — **ningún partial de buttons/forms** |
| Hacks `overflow: visible` en `<p-dialog>` | 2 (ambos por causa única) |

---

## Conclusión (sin proponer implementación)

La deuda está **concentrada en un solo eje**: la decisión —histórica— de implementar el autocomplete de cliente a mano (`customer-selector`). Esa decisión:

1. **Bloquea `appendTo="body"`** → fuerza dos hacks de `overflow: visible` en dialogs.
2. **Replica el patrón** en `access-control` (gym) por mimetismo.
3. **No mueve la aguja** del problema mayor (botones BEM duplicados), que es independiente y ortogonal: ese ya estaba documentado como deuda en el propio código (`quick-pay.component.scss:277-283`).

Existen por tanto **dos campañas de cleanup** distintas y separables, ambas confirmables sin diseño nuevo:

- **Campaña A — Custom dropdowns → PrimeNG**: 2 componentes (`customer-selector`, `access-control`) → elimina 2 hacks de overflow.
- **Campaña B — Botones BEM → `<p-button>` o partial `_buttons.scss`**: ≥ 17 bloques duplicados → elimina ~600 líneas de SCSS y unifica drift visual.

> **Pendiente de instrucciones** sobre qué campaña ejecutar primero, alcance, y si prefieres `<p-button>` directo vs partial SCSS compartido como mecanismo de unificación.
