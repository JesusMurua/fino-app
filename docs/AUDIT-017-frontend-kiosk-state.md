# AUDIT-017: Kiosk (Self-Service) — Cart State & Checkout Totals

**Date:** 2026-04-07
**Scope:** Kiosk module cart architecture, total display, and tax breakdown readiness
**Goal:** Determine how to safely inject Subtotal/IVA rows into the Kiosk UI

---

## 1. Component Inventory

| Screen | Route | File Path | Purpose |
|--------|-------|-----------|---------|
| Shell | `/kiosk` (parent) | `src/app/modules/kiosk/kiosk-shell.component.ts` | Idle timer, admin long-press, cart reset |
| Welcome | `/kiosk/welcome` | `src/app/modules/kiosk/screens/welcome/kiosk-welcome.component.ts` | Landing screen, auto-clears cart after 60s |
| Catalog | `/kiosk/catalog` | `src/app/modules/kiosk/screens/catalog/kiosk-catalog.component.ts` | Product browsing + floating "Ver orden" bar |
| Detail | `/kiosk/detail/:id` | `src/app/modules/kiosk/screens/detail/kiosk-detail.component.ts` | Size/extras/qty customization |
| Summary | `/kiosk/summary` | `src/app/modules/kiosk/screens/summary/kiosk-summary.component.ts` | Order review, qty adjust, discount display |
| Ticket | `/kiosk/ticket` | `src/app/modules/kiosk/screens/ticket/kiosk-ticket.component.ts` | Order confirmation, WhatsApp share |

**Total files:** 18 (6 components × 3 files: `.ts`, `.html`, `.scss`) + `kiosk.routes.ts`

---

## 2. Architectural Reality: Shared CartService

**The Kiosk uses the exact same global `CartService` as the POS.** There is no `KioskCartService` or local state duplication.

### Evidence

| Component | CartService Usage |
|-----------|-------------------|
| **Shell** | `cartService.clearCart()` on idle timeout |
| **Welcome** | `cartService.clearCart()` after 60s inactivity |
| **Catalog** | `cartService.itemCount` (badge), `cartService.totalCents` (floating bar), `cartService.addItem()` |
| **Detail** | `cartService.addItem(product, size, extras, notes)` — called N times for quantity |
| **Summary** | `cartService.items`, `cartService.totalCents`, `cartService.cartEvaluation`, `cartService.updateQuantity()`, `cartService.removeItem()`, `cartService.clearCart()` |
| **Ticket** | `cartService.getSnapshot()`, `cartService.clearCart()` |

### Implication

Since the kiosk reads `CartService.totalCents`, `CartService.totalTaxCents`, and `CartService.subtotalPreTaxCents` — the tax signals already exist and are already computed for kiosk cart items. **No new calculation logic is needed.** The work is purely UI: expose the existing signals and add template rows.

---

## 3. Current Total Display

### 3.1 Catalog — Floating Bottom Bar

```html
<span class="kiosk-catalog__order-total">{{ cartTotalCents() | price }}</span>
```

- Shows a single total in the "Ver orden" floating button.
- **No breakdown** — just the grand total.
- Tax breakdown here would be noise (small bar, customer scanning products). **Skip.**

### 3.2 Summary — Order Review (Primary Target)

The summary screen already has a conditional breakdown for discounts:

```html
@if (cartEvaluation(); as eval) {
  @if (eval.totalDiscountCents > 0) {
    <div class="ks__summary-card">
      <div class="ks__summary-row">
        <span>Subtotal</span>
        <span>{{ (totalCents() + eval.totalDiscountCents) | price }}</span>
      </div>
      <div class="ks__summary-row ks__summary-row--discount">
        <span>Descuentos</span>
        <span>-{{ eval.totalDiscountCents | price }}</span>
      </div>
      <div class="ks__total-row ks__total-row--inline">
        <span>Total</span>
        <span>{{ totalCents() | price }}</span>
      </div>
      <div class="ks__savings-banner">
        Ahorraste {{ eval.totalSavedCents | price }}
      </div>
    </div>
  }
}
```

When no discounts: just a simple `totalCents` display.

**This is the primary target for the IVA rows.** The existing `ks__summary-row` CSS class can be reused.

### 3.3 Ticket — Confirmation Screen

```html
<span class="kiosk-ticket__total">{{ totalCents() | price }}</span>
```

- Single total display.
- Also shows it in the WhatsApp share text: `Total: $XX.XX MXN`.
- **Secondary target** — add IVA breakdown for legal compliance on the confirmation screen.

### 3.4 Ticket Component — Order Persistence (Critical)

The ticket component **does NOT use `CartService.totalCents`** for persistence. It manually computes the total from the snapshot:

```typescript
const snapshot = this.cartService.getSnapshot();
const total = snapshot.reduce((sum, item) => sum + item.totalPriceCents, 0);

const order: Order = {
  ...
  totalCents: total,
  // NO taxAmountCents field
  ...
};
```

**GAP:** The persisted order is missing `taxAmountCents`. The POS checkout already includes it, but the kiosk ticket screen does not.

---

## 4. Identified Gaps

### GAP-01: Summary Screen Missing IVA Rows

| Severity | **HIGH — Legal Compliance** |
|----------|----------------------------|
| Current | Summary shows Subtotal (pre-discount), Discounts, Total. No IVA row. |
| Target | Add "Subtotal sin IVA" and "IVA" rows, matching the POS cart-panel pattern. |

### GAP-02: Ticket Screen Missing IVA Rows

| Severity | **MEDIUM — Legal** |
|----------|-------------------|
| Current | Confirmation shows only the grand total. |
| Target | Add IVA breakdown on the confirmation screen. |

### GAP-03: Persisted Order Missing `taxAmountCents`

| Severity | **HIGH — Data Integrity** |
|----------|--------------------------|
| Current | Kiosk ticket screen creates an `Order` without `taxAmountCents`. |
| Target | Compute tax from the snapshot items and include `taxAmountCents` in the persisted order. |

### GAP-04: WhatsApp Share Text Missing IVA

| Severity | **LOW — Nice-to-have** |
|----------|----------------------|
| Current | Share text shows `Total: $XX.XX MXN`. |
| Target | Optionally add `IVA: $XX.XX` line to the shared text. |

---

## 5. Gap Summary Matrix

| ID | Gap | Severity | Effort | Blocker? |
|----|-----|----------|--------|----------|
| GAP-01 | Summary screen missing IVA rows | HIGH | Low | **Yes** |
| GAP-02 | Ticket screen missing IVA rows | MEDIUM | Low | No |
| GAP-03 | Persisted order missing `taxAmountCents` | HIGH | Low | **Yes** |
| GAP-04 | WhatsApp text missing IVA | LOW | Trivial | No |

---

## 6. Step-by-Step Implementation Plan

### Step 1 — Expose Tax Signals in Summary Component

**File:** `src/app/modules/kiosk/screens/summary/kiosk-summary.component.ts`

- Add two readonly signal aliases (same pattern as existing `totalCents`):
  ```
  readonly totalTaxCents = this.cartService.totalTaxCents;
  readonly subtotalPreTaxCents = this.cartService.subtotalPreTaxCents;
  ```
- No new imports needed — `CartService` is already injected.

### Step 2 — Add IVA Rows to Summary Template

**File:** `src/app/modules/kiosk/screens/summary/kiosk-summary.component.html`

- Inside the summary card (after discounts, before the total row), add:
  ```
  "Subtotal sin IVA"   →  subtotalPreTaxCents() | price
  "IVA"                →  totalTaxCents() | price
  ```
- Reuse existing `ks__summary-row` CSS class — no new styles needed.
- These rows should appear **always** (not conditionally on discounts), since IVA is legally required.

### Step 3 — Add `taxAmountCents` to Order Persistence in Ticket

**File:** `src/app/modules/kiosk/screens/ticket/kiosk-ticket.component.ts`

- Import `calculateItemTax` and `DEFAULT_TAX_RATE` from `core/utils/tax.utils`.
- After computing `total` from the snapshot, compute tax:
  ```
  const taxAmountCents = snapshot.reduce((sum, item) => {
    const rate = item.taxRate ?? DEFAULT_TAX_RATE;
    const isTaxIncluded = item.product.isTaxIncluded !== false;
    return sum + calculateItemTax(item.totalPriceCents, item.discountCents, rate, isTaxIncluded);
  }, 0);
  ```
- Include `taxAmountCents` in the `Order` object.
- Store `taxAmountCents` in a local signal for display.

### Step 4 — Add IVA Rows to Ticket Template

**File:** `src/app/modules/kiosk/screens/ticket/kiosk-ticket.component.html`

- Below the existing total display, add the breakdown:
  ```
  "Subtotal sin IVA"  →  (totalCents - taxAmountCents) | price
  "IVA"               →  taxAmountCents | price
  ```

### Step 5 (Optional) — Add IVA to WhatsApp Share Text

**File:** `src/app/modules/kiosk/screens/ticket/kiosk-ticket.component.ts`

- In `buildWhatsAppText()`, insert an IVA line before the Total line:
  ```
  `IVA: $${(this.taxAmountCents() / 100).toFixed(2)}`
  ```

---

## 7. Key Files Reference

| File | Role | Tax Work Needed |
|------|------|-----------------|
| `src/app/modules/kiosk/screens/summary/kiosk-summary.component.ts` | Order review | Expose tax signals |
| `src/app/modules/kiosk/screens/summary/kiosk-summary.component.html` | Summary UI | Add IVA rows |
| `src/app/modules/kiosk/screens/ticket/kiosk-ticket.component.ts` | Order persistence | Compute + persist `taxAmountCents` |
| `src/app/modules/kiosk/screens/ticket/kiosk-ticket.component.html` | Confirmation UI | Add IVA rows |
| `src/app/core/services/cart.service.ts` | Cart state | Already has `totalTaxCents` and `subtotalPreTaxCents` — no changes |
| `src/app/core/utils/tax.utils.ts` | Tax math | Already exists — import into ticket component |

---

## 8. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Kiosk and POS share CartService — a bug in tax calc affects both | Tax utils are pure functions with no side effects; already tested via POS flow |
| Ticket component manually sums total (doesn't use CartService.totalCents) | Replicate the same tax extraction logic locally on the snapshot, not via signals |
| Idle timer clears cart — could clear mid-tax-calculation | Not a risk: `clearCart()` sets items to `[]`, signals recompute to 0 atomically |

---

*Generated by Claude Code — AUDIT-017*
