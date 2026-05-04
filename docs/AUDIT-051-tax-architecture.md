# AUDIT-051: Tax Architecture for Multi-Vertical POS

**Date:** 2026-05-03
**Scope:** Backend domain models, DTOs and services that drive tax (IVA) calculation across Products, Orders, and Tenants — with focus on whether the backend can support multi-vertical businesses (Gyms, Retail, F&B) without relying on frontend hardcoded constants.
**Status:** Read-only audit. No code modified.
**Related:** [AUDIT-014](AUDIT-014-backend-taxes-gaps.md) (fiscal/CFDI gaps, partially addressed since).

---

## 1. Executive Summary

The backend already models tax with reasonable depth: a normalized `Tax` catalog per country, a `ProductTax` join table, frozen `OrderItemTax` snapshots, an `IsTaxIncluded` flag on `Product`, an `Order.TaxAmountCents` aggregate, and a centralized `TaxCalculator` helper. **Tax is calculated server-side from product data — the frontend's tax math is thrown away on sync.**

However, three gaps prevent a clean multi-vertical implementation:

1. **No tenant-level default tax policy.** A Gym business cannot declare "all my services are tax-exempt by default"; the policy must be repeated per-product.
2. **Custom/Quick items (no `ProductId`) silently get zero tax.** The `SyncOrderItemRequest` carries no tax fields, and the server-side enrichment loop only fires when the product is in the catalog.
3. **Two hard-coded `0.16m` fallbacks** still live in `OrderService` and `InvoicingService` — one of which would silently apply 16% IVA to a Gym product whose tax was simply not configured.

The good news: the data model is largely in place. The fixes are scoped, additive changes (new columns + a couple of branches in the service layer), not a re-architecture.

---

## 2. Findings by Question

### 2.1 Product Entity — Does it carry tax info?

**Yes, on two parallel mechanisms.** ([POS.Domain/Models/Product.cs:44-60](../POS.Domain/Models/Product.cs#L44-L60))

| Field | Type | Purpose |
|---|---|---|
| `TaxRate` | `decimal?` | Legacy scalar rate (e.g., `0.16`, `0.08`, `0`). Nullable; `null` → server default `0.16m`. |
| `IsTaxIncluded` | `bool` (default `true`) | Whether `PriceCents` is gross (Mexican standard) or net. |
| `SatProductCode` | `string?(10)` | SAT clave de producto/servicio. |
| `SatUnitCode` | `string?(5)` | SAT clave de unidad. |
| `ProductTaxes` | `ICollection<ProductTax>` | New relational tax engine — many-to-many with the `Tax` catalog. |

There is **no `TaxCategoryId`** column. Conceptually, the role of "tax category" is played by the `Tax` catalog itself (`Tax.Id` is referenced via the `ProductTax` join). See [POS.Domain/Models/Tax.cs](../POS.Domain/Models/Tax.cs) and [POS.Domain/Models/ProductTax.cs](../POS.Domain/Models/ProductTax.cs).

**`IsTaxIncluded` does exist** and has been wired into the calculator: [OrderService.cs:191-193](../POS.Services/Service/OrderService.cs#L191-L193) selects `CalculateInclusiveTax` vs `CalculateExclusiveTax` based on it.

The DTO contract round-trips both fields: [ProductRequest.cs:48-50](../POS.Domain/DTOs/Product/ProductRequest.cs#L48-L50) and [ProductResponse.cs:41-43](../POS.Domain/DTOs/Product/ProductResponse.cs#L41-L43).

### 2.2 Order & OrderItem — Who calculates the tax?

**The backend, always.** The `SyncOrderItemRequest` DTO has **no tax fields whatsoever** — see [SyncOrderRequest.cs:49-78](../POS.Domain/Models/SyncOrderRequest.cs#L49-L78). Whatever the frontend computes for display is discarded on sync.

The server-side enrichment lives in [OrderService.cs:155-228](../POS.Services/Service/OrderService.cs#L155-L228) (Phase 2a-fiscal). Per item:

```csharp
if (productFiscalMap.TryGetValue(item.ProductId, out var product))
{
    item.SatProductCode = product.SatProductCode;
    item.SatUnitCode = product.SatUnitCode;
    var lineTotal = item.UnitPriceCents * item.Quantity;

    if (product.ProductTaxes.Count > 0)
    {
        // New engine — create OrderItemTax snapshots, sum into TaxAmountCents
        foreach (var pt in product.ProductTaxes) { ... }
    }
    else
    {
        // Legacy fallback — scalar Product.TaxRate, defaulting to 0.16m
        var taxRate = product.TaxRate ?? 0.16m;
        item.TaxAmountCents = TaxCalculator.CalculateInclusiveTax(lineTotal, taxRate);
    }
}
order.TaxAmountCents = order.Items.Sum(i => i.TaxAmountCents);
```

This is then frozen into the order via:

| Field | Location | Notes |
|---|---|---|
| `OrderItem.TaxRatePercent` | [OrderItem.cs:49](../POS.Domain/Models/OrderItem.cs#L49) | Frozen scalar. |
| `OrderItem.TaxAmountCents` | [OrderItem.cs:52](../POS.Domain/Models/OrderItem.cs#L52) | Frozen integer cents. |
| `OrderItem.AppliedTaxes` | [OrderItem.cs:67](../POS.Domain/Models/OrderItem.cs#L67) | `ICollection<OrderItemTax>` — full snapshot per applied tax (TaxId, TaxName, TaxRate, TaxAmountCents). |
| `Order.TaxAmountCents` | [Order.cs:38](../POS.Domain/Models/Order.cs#L38) | Order-level aggregate. Recomputed in `RecalculateTotals` ([line 1432](../POS.Services/Service/OrderService.cs#L1432)). |

**Custom / Quick items (no catalog product):** [MapToOrderItem](../POS.Services/Service/OrderService.cs#L1381-L1398) copies the line through verbatim with `ProductId` as-is. If the `ProductId` does not match a row, the `TryGetValue` lookup returns `false` and **the item silently gets `TaxAmountCents = 0` and `TaxRatePercent = null`**. There is no SAT data, no `OrderItemTax` snapshot, and no error. This is fine for tax-exempt gym sales — but it is **also** what happens if the cashier mistypes a SKU at a F&B counter, which is a silent fiscal bug.

There is currently no `IsCustomItem` flag, no per-line `IsTaxExempt` flag, and no way for the frontend to assert "this $5 bandage is tax-included at 16%" on a quick-item sale.

### 2.3 Tenant / Business / Branch — Default tax configuration?

**Partial.** The `Tax` catalog itself has the concept of a default ([Tax.cs:23-24](../POS.Domain/Models/Tax.cs#L23-L24)):

```csharp
/// <summary>Whether this tax is the default for new products in its country.</summary>
public bool IsDefault { get; set; }
```

Seeded in [DbInitializer.cs:251-254](../POS.Repository/DbInitializer.cs#L251-L254): `IVA 16%` is `IsDefault = true` for `MX`.

**But that flag is not actually consumed anywhere.** Greps for `IsDefault` show usage only on `UserBranch`, never on `Tax`. New products are not auto-associated with the country's default `Tax` row; the server falls back to the hard-coded `0.16m`.

**Business entity** ([Business.cs](../POS.Domain/Models/Business.cs)):
- Has `CountryCode` (`"MX"` default, [line 43](../POS.Domain/Models/Business.cs#L43)) — drives which `Tax` catalog rows are even relevant.
- Has fiscal identity (`Rfc`, `TaxRegime`, `LegalName`, `InvoicingEnabled`, `FacturapiOrganizationId`).
- **Has no `DefaultTaxRate`, no `DefaultTaxId`, no `IsTaxExemptVertical` flag.**

**Branch entity** ([Branch.cs](../POS.Domain/Models/Branch.cs)):
- Has `FiscalZipCode` only (lugar de expedición CFDI).
- **Has no tax overrides** (would be needed for a chain with one branch in the 8% IVA border zone).

**No `TenantContext` exists** in the codebase (the only hit for the term is in an unrelated audit doc) — multi-tenancy is enforced via `BranchId` scoping on entities (`IBranchScoped`), not via an ambient context object. Tax decisions therefore have to flow through the entities themselves.

### 2.4 Hard-coded constants still in code

| Location | Code | Risk |
|---|---|---|
| [OrderService.cs:217](../POS.Services/Service/OrderService.cs#L217) | `var taxRate = product.TaxRate ?? 0.16m;` | A Gym product with no `ProductTaxes` and `TaxRate = null` gets 16% IVA silently applied. |
| [InvoicingService.cs:17](../POS.Services/Service/InvoicingService.cs#L17) | `private const decimal DefaultTaxRate = 0.16m;` | Used at [line 512](../POS.Services/Service/InvoicingService.cs#L512) when freezing the rate onto the Facturapi payload. |
| [FacturapiClient.cs:71, 118](../POS.Services/Adapter/FacturapiClient.cs) | `tax_included = true,` | Hard-coded for every Facturapi item, ignoring `Product.IsTaxIncluded`. |

---

## 3. Gaps for Multi-Vertical Support

### GAP-A — No tenant-level "tax policy" or default

A Gym's products (membership renewals, personal-training services) are typically tax-exempt or fall under different IVA rules than retail. Today the only way to express this is to set `TaxRate = 0` (or attach a 0% `Tax` row) on **every single product** in their catalog. There is no:

- `Business.DefaultTaxId` / `Business.DefaultTaxRate` to anchor "what this tenant means by 'no tax configured'."
- Auto-association: when a product is created with no explicit tax, the service does not look up `Tax.IsDefault` for the business's `CountryCode` and attach it.
- Vertical-aware seed: when a Business is created with `PrimaryMacroCategoryId = Gym`, no tax-exempt default is wired up.

**Effect:** If onboarding doesn't set tax explicitly, the fallback at [OrderService.cs:217](../POS.Services/Service/OrderService.cs#L217) fires `0.16m` regardless of vertical.

### GAP-B — Custom / Quick items get zero tax silently

`SyncOrderItemRequest` has no tax fields. Items with `ProductId` that does not resolve to a catalog row receive `TaxAmountCents = 0` with no warning, no `OrderItemTax` snapshot, and incorrect SAT data on the order. For F&B verticals this is a fiscal hole; for Gyms it happens to do the right thing by accident.

**Two valid fixes are possible** (the right one depends on product policy):

1. **Disallow** uncatalogued items at the API layer (`ValidationException` if `ProductId` does not resolve).
2. **Allow** them, but require the frontend to pass a tax declaration (`TaxRatePercent` and `IsTaxIncluded`) on the sync DTO so the backend can freeze the snapshot from client-supplied fiscal data — applied through `TaxCalculator` to guarantee correct math.

### GAP-C — `SyncOrderItemRequest` has no tax-snapshot fields

Even for catalogued items, this carries the same tax-rate-mismatch race documented as GAP-3 in [AUDIT-014](AUDIT-014-backend-taxes-gaps.md): if `Product.TaxRate` (or `ProductTaxes`) changes between offline sale and sync, the receipt printed at the till and the backend record will disagree. For multi-vertical correctness this is mostly a F&B concern, but it interacts with GAP-B above (the same DTO needs tax fields either way).

### GAP-D — Hard-coded `0.16m` fallbacks remain

Listed in §2.4. None of these read `Business.CountryCode` or any tenant-level setting. A non-MX vertical (or a future US gym) would inherit Mexican IVA silently.

### GAP-E — `Tax.IsDefault` is dead config

The flag exists in the catalog and is seeded, but is never read by any service. Either wire it into product creation (auto-attach default `Tax` for the business's country) or drop it.

### GAP-F — Facturapi `tax_included` is hard-coded `true`

[FacturapiClient.cs:71, 118](../POS.Services/Adapter/FacturapiClient.cs#L71) sends `tax_included = true` regardless of `Product.IsTaxIncluded`. The data model supports both modes; the adapter does not. This will produce wrong CFDIs for any tenant who configures net pricing.

---

## 4. What's Missing to Stop Frontend Hardcoding

The frontend was patching a "fallback tax rate" because the backend can return:

- `Product.TaxRate = null` and no `ProductTaxes` → frontend has nothing to display.
- A custom/quick-item line with no tax fields at all in the order DTO.
- An `Order.TaxAmountCents` that doesn't match the visible item taxes when the item is a custom item.

To eliminate the hardcoded fallback at the frontend, the backend should provide:

1. **A fully-resolved tax view on every `Product`** — at read time, materialize `EffectiveTaxRate` (and `EffectiveIsTaxIncluded`) into the `ProductResponse`, falling back through:
   `ProductTaxes (sum) → Product.TaxRate → Business.DefaultTaxRate → Tax.IsDefault for Business.CountryCode → 0`.
   The frontend then trusts a single field; "no tax" is an explicit `0`, not an absent value.

2. **A `Business.DefaultTaxId` (or `DefaultTaxRate`) column** so each tenant declares their resting policy. Vertical-aware onboarding seeds this:
   - `Gym` / service verticals → 0% (or the "Exento" row).
   - `Retail` / `F&B` MX → 16% IVA.
   - Border zone → 8% IVA.

3. **Tax fields on `SyncOrderItemRequest`** (`TaxRatePercent`, `IsTaxIncluded`, optional `TaxId`) so:
   - Catalogued items can carry the rate the frontend used at sale time (race-free freeze).
   - Custom items can carry a tax declaration. Backend re-runs `TaxCalculator` from these inputs (never trusts the client's `TaxAmountCents`).

4. **Deletion of the `0.16m` fallbacks** in `OrderService` and `InvoicingService` once (1)–(3) land. The new fallback chain is data-driven and tenant-scoped.

5. **Optional but cheap:** wire `Tax.IsDefault` into `ProductService.CreateAsync` so a product saved without explicit `ProductTaxes` is auto-linked to the country's default `Tax` row. Closes the silent-default loophole at the source.

---

## 5. Risk Matrix

| Gap | Affected Vertical | Severity | Frontend Impact |
|---|---|---|---|
| A: No tenant default tax policy | Gyms, services | **High** | Forces frontend to hardcode "if vertical=Gym then 0%". |
| B: Custom items get zero tax | F&B (mistyped SKUs), Retail | **Critical** for F&B / **OK by accident** for Gym | Frontend cannot show tax line for keypad sales. |
| C: Sync DTO has no tax fields | All | **High** | Tax mismatch between printed receipt and backend record after rate changes. |
| D: Hard-coded `0.16m` | Non-MX, Gyms, border zone | **High** | Frontend either trusts wrong number or computes its own. |
| E: `Tax.IsDefault` unused | All | **Low** | Dead config; only matters via knock-on to A. |
| F: Facturapi `tax_included = true` | Tenants with net pricing | **Medium** | None for now (no tenant uses net pricing yet), but blocks future onboarding. |

---

## 6. Recommended Next Step

Before any frontend work: ship a small backend slice covering Gaps A, D, and E together —

- Add `Business.DefaultTaxId` (FK → `Tax`).
- Replace both `0.16m` literals with a resolver that reads `Business.DefaultTaxId` (then `Tax.IsDefault` for `CountryCode`, then `0`).
- Auto-attach `Business.DefaultTaxId` to new `Product`s missing `ProductTaxes`.
- Surface `EffectiveTaxRate` on `ProductResponse`.

Gaps B and C (sync DTO tax fields + custom-item handling) can ship as a second slice, since they require an Angular contract change.
