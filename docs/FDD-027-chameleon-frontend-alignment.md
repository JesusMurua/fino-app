# FDD-027 — Chameleon Frontend Alignment

**Date:** 2026-05-06
**Status:** Draft — pending approval
**Type:** Frontend Design Document
**Driver:** Align Angular 18 frontend with the Chameleon multi-tenant backend implemented in [BDD-019](BDD-019-chameleon-domain-readiness.md) and refined in [BDD-020](BDD-020-chameleon-metadata-architecture.md).
**Source audits:** [AUDIT-055](AUDIT-055-customer-history-ui.md), [AUDIT-056](AUDIT-056-chameleon-models.md).

---

## 0. Executive Summary

The backend has migrated from `text`-typed opaque metadata + scalar pollution on `Customer` to: (a) strongly-typed `*Metadata` owned types persisted as `jsonb`, (b) a new `CustomerMembership` aggregate with its own lifecycle, (c) three new customer-scoped read endpoints. The frontend currently mirrors the **old** contract — `Record<string, unknown>` everywhere, `customer.membershipValidUntil` polled directly, and a manual offline mutation hook in [sync.service.ts](../src/app/core/services/sync.service.ts#L246-L282) that writes `membershipValidUntil` + `lastPaymentAt` on Dexie customer rows.

This FDD specifies the alignment in three thrusts:

| Thrust | Goal |
|--------|------|
| **Models** | Replace `Record<string, unknown>` with five strict `*Metadata` interfaces; drop `Customer.membershipValidUntil` / `lastPaymentAt`; add `Order.metadata` slot; add optional `extensionData` passthrough on the five parents. |
| **Services** | Extend `CustomerService` with `getOrders` / `getMemberships` / `getStats`; gut the offline membership-extension hook from `SyncService` and replace it with a memberships pull that delegates state to the BE. |
| **UI** | Re-source `access-control` (gym reception gate), admin dashboard "expiring soon" widget, and the customer drawer (AUDIT-055) from the new memberships endpoint instead of the removed scalar. |

> **Important framing correction.** The original prompt mentioned “removing legacy scalar columns from `Order` (e.g. `tableId`, `orderSource`) that belong in `OrderMetadata`.” BDD-019 + BDD-020 do **not** remove those columns. `Order.Metadata` is **additive** and Day-1 carries only `DiningPersons` and `DeliveryAddressLine` ([BDD-020 §2.3](BDD-020-chameleon-metadata-architecture.md)). `tableId`, `tableName`, `kitchenStatusId`, `orderSource`, `externalOrderId`, `deliveryStatus`, `deliveryCustomerName`, `estimatedPickupAt` remain first-class scalar columns. This FDD therefore preserves them — see §1.4.

---

## 1. Core Model Refactoring (Interfaces)

### 1.1 Strict Metadata Interfaces (new file)

A single new file `src/app/core/models/metadata.model.ts` houses the five typed payloads, mirroring the C# owned types from [BDD-020 §2](BDD-020-chameleon-metadata-architecture.md) one-to-one. Optional fields use the `?` modifier to match `int?` / `bool?` / `decimal?` / `DateOnly?` / `DateTime?` on the BE.

#### 1.1.1 `ProductMetadata`

| Field | TS type | BE type | Source vertical |
|-------|---------|---------|-----------------|
| `membershipDurationDays` | `number` (optional) | `int?` | Services / Gimnasio |
| `serviceDurationMinutes` | `number` (optional) | `int?` | Services |
| `kitchenPrepMinutes` | `number` (optional) | `int?` | F&B / Quick Service |
| `isAlcoholic` | `boolean` (optional) | `bool?` | Bar / Sports Bar |
| `isSoldByWeight` | `boolean` (optional) | `bool?` | Retail Enterprise |

#### 1.1.2 `OrderItemMetadata`

| Field | TS type | BE type | Source vertical |
|-------|---------|---------|-----------------|
| `beneficiaryCustomerId` | `number` (optional) | `int?` | Gym |
| `weightGrams` | `number` (optional) | `decimal?` | Retail Enterprise |
| `appointmentAt` | `string \| Date` (optional, ISO on the wire) | `DateTime?` | Services |

#### 1.1.3 `OrderMetadata`

| Field | TS type | BE type | Source vertical |
|-------|---------|---------|-----------------|
| `diningPersons` | `number` (optional) | `int?` | F&B Restaurant |
| `deliveryAddressLine` | `string` (optional) | `string?` | Delivery aggregators |

#### 1.1.4 `CustomerMetadata`

| Field | TS type | BE type | Source vertical |
|-------|---------|---------|-----------------|
| `dateOfBirth` | `string` (optional, ISO date `YYYY-MM-DD`) | `DateOnly?` | Universal CRM |
| `marketingOptIn` | `boolean` (optional) | `bool?` | Compliance |
| `emergencyContactPhone` | `string` (optional) | `string?` | Gym / Wellness |

> **Date handling.** `DateOnly` on the BE serializes as a plain ISO date string (`"1990-04-12"`). Keeping it as `string` on the FE avoids the `string | Date` ambiguity that polluted `customer.membershipValidUntil`. UI parses on render only.

#### 1.1.5 `PaymentMetadata`

| Field | TS type | BE type | Notes |
|-------|---------|---------|-------|
| `rawProviderJson` | `string` (optional) | `string?` | Original provider payload (Clip, MercadoPago) |
| `authorizationCode` | `string` (optional) | `string?` | |
| `last4` | `string` (optional) | `string?` | Card display |
| `cardBrand` | `string` (optional) | `string?` | Card display |

#### 1.1.6 `ExtensionData` (catch-all)

Each of the five parent entities also gains an optional `extensionData?: Record<string, unknown>` for tenant-specific dynamic keys, mirroring BDD-020 §2.6 (`JsonDocument?` on BE). The FE keeps this loose by design — it is the escape hatch that the strict `*Metadata` interfaces protect.

### 1.2 Updates to Core Entity Interfaces

| File | Change | Before | After |
|------|--------|--------|-------|
| [product.model.ts](../src/app/core/models/product.model.ts) | Replace `metadata` type | `metadata?: Record<string, unknown>` | `metadata?: ProductMetadata` |
| [product.model.ts](../src/app/core/models/product.model.ts) | Add `extensionData` | — | `extensionData?: Record<string, unknown>` |
| [cart-item.model.ts](../src/app/core/models/cart-item.model.ts) | Replace `metadata` type | `metadata?: Record<string, unknown>` | `metadata?: OrderItemMetadata` |
| [cart-item.model.ts](../src/app/core/models/cart-item.model.ts) | Add `extensionData` | — | `extensionData?: Record<string, unknown>` |
| [order.model.ts](../src/app/core/models/order.model.ts) | Add `metadata` slot | (no field) | `metadata?: OrderMetadata` |
| [order.model.ts](../src/app/core/models/order.model.ts) | Add `extensionData` | — | `extensionData?: Record<string, unknown>` |
| [order.model.ts](../src/app/core/models/order.model.ts) (`OrderPayment`) | Replace `paymentMetadata` type | `paymentMetadata?: Record<string, unknown>` | `paymentMetadata?: PaymentMetadata` |
| [order.model.ts](../src/app/core/models/order.model.ts) (`OrderPayment`) | Add `extensionData` | — | `extensionData?: Record<string, unknown>` |
| [customer.model.ts](../src/app/core/models/customer.model.ts) | Add `metadata` slot | (no field) | `metadata?: CustomerMetadata` |
| [customer.model.ts](../src/app/core/models/customer.model.ts) | Add `extensionData` | — | `extensionData?: Record<string, unknown>` |
| [customer.model.ts](../src/app/core/models/customer.model.ts) | **Drop** `membershipValidUntil` | `membershipValidUntil?: string \| Date` | _removed_ |
| [customer.model.ts](../src/app/core/models/customer.model.ts) | **Drop** `lastPaymentAt` | `lastPaymentAt?: string \| Date` | _removed_ |

### 1.3 `Customer` — final shape (post-FDD)

| Group | Fields |
|-------|--------|
| Identity | `id`, `businessId`, `firstName`, `lastName?`, `phone`, `email?` |
| Fiscal | `rfc?` |
| CRM | `notes?`, `pointsBalance`, `creditBalanceCents`, `creditLimitCents`, `totalOrderCount`, `totalSpentCents`, `lastVisitAt?` |
| Audit | `createdAt`, `isActive` |
| Vertical extension | `metadata?: CustomerMetadata`, `extensionData?: Record<string, unknown>` |
| **Removed** | ~~`membershipValidUntil`~~, ~~`lastPaymentAt`~~ |

`lastVisitAt`, `pointsBalance`, `creditBalanceCents`, `totalOrderCount`, `totalSpentCents` are kept — they are CRM-transversal aggregates that the BE still emits on `GET /customers` (per AUDIT-056 §5.3). Only the **gym-specific** scalars are dropped.

### 1.4 `Order` — what NOT to remove

[BDD-019 §4.3.2](BDD-019-chameleon-domain-readiness.md) and [BDD-020 §2.3](BDD-020-chameleon-metadata-architecture.md) keep the legacy F&B / aggregator scalars on `Order` as first-class columns. The FE follows suit:

| Field | Status |
|-------|--------|
| `tableId`, `tableName` | **Kept** (F&B mesas, first-class column on BE) |
| `kitchenStatusId` | **Kept** (KDS lifecycle, first-class) |
| `orderSource` | **Kept** (aggregator origin, first-class) |
| `externalOrderId`, `deliveryStatus`, `deliveryCustomerName`, `estimatedPickupAt` | **Kept** (aggregator detail, first-class) |
| `paymentProvider`, `externalReference` | **Kept** (payment terminal integration, first-class) |
| `invoiceRequest` | **Kept** (CFDI MX) |
| `cashRegisterSessionId` | **Kept** (cash drawer) |
| `customerId`, `customerName` | **Kept** (CRM transversal) |
| `cancellationReason`, `cancelledAt` | **Kept** (lifecycle) |

Net delta on `Order`: only **add** `metadata?: OrderMetadata` and `extensionData?: Record<string, unknown>`. No removals.

---

## 2. New Aggregate Models

### 2.1 `MembershipStatus` enum

Mirrors the BE `MembershipStatus` enum ([BDD-019 §5.3](BDD-019-chameleon-domain-readiness.md#53-new-entity)). Persisted as a string on the wire (BE uses `HasConversion<string>()`).

| Value | Meaning |
|-------|---------|
| `'Active'` | Currently valid; `validUntil >= now`. |
| `'Expired'` | `validUntil < now`. Note: BE projects this lazily — see §3.3. |
| `'Frozen'` | Paused; cannot be extended via order sync. |
| `'Cancelled'` | Terminated; new purchase creates a new row instead. |

### 2.2 `CustomerMembership` interface

| Field | TS type | BE source |
|-------|---------|-----------|
| `id` | `number` | `int` PK |
| `customerId` | `number` | `int` FK |
| `productId` | `number` (optional) | `int?` (nullable for legacy backfill) |
| `productName` | `string` (optional) | DTO-only — joined by BE for display |
| `validFrom` | `string \| Date` | `timestamp with time zone` |
| `validUntil` | `string \| Date` | `timestamp with time zone` |
| `status` | `MembershipStatus` | string-converted enum |
| `originatingOrderId` | `string` (optional) | UUID FK to `Orders.Id` |
| `createdAt` | `string \| Date` | `timestamp with time zone` |
| `updatedAt` | `string \| Date` (optional) | `timestamp with time zone` |

> Permissive `string | Date` on the three timestamps because the API serializes ISO and any offline cache (see §3.4) may rehydrate as `Date`. UI normalizes via `new Date(value)` on render.

### 2.3 DTO Interfaces (read-only API responses)

These three DTOs land in `src/app/core/models/customer-history.model.ts` (new file, co-located with the customer aggregate):

#### 2.3.1 `CustomerOrderRowDto` — projection for order history

| Field | TS type | BE field |
|-------|---------|----------|
| `orderId` | `string` | `OrderId` (UUID) |
| `orderNumber` | `number` | `OrderNumber` |
| `createdAt` | `string \| Date` | `CreatedAt` |
| `totalCents` | `number` | `TotalCents` |
| `itemCount` | `number` | `ItemCount` |
| `branchId` | `number` | `BranchId` |
| `branchName` | `string` | `BranchName` |
| `isPaid` | `boolean` | `IsPaid` |
| `cancellationReason` | `string` (optional) | `CancellationReason` |

#### 2.3.2 `CustomerMembershipDto`

Identical to §2.2 `CustomerMembership` but always API-sourced; we expose the **same TypeScript symbol** for both (they share the wire shape) — see §2.4.

#### 2.3.3 `CustomerStatsDto`

| Field | TS type | BE field |
|-------|---------|----------|
| `totalSpentCents` | `number` | `TotalSpentCents` |
| `orderCount` | `number` | `OrderCount` |
| `lastOrderAt` | `string \| Date` (optional) | `LastOrderAt` |

#### 2.3.4 `PageData<T>` — pagination wrapper

Already exists in the codebase per `coding-standards.md` §Type Safety (`PageData<EmployeeShift>`). Reuse: `PageData<CustomerOrderRowDto>` for `GET /customers/{id}/orders`.

### 2.4 Sharing rule between domain and DTO

`CustomerMembershipDto` and `CustomerMembership` carry the same wire shape; we use a single interface `CustomerMembership` for both. If FE ever introduces local-only fields (e.g. an offline `cachedAt`), it does so via interface extension (`CachedCustomerMembership extends CustomerMembership`), keeping the DTO surface untouched.

---

## 3. Service Refactoring (API Integration)

### 3.1 `CustomerService` — new methods

[customer.service.ts](../src/app/core/services/customer.service.ts) gains three thin API wrappers and three optional Dexie-backed caches. Existing `getCustomerOrders(id): Promise<any[]>` is **deleted** and replaced by the typed `getOrders` below.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `getOrders` | `(customerId: number, opts?: { page?: number; pageSize?: number; from?: Date; to?: Date }) => Promise<PageData<CustomerOrderRowDto>>` | Paginated history. Replaces today's `Promise<any[]>` returning the same data without pagination. |
| `getMemberships` | `(customerId: number, status?: MembershipStatus) => Promise<CustomerMembership[]>` | Active + historical memberships sorted by `validUntil` desc. |
| `getStats` | `(customerId: number) => Promise<CustomerStatsDto>` | Aggregates for the drawer header. |

| Aspect | Decision |
|--------|----------|
| Endpoint base | `${ApiService.baseUrl}/customers/{id}/{path}` |
| Error handling | `firstValueFrom(...)` + `try/catch`, logging via `console.warn`, surfacing through `MessageService` only at the call site (per `coding-standards.md` §Component Error Handling). |
| Auth | Bearer token already attached by the existing HTTP interceptor — no extra work. |
| State | Results returned as Promises; **not** stored on the `customers()` signal. The drawer holds them in local component signals (matches today's `customerOrders` / `isLoadingOrders` pattern in [admin-customers.component.ts:79-82](../src/app/modules/admin/components/customers/admin-customers.component.ts#L79-L82)). |
| Types | All three methods return strictly typed Promises; **no `any`**. Replaces the `Promise<any[]>` antipattern in current `getCustomerOrders`. |

#### 3.1.1 Optional offline cache for memberships (gym reception)

Reception's gym gate runs offline. To preserve that, we introduce a Dexie store mirror — see §3.4.

### 3.2 `SyncService` — surgery on the offline membership hook

[sync.service.ts](../src/app/core/services/sync.service.ts) has three call-sites that must change because the BE is now the authoritative source for membership state:

| Lines | Method | Disposition |
|-------|--------|-------------|
| 246-282 | `applyOfflineMembershipExtensions(order)` | **Delete entirely.** The BE's `IMembershipService.ProcessOrderEntitlementsAsync` (called inside `OrderService.SyncOrdersAsync`) now creates / extends `CustomerMembership` rows transactionally. The FE must stop pre-mutating `customer.membershipValidUntil` because the field no longer exists on the BE entity. |
| 320-323 (and `reconcileSyncedMembershipCustomers`) | post-sync customer reconcile | **Replace.** Instead of pulling fresh `Customer` rows expecting an updated `membershipValidUntil`, pull memberships per beneficiary from `GET /customers/{id}/memberships` and write them to the new Dexie `customerMemberships` store (§3.4). Used to refresh reception offline cache. |
| 351 | beneficiary id read inside reconcile loop | **Keep.** Still needs `item.metadata?.beneficiaryCustomerId` to know which customers to refresh — but now the lookup is typed (`OrderItemMetadata.beneficiaryCustomerId: number?`) instead of bracket-notation. |
| 682 | outbound DTO `metadata: item.metadata ?? null` | **Keep.** Passthrough of typed `OrderItemMetadata` survives because the BE's typed deserializer accepts the same JSON shape. |

#### 3.2.1 Net behavioral change in `SyncService`

| Aspect | Before | After |
|--------|--------|-------|
| Customer Dexie row mutation on save | ✅ writes `membershipValidUntil` + `lastPaymentAt` locally | ❌ never mutates membership state on Dexie customer rows (those columns don't exist) |
| Authoritative membership source | Local Dexie row optimistic; corrected post-sync | BE `CustomerMembership` aggregate, period |
| What POS shows immediately after a membership sale offline | Optimistic new `validUntil` rendered right away | Optimistic placeholder built from `Product.metadata.membershipDurationDays` × `OrderItem.quantity`, **but** the membership only becomes durable after sync. Drawer / reception show "Sync pending" badge until reconcile. |
| Race conditions | Possible (FE diverges silently when concurrent terminals sync) | Eliminated — FE never claims authority |

### 3.3 Status projection (lazy)

Per [BDD-019 §6.1.2](BDD-019-chameleon-domain-readiness.md#612-status-auto-transition), the BE returns `Status = 'Expired'` whenever `validUntil < now AND stored Status = 'Active'`. The FE trusts this projection — no client-side recomputation. However, for offline UI (reception gate), we add a thin pure helper:

```text
isCurrentlyValid(membership: CustomerMembership): boolean
  return membership.status === 'Active' && new Date(membership.validUntil) >= new Date()
```

This handles the tiny race where a cached `'Active'` row has tipped past `validUntil` between sync and render.

### 3.4 Dexie schema changes (offline support)

A new store is required so [access-control.component.ts](../src/app/modules/reception/pages/access-control/access-control.component.ts) and the admin "expiring soon" widget keep working offline.

| Aspect | Decision |
|--------|----------|
| Dexie version bump | `28` (current is `27` per `database.service.ts` after FDD-026) |
| New store | `customerMemberships: '++localId, customerId, [customerId+status], validUntil'` |
| Hydration trigger | Lazy: on first call to a `CustomerMembershipsService.ensureLoadedFor(customerId)` (mirrors `CustomerService.ensureLoaded` from FDD-026). |
| Bulk sync | `SyncService` periodic pull adds a step "for each gym customer, refresh memberships." Phase-2 only — see §5. |
| Eviction | None for v1 — gyms have at most thousands of memberships per business. |
| **Removed** | The legacy `customer.membershipValidUntil` index becomes orphaned. Schema bump drops it. |

> A separate `CustomerMembershipsService` is preferred over expanding `CustomerService` because the data has its own lifecycle (status transitions, freezing, multiple per customer). Keeps services focused per `coding-standards.md`.

---

## 4. UI/UX Impact Analysis

### 4.1 Components touched

| Component | Reason | Change summary |
|-----------|--------|----------------|
| [admin-customers.component.ts](../src/app/modules/admin/components/customers/admin-customers.component.ts) | Drawer replaces `getCustomerOrders` and renders membership status section per AUDIT-055 | Wire `getOrders`, `getMemberships`, `getStats`. Render new `Estado de membresía` section between `drawer-stats` and the fiscal block. |
| [admin-customers.component.html](../src/app/modules/admin/components/customers/admin-customers.component.html) | Same | New `<section class="drawer-memberships">` with badges per `MembershipStatus` (Active=green, Expired=neutral, Frozen=blue, Cancelled=red — design-token aligned per CLAUDE.md). |
| [access-control.component.ts](../src/app/modules/reception/pages/access-control/access-control.component.ts) | Today reads `customer.membershipValidUntil` directly at line 80; that field is gone | Read latest `CustomerMembership` (Active or most recent) for the customer from the new Dexie store + `CustomerMembershipsService`. UI states `Vigente` / `Vencida` / `Sin membresía` derive from `membership.status` (with the local `isCurrentlyValid` helper for offline drift). |
| [access-control.component.html](../src/app/modules/reception/pages/access-control/access-control.component.html) | Lines 64, 79 read `c.membershipValidUntil` | Bind to a derived `membership` view-model (`membership.validUntil`, `membership.status`) computed in the component. |
| [dashboard.component.ts](../src/app/modules/admin/components/dashboard/dashboard.component.ts) | "Members expiring within ±7d" widget at lines 80-103 reads `customer.membershipValidUntil` | Refactor to query `CustomerMembershipsService.getActiveExpiringSoon(windowDays = 7)` which proxies a future BE query (or in v1, fetches all active memberships and filters client-side). |
| [dashboard.component.html](../src/app/modules/admin/components/dashboard/dashboard.component.html) line 360 | renders `member.membershipValidUntil` | Bind to `member.membership.validUntil`. |
| [product-form.component.ts](../src/app/modules/admin/components/products/product-form/product-form.component.ts) | Lines 444-470, 574, 663-679 read/write `product.metadata['membershipDurationDays']` via bracket notation | Migrate to `product.metadata?.membershipDurationDays` typed access. The `composeMetadata` helper becomes a typed builder that returns a `ProductMetadata` instead of a `Record<string, unknown>`. |
| [cart-panel.component.ts](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts) | Lines 442, 453, 506-507 access `product.metadata['membershipDurationDays']` and write `metadata = { beneficiaryCustomerId, membershipDurationDays }` | Same — typed access via `ProductMetadata`/`OrderItemMetadata`. The cart write becomes a typed object construction. |
| [checkout.component.ts](../src/app/modules/pos/components/checkout/checkout.component.ts) | Lines 273, 276 same patterns | Same typed migration. |
| [product.service.ts](../src/app/core/services/product.service.ts) line 42 | JSDoc references the loose metadata convention | Update JSDoc to reference `ProductMetadata`. |
| [sync.service.ts](../src/app/core/services/sync.service.ts) | §3.2 above | Delete `applyOfflineMembershipExtensions`; refactor reconcile path. |

### 4.2 Drawer UX (admin customer detail)

This addresses the open thread from [AUDIT-055](AUDIT-055-customer-history-ui.md). With the new endpoints, the drawer renders four sections in order:

| Section | Source | States |
|---------|--------|--------|
| Header (name, phone, email) | `customer` row | — |
| Balances (credit, points) | `customer` row | — |
| **Stats** (`Total gastado`, `Pedidos`, `Última visita`) | `getStats(customerId)` | loading / values / `$0.00 / 0 / —` |
| **Estado de membresía** (NEW) | `getMemberships(customerId)` | loading / list of badges / "Sin membresías" |
| Fiscal (`rfc`) | `customer.rfc` | — |
| Notes | `customer.notes` | — |
| Order history (paginated) | `getOrders(customerId, { page, pageSize: 10 })` | loading / list / "Sin órdenes" |

The membership section renders one card per membership. Active is pinned to top, then Frozen, then sorted desc by `validUntil`. Each card shows: product name (or "Membresía legacy" when `productId === null`), validity range, status badge, originating order id (link to that order's detail).

### 4.3 Reception offline behavior

| State | UI |
|-------|----|
| Online + member has Active membership | Green badge "Vigente hasta DD MMM YYYY" |
| Online + member's only membership is Expired | Red badge "Vencida el DD MMM YYYY" |
| Offline + cached Active membership exists | Green badge + small "Sin conexión" pill (data may be stale) |
| Offline + cached Expired only | Red badge + "Sin conexión" pill |
| Offline + no cached membership for this customer | Neutral badge "Sin información offline" — gate stays open per existing behavior, manager override available |

### 4.4 Behaviors that remain unchanged

- POS membership purchase UX (cart-panel beneficiary selector) is untouched — only the underlying types tighten.
- Product-form admin UX is untouched — only the type of the form-to-metadata pipeline tightens.
- The "Pa' Llevar" cart-panel customer attachment path ([cart-panel.component.ts:276-277](../src/app/modules/pos/components/cart-panel/cart-panel.component.ts#L276-L277)) is unaffected — it sets `customerId` on `Order`, not metadata.
- AUDIT-055's hallazgo A fix (quick-pay missing `customerId`) is **independent** from this FDD and tracked separately; the membership endpoints will not retroactively fix unattributed legacy orders.

---

## 5. Implementation Phases

| Phase | Scope | Files | Depends on | Complexity |
|-------|-------|-------|------------|:----------:|
| **P1 — Types foundation** | Create `metadata.model.ts`. Wire the five new interfaces into `Product`, `CartItem`, `Order`, `OrderPayment`, `Customer`. Drop `customer.membershipValidUntil`/`lastPaymentAt`. Migrate every existing bracket-notation access to typed access. | `core/models/*`, `product-form.component.ts`, `cart-panel.component.ts`, `checkout.component.ts` | BE BDD-020 deployed | Medium |
| **P2 — Memberships domain** | Create `customer-history.model.ts` (`CustomerMembership`, `MembershipStatus`, `CustomerOrderRowDto`, `CustomerStatsDto`). Create `CustomerMembershipsService` (fetch + Dexie cache). Bump Dexie to `v28` (drop legacy index, add `customerMemberships` store). | `core/models/customer-history.model.ts`, `core/services/customer-memberships.service.ts`, `database.service.ts` | P1 | Medium |
| **P3 — Sync hook surgery** | Delete `applyOfflineMembershipExtensions`. Refactor `reconcileSyncedMembershipCustomers` to pull memberships instead of customer profiles. Remove all writes of `membershipValidUntil` / `lastPaymentAt` on the FE. | `sync.service.ts` | P2 | High |
| **P4 — `CustomerService` API extension** | Add `getOrders` (typed, paginated), `getMemberships`, `getStats`. Delete legacy `getCustomerOrders(id): Promise<any[]>`. | `customer.service.ts` | P2 | Low |
| **P5 — Admin drawer revamp** | Wire P4 into [admin-customers.component.ts](../src/app/modules/admin/components/customers/admin-customers.component.ts). Add membership status section + paginated order history. Adopt design-token-aligned badges per CLAUDE.md design system. | `admin-customers.component.{ts,html,scss}` | P4 | Medium |
| **P6 — Reception + dashboard rewire** | Refactor [access-control.component.ts](../src/app/modules/reception/pages/access-control/access-control.component.ts) to consume `CustomerMembershipsService`. Refactor dashboard "expiring soon" widget. Remove the last `membershipValidUntil` references. | `access-control.component.{ts,html}`, `dashboard.component.{ts,html}` | P4 | Medium |
| **P7 — Cleanup & docs** | Update `docs/AUDIT-055` cross-link. Update `docs/AUDIT-052` (chameleon bounded contexts) cross-link. Drop dead JSDoc references to `Record<string, unknown>` metadata in `product.service.ts`. Verify `tsc --noEmit` clean. | misc | P1–P6 | Low |

Phases are sequential; P4 may parallelize with P3 once P2 has merged. P5 and P6 may parallelize once P4 has merged.

### 5.1 Phase exit criteria

| Phase | Exits when |
|-------|-----------|
| P1 | `tsc --noEmit` green; existing tests still green; no `Record<string, unknown>` survives in any of the five entity files; `grep "membershipValidUntil\|lastPaymentAt" src/app/core/models/customer.model.ts` returns 0 matches. |
| P2 | Dexie opens cleanly on a fresh install and on a v27 → v28 upgrade. `CustomerMembershipsService.ensureLoadedFor(id)` populates the new store from the API. |
| P3 | `grep "membershipValidUntil\|applyOfflineMembershipExtensions\|lastPaymentAt" src/` returns 0 matches in `core/services/sync.service.ts`. POS membership sale offline → online still ends with the BE owning the durable record. |
| P4 | `getOrders` returns typed `PageData<CustomerOrderRowDto>`. `customerService.getCustomerOrders` symbol no longer exists. |
| P5 | Admin drawer renders all four sections (Stats, Memberships, Orders, History) without runtime errors on a fresh seed customer. |
| P6 | Reception gate keeps working offline for a customer cached during a previous online session. Dashboard widget still surfaces "expiring soon" rows. |
| P7 | No stale references to legacy fields in JSDoc or docs. |

---

## 6. Backwards-incompatible Changes

| # | Change | Impact | Mitigation |
|---|--------|--------|-----------|
| BC-01 | `Customer.membershipValidUntil` and `Customer.lastPaymentAt` removed from the FE model | Any consumer breaks at compile time | Compile errors guide migration; checklist in P1 exit criteria |
| BC-02 | `Product.metadata`, `CartItem.metadata`, `OrderPayment.paymentMetadata` change type from `Record<string, unknown>` to typed interfaces | Bracket-notation accessors stop type-checking | Migrate to dot access; TS strict catches every site |
| BC-03 | `customerService.getCustomerOrders(id)` deleted in favor of `getOrders(id, opts?)` | Callers break | Single caller today ([admin-customers.component.ts:142-154](../src/app/modules/admin/components/customers/admin-customers.component.ts#L142-L154)) — migrate in P5 |
| BC-04 | `applyOfflineMembershipExtensions` deleted | No external callers | — |
| BC-05 | Dexie schema bumps `27 → 28` | Existing offline DBs lose `customer.membershipValidUntil` index (already orphaned) | Upgrade hook: simple reindex; no data loss because field is gone |
| BC-06 | `extensionData?: Record<string, unknown>` is added on five entities; the wire shape gains an optional field | Non-breaking; FE ignores until explicitly read | Document in P1 |

---

## 7. Risks & Open Questions

| # | Risk / Question | Owner | Resolution path |
|---|-----------------|-------|-----------------|
| R-01 | BE serializer key casing for `*Metadata` (camelCase vs PascalCase). BDD-020 §0 implies `JsonSerializerOptions` defaults; FE expects camelCase. | BE/FE | Confirm with BE team before P1; if PascalCase, add a small interceptor (already used elsewhere) to lowercase first letter. |
| R-02 | `DateOnly` (BE `CustomerMetadata.DateOfBirth`) JSON shape — is it `"1990-04-12"` or `"1990-04-12T00:00:00"`? | BE | Confirm; FE keeps `string` so any ISO works. |
| R-03 | `JsonDocument?` `extensionData` may serialize as `null` vs missing — both should parse. | FE | TS `?` covers both cases. |
| R-04 | `CustomerMembershipsService.getActiveExpiringSoon` for the dashboard widget — should it be a server-side endpoint? | FE/BE | v1 = client-side filter over `getMemberships(id)` per active member, but the widget today iterates over **all** customers. Without a list endpoint, this regresses performance. Defer the widget to a future BE endpoint or accept a single combined call (e.g. `GET /customers/memberships/expiring?windowDays=7`). Flag for BE roadmap. |
| R-05 | Offline cache freshness — `customerMemberships` may diverge if a different terminal extends a membership while we are offline. | FE | Reconcile path in P3 reads memberships post-sync; while offline, FE shows the latest cached snapshot with a "Sin conexión" pill. Acceptable trade-off. |
| R-06 | Migration order coordination — the FE must NOT ship P1 (which drops `customer.membershipValidUntil`) before BE has rolled the BDD-019 migration to prod, or the FE breaks against a BE that still emits the field on `GET /customers`. | Release | Gate the merge of P1 on a successful BE prod deploy. Verify with `curl /api/customers/{id}` payload before merging. |

---

## 8. References

- [BDD-019 — Chameleon Domain Readiness](BDD-019-chameleon-domain-readiness.md) — backend authoritative spec, implemented P1–P5.
- [BDD-020 — Chameleon Metadata Architecture](BDD-020-chameleon-metadata-architecture.md) — refines BDD-019 §3.1/§10 P1, defines Day-1 typed properties per Metadata class.
- [AUDIT-055 — Customer History UI](AUDIT-055-customer-history-ui.md) — drawer revamp + quick-pay attribution gap.
- [AUDIT-056 — Chameleon Models (FE)](AUDIT-056-chameleon-models.md) — current FE model state used as baseline.
- [AUDIT-052 — Restaurant Hub vs Chameleon Shells](AUDIT-052-restaurant-hub-chameleon.md) — bounded-context invariants the new types must respect.
- [coding-standards.md](../.claude/coding-standards.md) — Angular 18 / PrimeNG 17 patterns governing service shape, error handling, and type safety.
- [response-guidelines.md](../.claude/response-guidelines.md) — analyze first, wait for confirmation, implement only what is requested.

---

**End of design document. Awaiting explicit confirmation before writing any code.**
