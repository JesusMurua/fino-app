# Payment Method Catalog — Wire API Contract

> **Annex to** [`payment-method-catalog-architecture.md`](payment-method-catalog-architecture.md).
> That document is the design source of truth (the *why*); this one is the
> frozen wire contract (the *what on the network*) for FE consumers
> (`fino-app`, `fino-admin`).
>
> **Status:** PR-A1 + PR-A2 + PR-B shipped and validated in production
> (`vanidosademo`, Plan Pro → 7 methods). Contract frozen 2026-06-07.

---

## 0. How to read this document

Every shape below is the **literal JSON on the wire**, taken from the actual
controllers, DTOs and the global serializer config — not the C# record names.
A property absent from a sample is absent *by design* (see §1.3), not an
omission in the docs.

---

## 1. Conventions (apply to every endpoint)

### 1.1 Base URL & versioning

| Environment | Base |
|---|---|
| Production | `https://pos-api-kw8n.onrender.com` |

No version prefix. Routes are absolute as written (`/api/...`).

### 1.2 Property naming & enum casing

The global serializer (`Program.cs`) is fixed for the whole API:

- **Property names → `camelCase`** (`supportsOverpay`, `paymentMethodId`).
- **Enums → PascalCase *strings*, never integers** (`JsonStringEnumConverter`).
  - `category` is `"Cash"` / `"Card"` / `"Digital"` / `"Credit"` / `"Points"`
    / `"Voucher"` / `"Other"` — **PascalCase**.
  - ⚠️ The architecture doc's prose at one point implied lowercase; the wire is
    **PascalCase**. Do **not** lowercase-compare. Treat as an opaque string and
    switch on the exact value.

> **Exception — audit blobs.** The `beforeJson` / `afterJson` fields of the
> audit log (§2.7) are *opaque strings* produced by a separate serializer that
> does **not** apply the enum-string converter. Inside those blobs `Category`
> appears as an **integer** (`0`=Cash, `1`=Card, `2`=Digital, `3`=Credit,
> `4`=Points, `5`=Voucher, `6`=Other). They are a human/audit diff, not a typed
> contract — do not parse them programmatically.

### 1.3 Null handling — **read this**

`DefaultIgnoreCondition = WhenWritingNull`. **Null fields are omitted from the
JSON entirely** — they do **not** arrive as `"field": null`. Every nullable
field in this contract (`providerKey`, `icon`, `countryCode`, `customLabel`,
`providerConfigJson`, `changedByTokenId`, `beforeJson`, `afterJson`) may simply
**not be present** on a given row. FE must treat *absent* as *null/none*.

### 1.4 Authentication

| Scheme | Header | Used by | Failure |
|---|---|---|---|
| Tenant JWT | `Authorization: Bearer <jwt>` | the public endpoint (§2.1) | `401` if missing/invalid |
| Admin token | `X-Admin-Token: <token>` | every `/api/Admin/...` endpoint | `401` if missing/invalid |

The two schemes are disjoint. An end-user JWT can **never** reach an admin
endpoint, and the admin token is never accepted on tenant endpoints. The
tenant's `businessId` is taken from the JWT — it is **not** a request parameter.

### 1.5 Reference values

| `planTypeId` | Plan |
|---|---|
| `1` | Free |
| `2` | Basic |
| `3` | Pro |
| `4` | Enterprise |

`paymentMethodId` values are **DB-assigned at seed time and are not part of the
contract** — never hardcode them in the FE. Resolve a method by its stable
`code` (e.g. `"Cash"`, `"Card"`), then use its `id` for admin matrix/override
calls within the same session. The 9 seeded system methods (`isSystem: true`)
in production currently carry ids `5..` but that is incidental.

`PaymentCategory` values: `Cash`, `Card`, `Digital`, `Credit`, `Points`,
`Voucher`, `Other`.

Valid SAT `c_FormaPago` codes (CFDI 4.0) accepted by admin create/update:
`01 02 03 04 05 06 08 12 13 14 15 17 23 24 25 26 27 28 29 30 31 99`.

---

## 2. Endpoints

### 2.1 `GET /api/payment-methods/available` — public (fino-app)

The payment methods the **logged-in tenant** may use, after plan-matrix +
per-business override + country gating. Distinct from the anonymous raw catalog
at `GET /api/Catalog/payment-methods` (that one is the unfiltered list).

- **Auth:** `Authorization: Bearer <tenant JWT>` (required).
- **Query / body:** none. The business is resolved from the JWT.
- **Caching:** server-side per-tenant cache, 5-min TTL, auto-invalidated by any
  admin mutation. **No `Cache-Control`/`ETag` headers are emitted** — FE may
  layer its own short cache.

**`200 OK`** — JSON array, ordered by `sortOrder` then `code`:

```json
[
  {
    "id": 5,
    "code": "Cash",
    "name": "Efectivo",
    "category": "Cash",
    "supportsOverpay": true,
    "requiresReference": false,
    "requiresCustomer": false,
    "sortOrder": 10
  },
  {
    "id": 6,
    "code": "Card",
    "name": "Tarjeta",
    "category": "Card",
    "supportsOverpay": false,
    "requiresReference": false,
    "requiresCustomer": false,
    "sortOrder": 20
  }
]
```

| Field | Type | Notes |
|---|---|---|
| `id` | int | DB id (session-scoped use only; do not persist). |
| `code` | string | Stable freeze key. Match on this. |
| `name` | string | Tenant's `customLabel` if an override set one, else catalog name. |
| `category` | enum string | See §1.2. Drives change/overpay & report bucket. |
| `supportsOverpay` | bool | `true` only for cash today (produces change). |
| `requiresReference` | bool | FE must collect a reference (folio/auth) before sale. |
| `requiresCustomer` | bool | FE must attach a customer before sale. |
| `providerKey` | string? | **Omitted when null** (§1.3). Integration key (e.g. `"clip"`). |
| `icon` | string? | **Omitted when null.** CSS/icon class. |
| `sortOrder` | int | Display order. |

> Empty-array edge: a plan with **no** seeded matrix rows yields `[]`. All four
> production plans are seeded, so this only happens for a brand-new plan before
> admin seeds it.

- **`401 Unauthorized`** — no/invalid Bearer token.

---

### 2.2 `GET /api/Admin/payment-method-catalog` — admin

Every catalog row, ordered by `sortOrder` then `code`.

- **Auth:** `X-Admin-Token`.
- **`200 OK`** — array of catalog DTOs:

```json
[
  {
    "id": 5,
    "code": "Cash",
    "name": "Efectivo",
    "sortOrder": 10,
    "category": "Cash",
    "satPaymentFormCode": "01",
    "requiresReference": false,
    "requiresCustomer": false,
    "supportsOverpay": true,
    "supportsPartial": true,
    "isActive": true,
    "isSystem": true
  }
]
```

| Field | Type | Notes |
|---|---|---|
| `id` | int | |
| `code` | string | Unique. Immutable after create. |
| `name` | string | |
| `sortOrder` | int | |
| `category` | enum string | |
| `satPaymentFormCode` | string | 2-char SAT code (§1.5). |
| `requiresReference` | bool | |
| `requiresCustomer` | bool | |
| `supportsOverpay` | bool | |
| `supportsPartial` | bool | |
| `providerKey` | string? | Omitted when null. |
| `countryCode` | string? | Omitted when null. `null` ⇒ available in all countries; a value ⇒ only that ISO country. |
| `iconClass` | string? | Omitted when null. |
| `isActive` | bool | Soft-delete flag. Inactive rows never reach `/available`. |
| `isSystem` | bool | `true` ⇒ cannot be hard/soft-deleted by code path (delete returns `409`). |

- **`401`** — no/invalid admin token.

---

### 2.3 `POST /api/Admin/payment-method-catalog` — admin

Create a new (non-system) method.

- **Auth:** `X-Admin-Token`.
- **Request body** (`UpsertPaymentMethodCatalogRequest`):

```json
{
  "code": "Crypto",
  "name": "Cripto",
  "sortOrder": 50,
  "category": "Other",
  "satPaymentFormCode": "99",
  "requiresReference": false,
  "requiresCustomer": false,
  "supportsOverpay": false,
  "supportsPartial": true,
  "providerKey": null,
  "countryCode": null,
  "iconClass": null,
  "isActive": true
}
```

| Field | Required | Notes |
|---|---|---|
| `code` | ✅ | Must be unique across the catalog. |
| `name` | ✅ | |
| `sortOrder` | ✅ | |
| `category` | ✅ | One of the 7 enum strings. |
| `satPaymentFormCode` | ✅ | Must be in the SAT whitelist (§1.5). |
| `requiresReference` | ✅ | |
| `requiresCustomer` | ✅ | |
| `supportsOverpay` | ✅ | |
| `supportsPartial` | ✅ | |
| `providerKey` | optional | nullable |
| `countryCode` | optional | nullable |
| `iconClass` | optional | nullable |
| `isActive` | ✅ | |

> The created row is always `isSystem: false`. The client cannot set `isSystem`.

- **`200 OK`** — the created row (same shape as §2.2; `id`/`isSystem` populated).
- **`400 Bad Request`** — invalid SAT code, **or** `code` already exists.
  Body carries the message (e.g. `"A payment method with code 'Cash' already exists."`).
- **`401`** — no/invalid admin token.

---

### 2.4 `PUT /api/Admin/payment-method-catalog/{id}` — admin

Update an existing method's metadata.

- **Auth:** `X-Admin-Token`.
- **Body:** identical to §2.3 (`UpsertPaymentMethodCatalogRequest`).
- **Immutable:** `code` is the freeze key and is **ignored** on update — only
  metadata (name, sortOrder, category, SAT, flags, provider, country, icon,
  isActive) changes. `isSystem` cannot be changed.
- **`204 No Content`** — updated.
- **`400`** — invalid SAT code.
- **`401`** — no/invalid admin token.
- **`404`** — no method with that `id`.

---

### 2.5 `DELETE /api/Admin/payment-method-catalog/{id}` — admin

- **Auth:** `X-Admin-Token`.
- **Semantics** (decided server-side, not by a flag):
  - `isSystem: true` → **`409 Conflict`**, `"System payment methods cannot be deleted."`
  - has any `OrderPayment` referencing it → **soft-delete** (sets `isActive=false`,
    preserves history & the RESTRICT FK), returns `204`.
  - otherwise → **hard-delete**, returns `204`.
- **`204 No Content`** — soft- or hard-deleted.
- **`401`** — no/invalid admin token.
- **`404`** — no method with that `id`.
- **`409`** — system method.

> The `204` does not distinguish soft vs hard delete. If the FE needs to show
> "archived" vs "removed", re-fetch the catalog (§2.2): a soft-deleted row is
> still present with `isActive: false`; a hard-deleted row is gone.

---

### 2.6 `GET /api/Admin/plan-payment-method-matrix` — admin

The full Plan × Method matrix as a **flat array** of entries (not grouped).

- **Auth:** `X-Admin-Token`.
- **`200 OK`:**

```json
[
  { "planTypeId": 1, "paymentMethodId": 5, "isEnabled": true },
  { "planTypeId": 1, "paymentMethodId": 6, "isEnabled": false }
]
```

Production is fully seeded: 4 plans × 9 system methods = 36 rows. The FE pivots
client-side (plan rows × method columns) using `planTypeId` (§1.5) and resolving
`paymentMethodId` against the catalog (§2.2).

- **`401`** — no/invalid admin token.

---

### 2.7 `PUT /api/Admin/plan-payment-method-matrix` — admin

Bulk **upsert** (partial). Send only the entries you want to change.

- **Auth:** `X-Admin-Token`.
- **Body:** array of entries:

```json
[
  { "planTypeId": 1, "paymentMethodId": 6, "isEnabled": true },
  { "planTypeId": 3, "paymentMethodId": 9, "isEnabled": false }
]
```

- **Semantics:**
  - **Upsert per `(planTypeId, paymentMethodId)`:** existing rows are updated;
    missing rows are inserted.
  - **Partial — absent combos are left untouched.** This is *not* a replace-all;
    omitting a combo does **not** disable or delete it.
  - A no-op entry (value already equal) is silently skipped (no audit row).
  - Every effective change writes one audit row (axis `"plan"`).
- **`204 No Content`** — applied; payment caches invalidated.
- **`400`** — unknown `planTypeId` (not 1–4) or unknown `paymentMethodId`.
  The whole request is rejected on the first invalid entry (validated before any write).
- **`401`** — no/invalid admin token.

---

### 2.8 `GET /api/Admin/tenant-payment-method-overrides` — admin

All per-business overrides (no server-side filtering — filter client-side by
`businessId` / `paymentMethodId`).

- **Auth:** `X-Admin-Token`.
- **`200 OK`:**

```json
[
  {
    "id": 12,
    "businessId": 738,
    "paymentMethodId": 6,
    "isEnabled": true,
    "customLabel": "Mi TPV"
  }
]
```

| Field | Type | Notes |
|---|---|---|
| `id` | int | Override id (used for PUT/DELETE). |
| `businessId` | int | |
| `paymentMethodId` | int | |
| `isEnabled` | bool | The override decision; **wins over the plan matrix** for this tenant. |
| `customLabel` | string? | Omitted when null. Surfaces as `name` in `/available`. |
| `providerConfigJson` | string? | Omitted when null. Opaque per-tenant provider config blob. |

- **`401`** — no/invalid admin token.

> **Note:** there is currently **no** server-side query filter
> (`?businessId=`/`?paymentMethodId=`). The endpoint returns the full set; the
> FE filters. If the override volume grows this becomes a candidate for a future
> filtered/paged variant (not in this contract).

---

### 2.9 `POST /api/Admin/tenant-payment-method-overrides` — admin

- **Auth:** `X-Admin-Token`.
- **Body** (`CreateTenantOverrideRequest`):

```json
{
  "businessId": 738,
  "paymentMethodId": 6,
  "isEnabled": true,
  "customLabel": "Mi TPV",
  "providerConfigJson": null
}
```

| Field | Required | Notes |
|---|---|---|
| `businessId` | ✅ | Must exist (checked cross-tenant). |
| `paymentMethodId` | ✅ | Must exist in the catalog. |
| `isEnabled` | ✅ | |
| `customLabel` | optional | nullable |
| `providerConfigJson` | optional | nullable |

- **`200 OK`** — the created override (shape as §2.8, `id` populated).
- **`400`** — unknown `businessId`, unknown `paymentMethodId`, **or** an
  override for that `(businessId, paymentMethodId)` already exists
  (one override per pair — use PUT to change it).
- **`401`** — no/invalid admin token.

---

### 2.10 `PUT /api/Admin/tenant-payment-method-overrides/{id}` — admin

- **Auth:** `X-Admin-Token`.
- **Body** (`UpdateTenantOverrideRequest`) — `businessId`/`paymentMethodId` are
  fixed by the `id`, so only the mutable fields are sent:

```json
{
  "isEnabled": false,
  "customLabel": "Terminal Norte",
  "providerConfigJson": null
}
```

- **`204 No Content`** — updated.
- **`401`** — no/invalid admin token.
- **`404`** — no override with that `id`.

---

### 2.11 `DELETE /api/Admin/tenant-payment-method-overrides/{id}` — admin

Removes the override; the tenant reverts to plan-matrix behavior.

- **Auth:** `X-Admin-Token`.
- **`204 No Content`** — deleted.
- **`401`** — no/invalid admin token.
- **`404`** — no override with that `id`.

---

### 2.12 `GET /api/Admin/payment-matrix/preview-impact` — admin

Counts/lists the tenants that *would* be affected by flipping a method's flag in
a plan, **before** you commit the change via §2.7.

- **Auth:** `X-Admin-Token`.
- **Query params (all required):**

| Param | Type | Notes |
|---|---|---|
| `paymentMethodId` | int | |
| `planTypeId` | int | 1–4 |
| `enabled` | bool | The target state you're previewing. |

- **`200 OK`:**

```json
{
  "affectedTenantCount": 2,
  "affectedTenants": [
    { "id": 738, "businessName": "Vanidosa Demo", "planType": "Pro" }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `affectedTenantCount` | int | == `affectedTenants.length`. |
| `affectedTenants[].id` | int | businessId. |
| `affectedTenants[].businessName` | string | |
| `affectedTenants[].planType` | string | Plan display name. |

- **Counting rule (document for FE):** all tenants **on that plan**, **excluding**
  any tenant that has an **override for that method** (either direction). A
  tenant with an override is *shielded* — the plan change cannot affect it, so it
  is not listed. The `enabled` param is echoed-into intent but the affected set
  is "who follows the plan for this method", independent of the target value.
- **`401`** — no/invalid admin token.

---

### 2.13 `GET /api/Admin/payment-matrix/audit-log` — admin

Paginated audit trail of every catalog / plan / override mutation.

- **Auth:** `X-Admin-Token`.
- **Query params (all optional):**

| Param | Type | Default | Notes |
|---|---|---|---|
| `from` | ISO datetime | none | Inclusive lower bound on `changedAt` (UTC). |
| `to` | ISO datetime | none | Exclusive upper bound on `changedAt` (UTC). |
| `axis` | string | none | Filter: `"catalog"` \| `"plan"` \| `"override"`. |
| `page` | int | `1` | 1-based; `<1` coerced to 1. |
| `pageSize` | int | `50` | `<1` coerced to 50. |

- **`200 OK`** — newest first (`changedAt` desc, then `id` desc):

```json
{
  "page": 1,
  "pageSize": 50,
  "totalRows": 137,
  "items": [
    {
      "id": 137,
      "changedAt": "2026-06-07T02:14:55.21Z",
      "changedByTokenId": "ops-cli",
      "axis": "catalog",
      "entityKey": "method=Crypto",
      "afterJson": "{\"Id\":42,\"Code\":\"Crypto\",\"Category\":6,...}"
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `page` / `pageSize` | int | Echoed (post-coercion). |
| `totalRows` | int | Total matching rows (for pager). |
| `items[].id` | int | |
| `items[].changedAt` | ISO datetime | UTC. |
| `items[].changedByTokenId` | string? | Admin token id. Omitted when null. |
| `items[].axis` | string | `"catalog"` / `"plan"` / `"override"`. |
| `items[].entityKey` | string | Human key, e.g. `method=Crypto`, `plan=1;method=6`, `business=738;method=6`. Delete adds `;delete`; soft-delete adds `;soft-delete`. |
| `items[].beforeJson` | string? | Opaque pre-state blob. **Omitted on inserts.** |
| `items[].afterJson` | string? | Opaque post-state blob. **Omitted on deletes.** |

> ⚠️ `beforeJson`/`afterJson` are **opaque strings** (§1.2 exception): inside
> them `Category` is an **integer**, not the enum string. Render them as a raw
> diff; do not deserialize into the typed DTOs.

- **`401`** — no/invalid admin token.

---

### 2.14 `GET /api/Admin/orders/unauthorized-methods` — admin (drift, PR-A2)

Cross-tenant drift report: payments synced with an **unknown** method (recorded
as `Other`, `wasUnknownMethod=true`) **or** a method **not authorized** by the
tenant's plan (`wasUnauthorized=true`). Since PR-B, both flags are populated
(PR-A2 shipped the endpoint; PR-B added the `wasUnauthorized` gating that feeds
it).

- **Auth:** `X-Admin-Token`.
- **Query params (all optional):**

| Param | Type | Default | Notes |
|---|---|---|---|
| `from` | ISO datetime | `to − 30 days` | Coerced to UTC. |
| `to` | ISO datetime | now (UTC) | Coerced to UTC. |
| `page` | int | `1` | |
| `pageSize` | int | `50` | Clamped to `[1, 200]`. |

- **`200 OK`:**

```json
{
  "page": 1,
  "pageSize": 50,
  "totalRows": 4,
  "items": [
    {
      "orderId": "a1b2...",
      "orderNumber": 17,
      "businessId": 738,
      "businessName": "Vanidosa Demo",
      "planType": "Free",
      "methodCode": "Card",
      "methodName": "Tarjeta",
      "methodCategory": "Card",
      "wasUnauthorized": true,
      "wasUnknownMethod": false,
      "createdAt": "2026-06-06T18:00:00Z",
      "amountCents": 50000
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `orderId` | string | UUID. |
| `orderNumber` | int | |
| `businessId` / `businessName` / `planType` | | Tenant context. |
| `methodCode` / `methodName` | string | Frozen-at-sale. |
| `methodCategory` | enum string | PascalCase (§1.2). |
| `wasUnauthorized` | bool | Method not enabled by plan/override at sale. |
| `wasUnknownMethod` | bool | Method code wasn't in the catalog → recorded as `Other`. |
| `createdAt` | ISO datetime | |
| `amountCents` | int | |

- **`401`** — no/invalid admin token.

---

## 3. HTTP status semantics (summary)

| Code | When | Endpoints |
|---|---|---|
| `200 OK` | Successful GET / create-returns-body | all GETs, POST §2.3 §2.9 |
| `204 No Content` | Successful mutation with no body | PUT/DELETE §2.4 §2.5 §2.7 §2.10 §2.11 |
| `400 Bad Request` | Validation failure (invalid SAT, duplicate code, unknown plan/method/business, duplicate override) | POST/PUT §2.3 §2.4 §2.7 §2.9 |
| `401 Unauthorized` | Missing/invalid Bearer (public) or `X-Admin-Token` (admin) | all |
| `403 Forbidden` | **Not emitted** by these endpoints today. Auth is binary (authenticated or not); no per-role gating beyond the scheme. | — |
| `404 Not Found` | Target id does not exist | PUT/DELETE on `{id}` §2.4 §2.5 §2.10 §2.11 |
| `409 Conflict` | Delete of a `isSystem` catalog method | DELETE §2.5 |
| `422` | **Not used.** Validation surfaces as `400`. | — |
| `500` | Unhandled server error | any (should not occur in normal flow) |

Error bodies follow the API's standard `ExceptionMiddleware` envelope; the
human message is in the body for `400`/`409` (e.g. duplicate-code, system-method).

---

## 4. Cache & invalidation (for FE expectations)

- `/available` (§2.1) is server-cached per tenant for 5 min and **auto-invalidated
  immediately** on any admin mutation (catalog/plan/override). After an admin
  change, a tenant sees the new set on its next request — no stale window beyond
  in-flight requests. No HTTP cache headers are sent.
- The anonymous raw catalog (`GET /api/Catalog/payment-methods`) is also
  invalidated on admin mutations (it carries ETag/`Cache-Control` per the
  BDD-021 catalog convention).

---

## 5. Out of scope (explicitly not in this contract)

- Internal implementation, persistence, freeze logic — see the architecture doc.
- Multi-currency, refunds/partial-refund flows.
- A future filtered/paged variant of §2.8 (overrides currently return the full set).
- `Cache-Control`/`ETag` on `/available` (server cache + FE short cache suffice today).
- PR-C (dropping the legacy `Method` enum) — does not change any shape above.
