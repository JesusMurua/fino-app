# AUDIT-013: Gap Analysis — Tax (IVA) Implementation in the Frontend

**Date:** 2026-04-07
**Scope:** Pricing calculations, models, UI components, and receipt generation
**Goal:** Identify all gaps preventing tax display and CFDI-compliant tax breakdowns

---

## Target State

Mexico's legal requirement is IVA at 16% (general), 8% (frontera norte), or 0% (tasa cero).
The POS must support:

| Element | Requirement |
|---------|-------------|
| **Product-level tax config** | Each product has a `taxRate` and a `isTaxIncluded` flag |
| **Cart breakdown** | Show Subtotal, Discounts, IVA, and Total separately |
| **Checkout display** | Same 4-line breakdown before payment confirmation |
| **Printed ticket** | Legal-compliant receipt with tax line |
| **Order persistence** | `taxAmountCents` stored per order for accounting/CFDI |
| **Invoicing payload** | Tax data passed to backend for CFDI generation |

---

## 1. Current State

### 1.1 Product Model (`src/app/core/models/product.model.ts`)

```typescript
/** IVA tax rate as integer percentage (e.g. 16, 8, 0). Default: 16 */
taxRate?: number;
```

- **Field exists** — admin UI allows setting `taxRate` per product (defaults to 16).
- **No `isTaxIncluded` flag** — cannot distinguish tax-inclusive vs. tax-added pricing.
- **Field is orphaned** — never read by cart calculations or checkout logic.

### 1.2 CartItem Model (`src/app/core/models/cart-item.model.ts`)

Current fields:

```
id, product, quantity, size, extras, unitPriceCents, totalPriceCents,
notes, discountCents, promotionId, promotionName
```

- **No `taxRate` field** — cannot track per-item tax rate.
- **No `taxAmountCents` field** — cannot compute per-item tax.
- Pricing rule: `unitPriceCents = product.priceCents + sizeDelta + extraTotal`.
- Total rule: `totalPriceCents = unitPriceCents * quantity`.
- **No tax layer in either calculation.**

### 1.3 Order Model (`src/app/core/models/order.model.ts`)

Current total structure:

```typescript
totalCents: number;           // Final total (after discounts)
subtotalCents?: number;       // Pre-discount subtotal (optional)
totalDiscountCents?: number;  // Discount tracking
paidCents: number;            // Sum of all payments
changeCents: number;          // Change to return
```

- `subtotalCents` exists but only used for discount context.
- **No `taxAmountCents`** — tax not tracked at the order level.
- **No `taxRate`** — no way to know what rate was applied.

### 1.4 Cart Service (`src/app/core/services/cart.service.ts`)

Total calculation (computed signal):

```typescript
readonly totalCents = computed(() => {
  const evaluation = this.cartEvaluation();
  if (!evaluation) return 0;
  const subtotal = this.items().reduce((sum, i) => sum + i.totalPriceCents, 0);
  return Math.max(0, subtotal - evaluation.totalDiscountCents);
});
```

- Simple subtraction: `total = items_sum - discounts`.
- **No tax calculation anywhere.**
- No helper function for extracting tax from a tax-inclusive price.

### 1.5 Checkout Component (`src/app/modules/pos/components/checkout/`)

Computed properties:

```typescript
rawSubtotalCents    → items subtotal before manual discount
subtotalCents       → adjusted subtotal for discount calc
discountCents       → manual or preset discount
totalWithDiscount   → subtotalCents - discountCents
```

- Breakdown goes: Subtotal → Promo Discount → Manual Discount → **Total**.
- **No tax computation step between discount and total.**

Template breakdown (lines 189-218):

```
@if (discounts exist) {
  Subtotal:        $XX.XX
  Descuento promo: -$XX.XX
  Descuento manual:-$XX.XX
}
Total a cobrar:    $XX.XX    ← jumps directly to final total
```

- **Missing: IVA row.**

Order creation in `confirmPayment()`:

```typescript
order = {
  subtotalCents: this.subtotalCents(),
  orderDiscountCents: discount,
  totalDiscountCents: discount,
  totalCents: this.totalWithDiscount(),
  // NO taxAmountCents
};
```

### 1.6 Cart Panel (`src/app/modules/pos/components/cart-panel/`)

Template (lines 143-162):

```
@if (discounts > 0) {
  Subtotal:              $XX.XX
  Descuentos aplicados:  -$XX.XX
}
Total:                   $XX.XX
```

- **Same gap** — no tax row in the sidebar cart summary.

### 1.7 Print Service (`src/app/core/services/print.service.ts`)

HTML ticket template (lines 167-179):

```html
${hasDiscounts ? `
  <tr><td>Subtotal</td><td>$XX.XX</td></tr>
  <tr><td>Descuento</td><td>-$XX.XX</td></tr>
` : ''}
<tr><td>TOTAL</td><td>$XX.XX</td></tr>
```

Plain text ticket (lines 328-330):

```
Subtotal:      $XX.XX
Descuento:    -$XX.XX
---
TOTAL:         $XX.XX
```

- **Both formats lack a tax line.**
- Template structure can easily accommodate an extra row, but no data is available.

### 1.8 Price Pipe (`src/app/shared/pipes/price.pipe.ts`)

```typescript
transform(cents: number | null | undefined): string {
  return this.formatter.format((cents ?? 0) / 100);
}
```

- Simple cents-to-MXN formatter. Works correctly — no change needed.

### 1.9 Admin Products UI

- Input field for `taxRate` per product exists (defaults to 16).
- Value is saved to the backend.
- **Never propagated to cart or checkout calculations.**

### 1.10 Invoicing (`src/app/core/models/invoice.model.ts` + `invoicing.service.ts`)

- `IVA_RATE_OPTIONS` defined: `16%`, `8%`, `0%`.
- These are SAT catalog constants for CFDI XML generation.
- **Invoice creation payload does NOT include `taxAmountCents`.**
- Backend presumably calculates tax server-side for CFDI, but frontend is blind to it.

---

## 2. Identified Gaps

### GAP-01: No Tax Calculation Engine

| Severity | **CRITICAL — Legal Compliance** |
|----------|--------------------------------|
| Current | Cart total = sum(items) - discounts. No tax step. |
| Impact | Cannot display legally-required tax breakdown on tickets or invoices. |
| Target | A centralized tax calculation function that extracts/adds IVA from prices. |

### GAP-02: CartItem Has No Tax Fields

| Severity | **CRITICAL** |
|----------|-------------|
| Current | `CartItem` tracks `unitPriceCents` and `totalPriceCents` but no tax data. |
| Impact | Cannot show per-item tax or aggregate tax for the order. |
| Target | Add `taxRate`, `taxAmountCents` to `CartItem`. |

### GAP-03: Order Has No Tax Amount

| Severity | **CRITICAL** |
|----------|-------------|
| Current | `Order` has `totalCents` and optional `subtotalCents`, no `taxAmountCents`. |
| Impact | Tax data is lost after the sale — cannot reconcile for accounting. |
| Target | Add `taxAmountCents` to `Order` (and backend DTO). |

### GAP-04: No `isTaxIncluded` Flag on Product

| Severity | **HIGH** |
|----------|---------|
| Current | `Product.taxRate` exists but there is no `isTaxIncluded` boolean. |
| Impact | Cannot determine whether `priceCents = 1000` means "$10.00 + IVA" or "$10.00 IVA included". In Mexico, consumer-facing prices are almost always tax-included (NOM compliance). |
| Target | Add `isTaxIncluded: boolean` to `Product` (default: `true` for Mexico). |

### GAP-05: Checkout UI Missing Tax Row

| Severity | **HIGH — UX** |
|----------|--------------|
| Current | Breakdown shows Subtotal → Discounts → Total. |
| Target | Subtotal (pre-tax) → Discounts → IVA (16%) → Total. |

### GAP-06: Cart Panel Missing Tax Row

| Severity | **MEDIUM — UX** |
|----------|-----------------|
| Current | Sidebar shows Subtotal → Discounts → Total. |
| Target | Add a compact IVA line between discounts and total. |

### GAP-07: Printed Tickets Missing Tax Line

| Severity | **HIGH — Legal** |
|----------|-----------------|
| Current | HTML and plain-text tickets show Subtotal, Discount, Total. No IVA. |
| Target | Insert IVA row in both ticket formats. |

### GAP-08: Invoicing Payload Missing Tax Data

| Severity | **MEDIUM** |
|----------|-----------|
| Current | Frontend sends order data to invoicing service without tax breakdown. Backend presumably recalculates. |
| Target | Frontend sends `taxAmountCents` and `taxRate` so backend doesn't need to guess. |

### GAP-09: Product.taxRate Not Read in Cart Logic

| Severity | **HIGH** |
|----------|---------|
| Current | Admin UI writes `taxRate` per product. Cart calculations ignore it. |
| Impact | The field is fully orphaned — changes in admin have zero effect on pricing. |
| Target | `calcUnitPriceCents()` must read `product.taxRate` and compute tax accordingly. |

---

## 3. Gap Summary Matrix

| ID | Gap | Severity | Effort | Legal Blocker? |
|----|-----|----------|--------|----------------|
| GAP-01 | No tax calculation engine | CRITICAL | Medium | **Yes** |
| GAP-02 | CartItem has no tax fields | CRITICAL | Low | **Yes** |
| GAP-03 | Order has no taxAmountCents | CRITICAL | Low | **Yes** |
| GAP-04 | No isTaxIncluded on Product | HIGH | Low | **Yes** |
| GAP-05 | Checkout UI missing tax row | HIGH | Low | **Yes** |
| GAP-06 | Cart panel missing tax row | MEDIUM | Low | No (nice-to-have) |
| GAP-07 | Printed tickets missing tax line | HIGH | Low | **Yes** |
| GAP-08 | Invoicing payload missing tax data | MEDIUM | Low | No (backend fallback) |
| GAP-09 | Product.taxRate orphaned | HIGH | Low | **Yes** |

---

## 4. Design Decision: Tax-Included vs. Tax-Added

### Recommendation: Default to Tax-Included (Mexico Standard)

In Mexico, NOM-010-SCFI requires consumer-facing prices to **include IVA**. This means:

```
Product price (priceCents): $116.00  (IVA incluido)
  → Subtotal (pre-tax):    $100.00
  → IVA (16%):              $16.00
  → Total:                 $116.00
```

The extraction formula for tax-included prices:

```typescript
// Tax-included: extract tax from the final price
taxAmountCents = totalCents - Math.round(totalCents / (1 + taxRate / 100));

// Tax-added: add tax on top (B2B / export scenarios)
taxAmountCents = Math.round(subtotalCents * taxRate / 100);
```

The `isTaxIncluded` flag per product controls which formula applies.

---

## 5. Step-by-Step Implementation Plan

### Phase A: Model & Calculation Foundation

#### Step A1 — Add `isTaxIncluded` to Product Model

**File:** `src/app/core/models/product.model.ts`

- Add `isTaxIncluded?: boolean` (default: `true`).
- Admin products form: add toggle for "Precio incluye IVA" (default checked).
- Backend DTO must also include this field.

#### Step A2 — Add Tax Fields to CartItem Model

**File:** `src/app/core/models/cart-item.model.ts`

- Add `taxRate: number` (copied from product at add-time).
- Add `taxAmountCents: number` (calculated when item is added/updated).
- Update the pricing rule documentation:
  ```
  unitPriceCents = product.priceCents + sizeDelta + extraTotal
  if isTaxIncluded:
    taxAmountCents = totalPriceCents - round(totalPriceCents / (1 + taxRate/100))
  else:
    taxAmountCents = round(totalPriceCents * taxRate / 100)
  ```

#### Step A3 — Add Tax Fields to Order Model

**File:** `src/app/core/models/order.model.ts`

- Add `taxAmountCents: number` (sum of all item taxes).
- Add `taxRate?: number` (dominant rate, for display — e.g., 16).

#### Step A4 — Create Tax Calculation Utility

**File:** `src/app/core/utils/tax.utils.ts` (new)

```
extractTax(totalCents, taxRate, isTaxIncluded): { subtotalCents, taxAmountCents }
  - if isTaxIncluded: extract tax from totalCents
  - if !isTaxIncluded: add tax on top of totalCents
  - All math in integer cents to avoid floating point
```

#### Step A5 — Update Cart Service

**File:** `src/app/core/services/cart.service.ts`

- In `addItem()` / `updateItem()`: calculate `taxAmountCents` per CartItem using the utility.
- New computed signals:
  ```
  readonly subtotalCents   — sum of items (pre-tax, pre-discount)
  readonly totalTaxCents   — sum of item taxAmountCents (after discount proration)
  readonly totalCents      — subtotalCents - discountCents + totalTaxCents
  ```
- Key decision: **Discounts reduce the taxable base.** If a $116 item (IVA included) gets a 50% discount, the new price is $58, and tax is extracted from $58.

### Phase B: UI Integration

#### Step B1 — Update Checkout Component

**File:** `src/app/modules/pos/components/checkout/checkout.component.ts` + `.html`

- Add computed `taxAmountCents` derived from cart service.
- Template: Insert IVA row between discounts and total:
  ```
  Subtotal (sin IVA):   $XXX.XX
  Descuento promo:     -$XX.XX
  Descuento manual:    -$XX.XX
  IVA (16%):            $XX.XX
  ─────────────────────────────
  Total a cobrar:       $XXX.XX
  ```
- In `confirmPayment()`: pass `taxAmountCents` to the saved Order.

#### Step B2 — Update Cart Panel

**File:** `src/app/modules/pos/components/cart-panel/cart-panel.component.html`

- Add compact IVA line in the summary section:
  ```
  Subtotal:     $XXX.XX
  Descuentos:  -$XX.XX
  IVA:          $XX.XX
  Total:        $XXX.XX
  ```

#### Step B3 — Update Print Service

**File:** `src/app/core/services/print.service.ts`

- HTML ticket: Add `<tr>` for IVA between discount and total rows.
- Plain text ticket: Add IVA line in the text block.
- Both formats: Only show IVA row if `taxAmountCents > 0`.

### Phase C: Data Persistence & Invoicing

#### Step C1 — Update Order Creation

**Files:** Checkout component, sync service

- Include `taxAmountCents` in the order payload sent to backend.
- Ensure Dexie schema stores `taxAmountCents` for offline orders.

#### Step C2 — Update Invoicing Payload

**File:** `src/app/core/services/invoicing.service.ts`

- Pass `taxAmountCents` and `taxRate` in the invoice creation request.
- Backend can cross-validate but no longer needs to recalculate.

#### Step C3 — Update Admin Product Form

**File:** `src/app/modules/admin/components/products/admin-products.component.ts` + `.html`

- Add "Precio incluye IVA" toggle (default: checked).
- Persist `isTaxIncluded` alongside `taxRate`.

### Phase D: Edge Cases & Polish

#### Step D1 — Mixed Tax Rates in Cart

- If a cart has items with 16% and 0% rates, show grouped tax lines:
  ```
  IVA 16%:  $XX.XX  (N items)
  IVA 0%:    $0.00  (M items)
  ```
- Or a single aggregated line: `IVA: $XX.XX`.

#### Step D2 — Discount + Tax Interaction

- When a discount is applied, **prorate it across items proportionally**, then recalculate tax per item.
- Example: $116 item (IVA included) with $20 discount:
  ```
  Adjusted price: $96.00
  Tax extracted:  $96.00 - round($96.00 / 1.16) = $96.00 - $82.76 = $13.24
  Subtotal:       $82.76
  ```

#### Step D3 — Frontera Norte Support

- Products in northern border zones use 8% IVA.
- The `taxRate` field already supports this — just needs to flow through calculations.

---

## 6. Key Files Reference

| File | Current Role | Tax Gap |
|------|-------------|---------|
| [product.model.ts](src/app/core/models/product.model.ts) | Has `taxRate` (unused) | Missing `isTaxIncluded` |
| [cart-item.model.ts](src/app/core/models/cart-item.model.ts) | Price tracking | No tax fields |
| [order.model.ts](src/app/core/models/order.model.ts) | Order persistence | No `taxAmountCents` |
| [cart.service.ts](src/app/core/services/cart.service.ts) | Total calculation | No tax computation |
| [checkout.component.ts](src/app/modules/pos/components/checkout/checkout.component.ts) | Payment flow | No tax in breakdown |
| [checkout.component.html](src/app/modules/pos/components/checkout/checkout.component.html) | Price display | Missing IVA row |
| [cart-panel.component.html](src/app/modules/pos/components/cart-panel/cart-panel.component.html) | Sidebar total | Missing IVA row |
| [print.service.ts](src/app/core/services/print.service.ts) | Receipt generation | No tax line |
| [invoicing.service.ts](src/app/core/services/invoicing.service.ts) | CFDI creation | No tax in payload |
| [admin-products.component.ts](src/app/modules/admin/components/products/admin-products.component.ts) | Product admin | `taxRate` input exists, orphaned |

---

*Generated by Claude Code — AUDIT-013*
