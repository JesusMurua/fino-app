# AUDIT-031 — 5 Bugs Críticos E2E: Giro "Servicios Especializados"

**Fecha:** 2026-04-11
**Flujo testeado:** Landing → Registro → Onboarding → Dashboard → Dispositivos → POS para un negocio de giro "Servicios Especializados".

---

## Bug 1 — Handoff "General" en vez de "Servicios"

### Pregunta
¿Por qué cuando la URL manda el giro de servicios especializados, la UI muestra "General"?

### Raíz del problema

**Archivo:** [registration.utils.ts:21-46](src/app/core/utils/registration.utils.ts#L21-L46)

El `GIRO_SLUG_MAP` solo contiene dos entradas para servicios:
```ts
services:  BusinessTypeId.Servicios,
servicios: BusinessTypeId.Servicios,
```

**Faltan aliases** que la landing page probablemente emite para los sub-giros de servicios especializados. Si la landing envía slugs como `estetica`, `consultorio`, `taller`, `servicios-especializados`, o `specialized-services`, **ninguno tiene match** en el mapa.

**Línea 96-104** — el fallback de `resolveBusinessTypeSlug()`:
```ts
export function resolveBusinessTypeSlug(slug: string | null | undefined): BusinessTypeId {
  if (!slug) return BusinessTypeId.General;
  const key = slug.trim().toLowerCase();
  const mapped = GIRO_SLUG_MAP[key];
  if (mapped !== undefined) return mapped;
  console.warn(`[registration.utils] Unknown giro slug "${slug}" — falling back to General.`);
  return BusinessTypeId.General;  // ← aquí cae
}
```

Cuando el slug no matchea, cae a `General` silenciosamente (con un `console.warn` que nadie ve en producción).

### Diagnóstico confirmado
**Gap en el diccionario de slugs.** La business-rules-matrix (§1.4) define "Specialized Services (Estéticas, Consultorios, Talleres)" pero el mapa no tiene aliases para esos sub-giros. Faltan entradas como `estetica`, `consultorio`, `taller`, `servicios-especializados`, `specialized-services`, etc.

---

## Bug 2 — Onboarding atascado al presionar "Saltar"

### Pregunta
¿Qué hace el código si el usuario presiona "Saltar" estando en el último paso?

### Raíz del problema

**Archivo:** [onboarding.component.ts:214](src/app/modules/onboarding/onboarding.component.ts#L214)

```ts
readonly totalSteps = computed(() => this.isOwnerOrManager() ? 3 : 4);
```

Para un **Owner** (el usuario que acaba de registrar el negocio), `totalSteps = 3`. El step 3 (crear primer producto) es **el último paso**.

**Archivo:** [onboarding.component.ts:398-402](src/app/modules/onboarding/onboarding.component.ts#L398-L402)

```ts
skipStep(): void {
  this.skipProduct.set(true);
  this.nextStep();
}
```

**Archivo:** [onboarding.component.ts:373-384](src/app/modules/onboarding/onboarding.component.ts#L373-L384)

```ts
nextStep(): void {
  if (this.currentStep() < this.totalSteps()) {  // 3 < 3 → FALSE
    this.currentStep.update(s => s + 1);
    ...
  }
  // ← si la condición es false, no hace NADA
}
```

**Secuencia del bug:**
1. Owner está en step 3 (último paso, `totalSteps = 3`)
2. Presiona "Saltar este paso" → llama `skipStep()`
3. `skipStep()` llama `nextStep()`
4. `nextStep()` evalúa `3 < 3` → `false` → **no hace nada**
5. UI se queda congelada en step 3

El botón "Siguiente" del footer SÍ se oculta correctamente en el último paso ([onboarding.component.html:331](src/app/modules/onboarding/onboarding.component.html#L331): `@if (currentStep() < totalSteps())`), y se muestra "Finalizar" que llama a `completeOnboarding()`. **Pero el link "Saltar este paso" es independiente** — sigue visible y llama a `skipStep()` que no contempla ser el último paso.

### Diagnóstico confirmado
**`skipStep()` no verifica si está en el último paso.** Debería llamar `completeOnboarding()` cuando `currentStep() >= totalSteps()`, en vez de delegar ciegamente a `nextStep()`.

---

## Bug 3 — Dashboard muestra Error 402 en gráficas

### Pregunta
¿El dashboard llama al endpoint de reportes sin verificar la feature?

### Raíz del problema

**Archivo:** [dashboard.component.ts:341-348](src/app/modules/admin/components/dashboard/dashboard.component.ts#L341-L348)

```ts
// loadChartData() — SIN FEATURE CHECK
const result = await this.reportService.getDashboardCharts(
  this.dateFrom(),
  this.dateTo(),
);
```

**Archivo:** [report.service.ts:91-96](src/app/core/services/report.service.ts#L91-L96)

```ts
async getDashboardCharts(from: Date, to: Date): Promise<DashboardChartsDto> {
  return firstValueFrom(
    this.api.get<DashboardChartsDto>(
      `/report/charts?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  );
}
```

**Contraste con la ruta de Reportes** ([admin.routes.ts:36-42](src/app/modules/admin/admin.routes.ts#L36-L42)):
```ts
{
  path: 'reports',
  canActivate: [featureGuard],
  data: { requiredFeature: FeatureKey.AdvancedReports },  // ← PROTEGIDO
  ...
}
```

Pero la ruta del Dashboard ([admin.routes.ts:18-22](src/app/modules/admin/admin.routes.ts#L18-L22)) **no tiene guard**. Y el componente **no inyecta** `TenantContextService` para verificar `hasFeature(FeatureKey.AdvancedReports)` antes de llamar al endpoint.

**Error handling** ([dashboard.component.ts:346-348](src/app/modules/admin/components/dashboard/dashboard.component.ts#L346-L348)):
```ts
} catch {
  this.chartError.set('No se pudieron cargar las gráficas. Verifica tu conexión.');
}
```

El `catch` es genérico — no inspecciona el status 402 para mostrar un mensaje tipo "Disponible en plan Pro" o un upsell modal.

### Diagnóstico confirmado
**Endpoint `/report/charts` se llama incondicionalmente.** El backend lo protege con feature gate y devuelve 402. El frontend no verifica la feature antes de llamar, y no maneja el 402 diferenciadamente del error genérico.

---

## Bug 4 — Pantalla de Dispositivos "Frankenstein Visual"

### Preguntas
a) ¿El botón "Generar código" no tiene clases CSS?
b) ¿El dropdown de modo está hardcodeado?

### Raíz del problema

**a) Botón de generar código**

**Archivo:** [admin-devices.component.html:69-77](src/app/modules/admin/components/devices/admin-devices.component.html#L69-L77)
```html
<button
  type="button"
  class="btn-primary"
  [disabled]="generatingCode() || !codeBranchId"
  (click)="generateActivationCode()"
>
  ...Generar código
</button>
```

El botón **sí tiene** la clase `btn-primary`. Si se ve "Frankenstein", es porque:
- La clase `btn-primary` se define como estilo global/scoped en algún SCSS padre, pero si este componente no lo importa o hereda, puede no aplicarse.
- No usa un componente PrimeNG (`<p-button>`) como el resto de la app — es un `<button>` nativo con una clase custom, lo cual puede producir inconsistencia visual.

**b) Dropdown de modo — HARDCODEADO**

**Archivo:** [admin-devices.component.ts:62-74](src/app/modules/admin/components/devices/admin-devices.component.ts#L62-L74)

```ts
readonly modes: readonly ModeOption[] = [
  { value: 'cashier', label: '💳 Cajero',  icon: '💳' },
  { value: 'tables',  label: '🪑 Mesas',   icon: '🪑' },
  { value: 'kitchen', label: '👨‍🍳 Cocina',  icon: '👨‍🍳' },
  { value: 'kiosk',   label: '📱 Kiosko',  icon: '📱' },
];
```

**100% hardcodeado.** No inyecta `TenantContextService` ni filtra por features. Un negocio de "Servicios Especializados" (que según la matrix §1.4 NO tiene KDS, Mesas, ni Kiosco) ve las 4 opciones incluyendo modos que no le aplican.

**Feature keys disponibles pero no usados** ([feature-key.enum.ts](src/app/core/enums/feature-key.enum.ts)):
- `KdsBasic`, `RealtimeKds` → Kitchen
- `WaiterApp`, `TableMap` → Tables/Mesas
- `KioskMode` → Kiosk

### Diagnóstico confirmado
**a)** El botón existe con `btn-primary` pero es un `<button>` nativo, no un `<p-button>` PrimeNG. Puede lucir diferente del resto de la UI.
**b)** Las opciones del dropdown están hardcodeadas sin consultar features del tenant. La business-rules-matrix dice que features no aplicables deben **ocultarse** (DOM removal), pero aquí se muestran todas.

---

## Bug 5 — Router POS muestra Mesas en vez de Quick POS

### Pregunta
¿Existe un `redirectTo: 'tables'` por defecto? ¿Por qué el router no evalúa el BusinessType?

### Raíz del problema

**Cadena causal completa:**

**Paso 1 — Login correcto** ([device-routing.service.ts:63-81](src/app/core/services/device-routing.service.ts#L63-L81)):
```ts
private resolvePosRoute(): string {
  let experience = this.configService.posExperience();
  if (!experience) {
    const btId = this.authService.businessTypeId();
    const btCode = BusinessTypeId[btId];
    const catalog = this.catalogService.getBusinessType(btCode);
    experience = catalog?.posExperience;
  }
  switch (experience) {
    case 'Restaurant': return '/pos';
    case 'Quick':      return '/pos/quick';
    ...
    default:           return '/pos';  // ← fallback
  }
}
```

Para "Servicios" (`BusinessTypeId.Servicios`), el catálogo define `posExperience: 'Quick'` ([catalog.constants.ts:56](src/app/core/models/catalog.constants.ts#L56)), así que `resolvePosRoute()` retorna `/pos/quick`. **Esto funciona en el login.**

**Paso 2 — Pero la ruta `/pos` (sin suffijo) carga el RestaurantHub** ([pos.routes.ts:6-12](src/app/modules/pos/pos.routes.ts#L6-L12)):
```ts
{
  path: '',
  loadComponent: () =>
    import('./pages/restaurant-hub/restaurant-hub.component')
      .then(m => m.RestaurantHubComponent),
}
```

**Paso 3 — RestaurantHub está hardcodeado para Restaurantes** ([restaurant-hub.component.ts:47-54](src/app/modules/pos/pages/restaurant-hub/restaurant-hub.component.ts#L47-L54)):
```ts
readonly channelOptions: ChannelOption[] = [
  { label: 'Mesas',      value: 'tables',   icon: 'pi pi-th-large' },
  { label: 'Para Llevar', value: 'takeout', icon: 'pi pi-shopping-bag' },
  { label: 'Delivery',   value: 'delivery', icon: 'pi pi-send' },
];
readonly activeChannel = signal<RestaurantChannel>('tables');
```

**Escenario del bug:** Si un usuario de "Servicios" navega directamente a `/pos` (ej. desde el menú lateral, un bookmark, o un deep-link), el router carga `RestaurantHubComponent` con canales de Mesas/Delivery. `DeviceRoutingService` solo se evalúa al momento del login, no como un guard/redirect permanente en la ruta `/pos`.

### Diagnóstico confirmado
**Falta un guard o redirect en la ruta vacía de `/pos`** que evalúe `posExperience` y redirija a la variante correcta (`/pos/quick`, `/pos/retail`, etc.). `DeviceRoutingService.resolvePosRoute()` tiene la lógica correcta pero solo se ejecuta al login — no protege la ruta contra navegación directa.

---

## Resumen ejecutivo

| # | Bug | Causa raíz | Archivo clave | Severidad |
|---|-----|-----------|---------------|-----------|
| 1 | Handoff "General" | `GIRO_SLUG_MAP` no tiene aliases para sub-giros de servicios | [registration.utils.ts:21-46](src/app/core/utils/registration.utils.ts#L21-L46) | 🟠 |
| 2 | Onboarding atascado | `skipStep()` llama `nextStep()` que es no-op en el último paso (Owner: `totalSteps=3`) | [onboarding.component.ts:398-402](src/app/modules/onboarding/onboarding.component.ts#L398-L402) | 🔴 |
| 3 | Dashboard 402 | `loadChartData()` llama `/report/charts` sin verificar `AdvancedReports` feature | [dashboard.component.ts:341-348](src/app/modules/admin/components/dashboard/dashboard.component.ts#L341-L348) | 🟠 |
| 4 | Devices Frankenstein | Dropdown de modos hardcodeado (4 opciones fijas), sin `TenantContextService`; botón nativo sin PrimeNG | [admin-devices.component.ts:62-74](src/app/modules/admin/components/devices/admin-devices.component.ts#L62-L74) | 🟡 |
| 5 | POS muestra Mesas | Ruta `/pos` (vacía) carga `RestaurantHubComponent` siempre; falta guard que use `posExperience` | [pos.routes.ts:6-12](src/app/modules/pos/pos.routes.ts#L6-L12) | 🟠 |

**Esperando confirmación** antes de proponer patches.
