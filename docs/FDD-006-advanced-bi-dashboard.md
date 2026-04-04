# FDD-006 — Advanced BI Dashboard & Charts

**Feature:** Admin BI Dashboard con gráficas interactivas
**Fase:** 17
**Fecha:** 2026-04-03
**Estado:** Diseño — pendiente de aprobación

---

## 1. Resumen ejecutivo

Transformar el Dashboard del área Admin en una interfaz de Business Intelligence estilo Dribbble, con tres gráficas interactivas (Line, Bar, Doughnut) alimentadas por datos reales del backend, un selector de rango de fechas global y exportación CSV de detalle de ventas. Toda la gestión de estado usa **exclusivamente Angular Signals** — cero `BehaviorSubject`.

---

## 2. Análisis del estado actual

### 2.1 `ReportService` (existente)

| Aspecto | Estado actual |
|---|---|
| Patrón de datos | `async/await` + `firstValueFrom` — sin estado propio |
| Modelo de respuesta | `ReportSummary` (datos de resumen diario) |
| Exports | `downloadExcel()`, `downloadPdf()`, `downloadFiscalCsv()` (SAT) |
| Endpoints de gráficas | **No existen** |
| CSV de ventas (simple) | **No existe** (`downloadFiscalCsv` es SAT-específico) |

### 2.2 `DashboardComponent` (existente)

| Aspecto | Estado actual |
|---|---|
| Patrón de estado | Signals (`isLoading`, `isOffline`, `data`) — correcto |
| Reactividad | `effect()` sobre `activeBranchId` |
| Datos de gráficas | **No existen** |
| Selector de fechas | **No existe** |
| Imports PrimeNG | Solo `PricePipe` |

**Conclusión:** El componente ya usa el patrón de signals correcto y es la base ideal para extender. El servicio solo necesita nuevos métodos — sin cambios estructurales.

---

## 3. Nuevos modelos TypeScript

Ubicación: `src/app/core/models/report-chart.model.ts`

### 3.1 Modelos de datos del API

```typescript
/** Single data point for the sales-over-time line chart */
interface SalesOverTimePoint {
  date: string;          // ISO date string (YYYY-MM-DD)
  totalCents: number;    // Revenue in cents
  orderCount: number;    // Number of orders that day
}

/** Single entry for the top-products bar chart */
interface TopProductEntry {
  productId: number;
  productName: string;
  quantity: number;       // Units sold
  revenueCents: number;   // Total revenue in cents
}

/** Single slice for the payment-methods doughnut chart */
interface PaymentMethodBreakdown {
  method: string;         // Internal code (e.g. 'cash', 'card', 'transfer')
  label: string;          // Display label (e.g. 'Efectivo')
  orderCount: number;
  totalCents: number;
}

/** Aggregate response from GET /report/charts */
interface ReportChartData {
  salesOverTime: SalesOverTimePoint[];
  topProducts: TopProductEntry[];       // Max 10
  paymentMethods: PaymentMethodBreakdown[];
}
```

### 3.2 Tipos internos de Chart.js (wrappers)

```typescript
/** Typed wrapper for a Chart.js dataset passed to p-chart */
interface ChartJsData {
  labels: string[];
  datasets: ChartJsDataset[];
}

interface ChartJsDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[] | CanvasGradient;
  borderColor?: string | string[];
  borderWidth?: number;
  fill?: boolean;
  tension?: number;
  // ... Chart.js dataset options as needed
}
```

---

## 4. Extensiones al `ReportService`

Se añaden **dos métodos** al servicio existente. No se modifica ningún método actual.

### 4.1 `getChartData()` — datos de las tres gráficas

```typescript
/**
 * Fetches all chart datasets for the BI dashboard in a single request.
 * @param branchId  Branch to query
 * @param from      Start date (inclusive, time set to 00:00:00)
 * @param to        End date (inclusive, time set to 23:59:59)
 */
async getChartData(branchId: number, from: Date, to: Date): Promise<ReportChartData>
// Endpoint: GET /report/charts?from=ISO&to=ISO
// Motivo single endpoint: reduce round-trips; las tres gráficas siempre se cargan juntas.
```

### 4.2 `downloadSalesCsv()` — exportación simple (no-fiscal)

```typescript
/**
 * Downloads a simplified sales detail CSV (not SAT-compatible).
 * Columns: Order ID, Date, Time, Customer, Items, Subtotal, Discount, Total, Payment Method.
 * @param branchId  Branch to query
 * @param from      Start date (inclusive)
 * @param to        End date (inclusive)
 */
async downloadSalesCsv(branchId: number, from: Date, to: Date): Promise<void>
// Endpoint: GET /report/export/sales-csv?from=ISO&to=ISO
// Filename: ventas-detalle-YYYY-MM-DD_YYYY-MM-DD.csv
// Diferente de downloadFiscalCsv (que incluye RFC, SAT codes, CFDI UUID)
```

---

## 5. Estado del `DashboardComponent` — arquitectura de Signals

**Regla:** Cero `BehaviorSubject`. Todo el estado vive como `signal()` o `computed()` dentro del componente. El servicio es stateless (solo métodos `async`).

### 5.1 Señales de control de fecha

```typescript
//#region Date Range Signals

/**
 * Raw Date[] from p-calendar (range mode).
 * [0] = from date, [1] = to date (undefined until user picks both).
 * Default: first day of current month → today.
 */
readonly selectedDateRange = signal<Date[]>(this.getDefaultDateRange());

/** Resolved "from" boundary — always midnight */
readonly dateFrom = computed<Date>(() => {
  const d = new Date(this.selectedDateRange()[0] ?? this.getDefaultDateRange()[0]);
  d.setHours(0, 0, 0, 0);
  return d;
});

/** Resolved "to" boundary — always end of day */
readonly dateTo = computed<Date>(() => {
  const raw = this.selectedDateRange()[1] ?? this.selectedDateRange()[0];
  const d = new Date(raw ?? new Date());
  d.setHours(23, 59, 59, 999);
  return d;
});

//#endregion
```

### 5.2 Señales de carga y datos de gráficas

```typescript
//#region Chart Data Signals

readonly isLoadingCharts = signal(false);
readonly chartError = signal<string | null>(null);

/**
 * Raw API response. Null while loading or on error.
 * All chart computed signals derive from this single source of truth.
 */
readonly chartData = signal<ReportChartData | null>(null);

//#endregion
```

### 5.3 Computeds de Chart.js (un computed por gráfica)

```typescript
//#region Chart.js Dataset Computeds

/**
 * Dataset for the Line chart (sales over time).
 * Derived purely from chartData() — recalculates reactively on data change.
 */
readonly salesLineChartData = computed<ChartJsData>(() => {
  const points = this.chartData()?.salesOverTime ?? [];
  return {
    labels: points.map(p => this.formatChartDate(p.date)),
    datasets: [{
      label: 'Ventas (MXN)',
      data: points.map(p => p.totalCents / 100),
      borderColor: '#16A34A',
      backgroundColor: 'rgba(22, 163, 74, 0.12)',   // gradient applied in options
      fill: true,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: '#16A34A',
    }],
  };
});

/**
 * Dataset for the horizontal Bar chart (top products by revenue).
 */
readonly topProductsBarData = computed<ChartJsData>(() => {
  const items = this.chartData()?.topProducts ?? [];
  return {
    labels: items.map(p => p.productName),
    datasets: [{
      label: 'Ingresos (MXN)',
      data: items.map(p => p.revenueCents / 100),
      backgroundColor: '#16A34A',
      borderRadius: 6,
    }],
  };
});

/**
 * Dataset for the Doughnut chart (payment methods breakdown).
 */
readonly paymentDoughnutData = computed<ChartJsData>(() => {
  const slices = this.chartData()?.paymentMethods ?? [];
  return {
    labels: slices.map(s => s.label),
    datasets: [{
      data: slices.map(s => s.totalCents / 100),
      backgroundColor: ['#16A34A', '#D97706', '#2563EB', '#7C3AED', '#DC2626'],
      borderWidth: 2,
      borderColor: '#ffffff',
    }],
  };
});

//#endregion
```

### 5.4 Effect de recarga reactiva

```typescript
//#region Reactive Effects

constructor() {
  // Existing effect — reacts to branch change
  effect(() => {
    const branchId = this.authService.activeBranchId();
    if (branchId) this.loadData();
  }, { allowSignalWrites: true });

  // NEW — reacts to date range change; skips if range is incomplete
  effect(() => {
    const range = this.selectedDateRange();
    const branchId = this.authService.activeBranchId();
    // Only load when user has selected BOTH dates (p-calendar range mode)
    if (branchId && range[0] && range[1]) {
      this.loadChartData();
    }
  }, { allowSignalWrites: true });
}

//#endregion
```

### 5.5 Método `loadChartData()`

```typescript
//#region Chart Data Loading

async loadChartData(): Promise<void> {
  const branchId = this.authService.activeBranchId();
  if (!branchId) return;

  this.isLoadingCharts.set(true);
  this.chartError.set(null);

  try {
    const result = await this.reportService.getChartData(
      branchId,
      this.dateFrom(),
      this.dateTo(),
    );
    this.chartData.set(result);
  } catch {
    this.chartError.set('No se pudieron cargar las gráficas. Verifica tu conexión.');
    this.chartData.set(null);
  } finally {
    this.isLoadingCharts.set(false);
  }
}

//#endregion
```

### 5.6 Handler de exportación CSV

```typescript
//#region Export Handlers

isExportingCsv = signal(false);

async onExportSalesCsv(): Promise<void> {
  const branchId = this.authService.activeBranchId();
  if (!branchId) return;

  this.isExportingCsv.set(true);
  try {
    await this.reportService.downloadSalesCsv(branchId, this.dateFrom(), this.dateTo());
  } finally {
    this.isExportingCsv.set(false);
  }
}

//#endregion
```

---

## 6. Configuración de `p-chart` — Opciones de Chart.js

### 6.1 Line Chart (ventas en el tiempo)

```typescript
readonly salesLineChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) =>
          ` ${ctx.parsed.y.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`,
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: '#6B7280', font: { size: 12 } },
    },
    y: {
      grid: { color: 'rgba(107,114,128,0.1)' },
      ticks: {
        color: '#6B7280',
        font: { size: 12 },
        callback: (v: number) => `$${v.toLocaleString('es-MX')}`,
      },
      beginAtZero: true,
    },
  },
  elements: { line: { tension: 0.4 } },
};
// Nota: el gradiente de área se aplica mediante el plugin Chart.js afterLayout
// o usando `backgroundColor` como función de callback en el dataset.
// Detalle de implementación: definir en un helper buildGradient(ctx, chartArea).
```

### 6.2 Bar Chart — Horizontal (top productos)

```typescript
readonly topProductsBarOptions = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,   // Horizontal — mejor para nombres largos de productos
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) =>
          ` ${ctx.parsed.x.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`,
      },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(107,114,128,0.1)' },
      ticks: { color: '#6B7280', font: { size: 12 } },
      beginAtZero: true,
    },
    y: {
      grid: { display: false },
      ticks: { color: '#374151', font: { size: 13 } },
    },
  },
};
```

### 6.3 Doughnut Chart (métodos de pago)

```typescript
readonly paymentDoughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '70%',
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { color: '#374151', font: { size: 13 }, padding: 16 },
    },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const val = ctx.parsed;
          const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0);
          const pct = ((val / total) * 100).toFixed(1);
          return ` ${val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} (${pct}%)`;
        },
      },
    },
  },
};
```

---

## 7. Layout del Dashboard — PrimeFlex Grid

### 7.1 Estructura de secciones

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOOLBAR: [← desde] [hasta →]  p-calendar (range)        [⬇ CSV]        │
│  col-12                                                                   │
├──────────────────────────────────────────────────────────────────────────┤
│  KPI CARDS (existentes — sin cambios)                                     │
│  col-12                                                                   │
├──────────────────────────────────────────────────────────────────────────┤
│  LINE CHART — Ventas en el tiempo                                         │
│  col-12                            height: 320px                         │
├──────────────────────────────┬───────────────────────────────────────────┤
│  BAR CHART — Top Productos   │  DOUGHNUT — Métodos de pago               │
│  col-12 lg:col-6             │  col-12 lg:col-6     height: 320px        │
│  height: 320px               │                                           │
└──────────────────────────────┴───────────────────────────────────────────┘
```

### 7.2 Especificación de clases PrimeFlex

| Sección | Clases PrimeFlex | Notas |
|---|---|---|
| Toolbar de fechas | `col-12 flex align-items-center justify-content-between` | Espacio entre picker y botón |
| Contenedor gráficas | `grid mt-3` | Margen superior respecto a KPIs |
| Line chart wrapper | `col-12` | Ancho completo |
| Bar chart wrapper | `col-12 lg:col-6` | 50% en desktop |
| Doughnut wrapper | `col-12 lg:col-6` | 50% en desktop |
| Card de cada gráfica | `p-card` de PrimeNG + `border-round-xl shadow-2` | Consistente con diseño actual |

### 7.3 Date Range Picker — especificación `p-calendar`

```
Componente:  p-calendar (inline=false, selectionMode="range")
Posición:    Toolbar superior, alineado a la izquierda
Ancho:       280px fijo (clamp para mobile)
Placeholder: "Selecciona rango de fechas"
Max date:    hoy (no permitir fechas futuras)
Format:      dd/mm/yy
ShowIcon:    true
Event:       (onSelect)="onDateRangeSelect($event)" — dispara loadChartData() vía signal
Lógica:      Solo recarga cuando range[1] (fecha fin) está definido (no disparar en mitad de selección)
```

**Flujo de reactividad del date picker:**

```
Usuario selecciona rango completo
         ↓
onDateRangeSelect(dates: Date[])
         ↓
selectedDateRange.set(dates)     ← signal escribible
         ↓
effect() detecta cambio
         ↓
this.loadChartData()             ← async, actualiza chartData signal
         ↓
salesLineChartData(), topProductsBarData(), paymentDoughnutData()  ← computed se recalculan
         ↓
p-chart se actualiza automáticamente (binding a computed)
```

---

## 8. Botón de exportación CSV

```
Componente:  p-button
Label:       "Descargar Detalle de Ventas"
Icon:        pi pi-file-excel  (o pi pi-download)
Severity:    secondary
[loading]:   isExportingCsv()
(click):     onExportSalesCsv()
Posición:    Toolbar superior, alineado a la derecha
Disabled:    cuando isLoadingCharts() === true
```

**Formato del archivo generado:**

| Columna | Ejemplo |
|---|---|
| `order_id` | ORD-20260403-001 |
| `date` | 2026-04-03 |
| `time` | 14:23 |
| `customer` | Juan Pérez |
| `items` | Tacos x3, Agua x1 |
| `subtotal_mxn` | 95.00 |
| `discount_mxn` | 0.00 |
| `total_mxn` | 95.00 |
| `payment_method` | Efectivo |

---

## 9. Estado vacío y manejo de errores

| Estado | UI |
|---|---|
| Cargando gráficas | Skeleton placeholders con `p-skeleton` (height: 320px) dentro de cada card |
| Sin datos para el rango | Ilustración + mensaje "No hay ventas en este período" centrado en cada card |
| Error de red | `p-message` severity="error" con botón "Reintentar" (llama `loadChartData()`) |
| Rango incompleto en picker | Gráficas muestran último estado válido; no recargan |

---

## 10. Archivos a crear / modificar

| Archivo | Tipo de cambio | Motivo |
|---|---|---|
| `src/app/core/models/report-chart.model.ts` | **Crear** | Nuevos modelos `ReportChartData` & relacionados |
| `src/app/core/models/index.ts` | **Modificar** | Re-exportar nuevos modelos |
| `src/app/core/services/report.service.ts` | **Modificar** | Agregar `getChartData()` y `downloadSalesCsv()` |
| `src/app/modules/admin/components/dashboard/dashboard.component.ts` | **Modificar** | Nuevas signals, computeds, effects y handlers |
| `src/app/modules/admin/components/dashboard/dashboard.component.html` | **Modificar** | Layout completo con p-calendar, p-chart × 3, botón CSV |
| `src/app/modules/admin/components/dashboard/dashboard.component.scss` | **Modificar** | Alturas de charts, estilos de toolbar |

> **No se crean componentes hijos** en esta fase: toda la lógica vive en `DashboardComponent`.
> Si en el futuro las gráficas crecen en complejidad, se puede extraer a `ChartCardComponent`.

---

## 11. Dependencias de PrimeNG a importar

El `DashboardComponent` debe añadir en su array `imports`:

```typescript
import { CalendarModule } from 'primeng/calendar';
import { ChartModule } from 'primeng/chart';       // wraps Chart.js
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageModule } from 'primeng/message';
import { CardModule } from 'primeng/card';
```

> `ChartModule` de PrimeNG 17 incluye Chart.js como dependencia directa. No requiere instalación adicional si ya está en `package.json`. Verificar antes de implementar.

---

## 12. Reglas de implementación (recordatorio para Fase 17)

1. **Cero `BehaviorSubject`** — todo estado en `signal()` o `computed()`.
2. **Cero `subscribe()`** en el componente — usar `async/await` + `firstValueFrom` en el servicio como patrón existente.
3. **Cero mock data** — si el endpoint del backend no existe, el componente muestra estado vacío; no hardcodear datos de prueba.
4. **Precios siempre en centavos internamente** — dividir por 100 solo al construir los datasets de Chart.js (en los `computed`).
5. **Touch targets** — el botón CSV y el calendar deben tener `min-height: 44px` (adaptación táctil).
6. **Un `effect()` por responsabilidad** — no colapsar la lógica de branchId y dateRange en un solo effect.

---

*Documento generado el 2026-04-03. Requiere aprobación antes de cualquier implementación.*
