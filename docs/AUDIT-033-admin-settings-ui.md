# AUDIT-033 — Back Office Settings / Configuración UI

**Tipo:** Análisis puro (sin modificaciones)
**Branch:** `fix/pos-to-admin-routing-auth`
**Fecha:** 2026-04-20
**Scope:** `/admin/settings` — tab structure, feature gating, form cleanliness.

---

## 1. Archivos inspeccionados

| Artefacto | Ubicación |
|---|---|
| Componente raíz | [admin-settings.component.ts](../src/app/modules/admin/components/settings/admin-settings.component.ts) |
| Template | [admin-settings.component.html](../src/app/modules/admin/components/settings/admin-settings.component.html) |
| Tab hermano (Impresoras) | [admin-printer-settings.component.ts](../src/app/modules/admin/components/settings/printer-settings/admin-printer-settings.component.ts) |

---

## 2. Respuestas a las tres preguntas

### 2.1 ¿Qué tabs existen hoy?

Ocho tabs declaradas en `activeTab` ([admin-settings.component.ts:68](../src/app/modules/admin/components/settings/admin-settings.component.ts#L68)):

| Tab | Copy | Contenido |
|---|---|---|
| `business` | Negocio | Info del negocio (nombre, ubicación, teléfono), giro read-only, flags operacionales read-only, config de folios |
| `device` | Dispositivo | Nombre + selector de `mode` del dispositivo actual (cashier/tables/kitchen/kiosk) |
| `peripherals` | Periféricos | Impresora térmica (Serial/BT), Escáner USB-HID, Báscula (disabled hardcoded) |
| `security` | Seguridad | Cambio de PIN |
| `fiscal` | Fiscal | RFC, Razón Social, Régimen SAT, CP para CFDI |
| `billing` | Facturación | Plan actual, badges de estado Stripe, opciones de upgrade, cancelación |
| `printers` | Impresoras | Delegada a `AdminPrinterSettingsComponent` (pantallas de cocina, destinos de impresión por categoría) |
| `branches` | Sucursales | CRUD de sucursales + copia de catálogo matrix (**solo Owner**) |

### 2.2 ¿Respetan la matriz de features?

**No.** La búsqueda de `hasFeature`, `hasAnyFeature`, `tenantContext.` o `FeatureKey.` en todo el folder de settings devuelve **cero matches**. `TenantContextService` no se inyecta aquí.

El gating actual usa mecanismos legacy:

- **`ConfigService.hasKitchen()` / `hasTables()`** (flags de la sucursal activa) — usados en `availableModes` ([admin-settings.component.ts:89-99](../src/app/modules/admin/components/settings/admin-settings.component.ts#L89-L99)) para filtrar el selector de modo.
- **`authService.primaryMacroCategoryId()`** — usado en `showKitchenToggle` / `showTablesToggle` ([admin-settings.component.ts:258-268](../src/app/modules/admin/components/settings/admin-settings.component.ts#L258-L268)) para decidir qué toggles mostrar en el diálogo de sucursales.

**Consecuencia concreta:** un tenant Free de FoodBeverage verá el modo "Kiosko" ofrecido en la tab Dispositivo aunque no tenga la feature `KioskMode`. Un Retail con una sucursal marcada `hasKitchen=true` (posible por data legacy) verá el modo "Cocina" aunque no tenga `KdsBasic`. El nuevo `admin-devices.component` (FDD-015) **sí usa** `tenantContext.hasAnyFeature([...])` para el dropdown de modos del generador de códigos — Settings quedó atrás.

Las tabs `fiscal`, `billing`, `peripherals` y `printers` **se muestran a todos** sin gating. No se consulta `CfdiInvoicing` para ocultar la tab Fiscal en Free; no se consulta ninguna feature para la báscula o las impresoras adicionales de destino.

### 2.3 Deuda UX / lógica

**Duplicación y conflictos arquitectónicos**

1. **Dos tabs de impresión:** `Periféricos` y `Impresoras`. La primera configura la térmica local del dispositivo; la segunda es `AdminPrinterSettingsComponent` (destinos de impresión por categoría / cocina). Navegación confusa — el usuario no sabe dónde está cada cosa.
2. **Tab `Dispositivo` vs. nuevo `admin-devices`:** tras FDD-015 los admins ahora gestionan la flota vía `/admin/devices` (generar códigos, lista, revoke, edit). Esta tab en Settings sigue permitiendo **cambiar el modo del dispositivo actual** desde el Back Office, rompiendo la filosofía "Zero-Friction" — el modo debería venir pre-asignado por el código y cambiarse vía admin-devices (hoy `update()` solo cambia nombre+branch, no mode; pero la tab Settings **sí** permite cambiarlo localmente y persistir en localStorage).

**Gating roto / fuera de matriz**

3. **`availableModes` filtra por sucursal, no por feature.** Debería usar `tenantContext.hasAnyFeature([KdsBasic, RealtimeKds])` para kitchen, `[TableMap, WaiterApp]` para tables, `[KioskMode]` para kiosk — idéntico a `admin-devices.component.ts:74-88`.
4. **Modo `'kiosk'` marcado con `badge: 'Beta'` e `show: true` incondicional** ([admin-settings.component.ts:97](../src/app/modules/admin/components/settings/admin-settings.component.ts#L97)). Visible hasta para Retail/Services que no pueden usarlo.
5. **Tab `fiscal` sin gating.** Debería ocultarse si el tenant no tiene `CfdiInvoicing` (feature de Basic+ per matrix §1.1-1.2). Hoy un Free ve campos CFDI inertes.
6. **Báscula en `peripherals` con botón "Disponible en Retail" deshabilitado** ([admin-settings.component.html:562](../src/app/modules/admin/components/settings/admin-settings.component.html#L562)) — copy hardcoded, no consulta macro ni feature.
7. **Tab `branches` Owner-only** ([admin-settings.component.html:70](../src/app/modules/admin/components/settings/admin-settings.component.html#L70)) — FDD-013 consolidó que Manager es Back Office de primera clase (`BACK_OFFICE_ROLES = [Owner, Manager]`). Manager tiene acceso a `/admin` pero no puede gestionar sucursales; inconsistencia con `isBackOfficeRole`.
8. **`billing.upgradeOptions`** ([admin-settings.component.ts:194-221](../src/app/modules/admin/components/settings/admin-settings.component.ts#L194-L221)) muestra "Enterprise" y "Basic" en todos los tenants sin consultar `AVAILABLE_PLANS_BY_MACRO` del onboarding. A un Retail/Services se le puede ofrecer un upgrade que la matriz prohíbe.

**Campos rotos o muertos**

9. **`businessPhone` nunca se persiste.** Comentario explícito en [admin-settings.component.ts:115](../src/app/modules/admin/components/settings/admin-settings.component.ts#L115): `/** Phone field — local only, not persisted yet */`. El usuario lo edita, pulsa "Guardar", y se pierde en el próximo refresh.
10. **`branchForm` defaults inconsistentes:** `openNewBranch` setea `hasKitchen: false, hasTables: false` ([line 579](../src/app/modules/admin/components/settings/admin-settings.component.ts#L579)); en el template inicial del signal `branchForm: { ... hasKitchen: true, hasTables: true }` ([line 107](../src/app/modules/admin/components/settings/admin-settings.component.ts#L107)). Fuente de verdad confusa.
11. **Toggles `hasKitchen` / `hasTables` en el diálogo de sucursales** se muestran solo según macro, pero el texto del card operacional dice "Para modificarlas, contacta a soporte" ([admin-settings.component.html:213](../src/app/modules/admin/components/settings/admin-settings.component.html#L213)) — contradice que el form **sí** permite modificarlas.
12. **`deliveryPlatforms = [UberEats, Rappi, DidiFood]` hardcoded** ([admin-settings.component.ts:271](../src/app/modules/admin/components/settings/admin-settings.component.ts#L271)) — no consulta la feature `DeliveryAggregators` de la matriz.

**UX / organización**

13. **8 tabs es demasiado** para navegación horizontal; en móvil probablemente se desborda. Candidatos a fusión: `Periféricos` + `Impresoras` en un solo "Hardware"; `Fiscal` podría ser sub-sección de `Negocio` o del flujo de `Facturación` de clientes.
14. **`setTab` con side effect** ([admin-settings.component.ts:353-365](../src/app/modules/admin/components/settings/admin-settings.component.ts#L353-L365)) arranca/detiene el ScannerService al entrar/salir de Periféricos. Funcional pero se puede mover a un `effect()`.
15. **`currentGiroInfo` hardcodea descripciones por macro** — duplicación parcial con `MACRO_CATEGORY_LABELS` (que ya importa desde enums). El `description` debería vivir junto a los labels en `config.enum.ts`.
16. **Sin loading state global en el primer render de tabs** — `saveSuccess()` / `saveFolioSuccess()` / `saveFiscalSuccess()` se resetean con `setTimeout(3000)` individuales, patrón duplicado 4 veces. Candidato a helper común.

---

## 3. Resumen ejecutivo

| Dimensión | Estado |
|---|---|
| Tabs visibles | 8 (Negocio · Dispositivo · Periféricos · Seguridad · Fiscal · Facturación · Impresoras · Sucursales[Owner]) |
| Feature flag gating | **Ausente.** 0 matches de `hasFeature` / `FeatureKey` en el folder |
| Matriz macro × plan | Solo parcialmente honrada vía `hasKitchen`/`hasTables` y macro; ignora Plans y Features |
| Campos muertos | `businessPhone` (declarado no persistido), báscula siempre disabled |
| Duplicación | Periféricos ↔ Impresoras, Dispositivo ↔ admin-devices (FDD-015) |
| Role gating | `branches` Owner-only — desalineado con `BACK_OFFICE_ROLES` post-FDD-013 |
| Billing matrix | Muestra upgrades Enterprise/Basic incluso a macros que los tienen prohibidos |

**Conclusión:** Settings es la pantalla que **no recibió** la disciplina de la matriz de features. Se comporta como si estuviera en 2025 mientras que `admin-devices`, `onboarding` y `device-routing` ya migraron. Consolidar aquí antes del push final es obligatorio — hay 3 duplicaciones visibles al usuario (dos tabs de impresión, `Dispositivo` vs flota), 1 campo muerto (`businessPhone`), y varios gatings que muestran funciones que el plan/macro prohíbe.

Sin modificaciones a archivos. Documento cerrado.
