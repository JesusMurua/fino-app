# Frontend Design Document: Inventory & Ledger UX Refactor

> **Document ID:** FDD-010  
> **Status:** Draft  
> **Author:** Claude Code (Architect)  
> **Date:** 2026-04-04  
> **Target:** Angular 18 + PrimeNG 17 + PrimeFlex  

---

## 1. Executive Summary

### Problem Statement

The current Inventory module (`AdminInventoryComponent`) is a monolithic 822-line component with 8 dialogs, 3 tabs, and no pagination or virtual scrolling. All data is loaded at once into standard `p-table` instances, which causes noticeable DOM lag when inventory items, movements, or stock receipts grow into the hundreds or thousands. The UI relies on generic spinners (`pi-spin pi-spinner`) instead of skeleton loaders, making the interface feel slow even on fast networks.

### Proposed Solution

Refactor the Inventory module into a decomposed component architecture with dedicated sub-components per tab, introduce `p-table` virtual scrolling and lazy loading for large datasets, replace all spinner states with `p-skeleton` loaders, and apply the enterprise design system (Linear/Stripe aesthetic, light theme, `shadow-1` cards, 8px spacing scale). All component-level state must use Angular 18 Signals exclusively — no `BehaviorSubject` patterns.

### User Impact & UX Goals

- **Instant perceived load**: skeleton placeholders render within 16ms, data fills in progressively.  
- **No DOM lag**: virtual scrolling keeps rendered rows under 50 regardless of dataset size.  
- **Clearer hierarchy**: borderless cards with subtle shadows, grouped by category, with `text-900` values and `text-500` labels.  
- **Touch-friendly**: all interactive elements maintain the 64px minimum touch target.

---

## 2. Current State Analysis

### 2.1 Existing Components

| File | Lines | Responsibility |
|------|-------|----------------|
| `admin-inventory.component.ts` | 822 | Monolithic: 3 tabs, 8 dialogs, all CRUD, scanner integration |
| `admin-inventory.component.html` | 959 | Single template with all tabs, tables, and dialogs inline |
| `admin-inventory.component.scss` | 455 | BEM styles, manual color tokens, no design system alignment |

**Services (already signal-based, no changes needed to their public API):**

| Service | State Pattern | Notes |
|---------|---------------|-------|
| `InventoryService` | `signal<InventoryItem[]>()`, `computed()` | Offline-first via Dexie. `loadFromApi()` + `loadFromLocal()` fallback. |
| `SupplierService` | Stateless (returns `Observable`) | Pure HTTP wrapper, no caching. |
| `StockReceiptService` | Stateless (returns `Observable`) | Filter params: `supplierId`, `from`, `to`. |
| `InventoryConsumptionService` | Stateless (returns `Observable`) | CRUD for product consumption rules. |
| `ScannerService` | `Observable` stream | Emits barcode strings via `onScan()`. |

### 2.2 Current UX Pain Points

| ID | Pain Point | Impact |
|----|-----------|--------|
| UX-001 | **No pagination or virtual scrolling** — all records rendered in DOM | Severe lag with 500+ inventory items or movements |
| UX-002 | **Generic spinner overlays** on `p-table` `[loading]` | "Flash of nothing" — user sees blank table, then data pops in |
| UX-003 | **Monolithic component** — 822 lines, hard to reason about | Slow change detection cycles; entire component re-evaluates on any signal change |
| UX-004 | **8 inline `p-dialog` instances** always in DOM | Unnecessary DOM weight; dialogs share the same change detection boundary |
| UX-005 | **No visual grouping** — flat table rows with no category context | User must scan linearly to find items by type |
| UX-006 | **Movement history in modal** — loses context of the item | User cannot compare movements across items |
| UX-007 | **Template-driven forms** with `ngModel` | No structured validation; disabled-button-only feedback |
| UX-008 | **Manual color tokens** in SCSS | Inconsistent with design system; hard to maintain |

### 2.3 Performance Baseline (Estimated)

| Metric | Current (~50 items) | Projected (~1000 items) |
|--------|---------------------|------------------------|
| Initial render | ~200ms | ~2000ms+ (no virtualization) |
| Tab switch | ~80ms | ~500ms+ (full re-render) |
| Movement history load | ~150ms (HTTP) | ~150ms (HTTP) — but dialog open/close re-renders parent |
| Memory (DOM nodes) | ~3,000 | ~30,000+ |

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | User Story | Priority |
|----|-----------|----------|
| FR-001 | As an owner, I want to scroll through 1000+ inventory items without lag so that I can manage a large catalog. | Must |
| FR-002 | As an owner, I want to see skeleton placeholders while data loads so that the page feels instant. | Must |
| FR-003 | As an owner, I want inventory items grouped by category/unit so I can quickly find what I need. | Should |
| FR-004 | As a manager, I want to view movement history inline (expandable row) without losing my scroll position. | Should |
| FR-005 | As an owner, I want to filter the ledger (movements) by date range, type (in/out/adjustment), and item so I can audit stock changes. | Must |
| FR-006 | As a manager, I want stock receipt creation to remain fast with barcode scanning support. | Must |
| FR-007 | As an owner, I want supplier management with search and active/inactive filtering. | Must |
| FR-008 | As a manager, I want inline quick-edit for stock levels directly from the inventory table. | Could |

### 3.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-001 | Initial render (with skeleton) | < 100ms |
| NFR-002 | Data population after API response | < 300ms for 1000 items |
| NFR-003 | Rendered DOM rows at any time (virtual scroll) | <= 50 |
| NFR-004 | Tab switch latency | < 150ms |
| NFR-005 | Touch target minimum | 64 x 64px |
| NFR-006 | Minimum font size | 16px body, 20px prices/totals |
| NFR-007 | WCAG compliance | Level AA |
| NFR-008 | Offline support | Inventory items and movements via Dexie (existing) |
| NFR-009 | Browser support | Chrome 90+, Safari 15+, Edge 90+ (PWA) |

---

## 4. Component Architecture

### 4.1 Component Hierarchy

```
AdminInventoryShellComponent (smart — tab container)
├── InventoryItemsTabComponent (smart — items tab)
│   ├── InventoryItemsTableComponent (presentational — virtual scroll table)
│   ├─��� InventoryItemFormDialogComponent (presentational — create/edit dialog)
│   ├── InventoryMovementDialogComponent (presentational — entry/exit dialog)
│   └── InventoryQuickStockDialogComponent (presentational — barcode quick stock)
├── SuppliersTabComponent (smart — suppliers tab)
│   ├─��� SuppliersTableComponent (presentational — table with search)
│   └── SupplierFormDialogComponent (presentational — create/edit dialog)
└── StockReceiptsTabComponent (smart — receipts tab)
    ├── StockReceiptsTableComponent (presentational — lazy-loaded table)
    ├── StockReceiptDetailDialogComponent (presentational — read-only detail)
    └── StockReceiptFormDialogComponent (smart — scanner + line items)
        └── ReceiptItemPickerDialogComponent (presentational — manual item add)
```

### 4.2 Component Specifications

#### AdminInventoryShellComponent

- **Type:** Smart (container)
- **Responsibility:** Manages tab navigation and deferred loading of tab content.
- **Inputs:** None (route-activated).
- **Outputs:** None.
- **Dependencies:** `ActivatedRoute`, `Router`.
- **State:**
  - `activeTab: signal<number>` — index of the active tab (0, 1, 2). Synced with `?tab=` query param.
  - `tabLoaded: signal<Record<number, boolean>>` — tracks which tabs have been activated at least once (for deferred rendering with `@defer`).
- **Behavior:**
  - On init, read `?tab=` from route query params to set initial tab.
  - On tab change, update query param without navigation (`Router.navigate` with `replaceUrl`).
  - Use `@defer (when tabLoaded()[1])` pattern to lazy-render tab content only when first activated.

#### InventoryItemsTabComponent

- **Type:** Smart (container)
- **Responsibility:** Orchestrates inventory items data, loading state, and dialog visibility.
- **Inputs:** None.
- **Outputs:** None.
- **Dependencies:** `InventoryService`, `ProductService`, `ScannerService`, `MessageService`.
- **State:**
  - `items` — reference to `inventoryService.items` signal.
  - `isLoading` — reference to `inventoryService.isLoading` signal.
  - `editingItem: signal<InventoryItem | null>` — item being edited (null = create mode).
  - `showItemDialog: signal<boolean>` — controls create/edit dialog.
  - `showMovementDialog: signal<boolean>` — controls entry/exit dialog.
  - `movementTarget: signal<{ item: InventoryItem; type: 'in' | 'out' } | null>`.
  - `showQuickStock: signal<boolean>` — controls barcode quick-stock dialog.
  - `scannedProduct: signal<Product | null>`.
- **Behavior:**
  - Loads data via `inventoryService.loadFromApi()` on init.
  - Reloads on branch change via `effect()` watching `authService.activeBranchId()`.
  - Delegates scanner subscription to `ScannerService.onScan()` with `takeUntilDestroyed`.

#### InventoryItemsTableComponent

- **Type:** Presentational (dumb)
- **Responsibility:** Renders inventory items in a `p-table` with virtual scrolling, skeleton loaders, and inline stock badges.
- **Inputs:**
  - `items: InventoryItem[]` — full dataset (virtual scroll handles DOM).
  - `isLoading: boolean` — controls skeleton vs data display.
- **Outputs:**
  - `edit: EventEmitter<InventoryItem>` — user clicks edit.
  - `addStock: EventEmitter<InventoryItem>` — user clicks entry (+).
  - `removeStock: EventEmitter<InventoryItem>` — user clicks exit (-).
  - `viewHistory: EventEmitter<InventoryItem>` — user clicks history.
- **PrimeNG Config:**
  - `p-table` with `[scrollable]="true"`, `scrollHeight="calc(100vh - 280px)"`, `[virtualScroll]="true"`, `[virtualScrollItemSize]="56"`.
  - `[rowHover]="true"`, `dataKey="id"`, `styleClass="p-datatable-sm"`.
  - Column definitions: Name, Unit (badge), Stock (badge with color), Min Alert, Unit Cost (MXN), Actions.
- **Skeleton State:**
  - When `isLoading` is true, render 8 `p-skeleton` rows matching the table column layout (height `1.5rem`, varying widths per column).
- **Stock Badges:**
  - `currentStock === 0` → red badge "Sin stock".
  - `currentStock > 0 && currentStock <= lowStockThreshold` → yellow badge "Bajo stock".
  - `currentStock > lowStockThreshold` → green text, no badge.

#### InventoryItemFormDialogComponent

- **Type:** Presentational
- **Responsibility:** Create/edit form for inventory items.
- **Inputs:**
  - `item: InventoryItem | null` — null = create mode, object = edit mode.
  - `visible: boolean` — dialog visibility.
  - `unitOptions: { label: string; value: string }[]`.
- **Outputs:**
  - `save: EventEmitter<ItemFormPayload>` — emits form data on confirm.
  - `visibleChange: EventEmitter<boolean>` — two-way binding for dialog close.
- **Form Structure:**
  - `name: string` — required, max 60 chars.
  - `unit: string` — required, dropdown.
  - `currentStock: number` — required, min 0 (only on create).
  - `lowStockThreshold: number` — required, min 0.
  - `costPesos: number` — required, min 0, currency input (MXN).
- **Validation:** Disable save button until all required fields are valid.

#### InventoryMovementDialogComponent

- **Type:** Presentational
- **Responsibility:** Records a stock entry or exit for a specific item.
- **Inputs:**
  - `item: InventoryItem | null`.
  - `movementType: 'in' | 'out'`.
  - `visible: boolean`.
- **Outputs:**
  - `save: EventEmitter<{ quantity: number; reason: string }>`.
  - `visibleChange: EventEmitter<boolean>`.
- **Form Structure:**
  - `quantity: number` — required, min 1.
  - `reason: string` — optional, max 200 chars.
- **Visual:** Dialog header icon and save button color change based on `movementType` (green for in, red for out).

#### InventoryQuickStockDialogComponent

- **Type:** Presentational
- **Responsibility:** Quick stock reception from barcode scan.
- **Inputs:**
  - `product: Product | null`.
  - `visible: boolean`.
- **Outputs:**
  - `confirm: EventEmitter<{ productId: number; quantity: number }>`.
  - `visibleChange: EventEmitter<boolean>`.
- **Behavior:** Shows product name/image, quantity input with +/- buttons, `inputmode="none"` to suppress mobile keyboard.

#### SuppliersTabComponent

- **Type:** Smart (container)
- **Responsibility:** Manages supplier list, search, and CRUD dialogs.
- **Inputs:** None.
- **Outputs:** None.
- **Dependencies:** `SupplierService`, `MessageService`.
- **State:**
  - `suppliers: signal<Supplier[]>`.
  - `isLoading: signal<boolean>`.
  - `searchTerm: signal<string>`.
  - `filteredSuppliers: computed<Supplier[]>` — filters by `searchTerm` on `name` and `contactName`.
  - `editingSupplier: signal<Supplier | null>`.
  - `showDialog: signal<boolean>`.
- **Data Loading:** `supplierService.getAll()` on init, convert Observable to signal via `toSignal()` or manual subscribe + signal set.

#### SuppliersTableComponent

- **Type:** Presentational
- **Responsibility:** Renders supplier list with search input and action buttons.
- **Inputs:**
  - `suppliers: Supplier[]`.
  - `isLoading: boolean`.
  - `searchTerm: string`.
- **Outputs:**
  - `searchChange: EventEmitter<string>`.
  - `edit: EventEmitter<Supplier>`.
  - `toggleActive: EventEmitter<Supplier>`.
  - `create: EventEmitter<void>`.
- **PrimeNG:** `p-table` (standard, no virtual scroll needed — supplier lists are small).
- **Skeleton:** 5 `p-skeleton` rows when loading.

#### SupplierFormDialogComponent

- **Type:** Presentational
- **Responsibility:** Create/edit supplier form.
- **Inputs:**
  - `supplier: Supplier | null`.
  - `visible: boolean`.
- **Outputs:**
  - `save: EventEmitter<CreateSupplierRequest | UpdateSupplierRequest>`.
  - `visibleChange: EventEmitter<boolean>`.
- **Form Structure:**
  - `name: string` — required, max 80 chars.
  - `contactName: string` — optional, max 80 chars.
  - `phone: string` — optional, max 20 chars.
  - `notes: string` — optional, textarea, max 500 chars.
  - `isActive: boolean` — toggle, only visible on edit.

#### StockReceiptsTabComponent

- **Type:** Smart (container)
- **Responsibility:** Manages receipt list with filters and creation flow.
- **Inputs:** None.
- **Outputs:** None.
- **Dependencies:** `StockReceiptService`, `SupplierService`, `InventoryService`, `ProductService`, `ScannerService`, `MessageService`.
- **State:**
  - `receipts: signal<StockReceipt[]>`.
  - `isLoading: signal<boolean>`.
  - `supplierFilter: signal<number | null>`.
  - `dateRange: signal<[Date, Date] | null>`.
  - `selectedReceipt: signal<StockReceipt | null>` — for detail dialog.
  - `showDetailDialog: signal<boolean>`.
  - `showCreateDialog: signal<boolean>`.
- **Data Loading:** Lazy — only loads when tab first becomes active. Reloads on filter change.

#### StockReceiptsTableComponent

- **Type:** Presentational
- **Responsibility:** Renders receipt list with filter toolbar.
- **Inputs:**
  - `receipts: StockReceipt[]`.
  - `isLoading: boolean`.
  - `suppliers: Supplier[]` — for filter dropdown.
  - `supplierFilter: number | null`.
  - `dateRange: [Date, Date] | null`.
- **Outputs:**
  - `supplierFilterChange: EventEmitter<number | null>`.
  - `dateRangeChange: EventEmitter<[Date, Date] | null>`.
  - `applyFilters: EventEmitter<void>`.
  - `viewDetail: EventEmitter<StockReceipt>`.
  - `create: EventEmitter<void>`.
- **PrimeNG:** `p-table` with `[lazy]="true"` if dataset grows; for now, client-side with virtual scroll option.
- **Skeleton:** 5 `p-skeleton` rows when loading.

#### StockReceiptDetailDialogComponent

- **Type:** Presentational
- **Responsibility:** Read-only display of a receipt with line items.
- **Inputs:**
  - `receipt: StockReceipt | null`.
  - `visible: boolean`.
- **Outputs:**
  - `visibleChange: EventEmitter<boolean>`.
- **Layout:** Header card with supplier/date/received-by, then line items table, then total.

#### StockReceiptFormDialogComponent

- **Type:** Smart
- **Responsibility:** Complex receipt creation with scanner support and line item management.
- **Inputs:**
  - `visible: boolean`.
  - `suppliers: Supplier[]`.
  - `inventoryItems: InventoryItem[]`.
- **Outputs:**
  - `save: EventEmitter<CreateStockReceiptRequest>`.
  - `visibleChange: EventEmitter<boolean>`.
- **State:**
  - `selectedSupplierId: signal<number | null>`.
  - `notes: signal<string>`.
  - `lines: signal<NewReceiptLine[]>`.
  - `totalCents: computed<number>` — sum of all line `costCents * quantity`.
  - `isSaving: signal<boolean>`.
  - `showItemPicker: signal<boolean>`.
- **Scanner:** Subscribes to `ScannerService.onScan()` with `takeUntilDestroyed`. On scan, attempts `ProductService.findByBarcode()`, then matches against inventory items by name.
- **Line Management:** `addOrIncrementLine()`, inline quantity/cost editing, remove line.

#### ReceiptItemPickerDialogComponent

- **Type:** Presentational
- **Responsibility:** Manual item selection when barcode is not available.
- **Inputs:**
  - `visible: boolean`.
  - `itemOptions: { id: number; name: string; type: 'inventory' | 'product' }[]`.
- **Outputs:**
  - `add: EventEmitter<{ inventoryItemId?: number; productId?: number; name: string; quantity: number; costPesos: number }>`.
  - `visibleChange: EventEmitter<boolean>`.

### 4.3 Component Communication

- **Parent to Child:** Input binding via signals unwrapped in the parent template (e.g., `[items]="items()"`).
- **Child to Parent:** `EventEmitter` outputs. Parent handles service calls and Toast messages.
- **Sibling tabs:** No direct communication. Each tab manages its own data independently. Shared context (branch ID) comes from `AuthService`.

---

## 5. State Management

### 5.1 Signal Architecture

All component state MUST use Angular 18 Signals. No `BehaviorSubject` patterns.

**Service-Level Signals (existing, no changes):**

| Service | Signal | Type | Purpose |
|---------|--------|------|---------|
| `InventoryService` | `items` | `signal<InventoryItem[]>` | All inventory items for current branch |
| `InventoryService` | `lowStockItems` | `computed<InventoryItem[]>` | Filtered: items where `currentStock <= lowStockThreshold` |
| `InventoryService` | `isLoading` | `signal<boolean>` | Loading state |

**Component-Level Signals (new):**

Each smart component manages its own dialog visibility and editing state via signals. See Section 4.2 for per-component signal definitions.

### 5.2 Reactive Patterns

| Pattern | Where | Implementation |
|---------|-------|----------------|
| Branch change reload | `InventoryItemsTabComponent` | `effect()` watching `authService.activeBranchId()` |
| Scanner subscription | `InventoryItemsTabComponent`, `StockReceiptFormDialogComponent` | `scannerService.onScan().pipe(takeUntilDestroyed())` |
| HTTP to signal | `SuppliersTabComponent` | Subscribe to `Observable`, set signal in `next` callback |
| Debounced scan input | `StockReceiptFormDialogComponent` | RxJS `debounceTime(150)` on scan input stream |
| Computed filtering | `SuppliersTabComponent` | `computed()` filtering `suppliers()` by `searchTerm()` |

### 5.3 Form State

All dialog forms use plain object signals (not Angular Reactive Forms), consistent with existing codebase patterns:

```
form = signal<ItemForm>({ name: '', unit: 'pza', currentStock: 0, ... })
```

Validation is computed:

```
isFormValid = computed(() => {
  const f = this.form();
  return f.name.trim().length > 0 && f.currentStock >= 0 && ...;
})
```

---

## 6. UI/UX Specifications

### 6.1 Layout Structure

**Shell (AdminInventoryShellComponent):**

```
Full-width container, surface-ground background
├── Header row: flex, justify-content-between, align-items-center, px-4 pt-4
│   ├── Title: "Inventory" (text-900, text-2xl, font-semibold)
│   └── (reserved for global actions if needed)
└── p-tabView (no border, custom minimal tab headers)
    ├── Tab 0: "Items" → InventoryItemsTabComponent
    ├── Tab 1: "Suppliers" → SuppliersTabComponent
    └── Tab 2: "Receipts" → StockReceiptsTabComponent
```

**Items Tab Layout:**

```
px-4 pb-4
├── Toolbar: flex, justify-content-between, align-items-center, mb-4
│   ├── Left: item count badge (text-500)
│   └── Right: "New Item" button (p-button, primary)
├── Table Card: border-none, shadow-1, border-round-xl, overflow-hidden
│   └── p-table with virtual scroll
└── (Dialogs rendered outside card, lazy)
```

**Suppliers Tab Layout:**

```
px-4 pb-4
├── Toolbar: flex, gap-3, align-items-center, mb-4
│   ├── Search: p-inputText with pi-search icon (flex-grow-1, max-width 400px)
│   └── "New Supplier" button (p-button, primary)
├── Table Card: border-none, shadow-1, border-round-xl
│   └── p-table (standard, no virtual scroll)
└── (Dialog lazy)
```

**Receipts Tab Layout:**

```
px-4 pb-4
├── Filter Toolbar: flex, gap-3, align-items-center, flex-wrap, mb-4
│   ├── Supplier dropdown (width 250px)
│   ��── Date range calendar (width 280px)
│   ├── "Filter" button (p-button, outlined)
│   └─��� "New Receipt" button (p-button, primary, ml-auto)
├── Table Card: border-none, shadow-1, border-round-xl
│   └── p-table
└── (Dialogs lazy)
```

### 6.2 PrimeNG Components

#### p-table (Inventory Items)

| Property | Value | Rationale |
|----------|-------|-----------|
| `[scrollable]` | `true` | Enable scroll container for virtual scroll |
| `scrollHeight` | `"calc(100vh - 280px)"` | Fill available viewport minus header/toolbar |
| `[virtualScroll]` | `true` | Only render visible rows |
| `[virtualScrollItemSize]` | `56` | Row height in px (48px content + 8px padding) |
| `[rowHover]` | `true` | Visual feedback on hover |
| `dataKey` | `"id"` | Row identity for tracking |
| `styleClass` | `"p-datatable-sm"` | Compact density |

**Column definitions:**

| Column | Width | Content |
|--------|-------|---------|
| Name | `flex: 1` (min 200px) | `text-900 font-medium` |
| Unit | `80px` | Badge: `surface-100 text-600 border-round px-2 py-1 text-sm` |
| Stock | `120px` | Numeric value + conditional badge |
| Min Alert | `100px` | Numeric value, `text-500` |
| Unit Cost | `120px` | Currency formatted (MXN), `text-primary font-semibold` |
| Actions | `180px` | 4 icon buttons: +, -, edit, history |

**Custom templates:**
- `pTemplate="header"` — column headers with `text-500 text-sm font-medium uppercase` styling.
- `pTemplate="body"` — row content per column spec above.
- `pTemplate="loadingbody"` — skeleton rows (8 rows of `p-skeleton` matching column widths).
- `pTemplate="emptymessage"` — centered empty state with icon and text.

#### p-skeleton (Loading States)

Replace all `[loading]="true"` spinner overlays with skeleton templates.

**Table skeleton pattern:**
- Render 8 skeleton rows.
- Each row has `p-skeleton` elements matching column widths.
- Heights: `1.25rem` for text columns, `2rem` for badge columns.
- `borderRadius="8px"` for rounded appearance.
- Animation: default wave (built into PrimeNG).

**Card skeleton pattern (for summary stats, if added):**
- `p-skeleton width="100%" height="3rem"` for title.
- `p-skeleton width="60%" height="1.5rem"` for subtitle.

#### p-dialog (All Dialogs)

| Property | Value |
|----------|-------|
| `[modal]` | `true` |
| `[closable]` | `true` |
| `[draggable]` | `false` |
| `[resizable]` | `false` |
| `[style]` | `{ width: '480px' }` (forms), `{ width: '700px' }` (receipts) |
| `[breakpoints]` | `{ '768px': '95vw' }` |
| `header` | Dynamic based on create/edit mode |

### 6.3 Visual States

#### Loading State (Skeleton)

Each table component renders `p-skeleton` rows when `isLoading` is true. The skeleton layout mirrors the actual table row structure:

- **Items table:** 8 skeleton rows with 6 cells each.
- **Suppliers table:** 5 skeleton rows with 5 cells each.
- **Receipts table:** 5 skeleton rows with 6 cells each.

#### Empty State

Centered container with:
- Icon: `text-4xl text-300` (e.g., `pi-box` for items, `pi-truck` for suppliers, `pi-inbox` for receipts).
- Message: `text-lg text-500 mt-2`.
- Optional CTA: `p-button` with `text` severity to create first item.

#### Error State

- **API errors:** Toast message (`severity: 'error'`), table keeps stale data.
- **Validation errors:** Inline below input fields with `small.text-red-500`.
- **Network offline:** Yellow banner at top (reuse existing `kds-offline-banner` pattern from KDS).

#### Success State

- Toast message (`severity: 'success'`, `life: 3000`).
- Dialog auto-closes on successful save.
- Table data refreshes immediately (signal update).

### 6.4 Design Tokens (Enterprise Theme)

| Token | Value | Usage |
|-------|-------|-------|
| Card container | `border-none shadow-1 border-round-xl surface-card` | All table wrappers |
| Page background | `surface-ground` | Shell background |
| Value text | `text-900` | Item names, stock numbers, totals |
| Label text | `text-500` | Column headers, field labels |
| Subtle text | `text-400` | Timestamps, secondary info |
| Primary action | `p-button` (default green from theme) | Create, Save, Confirm |
| Danger action | `p-button severity="danger"` | Delete, Stock Exit |
| Spacing | 8px scale: `gap-2` (8px), `gap-3` (12px), `gap-4` (16px), `gap-5` (20px) | All spacing |
| Border radius | `border-round-xl` (12px) for cards, `border-round-lg` (8px) for badges | Containers |
| Hover | `hover:surface-hover` or `hover:shadow-2` | Table rows, interactive cards |

### 6.5 User Interactions

| Action | Element | Effect |
|--------|---------|--------|
| Click "New Item" | Button in toolbar | Opens `InventoryItemFormDialogComponent` in create mode |
| Click row edit icon | Action button in table | Opens `InventoryItemFormDialogComponent` in edit mode with item data |
| Click row + icon | Action button in table | Opens `InventoryMovementDialogComponent` with type `'in'` |
| Click row - icon | Action button in table | Opens `InventoryMovementDialogComponent` with type `'out'` |
| Click row history icon | Action button in table | Opens movement history dialog or expands inline (see FR-004) |
| Scan barcode | Scanner hardware | Triggers `ScannerService.onScan()`, opens quick stock dialog if product found |
| Tab change | `p-tabView` header | Deferred load of tab content; updates `?tab=` query param |
| Filter receipts | Dropdown + calendar + button | Reloads receipt data with filter params |
| Inline edit quantity | `p-inputNumber` in receipt form | Updates line total reactively via computed signal |

---

## 7. Data Flow

### 7.1 API Integration

| Service Method | Trigger | Endpoint | Response Handling | Error Handling |
|---------------|---------|----------|-------------------|----------------|
| `inventoryService.loadFromApi()` | Tab 0 init, branch change | `GET /inventory` | Cache in Dexie, set signal | Fallback to `loadFromLocal()` |
| `inventoryService.create(item)` | Item form save (create) | `POST /inventory/create` | Add to Dexie, reload from API | Toast error, keep dialog open |
| `inventoryService.update(id, item)` | Item form save (edit) | `PUT /inventory/{id}` | Update Dexie, reload from API | Toast error, keep dialog open |
| `inventoryService.addMovement(...)` | Movement form save | `POST /inventory/{id}/movement` | Reload from API (stock changed) | Toast error, keep dialog open |
| `supplierService.getAll()` | Tab 1 first activation | `GET /supplier` | Set signal | Toast error |
| `supplierService.create(data)` | Supplier form save (create) | `POST /supplier` | Reload suppliers | Toast error |
| `supplierService.update(id, data)` | Supplier form save (edit) | `PUT /supplier/{id}` | Reload suppliers | Toast error |
| `stockReceiptService.getAll(...)` | Tab 2 first activation, filter change | `GET /stock-receipt?...` | Set signal | Toast error |
| `stockReceiptService.create(data)` | Receipt form confirm | `POST /stock-receipt` | Reload receipts, close dialog | Toast error |
| HTTP GET `/inventory/{id}/movements` | History view | Direct `HttpClient` call | Set movements signal | Toast error |

### 7.2 Data Transformation

| Transformation | Location | Logic |
|---------------|----------|-------|
| Cost cents to pesos | Table display | `item.costCents / 100` formatted with `currency:'MXN'` pipe |
| Pesos to cents | Form save | `Math.round(costPesos * 100)` |
| Stock badge derivation | `InventoryItemsTableComponent` | Compare `currentStock` to 0 and `lowStockThreshold` |
| Receipt total | `StockReceiptFormDialogComponent` | `computed()` summing all `line.quantity * line.costCents` |
| Supplier filter | `SuppliersTabComponent` | `computed()` case-insensitive substring match on `name` + `contactName` |

### 7.3 Data Refresh Strategy

| Trigger | Action |
|---------|--------|
| Component init | Load from API (items tab). Deferred for tabs 1 and 2. |
| Branch change | `effect()` triggers full reload of active tab data. |
| After create/update/delete | Reload the affected dataset from API. |
| After movement | Reload inventory items (stock values changed). |
| Manual refresh | Not required — data refreshes on every mutation. |
| Tab activation (first time) | Load data for that tab. |

---

## 8. Performance Optimization

### 8.1 Rendering Optimization

| Technique | Component | Implementation |
|-----------|-----------|----------------|
| Virtual scrolling | `InventoryItemsTableComponent` | `p-table [virtualScroll]="true" [virtualScrollItemSize]="56"` |
| `@defer` blocks | `AdminInventoryShellComponent` | Defer rendering of tab 1 and tab 2 until first activated |
| `trackBy` via `dataKey` | All `p-table` instances | `dataKey="id"` on every table |
| Skeleton over spinner | All table components | `p-skeleton` rows in `pTemplate="loadingbody"` |
| Standalone components | All new components | Tree-shakeable, independent change detection boundaries |

### 8.2 Data Optimization

| Technique | Where | Details |
|-----------|-------|---------|
| Dexie caching | `InventoryService` | Existing: API data cached in IndexedDB, fallback on offline |
| Deferred tab loading | Shell | Suppliers and receipts only load on first tab activation |
| Computed signal filtering | `SuppliersTabComponent` | Client-side filtering avoids additional API calls |
| Server-side date filtering | `StockReceiptsTabComponent` | `from`/`to` params reduce response payload |

### 8.3 Bundle Optimization

| Technique | Details |
|-----------|---------|
| Lazy-loaded route | `AdminInventoryComponent` already lazy-loaded via `admin.routes.ts` |
| Standalone sub-components | Each dialog/table is its own standalone component — only imported where used |
| PrimeNG module imports | Import only used modules (`TableModule`, `DialogModule`, `SkeletonModule`, etc.) per component |

---

## 9. Error Handling

### 9.1 Error Types

| Error Type | Display Method | Recovery |
|------------|---------------|----------|
| API timeout / network error | Toast (error), fallback to Dexie data | Auto-retry on next user action |
| API validation error (400) | Toast (warn) with server message | Keep dialog open for correction |
| API server error (500) | Toast (error) with generic message | Log to console, keep UI functional |
| Form validation error | Inline `small.text-red-500` under field | User corrects and re-submits |
| Barcode not found | Toast (info): "Product not found for barcode X" | User can search manually |

### 9.2 User Feedback (Toast Messages)

| Action | Severity | Summary | Detail |
|--------|----------|---------|--------|
| Item created | success | Success | "Item created successfully" |
| Item updated | success | Success | "Item updated successfully" |
| Movement recorded | success | Success | "Stock entry recorded" / "Stock exit recorded" |
| Supplier saved | success | Success | "Supplier saved successfully" |
| Receipt created | success | Success | "Stock receipt confirmed" |
| API error | error | Error | "Could not load data — showing cached version" |
| Validation error | warn | Warning | Server-provided message |

---

## 10. Accessibility

### 10.1 Keyboard Navigation

| Key | Context | Action |
|-----|---------|--------|
| Tab | Tables, forms | Standard tab order through interactive elements |
| Enter | Table action buttons | Activates the focused action |
| Escape | Dialogs | Closes the active dialog |
| Arrow Up/Down | Virtual scroll table | Navigate rows (PrimeNG built-in) |

### 10.2 Screen Reader Support

| Element | ARIA Attribute | Value |
|---------|---------------|-------|
| Icon-only action buttons | `aria-label` | "Edit item", "Add stock", "Remove stock", "View history" |
| Stock badges | `role="status"` | Announce stock level |
| Tab panels | `aria-label` | "Inventory Items", "Suppliers", "Stock Receipts" |
| Dialogs | `aria-modal` | `true` (PrimeNG default) |
| Loading skeletons | `aria-busy` | `true` on table container when loading |
| Empty state | `role="status"` | Announce empty list |

---

## 11. Testing Requirements

### 11.1 Unit Tests

**Component tests:**
- `InventoryItemsTableComponent`: renders skeleton when loading, renders items when loaded, emits correct events on button clicks, displays correct stock badge variant.
- `InventoryItemFormDialogComponent`: disables save when form invalid, emits save payload with correct structure, resets form on close.
- `InventoryMovementDialogComponent`: shows correct icon/color for entry vs exit, validates quantity > 0.
- `SuppliersTableComponent`: filters suppliers by search term, shows correct active/inactive badges.
- `StockReceiptsTableComponent`: renders filter controls, emits filter changes.

**Service tests (existing, verify no regression):**
- `InventoryService`: signal updates after create/update, computed `lowStockItems` filters correctly.
- `StockReceiptService`: passes correct query params for filters.

### 11.2 E2E Tests

| Scenario | Steps | Expected |
|----------|-------|----------|
| Create inventory item | Navigate to inventory > Click "New Item" > Fill form > Save | Item appears in table, toast shown |
| Record stock entry | Click + on item > Enter quantity > Save | Stock value increases, toast shown |
| Filter receipts by date | Select date range > Click Filter | Table shows only matching receipts |
| Virtual scroll performance | Load 1000 items > Scroll rapidly | No frame drops, smooth scrolling |
| Barcode scan quick stock | Scan known barcode | Quick stock dialog opens with product info |

---

## 12. Implementation Phases

### Phase 1: Shell Decomposition & Table Component

**Deliverables:**
- `AdminInventoryShellComponent` — tab container with `@defer`.
- `InventoryItemsTabComponent` — smart container for items tab.
- `InventoryItemsTableComponent` — presentational table with virtual scroll + skeleton.
- Update `admin.routes.ts` to point to new shell component.

**Acceptance:** Items tab renders with virtual scroll and skeleton loaders. Existing functionality preserved.

### Phase 2: Item Dialogs Extraction

**Deliverables:**
- `InventoryItemFormDialogComponent` — create/edit form.
- `InventoryMovementDialogComponent` — entry/exit form.
- `InventoryQuickStockDialogComponent` — barcode quick stock.

**Acceptance:** All item CRUD operations work through extracted dialog components.

### Phase 3: Suppliers Tab

**Deliverables:**
- `SuppliersTabComponent` — smart container.
- `SuppliersTableComponent` — presentational table with skeleton.
- `SupplierFormDialogComponent` — create/edit form.

**Acceptance:** Supplier tab loads on first activation, search filters locally, CRUD works.

### Phase 4: Stock Receipts Tab

**Deliverables:**
- `StockReceiptsTabComponent` — smart container.
- `StockReceiptsTableComponent` — presentational table with skeleton.
- `StockReceiptDetailDialogComponent` — read-only detail.
- `StockReceiptFormDialogComponent` — creation with scanner.
- `ReceiptItemPickerDialogComponent` — manual item selection.

**Acceptance:** Receipt creation flow with scanner works end-to-end, filters apply correctly.

### Phase 5: Polish & Cleanup

**Deliverables:**
- Delete old monolithic `AdminInventoryComponent` and its template/styles.
- Enterprise design pass: verify all cards use `shadow-1 border-none border-round-xl`, all spacing follows 8px scale, all text uses `text-900`/`text-500` hierarchy.
- Accessibility audit: verify ARIA labels, keyboard navigation, focus management.
- Performance benchmark: verify < 50 DOM rows with 1000 items.

**Acceptance:** Production build passes, no regressions, design matches enterprise spec.

### Phase Dependencies

```
Phase 1 (Shell + Items Table)
    └── Phase 2 (Item Dialogs) — depends on Phase 1 container
    └── Phase 3 (Suppliers Tab) — independent of Phase 2
    └── Phase 4 (Receipts Tab) — independent of Phase 2 & 3
        └── Phase 5 (Polish) — depends on all previous phases
```

Phases 2, 3, and 4 can be developed in parallel once Phase 1 is complete.

---

## Appendix: File Structure

```
src/app/modules/admin/components/inventory/
├── admin-inventory-shell.component.ts          (Phase 1)
├── items/
│   ├─�� inventory-items-tab.component.ts        (Phase 1)
│   ├─�� inventory-items-table.component.ts      (Phase 1)
│   ├── inventory-items-table.component.html    (Phase 1)
│   ├── inventory-items-table.component.scss    (Phase 1)
│   ├── inventory-item-form-dialog.component.ts (Phase 2)
│   ├── inventory-movement-dialog.component.ts  (Phase 2)
│   └── inventory-quick-stock-dialog.component.ts (Phase 2)
├── suppliers/
│   ├── suppliers-tab.component.ts              (Phase 3)
│   ├── suppliers-table.component.ts            (Phase 3)
│   └── supplier-form-dialog.component.ts       (Phase 3)
└── receipts/
    ├── stock-receipts-tab.component.ts         (Phase 4)
    ├── stock-receipts-table.component.ts       (Phase 4)
    ├── stock-receipt-detail-dialog.component.ts (Phase 4)
    ├── stock-receipt-form-dialog.component.ts  (Phase 4)
    └── receipt-item-picker-dialog.component.ts (Phase 4)
```
