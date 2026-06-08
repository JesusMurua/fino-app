# Payment Method Catalog — Architecture & Design

> **Status:** PR-A1 + PR-A2 implemented. Design source of truth for the remaining PRs (B → C).
> **Scope:** Backend refactor of payment methods from a hardcoded enum to a
> data-driven catalog with behavior categories, plan gating and tenant overrides.

---

## 0. PR-A1 — Delivered (foundation)

Implemented (no pre-launch data, so **no backfill and no fallbacks** were needed):

- `PaymentCategory` enum (7 values) + `PaymentMethodCatalog` extended
  (Category, SatPaymentFormCode, Requires*/Supports* flags, ProviderKey,
  CountryCode, IconClass, IsActive, IsSystem).
- `OrderPayment` frozen-at-sale columns: `MethodCode`, `Category`,
  `SatPaymentFormCode`, `PaymentMethodId` (FK → catalog, **non-nullable**,
  `ON DELETE RESTRICT`), plus `WasUnauthorized`/`WasUnknownMethod` (columns only;
  logic is PR-A2).
- Migration `AddPaymentMethodCatalogFoundation` — **schema only** (empty
  `OrderPayments` table → no data backfill). Catalog 4→9 reconcile runs in
  `DbInitializer.UpsertPaymentMethodCatalogAsync` (idempotent, runs in all envs).
- Freeze centralized in **`OrderService`** (`SyncOrdersAsync` batch + `AddPaymentAsync`)
  via `_unitOfWork.Catalog` — covers all four write-paths (sync, AddPayment, Clip,
  MercadoPago); **fail-fast** if a method has no catalog row. No separate resolver
  service was needed.
- `InvoicingService` reads the frozen `SatPaymentFormCode` (no fallback);
  `SatPaymentForm` StoreCredit/LoyaltyPoints → `"05"`.
- Reports bucket by the frozen `OrderPayment.Category`
  (`GetPaymentTotalsAsync` groups by Category+MethodCode; Dashboard + Report
  updated; `PaymentMethodBuckets` helper deleted). `DashboardSales` gained
  `DigitalCents/CreditCents/PointsCents/VoucherCents`; `TransferCents` kept as a
  **deprecated alias = DigitalCents** until the FE migrates.
- SAT decisions confirmed: StoreCredit/LoyaltyPoints `"05"`; MercadoPago →
  `Digital` (→ `DigitalCents`).
- Tests: catalog reconcile (9 rows), frozen write-path, category buckets,
  multi-method change/corte. Suite 128 → 130.

**PR-A2 — Delivered (soft gating + drift report):**

- `MapToPayment` no longer silently defaults unknown methods to Cash — an
  unparseable method is recorded as `Other` with `WasUnknownMethod = true` and an
  `ILogger.LogWarning` (branch/order/received value). The sale is never rejected
  (offline-first). The catalog freeze keeps fail-fast only for a valid enum with
  no catalog row (= seed bug).
- Cross-tenant drift report `GET /api/Admin/orders/unauthorized-methods?from=&to=&page=&pageSize=`
  (`X-Admin-Token`), via `OrderRepository.GetFlaggedPaymentsAsync` with
  `IgnoreQueryFilters()`. Returns paged payments flagged `WasUnknownMethod` **or**
  `WasUnauthorized` (so PR-B's rows appear with no endpoint change). Rows carry
  order/business/plan + frozen method code/category. Suite 130 → 133.

**Deferred to PR-B/C:** `WasUnauthorized` gating logic + its tests (born with
`PlanPaymentMethodMatrix`), the admin CRUD + public `/payment-methods/available`,
and the `Method` enum drop.

---

## 1. Executive summary

Payment methods are currently a hardcoded `PaymentMethod` enum (9 values) read
across reporting, fiscal (CFDI) and provider code. To let methods be added /
toggled per plan and per tenant **without a deploy**, we move to a **data-driven
catalog**: a small primitive `PaymentCategory` enum (7 values) that defines
*behavior*, plus a `PaymentMethodCatalog` table holding the concrete, editable
methods. Plan availability is declared in `PlanPaymentMethodMatrix` (mirroring
`PlanFeatureMatrix`) and exceptions in a new per-business `TenantPaymentMethodOverride`.
The refactor must clear two hard blockers — **SAT/CFDI fidelity** (the fiscal
"Forma de Pago" cannot be derived from category and must be frozen on each
payment at sale time) and **offline-first sync** (the documented "never reject
valid orders" rule forbids hard-rejecting a synced sale). The model below
resolves both, plus six secondary findings (H1–H6) surfaced during the audit.

---

## 2. Context & trigger

### 2.1 Current state

| Aspect | Reality today |
|---|---|
| Methods | `PaymentMethod` enum, 9 values: `Cash, Card, Transfer, Other, Clip, MercadoPago, BankTerminal, StoreCredit, LoyaltyPoints` |
| Persistence | `OrderPayment.Method` stored as **string** (`HasConversion<string>().HasMaxLength(20)`, `ApplicationDbContext.cs`) |
| Catalog | `PaymentMethodCatalog` exists but holds **only 4 rows** — `Cash, Card, Transfer, Other` (`DbInitializer.cs:95-101`). Diverges from the 9-value enum. |
| Catalog endpoint | `GET /api/Catalog/payment-methods` — Anonymous, cached, returns the raw 4-row catalog (`{ Id, Code, Name, SortOrder }`) |
| Summary buckets | Step 1 (shipped) groups by `PaymentMethodBuckets.BucketOf` in code: Cash→cash, Card/Clip/BankTerminal→card, Transfer→transfer, **MercadoPago/StoreCredit/LoyaltyPoints/Other→other** |
| Fiscal | `SatPaymentForm.FromDominantMethod(enum)` maps method→SAT code **at invoice time** (`SatPaymentForm.cs`); `InvoicingService.cs:155-156` |
| Behavior gating | `StoreCredit`/`LoyaltyPoints` validation + balance consumption hardcoded in `OrderService.cs:333-375` |

### 2.2 Blockers detected (from the multi-payment + refactor audits)

1. **SAT/CFDI per method, not per category.** The SAT "Forma de Pago" code does
   not follow the behavior category: `Transfer`→`03` but `MercadoPago`→`04`,
   yet both are category `digital`. An admin-created method with no SAT code
   would default to `99`, which the SAT rejects when stamping real invoices.
2. **Offline-first sync.** `CLAUDE.md` → *Offline Sync Strategy* mandates
   *"Never reject valid orders — log and continue."* A hard `400` at sync over a
   plan mismatch (or a catalog typo) would discard a sale for which the cashier
   already took real money.

### 2.3 Architecture decision

Primitive **`PaymentCategory`** enum (7 values, defines behavior) + **data-driven
`PaymentMethodCatalog`** (concrete methods, admin-editable) + **`PlanPaymentMethodMatrix`**
(per-plan availability) + **`TenantPaymentMethodOverride`** (per-business exception)
+ **frozen-at-sale** denormalization on `OrderPayment` (code, category and SAT
code copied at the moment of sale so historical invoices/reports never drift if
the catalog is edited later).

---

## 3. Final data model (incorporates H1–H6)

### 3.1 `PaymentCategory` — primitive enum (NOT admin-managed)

Category is invariant: it defines **behavior** (overpay gating, customer/reference
validation, report bucket). Concrete methods are instances within a category.

| Value | Behavior it defines |
|---|---|
| `cash` | `SupportsOverpay = true` — the only category that produces change |
| `card` | Card-present / card-backed rails (physical card + terminals) |
| `digital` | Bank transfers, wallets, QR without an underlying card |
| `credit` | Customer store credit — `RequiresCustomer = true`, consumes `CreditBalance` |
| `points` | Loyalty points — `RequiresCustomer = true`, consumes `PointsBalance` |
| `voucher` | Vouchers / gift codes with a validation code |
| `other` | Catch-all |

### 3.2 `PaymentMethodCatalog` — extend the **existing** entity (do not create V2)

Existing columns: `Id, Code, Name, SortOrder`. New columns:

| Column | Type | Notes |
|---|---|---|
| `Category` | string (FK to `PaymentCategory`) | behavior driver |
| `SatPaymentFormCode` | string(2), NOT NULL on new methods | per-method SAT code (resolves blocker 1) |
| `RequiresReference` | bool, default `false` | declarative gating (replaces hardcoded checks) |
| `RequiresCustomer` | bool, default `false` | declarative gating (credit/points) |
| `SupportsOverpay` | bool, default `false` | only `true` for cash |
| `SupportsPartial` | bool, default `true` | |
| `ProviderKey` | string?, nullable | `'clip'`, `'mercadopago'`, … |
| `CountryCode` | string(2)?, nullable | `null` = global, `'MX'` = MX-only |
| `IconClass` | string?, nullable | e.g. `pi-money-bill` |
| `IsActive` | bool, default `true` | soft-delete flag |
| `IsSystem` | bool | `true` for the 9 base methods — never hard-deletable |

> **H1 — seed reconcile (4 → 9).** The catalog has only 4 rows today. PR-A1 must
> **insert the 5 missing methods** (`Clip, MercadoPago, BankTerminal, StoreCredit,
> LoyaltyPoints`) idempotently (insert-if-missing) **and** set
> `Category`/`SatPaymentFormCode`/flags on the existing 4, **before** backfilling
> `OrderPayment`. The new `Code` values must match `enum.ToString()` exactly so
> the string-keyed backfill resolves.

### 3.3 `OrderPayment` — frozen-at-sale denormalization

Extend the existing entity. All copied **at the moment of sale** from the catalog
row, so editing/deleting a catalog method never alters historical orders.

| Column | Type | Notes |
|---|---|---|
| `MethodCode` | string, NOT NULL post-migration | denormalized `catalog.Code` — avoids a join on the report/hot path |
| `Category` | string, NOT NULL post-migration | **H2** — denormalize category too, so reports bucket from a frozen column with no join and no in-code map |
| `SatPaymentFormCode` | string(2), NOT NULL post-migration | frozen SAT code — preserves historical invoices |
| `PaymentMethodId` | int? FK → `PaymentMethodCatalog.Id`, `ON DELETE RESTRICT` | nominal FK; queries read `MethodCode`/`Category` |
| `WasUnauthorized` | bool, default `false` | soft-gating flag (method known but not plan-authorized) |
| `WasUnknownMethod` | bool, default `false` | soft-gating flag (method absent from catalog — persisted as `Other`) |

> The existing `Method` enum-string column stays **deprecated-but-written** during
> the transition (compat) and is dropped in PR-C once no consumer reads it.

### 3.4 `PlanPaymentMethodMatrix` — new, analogous 1:1 to `PlanFeatureMatrix`

`{ PlanTypeId, PaymentMethodId, IsEnabled }`. Declares which methods each plan
tier includes.

### 3.5 `TenantPaymentMethodOverride` — new axis (H4)

`{ BusinessId, PaymentMethodId, IsEnabled, CustomLabel?, ProviderConfigJson? }`.

> **H4 — this is a new axis, not a feature-matrix copy.** Features override by
> **Plan×BusinessType** (`PlanBusinessTypeFeatureOverride`), not per business.
> A per-business override is genuinely new design here (it exists to grant one
> client a special method). The *plan* matrix reuses the feature pattern; the
> per-tenant override does not.

**Resolution precedence:** `TenantPaymentMethodOverride` > `PlanPaymentMethodMatrix`
> filter (`CountryCode` match + `IsActive`).

---

## 4. Blocker resolution

### 4.1 SAT / CFDI

**Per-method SAT code** lives on the catalog row (not derived from category) and
is **frozen** on `OrderPayment` at sale time. Initial mapping:

| Method | `SatPaymentFormCode` | Category |
|---|---|---|
| Cash | `01` (Efectivo) | cash |
| Card | `04` (Tarjeta de crédito) | card |
| Transfer | `03` (Transferencia electrónica) | digital |
| Clip | `04` (terminal → tarjeta) | card |
| MercadoPago | `04` (tarjeta subyacente) | digital |
| BankTerminal | `04` | card |
| StoreCredit | `05` (Monedero electrónico) — **confirm with accounting** | credit |
| LoyaltyPoints | `05` — **confirm with accounting** | points |
| Other | `99` (Por definir) | other |

> ⚠️ **Fiscal change to confirm.** Today `StoreCredit`/`LoyaltyPoints` map to SAT
> `99` (`SatPaymentForm.cs:22-23`). Moving them to `05` is a behavior change that
> **accounting must sign off** before seeding. Not a design blocker; it gates the
> seed values.

Steps:
1. Each catalog row carries its correct SAT code.
2. At sale, every `OrderPayment` write-path copies `SatPaymentFormCode` from the
   catalog (freeze).
3. `InvoicingService` (`SatPaymentForm.FromDominantMethod`) changes to read
   `payment.SatPaymentFormCode` directly. A `null` fallback to the enum mapping
   exists **only as defense** for legacy rows — not an operational strategy.
4. **Atomic backfill** in the migration (same transaction: populate every
   `OrderPayment` + set NOT NULL) so there is **no null window** in production.
5. **SAT whitelist hardcoded in code** (the SAT "Formas de Pago" set changes
   rarely) + a test asserting membership. Admin create/edit validates the SAT
   code is a **member of the whitelist** (membership implies format; a plain
   "2 numeric chars" check would let `00` through).

### 4.2 Offline-first sync (two layers)

**Layer 1 — FE preventive (happy path):** `GET /api/payment-methods/available`
returns the methods allowed for the logged-in tenant (plan + override + branch
country). The FE only exposes those in its selector. Cache 5 min, invalidated
when admin mutates the matrices.

**Layer 2 — sync never rejects (defense), per H5:**

| Case at sync | Behavior |
|---|---|
| Method in catalog, **authorized** by plan/override | persist normally |
| Method in catalog, **not authorized** (plan drift / downgrade between charge and sync) | **persist** the order + payment, set `WasUnauthorized = true`, log (business / method / plan) |
| Method **not in catalog** (typo / stale payload) | **persist** as `Other` + `WasUnknownMethod = true` + log — **no 400** (a consummated sale's money record is never lost) |

> **H5.** Even an unknown method is not a `400`. The current `MapToPayment`
> silently defaults unparseable methods to `Cash`, which mislabels money;
> `Other` + flag is more honest. If a `400` is ever introduced it must be
> **per-order in `failedRequests`**, never batch-level.

**Drift visibility:** `GET /admin/orders/unauthorized-methods?from=&to=` lists
orders flagged `WasUnauthorized`/`WasUnknownMethod`, grouped by tenant + method,
for super-admin review (e.g. "tenant X charged Card 5× but the plan excludes it →
upsell or bill the right plan"). Flagged orders **still count normally** in
summary/charts (the money exists); the admin can optionally filter on the flag.

> **H3 — every `OrderPayment` write-path must populate the frozen columns**
> (`MethodCode`, `Category`, `SatPaymentFormCode`, `PaymentMethodId`), not just
> sync. The write-paths are:
> - `OrderService.MapToPayment` (`OrderService.cs:1473`) — sync, new (`:1381`) and re-sync (`:128`)
> - `ClipService` (`ClipService.cs:55`)
> - `MercadoPagoService` (`MercadoPagoService.cs:57`)
> - `OrdersController` AddPayment (`OrdersController.cs:229`)
>
> Missing any of these means provider payments created post-migration are born
> with a null SAT code and break stamping.

---

## 5. Endpoints

### 5.1 Public (tenant-facing)

```
GET /api/payment-methods/available
Auth: [Authorize] (tenant Bearer)
```

New **`PaymentMethodsController`** — **not** `CatalogController` (that one is
Anonymous + raw catalog + global cache; this is `[Authorize]` + tenant-filtered +
per-tenant cache). Returns the catalog projected to a minimal shape:
`{ id, code, name, category, supportsOverpay, requiresReference, requiresCustomer, providerKey, icon, sortOrder }`.

Filters applied, in order:
1. `catalog.IsActive == true`
2. `catalog.CountryCode == branch.CountryCode OR catalog.CountryCode == null`
3. `PlanPaymentMethodMatrix(tenant.PlanType).IsEnabled == true`
4. `TenantPaymentMethodOverride(business)` — if present, **overrides** the plan matrix

Cache: per-tenant TTL 5 min + `InvalidateAll` on admin mutation.

### 5.2 Admin (`X-Admin-Token`, pattern of `AdminFeatureMatrixController`)

```
GET    /admin/payment-method-catalog
POST   /admin/payment-method-catalog
PUT    /admin/payment-method-catalog/{id}
DELETE /admin/payment-method-catalog/{id}      // soft-delete; hard only if !IsSystem && no payments

GET    /admin/plan-payment-method-matrix
PUT    /admin/plan-payment-method-matrix        // bulk upsert

GET    /admin/tenant-payment-method-overrides
POST   /admin/tenant-payment-method-overrides
PUT    /admin/tenant-payment-method-overrides/{id}
DELETE /admin/tenant-payment-method-overrides/{id}

GET    /admin/payment-matrix/preview-impact?paymentMethodId=X&enabled=false
GET    /admin/payment-matrix/audit-log
GET    /admin/orders/unauthorized-methods       // drift report (§4.2)
```

Reuses: `X-Admin-Token` auth, `FeatureMatrixAuditLog`-style audit, and
`FeatureCacheGeneration` for `InvalidateAll`.

> **Delete policy (H2 of refactor audit, Q2).** Soft-delete (`IsActive=false`) is
> the normal admin path; never hard-delete a method with history or `IsSystem`.
> `ON DELETE RESTRICT` on `OrderPayment.PaymentMethodId` is the DB-level backstop.

---

## 6. Category → report bucket (decision H6)

Summary buckets **mirror the 7 categories** rather than forcing them into the 4
legacy buckets. `DashboardSales` grows to:
`cashCents, cardCents, digitalCents, creditCents, pointsCents, voucherCents, otherCents`.
Additive — the current FE ignores unknown fields.

| Category | Bucket |
|---|---|
| cash | `cashCents` (net of change) |
| card | `cardCents` |
| digital | `digitalCents` |
| credit | `creditCents` |
| points | `pointsCents` |
| voucher | `voucherCents` |
| other | `otherCents` |

This resolves the MercadoPago question: it falls naturally into `digitalCents`
(wallet/QR) **without conflating it with SPEI bank transfer**, and lets the cash
close distinguish customer credit/points (not real drawer cash) from cash.
Reports read the **frozen `OrderPayment.Category`** column (H2), no join.

> The shipped step-1 helper `PaymentMethodBuckets` (4 buckets, in code) is the
> interim precursor; once `Category` is denormalized and the DTO is extended, it
> is superseded by the frozen column.

---

## 7. Implementation plan (4 PRs + 2 parallel tracks)

| PR | Scope | Size |
|---|---|---|
| **PR-A1** (foundation) | Extend 2 entities + `PaymentCategory` enum + 2 new entities + migration with **seed-reconcile 4→9** + **atomic backfill** (`OrderPayment`: MethodCode / Category / SatPaymentFormCode / FK) + **freeze in all 4 write-paths** (H3) + `InvoicingService` reads frozen code + reports bucket by frozen Category + tests | **Large** |
| **PR-A2** (soft gating) | Sync gating: `WasUnauthorized` + `WasUnknownMethod` (no 400, H5) + drift report. Isolated for focused review of the sync hot-path. | **Medium** |
| **PR-B** (admin) | Admin CRUD catalog + plan-matrix + tenant-override + preview-impact + audit + `InvalidateAll` + public `/payment-methods/available` | **Medium-large** |
| **PR-C** (cleanup, much later) | Drop `OrderPayment.Method` string column + `PaymentMethod` enum once no consumer reads them | **Small** |

Parallel tracks:
- **fino-admin UI** — parallel to PR-B (separate repo; its own design doc).
- **FE consumption** — after PR-B + UI: refactor enum → runtime catalog +
  quick-pay multi-method.

---

## 8. Pending decisions (do not block design; gate seed values)

1. **Accounting:** `StoreCredit`/`LoyaltyPoints` → SAT `05` vs current `99`.
2. **Stakeholder:** MercadoPago in `digitalCents` (recommended with H6) vs the
   conservative `otherCents` if the bucket split is declined.
3. **Confirmed:** per-tenant override precedence
   `TenantOverride > PlanMatrix > filters(country/active)`.

---

## 9. References

- `CLAUDE.md` → **Offline Sync Strategy** (the "never reject valid orders" rule
  that forces the soft-gating of §4.2).
- Pattern reuse: `AdminFeatureMatrixController`, `FeatureCacheGeneration`
  (`InvalidateAll`), `FeatureMatrixAuditLog`, `PlanFeatureMatrix`.
- Reference for "new axis" (H4): `PlanBusinessTypeFeatureOverride` (Plan×BusinessType,
  *not* per-business — which is why `TenantPaymentMethodOverride` is new).
- Shipped step-1: `PaymentMethodBuckets`, `OrderService.RecalculatePaymentTotals`
  (change from cash overpayment only), `MultiMethodPaymentTests`.
- Fiscal: `SatPaymentForm.cs`, `InvoicingService.cs:155-156`,
  `docs/BDD-004-electronic-invoicing.md`.
- SAT 4.0 — Catálogo "Formas de Pago" (`c_FormaPago`): official SAT MX catalog.

---

## Out of scope

- Real code (this is a design document).
- Time estimates in hours/days.
- Multi-currency — *future* (would add `PaymentMethodCatalog.CurrencyCode`).
- Dedicated refunds — *future* (today only `DELETE /orders/{id}/payments/{paymentId}` removes a row).
- Per-tenant detailed provider config (Stripe keys, etc.) — *future*; for now only the opaque `ProviderConfigJson`.
- fino-admin UI details — separate doc in `fino-admin/docs` when that turn comes.
