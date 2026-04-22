# AUDIT-035 — Gating de Folios · Currency Input UX · Eliminación de `AppConfig.pin`

**Fecha:** 2026-04-21
**Rama:** `audit/cajas-y-hardware`
**Modo:** Análisis (sin cambios de código)

---

## 1. Visibilidad del bloque "Folios" en Settings → Negocio

### Dónde se decide

Computed: [admin-settings.component.ts:128-134](src/app/modules/admin/components/settings/admin-settings.component.ts#L128-L134)

```ts
readonly canSeeCustomFolio = computed(() =>
  this.tenantContext.hasAnyFeature([
    FeatureKey.CustomFolios,
    FeatureKey.CfdiInvoicing,
  ]),
);
```

Render: [admin-settings.component.html:158-159](src/app/modules/admin/components/settings/admin-settings.component.html#L158-L159) → `@if (canSeeCustomFolio())`

### Regla exacta

Visible si el tenant tiene **al menos una** de estas feature flags activas:

| Feature | Aplica en qué giro (macro) |
|---------|----------------------------|
| `CustomFolios` | **Sólo Services** ([feature-key.enum.ts:109-113](src/app/core/enums/feature-key.enum.ts#L109-L113)) |
| `CfdiInvoicing` | FoodBeverage · QuickService · Retail · Services (todas) |

### ¿Por qué un "Pro" puede no verlo?

Según la matriz de planes ([.claude/business-rules-matrix.md:29-54](.claude/business-rules-matrix.md#L29-L54)):

| Macro | Plan donde entra CFDI | Plan donde entra CustomFolios |
|-------|----------------------|-------------------------------|
| FoodBeverage | Basic ($199) | **Nunca** (no aplica al giro) |
| QuickService | Basic ($149) | **Nunca** |
| Retail | Basic ($149) | **Nunca** |
| Services | Pro ($99) | Pro ($99) |

El check de `canSeeCustomFolio` sólo es **true** si el JWT del tenant trae `CfdiInvoicing` o `CustomFolios`. Hipótesis ordenadas por probabilidad:

1. **Feature flags del JWT no cascadean Basic → Pro en el backend.** Si el backend emite sólo las features "incrementales" del plan, un tenant F&B Pro tendría `RealtimeKds, TableMap, WaiterApp, KioskMode, MultiTill` pero **no** `CfdiInvoicing` (que sólo es del tier Basic). La UI esperaría una lista acumulada pero el backend entregaría lista incremental → Folios invisibles pese a estar en Pro.
   - Verificación rápida: abrir DevTools → `localStorage.token` → decodificar JWT → mirar `features` claim. Si no contiene `CfdiInvoicing`, confirmado.
   - Fix: que el backend entregue la unión (Basic ∪ Pro ∪ Enterprise features). Es el patrón estándar SaaS.

2. **Tenant Services Pro sí ve CFDI pero el JWT no incluye `CustomFolios`.** Services Pro *debe* incluir `CustomFolios` según la matriz. Si el backend lo omite, también se cae. Menos probable porque la computed tiene un `OR` con CFDI.

3. **Race condition en hidratación.** `TenantContextService.setContext` corre al login; si el usuario navega a Settings antes de que `AuthService.rehydrate` complete, `activeFeatures` puede estar vacío momentáneamente. `canSeeCustomFolio` retornaría `false` hasta que se repinta. Poco probable en la práctica (signals re-render al vuelo).

4. **Plan correcto pero macro incorrecta.** Si onboarding registró al usuario con otro macro del que él cree, el backend habrá emitido un set de features que no matchea. Diagnóstico: `authService.primaryMacroCategoryId()` en consola.

### Otras visibilidades hoy en Settings

| Elemento | Gate | Regla |
|----------|------|-------|
| Tab **Fiscal** completo | `canSeeFiscal` → `CfdiInvoicing` | Oculta la tab entera si no hay CFDI |
| Tarjeta **Báscula** | `canSeeScale` → `CoreHardware` **AND** macro === `Retail` | Sólo retail con hardware core |
| **Destinos de impresión** (cocina / barra) | `canSeePrintDestinations` → `KdsBasic OR RealtimeKds OR PrintedTickets` | Cualquier flag de impresión activa |
| **Configuración de Folios** | `canSeeCustomFolio` → `CustomFolios OR CfdiInvoicing` | ← el caso reportado |

Tabs ocultadas dinámicamente: sólo `fiscal` está en la lista de `visibleTabs` ([admin-settings.component.ts:137-141](src/app/modules/admin/components/settings/admin-settings.component.ts#L137-L141)). Las otras 3 (Negocio, Hardware, Facturación) siempre son visibles.

### Recomendación

Antes de tocar la UI, **verificar el contenido del JWT en el ambiente del usuario reportante**:
- Si falta `CfdiInvoicing`, el fix es backend (cascadeo de features por tier).
- Si está presente pero aún así no se ve, mirar logs de consola — puede ser un hidratación race que se soluciona con `firstValueFrom(this.authService.rehydrate())` en `ngOnInit` del componente.

No tiene sentido modificar `canSeeCustomFolio` sin saber qué le llega al frontend.

---

## 2. Currency Input bloqueando tecleo ("$0.00" en Abrir turno)

### Dónde

Dialog template: [cash-register.component.html:143-156](src/app/modules/admin/components/cash-register/cash-register.component.html#L143-L156)

```html
<p-inputNumber
  inputId="open-amount"
  [(ngModel)]="openAmount"
  mode="currency"
  currency="MXN"
  locale="es-MX"
  [min]="0"
  styleClass="dialog-field__input-lg"
  inputStyleClass="dialog-field__input-lg-inner"
  placeholder="$0.00"
/>
```

Binding: [cash-register.component.ts:143](src/app/modules/admin/components/cash-register/cash-register.component.ts#L143) → `openAmount = 0;`

### Por qué molesta

- El modelo arranca en `0`, no en `null`.
- `p-inputNumber mode="currency"` con valor `0` pinta `"$0.00"` en el input (no usa el placeholder porque hay un valor válido).
- Al hacer tap, el caret cae al final; PrimeNG intercepta las teclas de dígito y las concatena al valor actual → "$0.005" o similar.
- El placeholder `"$0.00"` es decorativo: nunca se ve porque siempre hay un valor numérico.

### Mismo patrón en otras partes

`p-inputNumber mode="currency"` aparece en:

- [cash-register.component.html:145, 241, 364](src/app/modules/admin/components/cash-register/cash-register.component.html#L145) (abrir turno, contar cierre, movimientos)
- [pos-header.component.html:371, 381, 471, 481, 650](src/app/modules/pos/components/pos-header/pos-header.component.html#L371) (recibir mercancía, línea de recibo)
- [checkout.component.html:147, 158, 476](src/app/modules/pos/components/checkout/checkout.component.html#L147) (pago efectivo, propina)
- [admin-products.component.html](src/app/modules/admin/components/products/admin-products.component.html) — precios (múltiples)
- [admin-inventory.component.html](src/app/modules/admin/components/inventory/admin-inventory.component.html) — costo
- Varios más en promociones, clientes, recetas, recibos

Todas sufren el mismo defecto cuando el valor inicial es `0`.

### Opciones de fix

**A — Valor inicial `null` (targeteada, en `openAmount` y `closeAmount`).**

```ts
openAmount: number | null = null;
closeAmount: number | null = null;
```

Ajustes necesarios:
- `openSession()` línea 302: `Math.round((this.openAmount ?? 0) * 100)`.
- Validaciones: `this.openAmount === 0` → `!this.openAmount`.
- Línea 299 deshabilitado: `[disabled]="openAmount < 0"` → `[disabled]="openAmount == null || openAmount < 0"`.
- Reset en `resetOpenDialog()` / `resetCloseDialog()`: `= null` en vez de `= 0`.

Ventaja: el placeholder `"$0.00"` sí aparece (porque el modelo es `null`), y el primer tecleo crea el valor desde cero. Es la solución que PrimeNG espera.

**B — Auto-select del contenido al enfocar (universal, reutilizable).**

`p-inputNumber` expone un output `(onFocus)` con el `FocusEvent` nativo. Handler:

```ts
selectInputContent(event: { originalEvent: FocusEvent }): void {
  (event.originalEvent.target as HTMLInputElement).select();
}
```

Uso:

```html
<p-inputNumber ... (onFocus)="selectInputContent($event)" />
```

Al enfocar, el `"$0.00"` queda seleccionado — la primera tecla lo sobreescribe. Funciona también con valores distintos de cero ("edición rápida" para corregir un precio).

**C — Directiva standalone reusable.**

Encapsular B en una directiva `[posSelectOnFocus]` que se aplique al `p-inputNumber` sin lógica en el componente. Evita repetir el handler en 20+ plantillas.

### Recomendación

- **Corto plazo (sólo abrir/cerrar turno):** Opción A. Es la intención original del `placeholder="$0.00"` que hoy no funciona. Dos líneas de código en el componente y un tipo ajustado.
- **Mediano plazo (toda la app):** Opción C — directiva `posSelectOnFocus` aplicada a todos los `p-inputNumber mode="currency"`. Esto resuelve la fricción también para edición de precios de productos y montos de checkout, donde el 0 inicial no es el único caso molesto (corregir un `$150.00` tecleando requiere hoy seleccionar a mano).

Idealmente ambas: A para el caso del turno (arranque limpio) + C transversal para UX fluida en ediciones.

---

## 3. Erradicación completa de `AppConfig.pin`

### Qué hay hoy

**Modelo** ([app-config.model.ts](src/app/core/models/app-config.model.ts)):

```ts
export interface AppConfig extends BusinessConfig {
  id: 'main';
  /** 4-digit PIN for back-office access. Stored as plain string (local-only, no backend yet). */
  pin: string;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  ...DEFAULT_BUSINESS_CONFIG,
  id:  'main',
  pin: '1234',
};
```

**Servicio** ([config.service.ts:194-210](src/app/core/services/config.service.ts#L194-L210)):

```ts
async verifyPin(pin: string): Promise<boolean> {
  const config = await this.load();
  return config.pin === pin;
}

async updatePin(newPin: string): Promise<void> {
  const config = await this.load();
  await this.save({ ...config, pin: newPin });
}
```

### ¿Rompe la sincronización con la API?

**No.** Evidencia:

1. **Respuesta del API** ([config.service.ts:27-45](src/app/core/services/config.service.ts#L27-L45)):
   ```ts
   interface BranchConfigResponse {
     id, businessId, businessName, branchName, locationName?, businessPhone?,
     hasKitchen?, hasTables?, hasDelivery?, hasInvoicing?,
     folioPrefix?, folioFormat?, folioCounter?,
     planTypeId?, primaryMacroCategoryId?, posExperience?
   }
   ```
   **No contiene `pin`.** El backend ni lo envía ni lo espera.

2. **Merge en `load()`** ([config.service.ts:149-162](src/app/core/services/config.service.ts#L149-L162)):
   El spread `{ ...config, businessName: remote.businessName, … }` nunca toca la llave `pin`. Vive y muere en Dexie.

3. **`save()`** ([config.service.ts:183-192](src/app/core/services/config.service.ts#L183-L192)):
   Sólo hace `db.config.put(...)` en IndexedDB. Ninguna llamada HTTP derivada de `save` incluye `pin`.

4. **Dexie sin constraints de schema**: el store `config` ([database.service.ts:59](src/app/core/services/database.service.ts#L59)) está declarado como `config: 'id'` — único índice es `id`. Dexie acepta cualquier forma de objeto; si escribes un `AppConfig` sin `pin`, Dexie simplemente no almacena esa llave. Registros existentes que *sí* tengan `pin` sobreviven (quedan como propiedad suelta) hasta el próximo `put()`, momento en que se reescribirán sin ella. **No requiere migración**.

### Verificación de consumidores (grep exhaustivo)

Sólo 3 archivos referencian `config.pin`:

| Archivo | Referencia | Tipo |
|---------|-----------|------|
| [app-config.model.ts:15,22](src/app/core/models/app-config.model.ts#L15) | Declaración del campo + default `'1234'` | **a borrar** |
| [config.service.ts:198-210](src/app/core/services/config.service.ts#L198-L210) | `verifyPin` / `updatePin` — único consumidor era la tab Seguridad (ya borrada en AUDIT-034) | **a borrar** |

Todas las demás apariciones de `pin` en el código son:
- `User.pin` (entidad distinta, server-side, empleado)
- Ruta Angular `/pin` (login de cajero, no relacionada)
- `authService.pinLogin` / `POST /auth/pin-login` (endpoint distinto)
- `POST /branch/{id}/verify-pin` (endpoint distinto — PIN de sucursal server-side)

### Pasos de eliminación (checklist)

1. **`src/app/core/models/app-config.model.ts`**
   - Borrar la línea `pin: string;` del interface `AppConfig`.
   - Borrar la línea `pin: '1234',` del `DEFAULT_APP_CONFIG`.
   - Actualizar el JSDoc del interface: quitar "with security settings" (ya no hay). Simplificar a "Business config persisted in IndexedDB".
2. **`src/app/core/services/config.service.ts`**
   - Borrar método `verifyPin()` (líneas 194-201 aprox).
   - Borrar método `updatePin()` (líneas 203-210 aprox).
   - Limpiar el JSDoc del header de la clase que menciona "Shared across all devices — businessName, locationName, PIN" (línea 51): quitar `PIN`.
3. **Build:** `npm run build`. No debe haber errores — ya verificamos que sin la tab Seguridad nadie llama a estos métodos.
4. **Runtime:** ningún efecto perceptible para el usuario. Tenants existentes seguirán teniendo `pin: '1234'` guardado en Dexie hasta el próximo `save()` que lo reescriba sin la llave; nada lo lee.

### Riesgo residual

**Ninguno que bloquee.** Casos de borde inspeccionados y descartados:

- ¿El `sha256Hex(pin)` de `offlinePinLogin` en [auth.service.ts:287](src/app/core/services/auth.service.ts#L287) usa `config.pin`? → **No**, usa el PIN introducido por el usuario en pantalla para compararlo contra `User.pinHash` guardado server-side.
- ¿Algún test mockea `AppConfig.pin`? → no hay tests del componente Settings actuales.
- ¿El tipo `AppConfig` se serializa hacia el backend por otro camino? → no. Los únicos POSTs de config son `/branch/folio-config` y `/branch/fiscal-config`, que mandan payloads específicos (no el `AppConfig` completo).

---

## Resumen ejecutivo

| # | Pregunta | Respuesta corta | Siguiente paso |
|---|---------|-----------------|----------------|
| 1 | ¿Por qué Pro no ve Folios? | `canSeeCustomFolio = CustomFolios OR CfdiInvoicing`. Lo más probable: el JWT no está cascadeando features Basic→Pro, así que falta `CfdiInvoicing` | Decodificar el JWT del usuario afectado antes de cambiar código |
| 2 | ¿Cómo arreglamos "$0.00" que bloquea tecleo? | `p-inputNumber` con valor `0` pinta el cero en vez del placeholder | Opción A (`openAmount: number \| null = null`) para turno + Opción C (directiva `posSelectOnFocus`) transversal |
| 3 | ¿Borrar `AppConfig.pin` es seguro? | **Sí.** Nada lo lee fuera del propio `config.service.ts`. API no contiene `pin`. Dexie no requiere migración | Borrar el campo del modelo + los dos métodos del servicio + referencia en JSDoc. `npm run build` para sellar. |

Listos para ejecutar cuando lo apruebes. Recomendación: arrancar por el #3 (trivial, 0 riesgo) y el #2 (fix local del turno); el #1 requiere primero diagnóstico del JWT antes de cualquier edición.
