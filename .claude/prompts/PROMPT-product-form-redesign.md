# PROMPT: Product Form Redesign — restaurant-app

Lee primero los archivos en `.claude/` (response-guidelines.md, coding-standards.md, html-standards.md).

Luego lee `docs/AUDIT-045-product-form-and-grid-spacing.md` que contiene la auditoría completa del Product Form y los bugs de spacing. Todo lo que necesitas saber del estado actual está ahí.

---

## FASE 1 — Spacing fixes (commit independiente)

Implementa los 4 fixes de spacing identificados en la auditoría como B1–B4. Hazlos todos en un solo commit.

### B1 — admin-shell max-width
En `admin-shell.component.scss`, cambia `.content { max-width: 1200px }` a `max-width: 1440px`.

### B2 — Sucursales card desalineada
En el template de Settings donde está la card de Sucursales, envuélvela en `<div class="grid"><div class="col-12">...</div></div>` para que herede los negative margins del grid de PrimeFlex y quede alineada con las cards de arriba (Info + Folios).

### B3 — Product form angosto
Se resuelve en la Fase 2 (el rediseño elimina el `max-width: 720px`). No tocar aquí.

### B4 — TabView violeta en vez de verde
En `styles.scss` (el global), agrega el override del TabView para que use el color brand verde. El selector es `.p-tabview .p-tabview-nav li.p-highlight .p-tabview-nav-link`. Usa `color: #16a34a` y `border-color: #16a34a`. Esto afecta a Settings que sigue usando tabs.

**Commit message:** `fix(admin): spacing fixes B1-B2-B4 from AUDIT-045`

Espera confirmación antes de continuar a la Fase 2.

---

## FASE 2 — Rediseño del Product Form (commit separado)

### Decisiones de arquitectura ya tomadas (NO cambiar):
- El FormGroup NO se modifica. Los 16 controles + 2 FormArrays se mantienen idénticos.
- Los servicios inyectados NO cambian.
- Las validaciones NO cambian.
- Los gates por giro (`showsMembership`, `hasKitchen()`, `posExperience`) se mantienen — solo cambian de tab a sección colapsable.
- El modo crear/editar compartido se mantiene.

### 2.1 — Eliminar TabView

Quita `<p-tabView>` y `TabViewModule` del componente. Elimina `activeTabIndex` signal.

### 2.2 — Layout 2 columnas con preview

Reemplaza el body del componente con un grid de 2 columnas:

```
.product-form-page__body {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 0;
  overflow: hidden;
}

@media (max-width: 1023px) {
  .product-form-page__body {
    grid-template-columns: 1fr;
  }
  .product-form-page__preview {
    display: none;
  }
}
```

- Columna izquierda: `.product-form-page__form` — scrolleable, padding 16px.
- Columna derecha: `.product-form-page__preview` — border-left, background surface, sticky, padding 16px. Se oculta en <1024px.

Quita `max-width: 720px` del `.product-form`.

### 2.3 — Secciones colapsables con `<details>` nativo

Reemplaza los tabs por secciones colapsables usando `<details>` HTML nativo. Cada sección tiene:
- `<summary>` con icono (PrimeNG icon o pi icon), título, y badge condicional si aplica.
- Contenido del formulario adentro.

Agrega un signal para controlar qué secciones están abiertas:
```typescript
expandedSections = signal<Set<string>>(new Set(['identity', 'price']));
```

Las secciones son:

1. **Identidad** (abierta por default)
   - `name` (full-width, max-width: 480px)
   - `categoryId` + `barcode` en grid 2-col
   - `description` (textarea)
   - Imagen: drag-and-drop zone. En modo crear, acumula en `pendingImageFiles = signal<File[]>([])` y sube después del `createProduct` exitoso. En modo editar, sube inmediatamente como antes.
   - `isAvailable` switch

2. **Precio** (abierta por default)
   - `pricePesos` + `taxRate` en grid 2-col
   - Switch "Precio incluye IVA"

3. **Inventario** (cerrada por default)
   - `trackStock` switch
   - `currentStock` + `lowStockThreshold` en grid 2-col (visible solo si trackStock es true, con transición)
   - `barcode` (si decides moverlo aquí en vez de Identidad — evalúa qué tiene más sentido para el usuario)

4. **Vigencia y membresía** (cerrada, solo visible si `showsMembership()`)
   - `isMembership` switch
   - `membershipDurationDays` (visible si isMembership es true)
   - Badge: "Servicios" en color purple

5. **Modificadores** (cerrada, solo visible si `hasKitchen()` o macro FoodBeverage/QuickService)
   - `sizes` FormArray (reusar el markup actual)
   - `modifierGroups` FormArray (reusar el markup actual)
   - `printingDestinationId` dropdown
   - Badge: "F&B" en color blue

6. **Datos fiscales** (cerrada, solo visible si el tenant tiene feature CfdiInvoicing)
   - `satProductCode`
   - `satUnitCode`
   - Badge: "CFDI" en color amber/warning

### 2.4 — Preview lateral

Crea un sub-componente o sección dentro del mismo componente que muestre una vista previa del producto.

El preview se actualiza en tiempo real leyendo del FormGroup con un `computed`:
```typescript
previewProduct = computed(() => ({
  name: this.productForm.get('name')?.value || 'Nombre del producto',
  category: this.categories().find(c => c.id === this.productForm.get('categoryId')?.value)?.name || 'Sin categoría',
  pricePesos: this.productForm.get('pricePesos')?.value || 0,
  isAvailable: this.productForm.get('isAvailable')?.value ?? true,
  image: this.productImages()?.length > 0 ? this.productImages()[0]?.url : null
}));
```

**IMPORTANTE — El preview se adapta al macro del tenant:**

Usa `tenantContextService.currentMacro()` para decidir qué vista mostrar:

- **FoodBeverage (Restaurant)**: Card con imagen, nombre, categoría, precio. Grid de 2 columnas simulando cómo se ve en el POS de mesas.
- **QuickService (Comida rápida)**: Botón grande con nombre y precio. Simula el cobro rápido al mostrador.
- **Retail (Tiendas)**: Fila de lista con imagen mini, nombre, SKU, stock, precio alineado a la derecha. Simula el POS con scanner.
- **Services**: Card de servicio con ícono de reloj, nombre, duración, precio. Simula la vista de agenda.

Usa un `@switch (tenantContext.currentMacro())` en el template para renderizar la vista correcta.

### 2.5 — Botones del footer

Reemplaza `.btn-primary` y `.btn-ghost` custom por `<p-button>`:
```html
<p-button label="Cancelar" severity="secondary" [outlined]="true" (onClick)="cancel()" />
<p-button label="Guardar" icon="pi pi-save" [loading]="savingProduct()" (onClick)="save()" />
```

El footer sticky se mantiene.

### 2.6 — Imágenes en modo crear

Agrega `pendingImageFiles = signal<File[]>([])`.

En la sección Identidad, el drop-zone acumula archivos en este signal (sin subir).

En `save()`, después del `createProduct` exitoso que retorna el `id`, itera `pendingImageFiles()` y sube cada imagen con `productService.uploadProductImage(id, file)`.

Muestra un progress bar después del POST si hay imágenes pendientes.

### 2.7 — Responsive

```scss
// ≥1024px: 2 columnas (form + preview)
// 768–1023px: form full-width, preview hidden
// <768px: form full-width, secciones Identidad abierta, resto cerradas

@media (max-width: 1023px) {
  .product-form-page__body {
    grid-template-columns: 1fr;
  }
  .product-form-page__preview {
    display: none;
  }
}

@media (max-width: 768px) {
  .form-section__grid--2col {
    grid-template-columns: 1fr;
  }
}
```

---

## Checklist de verificación post-implementación

- [ ] `npx tsc --noEmit -p tsconfig.json` → EXIT=0
- [ ] `npx ng build --configuration development` → sin errores
- [ ] Crear producto: llenar nombre + precio + categoría → guardar → verificar que se creó correctamente
- [ ] Editar producto: navegar a un producto existente → todos los campos pre-llenados → editar → guardar
- [ ] Verificar gates: en macro Services, la sección "Vigencia" aparece. En FoodBeverage, "Modificadores" aparece. En Retail, ninguna de las dos.
- [ ] Verificar responsive: en <1024px el preview desaparece. En <768px los campos de 2-col van a 1-col.
- [ ] Verificar imágenes: en modo crear, subir imagen → guardar → la imagen se sube después del create.
- [ ] El preview refleja el macro del tenant (no tabs manuales).

**Commit message:** `refactor(product-form): redesign without tabs, collapsible sections, live preview`

NO implementes nada extra más allá de lo descrito. Si tienes dudas, pregunta antes de implementar.
