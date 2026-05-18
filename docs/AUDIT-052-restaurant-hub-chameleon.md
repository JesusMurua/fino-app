# AUDIT-052 — `RestaurantHubComponent` vs `UnifiedPosComponent`: ¿es deuda o es frontera?

**Date:** 2026-05-04
**Branch:** `fix/giro-ux`
**Scope:** Análisis arquitectural del por qué `RestaurantHubComponent` quedó **fuera** del refactor camaleón (AUDIT-050). El usuario aplica un mandato de Cero Deuda Técnica y quiere evidencia de si esto es un decisión arquitectural válida o un atajo que hay que cobrar después.
**Output:** Veredicto + redacción canónica para los manuales de arquitectura. **Sin cambios de código.**

---

## Executive Summary (verdict)

**Mantenerlos separados es la decisión correcta.** No es deuda técnica — es una **frontera de contexto delimitado** (bounded context) entre dos modelos de negocio fundamentalmente distintos:

- **Fast-Lane POS** (`UnifiedPosComponent` en `/pos/sell`) — venta lineal de un solo carrito: tocar producto → cobrar → siguiente cliente. No hay estado entre ventas.
- **Full-Service F&B** (`RestaurantHubComponent` en `/pos`) — orquestación multi-canal con estado persistente: floor map de mesas vivas, ciclo de cocina, operaciones sobre órdenes abiertas (merge/split/move), reservaciones, delivery externo.

Forzar la fusión genera un *God Object* que perjudica las dos experiencias: el cajero de Fast-Lane carga ~3 700 líneas de lógica F&B que nunca usa, y el mesero de F&B pierde el modelo mental de "el floor map ES el POS" para entrar a un toggle teclado/cuadrícula que no le aplica.

> **Regla durable**: el camaleón consolida verticales con la **misma topología transaccional** (1 carrito ↔ 1 venta linealizada). El hub F&B vive en otra topología (N carritos ↔ N órdenes abiertas con ciclo de vida en cocina). Las dos no se cruzan sin romper el modelo.

---

## 1 — Responsabilidades & Complejidad

### 1.1 Lo que orquesta `UnifiedPosComponent`

[unified-pos.component.ts](src/app/modules/pos/components/unified-pos/unified-pos.component.ts) — **150 LOC**. Único trabajo:

- Montar `<app-pos-header>` + `<app-cart-panel>` + un slot que alterna entre `<app-keypad-stage>` y `<app-product-grid-inner>` según `PosViewModeService.viewMode()`.
- Iniciar/parar `ScannerService` cuando viewMode cambia (grid → on, keypad → off, evita inputs fantasma).
- Sembrar el default de viewMode a partir de `tenantContext.posExperience()` la primera vez.

**Topología**: 1 cajero ↔ 1 carrito ↔ 1 venta. Al cobrar, el cart se vacía y queda listo para la siguiente.

### 1.2 Lo que orquesta `RestaurantHubComponent`

[restaurant-hub.component.ts](src/app/modules/pos/pages/restaurant-hub/restaurant-hub.component.ts) (80 LOC en sí mismo, pero compone tres subsistemas pesados):

| Canal | Componente compuesto | LOC del subsistema | Qué orquesta |
|---|---|---:|---|
| Mesas (Tables) | [`<app-tables>`](src/app/modules/tables/tables.component.ts) | 1 215 TS + 761 HTML + 1 139 SCSS | Floor map por zonas, polling cada 15 s, reservaciones, ciclo de mesa (libre / ocupada / reservada / sucia / por limpiar), dialogs de merge / split-equal / split-items / move-items / reserved-table / dirty-table |
| Para Llevar (Takeout) | [`<app-product-grid>`](src/app/modules/pos/components/product-grid/product-grid.component.ts) | shell completo legacy con cart-panel embebido | Walk-up de mostrador con misma cart-panel pero ramificada por `isFoodAndBeverage()` y `hasKitchen()` para enviar comandas a cocina si aplica |
| Delivery | placeholder + [`<app-delivery-panel>`](src/app/modules/pos/components/delivery-panel/delivery-panel.component.ts) overlay | 65 LOC de panel + 153 LOC de service | Órdenes externas Uber Eats / Rappi / DiDi Food; monitor en tiempo real |

**Servicios F&B-only (no consumidos por unified-pos)**:

| Servicio | LOC | Razón de existir |
|---|---:|---|
| [`TableService`](src/app/core/services/table.service.ts) | 263 | Endpoints `move-items`, `merge-orders`, `split-by-items`, `split-equal`, `getTableStatuses` |
| [`OrderContextService`](src/app/core/services/order-context.service.ts) | 188 | Tracking persistente (sessionStorage) de `activeTable`, `addingToOrder`, `activeOrder` — el "carrito" puede pertenecer a una mesa específica o estar agregándose a una orden ya en cocina |
| [`ReservationService`](src/app/core/services/reservation.service.ts) | 133 | Confirmadas / walk-in / conflictos |
| [`ZoneService`](src/app/core/services/zone.service.ts) | 55 | Agrupación de mesas por zona física |
| [`TableAssignmentService`](src/app/core/services/table-assignment.service.ts) | 133 | Asignar mesa a orden ya creada (FDD-001) |

**Topología F&B**: 1 cajero ↔ N órdenes simultáneamente abiertas (una por mesa) ↔ ciclo de cocina (Pending → InProgress → Ready → Delivered) ↔ posibles N+1 órdenes resultantes (split) o N-1 (merge) ↔ N tickets impresos.

### 1.3 Diferencia estructural en el `cart-panel` (componente compartido)

El `<app-cart-panel>` ya está bifurcado internamente vía dos signals:

```typescript
readonly isFoodAndBeverage = computed(() =>
  this.tenantContext.currentMacro() === MacroCategoryType.FoodBeverage,
);
readonly showSendToKitchen = computed(() => this.configService.hasKitchen());
```

Cuando es F&B + tiene cocina:
- Botón **"Enviar a cocina"** + **"Cobrar directo"** (walk-up bar)
- Selector de mesa (`canAssignTable()`)
- Modo "agregando a orden #N" cuando se están añadiendo items a una orden ya enviada a cocina
- Cancelar agregando items → vuelve a `/tables`

Cuando NO es F&B:
- Solo botón **"Cobrar"** que abre el `<app-quick-pay>` inline (no `/pos/checkout`)

Es decir: el cart-panel **ya conoce** ambos mundos pero los gates dejan entrar exactamente la complejidad necesaria por contexto. Esa bifurcación es sana porque vive en **un solo punto** y porque el resto del shell (header / catálogo / keypad) es agnóstico.

---

## 2 — Factibilidad de fusión: ¿es deuda?

Hipótesis a evaluar: agregar `viewMode='tables'` a `PosViewModeService` y absorber `<app-tables>` como un tercer stage del camaleón.

### 2.1 Coste técnico de la fusión

- `UnifiedPosComponent` pasaría de 150 LOC a importar 3 115 LOC adicionales (TablesComponent + template + estilos). El bundle size de la ruta `/pos/sell` se infla para tenants Retail / Services que **nunca abren mesas**. No es lazy-friendly: el toggle de viewMode es síncrono.
- Tendríamos que decidir **dónde vive el cart-panel** en modo tables. En F&B hoy el cart aparece flotando dentro de la cuadrícula de takeout, pero en floor map **no hay cart**: el mesero abre una mesa, eso lo dirige a `<app-product-grid>` (con cart-panel propio adentro), que cobra o envía a cocina, y al terminar regresa al floor map. **El floor map NO es un stage paralelo al cart**; es un router visual que dirige hacia stages.
- El `PosViewModeService` actualmente persiste la elección del cajero entre sesiones. ¿Tendría sentido que un mesero F&B persista `viewMode='tables'` y nunca pueda usar el teclado de cobro libre? Probablemente sí, pero entonces el toggle del header (catálogo / teclado) se vuelve irrelevante 90% del tiempo y debería esconderse — exactamente la lógica que el `toggleVisible` ya impone, pero ahora con un tercer caso especial.

### 2.2 Coste de UX

- Para el cajero **Fast-Lane** (Retail / Services), abrir `/pos/sell` y ver un botón "Mesas" en el header es ruido cognitivo: ese tenant no tiene mesas configuradas. Habría que ocultarlo con `hasTables()`. No imposible, pero un gate más.
- Para el mesero **F&B**, el modelo mental hoy es claro: "Mi pantalla principal es el floor map". Forzarle un toggle "teclado / cuadrícula / mesas" implica que **mesas se vuelve una opción** en igualdad con teclado, cuando en realidad mesas es **el contexto raíz** desde el cual se entra a las otras vistas (porque el cobro ocurre por mesa, no en abstracto).

### 2.3 Coste arquitectural — el factor decisivo

Las dos topologías tienen **lifecycles incompatibles**:

| Aspecto | Fast-Lane | Full-Service F&B |
|---|---|---|
| Carritos abiertos al mismo tiempo | 1 | N (uno por mesa ocupada) |
| Persistencia entre transacciones | Carrito se vacía al cobrar | Orden vive desde "abrir mesa" hasta "pagar cuenta" — minutos a horas |
| Estado de cocina | Inexistente | `kitchenStatusId` con polling de 15 s |
| Operaciones inter-orden | Ninguna | move-items, merge-orders, split-by-items, split-equal |
| Origen del carrito activo | Click en producto | Click en mesa → `OrderContextService.setActiveTable()` → eventualmente abre product-grid |
| "Cobrar" significa | Persist + clear cart + print ticket | Liberar mesa + persist + clear + ticket(s) (uno por split o uno consolidado) |
| Walk-up sin mesa | n/a | Sí — canal "Para Llevar" ES un sub-modo Fast-Lane dentro de F&B |

El último renglón es revelador: **F&B ya contiene un sub-modo Fast-Lane** (Para Llevar), pero no al revés. Fast-Lane no contiene Full-Service y nunca lo va a contener sin volverse Full-Service.

### 2.4 Veredicto técnico

**No es deuda. Es una frontera de contexto delimitado.**

Fusionar no resuelve un problema real — solo hace UnifiedPos un God Object con dos modos de operación incompatibles, encarece bundle, complica el mental model y obliga a más gates condicionales en cada subsistema. La consolidación que SÍ tiene sentido (y que ya hicimos en AUDIT-050) es la de verticales con la misma topología transaccional: Retail + Counter + Quick + Services.

---

## 3 — Action Plan

**El veredicto es: KEEPING THEM SEPARATE IS RIGHT (Domain Boundary).**

Por lo tanto, el plan de acción no es código sino **documentación canónica** para que ninguna sesión futura de Claude (incluido yo en otra ventana) interprete esto como deuda y pretenda fusionarlos.

### 3.1 Wording canónico para `.claude/Manual de Arquitectura y Reglas de Negocio - POS.md`

Añadir esta sección como **invariante arquitectural** (no negociable sin nuevo audit):

> ## Frontera de Contexto: Fast-Lane POS vs Full-Service F&B
>
> El módulo POS contiene **dos shells distintos por diseño**, no por accidente histórico:
>
> ### Fast-Lane POS — `UnifiedPosComponent` en `/pos/sell`
>
> Atiende los macro-giros **Retail, Counter, Quick y Services**. Topología transaccional: **1 cajero ↔ 1 carrito ↔ 1 venta linealizada**. Al cobrar, el carrito se vacía y queda listo para el siguiente cliente. No existe estado persistente entre transacciones. La presentación se adapta al giro (catálogo de tiles vs teclado calculadora) vía `PosViewModeService`, pero el flujo subyacente es siempre el mismo: pick → add → pay.
>
> ### Full-Service F&B — `RestaurantHubComponent` en `/pos`
>
> Atiende exclusivamente el macro-giro **Food & Beverage**. Topología transaccional: **1 cajero ↔ N órdenes simultáneamente abiertas** (una por mesa ocupada) ↔ **ciclo de vida en cocina** (Pending → InProgress → Ready → Delivered) ↔ **operaciones inter-orden** (move-items / merge / split-by-items / split-equal). Una orden vive minutos u horas, no segundos. El floor map ES el contexto raíz desde el cual se entra a vistas de cobro o adición de items, no un modo paralelo a ellas.
>
> ### Por qué NO se consolidan
>
> 1. **Lifecycles incompatibles**: el carrito de Fast-Lane es transient (vive ~30 segundos); la orden F&B es persistent (vive horas) y atraviesa estados de cocina que no existen non-F&B.
> 2. **Cardinalidad distinta**: Fast-Lane mantiene `N=1` carritos a la vez; F&B mantiene `N=mesas-ocupadas`.
> 3. **Operaciones inter-orden**: merge / split / move solo tienen sentido cuando hay órdenes abiertas concurrentes — un patrón ausente de Fast-Lane por construcción.
> 4. **Inversión del mental model**: en Fast-Lane el cart es protagonista; en F&B el floor map es protagonista y el cart es un detalle de la mesa activa.
> 5. **Inclusión asimétrica**: F&B ya contiene un sub-modo Fast-Lane (canal "Para Llevar" dentro del hub). Fast-Lane no puede contener F&B sin volverse F&B.
>
> ### Consecuencia operacional
>
> - Cualquier feature que aplique a **ambos contextos** (ej. integración de delivery, sync offline, cash-register sessions, shift management) vive en **servicios o componentes shared** que ambos shells consumen — no se duplica.
> - El `<app-cart-panel>` es el único componente shared que conoce ambos mundos, ramificado vía `isFoodAndBeverage()`. Esa ramificación es sana porque vive en un solo punto.
> - **Nunca se debe** absorber `<app-tables>`, `OrderContextService`, `TableService`, ni el ciclo de cocina en `UnifiedPosComponent`. Si surge la tentación, esta sección debe leerse antes de hacerlo.

### 3.2 Wording canónico para `docs/POS-ARCHITECTURE.md`

Añadir el mismo bloque al inicio (o como sección "Bounded Contexts") y referenciar este audit como justificación.

### 3.3 Memoria de auto-memory para sesiones futuras

Crear una entrada `project_pos_bounded_contexts.md` (`type: project`) con resumen ejecutable:

```markdown
---
name: POS Bounded Contexts (Fast-Lane vs F&B)
description: Por qué UnifiedPosComponent y RestaurantHubComponent NO se fusionan
type: project
---

Fast-Lane POS (`UnifiedPosComponent` en `/pos/sell`, macros Retail/Counter/Quick/Services)
y Full-Service F&B (`RestaurantHubComponent` en `/pos`, macro F&B) son contextos
delimitados separados por diseño.

**Why:** Topologías transaccionales incompatibles. Fast-Lane es 1 carrito ↔ 1 venta
transient. F&B es N órdenes abiertas concurrentes con ciclo de cocina persistente y
operaciones inter-orden (merge/split/move).

**How to apply:** Nunca proponer absorber `<app-tables>`, `TableService`,
`OrderContextService` o el flujo de cocina en `UnifiedPosComponent`. Las features
cross-cutting viven en servicios shared. Detalle: AUDIT-052.
```

---

## Apéndice — Métricas que respaldan el veredicto

```
LOC F&B-específico:
  modules/tables/tables.component.ts ........... 1 215
  modules/tables/tables.component.html .......... 761
  modules/tables/tables.component.scss ......... 1 139
  core/services/table.service.ts ................ 263
  core/services/order-context.service.ts ........ 188
  core/services/reservation.service.ts .......... 133
  core/services/zone.service.ts .................. 55
  core/services/table-assignment.service.ts ..... 133
  ─────────────────────────────────────────────────
  Total F&B-only ............................... 3 887  LOC

LOC UnifiedPosComponent shell + chameleon:
  components/unified-pos/*.{ts,html,scss} ........ ~310
  components/keypad-stage/*.{ts,html,scss} ....... ~470
  components/product-grid-inner/*.{ts,html,scss}.. ~310
  components/quick-pay/*.{ts,html,scss} .......... ~480
  core/services/pos-view-mode.service.ts .......... 78
  ─────────────────────────────────────────────────
  Total Fast-Lane shell ....................... ~1 650  LOC
```

Absorber 3 887 LOC de un dominio incompatible dentro de un shell de 1 650 LOC no es consolidación — es contaminación.

---

**Author:** Claude (AUDIT-052)
**Status:** Análisis completo. Sin cambios de código. Pendiente de aprobación para incorporar el wording canónico al manual de arquitectura.
