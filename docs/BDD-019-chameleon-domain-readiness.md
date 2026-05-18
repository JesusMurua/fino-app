# BDD-019 — Chameleon Domain Readiness

**Date:** 2026-05-05
**Status:** Implemented (P1–P5 — 2026-05-06)
**Related audits:** [AUDIT-023](AUDIT-023-customer-history-memberships.md), [AUDIT-024](AUDIT-024-chameleon-domain-readiness.md)
**Driver:** Multi-vertical (Chameleon) evolution + customer history/stats unblock.

---

## 1. Executive Summary

**Problem.** The current domain leaks vertical-specific concerns (gym membership) into the generic `Customer` aggregate via two scalar columns (`MembershipValidUntil`, `LastPaymentAt`). Metadata extension points (`Product.Metadata`, `OrderItem.Metadata`, `OrderPayment.PaymentMetadata`) are stored as raw `text` with no schema, no typing, and no EF Core integration. The Admin Backoffice has no API to list a customer's orders or aggregate spend, so Customer Detail panels show empty History and `$0.00` Total Spent.

**Proposed solution.** (a) Migrate metadata columns to strongly-typed C# classes mapped to PostgreSQL `jsonb` via EF Core 9 `OwnsOne(...).ToJson()`. (b) Extract the membership concern into a new `CustomerMembership` aggregate, backfilling legacy data inside the migration. (c) Introduce three customer-scoped read endpoints (`/orders`, `/memberships`, `/stats`) and route membership-extension logic through a dedicated `IMembershipService`.

**Expected outcome.** A Chameleon-ready domain where vertical payloads live in typed JSON or in dedicated aggregates; the Admin UI receives real history and stats; gym membership semantics become explicit, auditable, and capable of supporting multiple concurrent entitlements per customer.

---

## 2. Current State Analysis

### 2.1 Architecture involved

| Layer | Files of interest |
|-------|-------------------|
| Domain | `Customer`, `Product`, `Order`, `OrderItem`, `OrderPayment`, `SyncOrderRequest` |
| Repository | `ApplicationDbContext` (entity configurations), `OrderRepository`, `CustomerRepository`, EF migrations |
| Services | `OrderService.SyncOrdersAsync` (currently invokes `ICustomerService.ExtendMembershipAsync`) |
| API | `CustomersController`, `OrdersController` |

### 2.2 Pain points

| # | Pain point | Source |
|---|-----------|--------|
| P1 | `Customer.MembershipValidUntil` / `LastPaymentAt` pollute every tenant regardless of vertical. | AUDIT-024 §1.1 |
| P2 | All `Metadata` columns are PostgreSQL `text`; no `jsonb`, no `OwnsOne`, no `ToJson()` anywhere in the project. | AUDIT-024 §2.2 / §2.3 |
| P3 | No `Order.Metadata` and no `Customer.Metadata` slot — asymmetry. | AUDIT-024 §3 |
| P4 | No endpoint returns a customer's orders; `GET /customers/{id}/transactions` returns the credit/loyalty ledger only. | AUDIT-023 §1.3 |
| P5 | Membership history is overwritten in place; no period log, no plan/tier, no support for parallel memberships. | AUDIT-023 §2.3 |
| P6 | Membership extension is wired directly inside `ICustomerService`, conflating CRM with entitlement concerns. | AUDIT-023 §2.2 |

### 2.3 Performance baseline

`MembershipValidUntil` already has a partial filtered index. `Order.CustomerId` is indexed. New per-customer queries should land on existing indexes; no degradation expected. JSON-typed columns mapped via `ToJson()` materialize as a single `jsonb` column per owned-type — no extra round-trips.

---

## 3. Technical Requirements

### 3.1 Functional Requirements

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-001 | Strongly type `Product.Metadata` | EF model maps `Product.Metadata` to a `ProductMetadata` owned type stored in a `jsonb` column. Existing data round-trips without loss. |
| FR-002 | Strongly type `OrderItem.Metadata` | EF model maps `OrderItem.Metadata` to `OrderItemMetadata`. `BeneficiaryCustomerId` accessible as a typed property. |
| FR-003 | Strongly type `OrderPayment.PaymentMetadata` | EF model maps `OrderPayment.PaymentMetadata` to `PaymentMetadata`. Provider-specific shapes preserved. |
| FR-004 | Add `Order.Metadata` slot | New owned type `OrderMetadata` mapped to `jsonb`; nullable. |
| FR-005 | Add `Customer.Metadata` slot | New owned type `CustomerMetadata` mapped to `jsonb`; nullable. |
| FR-006 | Drop `Customer.MembershipValidUntil` and `Customer.LastPaymentAt` | Columns removed. Index `IX_Customers_MembershipValidUntil` dropped. |
| FR-007 | Introduce `CustomerMembership` aggregate | Table created with all specified columns and indexes. |
| FR-008 | Backfill legacy memberships | After migration runs, every `Customer` row that previously had `MembershipValidUntil IS NOT NULL` has a corresponding `CustomerMemberships` row with `ProductId = NULL`. |
| FR-009 | `IMembershipService.ProcessOrderEntitlementsAsync` exists and is called from `OrderService.SyncOrdersAsync` | When an OrderItem's resolved `Product.Metadata.MembershipDurationDays > 0`, the service is invoked and creates/extends a `CustomerMembership` row. |
| FR-010 | Stacking rules implemented | Same `(CustomerId, ProductId)` extends; different `ProductId` creates a new row; legacy rows (`ProductId NULL`) are never extended. |
| FR-011 | Frozen status pauses the membership | When `Status = Frozen`, the service rejects extension attempts and the membership does not auto-expire. |
| FR-012 | Endpoint `GET /api/customers/{id}/orders` | Returns paginated `CustomerOrderRowDto` list filterable by date. |
| FR-013 | Endpoint `GET /api/customers/{id}/memberships` | Returns active + historical memberships sorted by `ValidUntil` desc. |
| FR-014 | Endpoint `GET /api/customers/{id}/stats` | Returns `TotalSpentCents`, `OrderCount`, `LastOrderAt`. |

### 3.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001 | Endpoint latency (p95) | `< 200 ms` on a 50k-orders / 10k-customers seed. |
| NFR-002 | Migration runtime | `< 5 s` on a 100k-customers DB; `< 30 s` on 1M-customers. |
| NFR-003 | Zero data loss | Every legacy `MembershipValidUntil IS NOT NULL` row produces exactly one `CustomerMemberships` row. |
| NFR-004 | Concurrency safety | Two simultaneous order syncs for the same `(CustomerId, ProductId)` must not double-extend; conflicts resolved via optimistic concurrency. |
| NFR-005 | Authorization | All three new endpoints gated by `Owner,Manager,Cashier` roles. |
| NFR-006 | Multi-tenant isolation | Endpoints reject access when `Customer.BusinessId != User.BusinessId`. |

---

## 4. Architecture Design

### 4.1 Component Overview

| Component | Type | Responsibility |
|-----------|------|----------------|
| `IMembershipService` / `MembershipService` | Service (new) | Owns membership lifecycle: create, extend, freeze, query. Exposes `ProcessOrderEntitlementsAsync`. |
| `ICustomerMembershipRepository` / impl | Repository (new) | Persistence for `CustomerMembership` aggregate; EF queries by customer, by status, by product. |
| `IUnitOfWork` | Existing | Adds `Memberships` property; existing `Customers`, `Orders` reused. |
| `ICustomerService` | Existing — slim down | `ExtendMembershipAsync` removed. CRM/credit/loyalty methods unchanged. |
| `IOrderService` | Existing — modified | `SyncOrdersAsync` calls `IMembershipService.ProcessOrderEntitlementsAsync` instead of `ICustomerService.ExtendMembershipAsync`. |
| `CustomersController` | Existing — extended | Three new actions: `GetOrders`, `GetMemberships`, `GetStats`. |
| `IOrderRepository` | Existing — extended | New projection method `GetByCustomerPagedAsync` returning `CustomerOrderRowDto`. |

### 4.2 Data Flow

#### 4.2.1 POS sync extends a membership

1. POS posts a synced order via `POST /api/orders/sync`. The order's items include a product whose `Metadata.MembershipDurationDays > 0`.
2. `OrderService.SyncOrdersAsync` persists the `Order` and its `OrderItems` (existing flow, unchanged).
3. After save, `OrderService` calls `IMembershipService.ProcessOrderEntitlementsAsync(order)`.
4. The service iterates `order.Items`; for each item with `Product.Metadata.MembershipDurationDays > 0`:
   - resolves the beneficiary id (`OrderItem.Metadata.BeneficiaryCustomerId ?? order.CustomerId`),
   - looks up the most recent active `CustomerMembership` for `(CustomerId, ProductId)`,
   - if found and not `Frozen` → extends `ValidUntil += DurationDays`, refreshes `Status` if it had been `Expired`,
   - if not found or `Frozen` → creates a new row with `ValidFrom = UtcNow`, `ValidUntil = UtcNow + DurationDays`, `Status = Active`, `OriginatingOrderId = order.Id`.
5. Rows are saved via the same UoW transaction as the order — the order and its entitlements either both commit or both roll back.

#### 4.2.2 Admin reads customer history

1. Admin UI calls `GET /api/customers/{id}/orders?page=1&pageSize=20&from=...&to=...`.
2. Controller validates the customer belongs to the caller's business.
3. `IOrderRepository.GetByCustomerPagedAsync(customerId, page, pageSize, from, to)` runs a projection-only query that returns `CustomerOrderRowDto` directly (no entity hydration).
4. Controller returns `PageData<CustomerOrderRowDto>`.

#### 4.2.3 Admin reads customer stats

1. Admin UI calls `GET /api/customers/{id}/stats`.
2. Controller validates ownership.
3. `IOrderRepository.GetStatsByCustomerAsync(customerId)` runs a single aggregation query (`SUM(TotalCents)`, `COUNT(*)`, `MAX(CreatedAt)`) filtered by `CustomerId` and `IsPaid = true` and `CancellationReason IS NULL`.
4. Controller returns `CustomerStatsDto`.

### 4.3 Database Schema Changes

#### 4.3.1 New table

| Table | `CustomerMemberships` |
|-------|------------------------|
| `Id` | `int` PK identity |
| `CustomerId` | `int` FK → `Customers(Id)` (Cascade) |
| `ProductId` | `int?` FK → `Products(Id)` (SetNull) — nullable for legacy backfill |
| `ValidFrom` | `timestamp with time zone` not null |
| `ValidUntil` | `timestamp with time zone` not null |
| `Status` | `varchar(20)` not null — persisted as string via `HasConversion<string>()` |
| `OriginatingOrderId` | `varchar(36)` nullable, FK → `Orders(Id)` (SetNull) |
| `CreatedAt` | `timestamp with time zone` default `now()` |
| `UpdatedAt` | `timestamp with time zone` nullable |
| `xmin` | system column used as concurrency token |

Indexes:

| Index | Columns | Purpose |
|-------|---------|---------|
| `IX_CustomerMemberships_CustomerId` | `CustomerId` | List customer's memberships. |
| `IX_CustomerMemberships_Customer_Product` | `(CustomerId, ProductId)` | Stacking lookup; partial filter `WHERE "ProductId" IS NOT NULL`. |
| `IX_CustomerMemberships_ValidUntil_Active` | `ValidUntil` | Filtered `WHERE "Status" = 'Active'` — fast "expiring soon" queries. |
| `IX_CustomerMemberships_OriginatingOrderId` | `OriginatingOrderId` | Audit trace from order to entitlement. |

#### 4.3.2 Modified tables

| Table | Change | Reason |
|-------|--------|--------|
| `Customers` | Drop columns `MembershipValidUntil`, `LastPaymentAt`. Drop index `IX_Customers_MembershipValidUntil`. Add `Metadata` (`jsonb` nullable) for `CustomerMetadata`. | Purify the aggregate; introduce typed slot. |
| `Products` | Convert `Metadata` from `text` to `jsonb` (owned-type `ProductMetadata`). | FR-001. |
| `Orders` | Add `Metadata` (`jsonb` nullable) for `OrderMetadata`. | FR-004. |
| `OrderItems` | Convert `Metadata` from `text` to `jsonb` (owned-type `OrderItemMetadata`). `ExtrasJson` left untouched. | FR-002. |
| `OrderPayments` | Convert `PaymentMetadata` from `text` to `jsonb` (owned-type `PaymentMetadata`). | FR-003. |

#### 4.3.3 Backfill (executed inside the migration, BEFORE drop)

Conceptually:

```text
INSERT INTO "CustomerMemberships" (CustomerId, ProductId, ValidFrom, ValidUntil, Status, OriginatingOrderId, CreatedAt)
SELECT
    c."Id",
    NULL,
    COALESCE(c."LastPaymentAt", c."MembershipValidUntil" - INTERVAL '30 days', CURRENT_TIMESTAMP),
    c."MembershipValidUntil",
    CASE WHEN c."MembershipValidUntil" > CURRENT_TIMESTAMP THEN 'Active' ELSE 'Expired' END,
    NULL,
    CURRENT_TIMESTAMP
FROM "Customers" c
WHERE c."MembershipValidUntil" IS NOT NULL;
```

The text-to-jsonb conversion of existing `Metadata` columns is performed via `USING ("Metadata"::jsonb)` in the `AlterColumn` step. Pre-validated by a check query that ensures every existing string is valid JSON or `NULL`; any non-JSON row aborts the migration.

---

## 5. API Contract

### 5.1 Endpoints

#### 5.1.1 `GET /api/customers/{id}/orders`

| Aspect | Value |
|--------|-------|
| Auth | `[Authorize(Roles = "Owner,Manager,Cashier")]` |
| Path | `id : int` |
| Query | `page : int = 1`, `pageSize : int = 20` (max 100), `from : DateTime?`, `to : DateTime?` |
| Response | `PageData<CustomerOrderRowDto>` |
| 200 | Returns the paginated orders list. |
| 400 | Invalid `page`/`pageSize`/date range. |
| 403 | Customer belongs to another business. |
| 404 | Customer not found. |

```csharp
public class CustomerOrderRowDto
{
    public string OrderId { get; set; } = null!;
    public int OrderNumber { get; set; }
    public DateTime CreatedAt { get; set; }
    public int TotalCents { get; set; }
    public int ItemCount { get; set; }
    public int BranchId { get; set; }
    public string BranchName { get; set; } = null!;
    public bool IsPaid { get; set; }
    public string? CancellationReason { get; set; }
}
```

#### 5.1.2 `GET /api/customers/{id}/memberships`

| Aspect | Value |
|--------|-------|
| Auth | `[Authorize(Roles = "Owner,Manager,Cashier")]` |
| Path | `id : int` |
| Query | `status : string?` (`Active`, `Expired`, `Frozen`, `Cancelled`) |
| Response | `IEnumerable<CustomerMembershipDto>` sorted by `ValidUntil` desc |
| 200 | Returns the list (may be empty). |
| 403 | Cross-tenant access. |
| 404 | Customer not found. |

```csharp
public class CustomerMembershipDto
{
    public int Id { get; set; }
    public int? ProductId { get; set; }
    public string? ProductName { get; set; }
    public DateTime ValidFrom { get; set; }
    public DateTime ValidUntil { get; set; }
    public string Status { get; set; } = null!;
    public string? OriginatingOrderId { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

#### 5.1.3 `GET /api/customers/{id}/stats`

| Aspect | Value |
|--------|-------|
| Auth | `[Authorize(Roles = "Owner,Manager,Cashier")]` |
| Path | `id : int` |
| Response | `CustomerStatsDto` |
| 200 | Returns aggregates (zeros if no orders). |
| 404 | Customer not found. |

```csharp
public class CustomerStatsDto
{
    public int TotalSpentCents { get; set; }
    public int OrderCount { get; set; }
    public DateTime? LastOrderAt { get; set; }
}
```

### 5.2 Service Interfaces

```csharp
public interface IMembershipService
{
    Task<IEnumerable<CustomerMembership>> GetByCustomerAsync(int customerId, MembershipStatus? status = null);

    Task<CustomerMembership> ExtendOrCreateAsync(
        int customerId, int productId, int durationDays, string originatingOrderId);

    Task ProcessOrderEntitlementsAsync(Order order);

    Task<CustomerMembership> FreezeAsync(int membershipId);
    Task<CustomerMembership> UnfreezeAsync(int membershipId);
    Task<CustomerMembership> CancelAsync(int membershipId, string reason);
}

public interface ICustomerMembershipRepository
{
    Task<IEnumerable<CustomerMembership>> GetByCustomerAsync(int customerId);
    Task<CustomerMembership?> GetActiveAsync(int customerId, int productId);
    Task AddAsync(CustomerMembership membership);
    void Update(CustomerMembership membership);
}
```

### 5.3 New entity

```csharp
public class CustomerMembership
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public int? ProductId { get; set; }
    public DateTime ValidFrom { get; set; }
    public DateTime ValidUntil { get; set; }
    public MembershipStatus Status { get; set; } = MembershipStatus.Active;
    public string? OriginatingOrderId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public virtual Customer? Customer { get; set; }
    public virtual Product? Product { get; set; }
    public virtual Order? OriginatingOrder { get; set; }
}

public enum MembershipStatus { Active, Expired, Frozen, Cancelled }
```

### 5.4 Owned-type definitions

```csharp
public class ProductMetadata
{
    public int? MembershipDurationDays { get; set; }
}

public class OrderItemMetadata
{
    public int? BeneficiaryCustomerId { get; set; }
}

public class OrderMetadata
{
    // Reserved for future vertical extensions; intentionally empty for now.
}

public class CustomerMetadata
{
    // Reserved for future vertical extensions; intentionally empty for now.
}

public class PaymentMetadata
{
    public string? RawProviderJson { get; set; }
    public string? AuthorizationCode { get; set; }
    public string? Last4 { get; set; }
    public string? CardBrand { get; set; }
}
```

### 5.5 EF Core configuration snippets

```csharp
modelBuilder.Entity<Product>(entity =>
{
    entity.OwnsOne(p => p.Metadata, b => b.ToJson());
});

modelBuilder.Entity<OrderItem>(entity =>
{
    entity.OwnsOne(i => i.Metadata, b => b.ToJson());
});

modelBuilder.Entity<OrderPayment>(entity =>
{
    entity.OwnsOne(p => p.PaymentMetadata, b => b.ToJson());
});

modelBuilder.Entity<Order>(entity =>
{
    entity.OwnsOne(o => o.Metadata, b => b.ToJson());
});

modelBuilder.Entity<Customer>(entity =>
{
    entity.OwnsOne(c => c.Metadata, b => b.ToJson());
});

modelBuilder.Entity<CustomerMembership>(entity =>
{
    entity.Property(m => m.Status).HasConversion<string>().HasMaxLength(20);

    entity.HasOne(m => m.Customer).WithMany().HasForeignKey(m => m.CustomerId).OnDelete(DeleteBehavior.Cascade);
    entity.HasOne(m => m.Product).WithMany().HasForeignKey(m => m.ProductId).OnDelete(DeleteBehavior.SetNull);
    entity.HasOne(m => m.OriginatingOrder).WithMany().HasForeignKey(m => m.OriginatingOrderId).OnDelete(DeleteBehavior.SetNull);

    entity.HasIndex(m => m.CustomerId);
    entity.HasIndex(m => new { m.CustomerId, m.ProductId }).HasFilter("\"ProductId\" IS NOT NULL");
    entity.HasIndex(m => m.ValidUntil).HasFilter("\"Status\" = 'Active'");
    entity.HasIndex(m => m.OriginatingOrderId);

    entity.Property<uint>("xmin").HasColumnType("xid").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
});
```

---

## 6. Business Logic Specifications

### 6.1 Core Algorithms

#### 6.1.1 `ProcessOrderEntitlementsAsync`

> **Revised 2026-05-06 (P3 implementation):** the algorithm now follows an
> **always-create-new** strategy (each entitlement is its own row, preserving
> a clean `OriginatingOrderId` audit trace) and the service does **not** call
> `SaveChangesAsync` itself — the caller's commit boundary owns the UoW.

```text
INPUT: orders : IEnumerable<Order>
1. Filter: o.IsPaid && o.CancellationReason == null && o.Items?.Count > 0.
2. Batch-load every referenced Product (single SELECT, with typed Metadata).
3. Batch-load every referenced Branch for tenant validation (single SELECT).
4. Pre-pass — collect membership-eligible items:
   a. product.Metadata?.MembershipDurationDays > 0 (skip null / <= 0).
   b. item.Quantity > 0 (skip).
   c. beneficiaryId := item.Metadata?.BeneficiaryCustomerId (when > 0) ?? order.CustomerId.
   d. If beneficiaryId is null → throw ValidationException("BENEFICIARY_REQUIRED").
5. Batch-load referenced beneficiary Customers (single SELECT).
6. Cross-tenant validation:
   if customer.BusinessId != branch.BusinessId
     → throw ValidationException("CROSS_TENANT_BENEFICIARY").
7. Batch-load existing CustomerMemberships where Status IN (Active, Frozen)
   for the (CustomerId, ProductId) pairs identified in the pre-pass.
8. For each eligible item:
   a. If any existing row for (beneficiaryId, productId) has Status == Frozen
      → throw ValidationException("FROZEN_MEMBERSHIP_NOT_EXTENDABLE").
   b. validFrom := max(MAX(existing Active ValidUntil), UtcNow)  // clamp prevents backdating.
   c. validUntil := validFrom + durationDays * quantity.
   d. Create new CustomerMembership {
        CustomerId, ProductId, ValidFrom, ValidUntil,
        Status = Active, OriginatingOrderId = order.Id, CreatedAt = UtcNow }.
   e. _unitOfWork.CustomerMemberships.AddAsync(...).
9. NO SaveChangesAsync inside the service. The caller commits.
OUTPUT: void (or throws ValidationException for the codes above).
```

The service is intentionally pure-staging: it issues `AddAsync` calls and lets
the caller's `SaveChangesAsync` materialize them inside its own transaction
boundary. The caller is responsible for translating `DbUpdateConcurrencyException`
into `ConcurrencyConflictException("MEMBERSHIP_BUSY")` per §6.4.

#### 6.1.2 Status auto-transition

`Active → Expired` is **lazy**: the column is not auto-updated by a job. Instead, query callers (`GetByCustomerAsync`, the `/memberships` endpoint, `GetActiveAsync`) project status as `Expired` whenever `ValidUntil < UtcNow AND Status = Active`. On any write of an existing Active row whose `ValidUntil` has passed (e.g. an extension), the service flips it back to `Active`. This keeps writes minimal and avoids a background job.

`Frozen` and `Cancelled` are explicit; never auto-transitioned.

#### 6.1.3 Stats aggregation

Single SQL aggregation over `Orders WHERE CustomerId = @id AND IsPaid = true AND CancellationReason IS NULL`:

```text
TotalSpentCents = SUM(TotalCents)
OrderCount      = COUNT(*)
LastOrderAt     = MAX(CreatedAt)
```

### 6.2 Validation Rules

| ID | Rule | Error |
|----|------|-------|
| VR-001 | Membership extension requires a beneficiary id (`OrderItem.Metadata.BeneficiaryCustomerId` or `Order.CustomerId`). | `BENEFICIARY_REQUIRED` (400) |
| VR-002 | Frozen memberships cannot be extended via order sync. | `FROZEN_MEMBERSHIP_NOT_EXTENDABLE` (400) |
| VR-003 | Cancelled memberships cannot be extended; a new row is created instead. | (handled, no error) |
| VR-004 | `pageSize` must be in `[1, 100]`. | `INVALID_PAGE_SIZE` (400) |
| VR-005 | `from <= to` when both supplied. | `INVALID_DATE_RANGE` (400) |
| VR-006 | `Customer.BusinessId == User.BusinessId` for every customer-scoped endpoint. | `403 Forbidden` |
| VR-007 | Backfill aborts if any existing `Metadata` text column contains invalid JSON. | Migration fails loudly. |

### 6.3 Edge Cases

| Edge case | Expected behavior |
|-----------|-------------------|
| Order with multiple membership items for the same `(customer, product)` | Each item stacks: `durationDays * sum(quantities)` added in a single update. |
| Order with membership item but `quantity = 0` | Skip silently. |
| Item has `BeneficiaryCustomerId` for a customer of a different business | Reject the entire sync (`CROSS_TENANT_BENEFICIARY`, 400). |
| Customer has only legacy (`ProductId NULL`) membership and now buys a real one | New row created with the real `ProductId`; legacy row untouched. |
| Order is cancelled after extension | Out of scope for this BDD — entitlements are not auto-revoked on cancellation. Tracked as a future feature. |
| Two near-simultaneous syncs both extend `(c, p)` | See §6.4 Concurrency. |
| `MembershipDurationDays = -5` (negative) | Treat as `<= 0` → skipped. No exception. |

### 6.4 Concurrency

> **Revised 2026-05-06 (P3 implementation):** strategy switched from "internal
> retry with re-read" to **fail-fast with single-shot surfacing**. The POS sync
> queue on the client retries the batch naturally, removing the need for an
> internal retry loop that would otherwise need to manage its own transaction
> boundaries.

Two parallel `OrderService.SyncOrdersAsync` calls (e.g. two devices syncing) can both stage `CustomerMembership` rows for the same `(CustomerId, ProductId)`. Without protection the second commit could land an entitlement whose `ValidFrom` was computed from a now-stale snapshot of the existing rows, producing a gap or overlap in coverage.

**Mitigation.** `CustomerMembership` declares an `xmin` shadow concurrency token (matching the pattern used today on `Order`). On `SaveChangesAsync`, EF appends `WHERE xmin = @original` to the row state checks; the losing transaction throws `DbUpdateConcurrencyException`.

**Caller contract.** `MembershipService.ProcessOrderEntitlementsAsync` does not handle the concurrency exception itself — it only stages rows. The caller (`OrderService.SyncOrdersAsync`) wraps its own `SaveChangesAsync` in a `try/catch (DbUpdateConcurrencyException)` immediately after the membership hook and rethrows as `ConcurrencyConflictException("MEMBERSHIP_BUSY", ex)`. The HTTP layer surfaces this as `409 Conflict`; the offline POS client's sync queue is responsible for retrying the affected batch.

This keeps the service stateless, preserves a single source of transaction truth (the caller), and avoids the impossibility of "retry within the same UoW" (a fresh re-read needs a fresh transaction in PostgreSQL).

---

## 7. Performance Optimization Strategy

### 7.1 Query Optimization

| Surface | Strategy |
|---------|----------|
| `GET /customers/{id}/orders` | Projection-only query into `CustomerOrderRowDto` — no entity hydration, no `Items` include. `ItemCount` derived via a subquery `(SELECT COUNT(*) FROM "OrderItems" WHERE "OrderId" = o."Id")`. Branch name joined via `o.Branch.Name`. |
| `GET /customers/{id}/stats` | Single GROUP BY query. No N+1. |
| `GET /customers/{id}/memberships` | Direct entity fetch with optional `Product` include for the name only. Sorted in DB. |
| `ProcessOrderEntitlementsAsync` | Batch-load all referenced `Product` rows once; batch-load existing memberships once via `WHERE CustomerId IN (...) AND ProductId IN (...)`. |

### 7.2 Bulk Operations

The membership hook operates per-order, not per-batch — bulk operations are not required at this stage. If load grows, the natural extension is a `ProcessSyncBatchEntitlementsAsync(IEnumerable<Order>)` that pre-loads everything for the entire batch.

### 7.3 Caching Strategy

Out of scope. None of the new read endpoints are hot enough to warrant a cache; they are admin-panel queries called per customer detail open. Re-evaluate if `/stats` becomes part of a dashboard.

---

## 8. Error Handling Strategy

| Scenario | Exception | HTTP | Logged at |
|----------|-----------|------|-----------|
| Customer not found | `NotFoundException` | 404 | INFO |
| Cross-tenant access | `ForbiddenException` | 403 | WARN |
| Beneficiary missing on a membership item | `ValidationException("BENEFICIARY_REQUIRED")` | 400 | WARN |
| Beneficiary in another business | `ValidationException("CROSS_TENANT_BENEFICIARY")` | 400 | WARN |
| Frozen membership extension attempt | `ValidationException("FROZEN_MEMBERSHIP_NOT_EXTENDABLE")` | 400 | INFO |
| Concurrency conflict after retries | `ConcurrencyException("MEMBERSHIP_BUSY")` | 409 | ERROR |
| Backfill encounters non-JSON `Metadata` | Migration aborts | n/a | ERROR (deploy log) |
| Invalid `Metadata` JSON shape on read | EF deserialization throws → `InternalServerException` | 500 | ERROR |

User-facing messages are kept short and machine-friendly (the codes above). Detailed message text returned for 4xx; 5xx returns a generic message and logs the full exception.

---

## 9. Test Plan / Acceptance Criteria

### 9.1 Unit tests — `MembershipService`

| # | Scenario |
|---|----------|
| U-01 | Extend existing Active membership for same `(customer, product)` adds days correctly. |
| U-02 | Extend an Expired membership resets `ValidFrom = UtcNow` and `Status = Active`. |
| U-03 | Frozen membership extension throws `FROZEN_MEMBERSHIP_NOT_EXTENDABLE`. |
| U-04 | Different `ProductId` for same customer creates a new row. |
| U-05 | `MembershipDurationDays = 0` or `null` is a no-op. |
| U-06 | `BeneficiaryCustomerId` overrides `Order.CustomerId`. |
| U-07 | Quantity > 1 multiplies days. |
| U-08 | Status auto-projection returns `Expired` when `ValidUntil < now` and stored Status is `Active`. |

### 9.2 Integration tests

| # | Scenario |
|---|----------|
| I-01 | `POST /orders/sync` of a membership product creates a `CustomerMemberships` row in the same transaction. |
| I-02 | A second sync of the same product extends instead of duplicating. |
| I-03 | `GET /customers/{id}/orders` returns paginated rows respecting date filters. |
| I-04 | `GET /customers/{id}/stats` returns `TotalSpentCents` matching the sum of paid, non-cancelled orders. |
| I-05 | `GET /customers/{id}/memberships?status=Active` returns only Active rows. |
| I-06 | Cross-tenant access on any of the three endpoints returns 403. |
| I-07 | Migration on a seeded DB with both legacy `MembershipValidUntil` rows and JSON-valid `Metadata` strings completes successfully and produces correct backfill rows. |
| I-08 | Migration aborts when a fixture row has invalid JSON in `Metadata`. |

### 9.3 Performance tests

| # | Scenario | Target |
|---|----------|--------|
| P-01 | `/customers/{id}/orders` p95 with 500 orders/customer | `< 200 ms` |
| P-02 | `/customers/{id}/stats` p95 with 1k orders/customer | `< 100 ms` |
| P-03 | Migration runtime on 100k customers, 50% with `MembershipValidUntil` | `< 5 s` |

### 9.4 Acceptance criteria

A1. After deploy, customers with a legacy `MembershipValidUntil` show that date in the Admin Membership panel via `GET /customers/{id}/memberships`.
A2. The Admin Customer Detail panel renders non-zero `TotalSpentCents` and `OrderCount` for any customer with paid orders.
A3. A POS sync of a known gym membership product extends the customer's membership by the configured `MembershipDurationDays` and creates a row in `CustomerMemberships` referencing the originating order.
A4. `Customer` table no longer has `MembershipValidUntil` or `LastPaymentAt` columns.
A5. `Product`, `OrderItem`, `OrderPayment`, `Order`, `Customer` all expose strongly-typed `Metadata` accessible via EF without manual JSON parsing.

---

## 10. Rollout & Phasing

| Phase | Deliverable | Complexity | Depends on |
|-------|-------------|:----------:|-----------|
| **P1 — Typed metadata foundation** | New owned types (`ProductMetadata`, `OrderItemMetadata`, `OrderMetadata`, `CustomerMetadata`, `PaymentMetadata`). EF `OwnsOne(...).ToJson()` mappings. Migration converting `text` → `jsonb` with pre-validation. Update every read/write site that previously parsed JSON manually (e.g. `TryReadBeneficiaryCustomerId`). | Medium | — |
| **P2 — `CustomerMembership` aggregate + backfill** | New entity, repository, EF config, indexes. Migration creates table and runs the SQL backfill from `Customers` BEFORE dropping `MembershipValidUntil` / `LastPaymentAt`. | Medium | P1 |
| **P3 — `IMembershipService` + sync hook** | New service + repository wired into UoW. `OrderService.SyncOrdersAsync` calls `ProcessOrderEntitlementsAsync` instead of `ICustomerService.ExtendMembershipAsync`. Remove `ExtendMembershipAsync` from `ICustomerService`. Concurrency token + retry policy. | High | P2 |
| **P4 — Customer read endpoints** | `GET /customers/{id}/orders`, `/memberships`, `/stats`. New repository projections. DTOs. | Low | P2 |
| **P5 — Cleanup & docs** | Delete legacy columns from EF model, drop dead helpers, update Swagger XML docs, update `ARCHITECTURE-OVERVIEW`. | Low | P1–P4 |

Phases are sequential — each must merge and pass CI before the next starts. P4 can be parallelized with P3 once P2 has merged.

---

## 11. Backwards-incompatible Changes

| # | Change | Impact | Mitigation |
|---|--------|--------|-----------|
| BC-01 | `Customer.MembershipValidUntil` and `LastPaymentAt` removed from the entity. | Any consumer reading these from the `GET /customers/{id}` payload breaks. | Frontend must read `MembershipValidUntil` from the new `/customers/{id}/memberships` endpoint instead. Coordinate with restaurant-app team. |
| BC-02 | `ICustomerService.ExtendMembershipAsync` removed. | Internal callers break at compile time. | Replaced by `IMembershipService.ExtendOrCreateAsync`. Compile errors guide the migration. |
| BC-03 | `Product.Metadata` JSON shape becomes typed. | Wire shape to/from API may change subtly: empty `{}` instead of `null`, key casing fixed by serializer config. | Confirm with frontend before merge. Document the canonical shape in OpenAPI. |
| BC-04 | `OrderItem.Metadata` JSON shape becomes typed. | `SyncOrderItemRequest.Metadata` is still a `string?` on the wire — but the server now deserializes it strictly. Unknown keys are ignored; malformed JSON throws 400. | Communicate to POS app team. Add a version sentinel in `OrderItemMetadata` if future churn is anticipated. |
| BC-05 | `OrderPayment.PaymentMetadata` shape typed. | Provider-specific raw JSON now lives under `RawProviderJson`. | Review what each integration (Clip, MercadoPago) sends; possibly add provider-specific subtypes later. |
| BC-06 | New required column `Status` on `CustomerMemberships`. | n/a — table is new. | — |
| BC-07 | `Customer.Orders` navigation no longer the recommended access path for history. | Internal repositories using `Include(c => c.Orders)` may need rewiring. | Search-and-replace; the new repository projection is preferred for performance. |

---

**End of design document.**
