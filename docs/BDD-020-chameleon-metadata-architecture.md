# BDD-020 — Chameleon Metadata Architecture

**Date:** 2026-05-05
**Status:** Draft — pending approval
**Type:** Corrective + refinement to [BDD-019 §3.1 / §10 P1](BDD-019-chameleon-domain-readiness.md).
**Driver:** Replace the `JsonObjectConverter` workaround (string-escaped JSON inside `jsonb`) with a hybrid pattern: strict typed properties on owned-type metadata + a separate native `jsonb` column for tenant-specific extension data.

---

## 0. Architectural Decision (overrides P1 implementation)

| Aspect | Decision |
|--------|----------|
| Multi-tenant SaaS posture | Keep ALL 4 core Metadata classes (`ProductMetadata`, `OrderItemMetadata`, `OrderMetadata`, `CustomerMetadata`) plus `PaymentMetadata`. No empty classes — each ships with at least one typed Day-1 property. |
| Hybrid pattern | Each parent entity gets **two** jsonb columns: `Metadata` (owned-type with strict props via `OwnsOne(...).ToJson()`) AND `ExtensionData` (raw `JsonDocument?` for tenant-specific dynamic keys). |
| Catch-all location | `ExtensionData` lives on the **parent entity**, **NOT** inside the owned metadata class. Reason: EF Core 9's owned-type-as-JSON model discovery rejects `JsonObject`/`JsonNode` (proven in P1) and is risky for `JsonDocument`; isolating it as a top-level scalar guarantees Npgsql's native `jsonb` mapping. |
| Queryability | Native via PostgreSQL `jsonb` operators (`->>`, `@>`, `->`, `?`, `?|`, `?&`, GIN indexes). No string escaping. |
| YAGNI delta | Each Metadata class ships with at least 2 strict typed Day-1 properties whose justification is either (a) existing operative code, (b) a documented Manual de Arquitectura/business-rules-matrix feature, or (c) a standard Enterprise CRM/POS field for a sub-giro we already onboard. |

---

## 1. Vertical Audit — Day-1 typed properties per Metadata class

| Vertical / Sub-giro | Entity | Proposed Typed Property | Type | Justification |
|---------------------|--------|--------------------------|------|---------------|
| Services / Gimnasio (sub-giro 20) | Product | `MembershipDurationDays` | `int?` | Existing in [MacroCategoryTemplates.cs:70](POS.Domain/Helpers/MacroCategoryTemplates.cs#L70) and consumed by [`OrderService.ApplyMembershipExtensionsAsync`](POS.Services/Service/OrderService.cs#L1579). Drives the gym membership flow. |
| Services / Estética, Consultorio, Taller, Gimnasio | Product | `ServiceDurationMinutes` | `int?` | Standard Enterprise POS field for service-based sub-giros. Powers appointment-slot logic for `AppointmentReminders` (FeatureKey 82) referenced in business-rules-matrix.md §1.4. |
| F&B / All sub-giros (1, 2, 3) + Quick Service (4–9) | Product | `KitchenPrepMinutes` | `int?` | Standard KDS time estimate. Manual §4 lists "Pantallas de Cocina (KDS)" as a Pro feature; KDS without prep estimates is a degraded experience. |
| F&B / Bar/Cantina (sub-giro 2), Sports Bar (3) | Product | `IsAlcoholic` | `bool?` | Regulatory compliance (Mexican LISR/responsible service); enables age-gate UX hooks. |
| Retail / Enterprise plan (Manual §3 "Soporte de Básculas") | Product | `IsSoldByWeight` | `bool?` | Manual lists scale support as the Enterprise hardware unlock. The Product flag determines whether the POS prompts for scale capture. |
| Services / Gimnasio | OrderItem | `BeneficiaryCustomerId` | `int?` | Existing in [SyncOrderRequest.cs:77](POS.Domain/Models/SyncOrderRequest.cs#L77) and consumed by [`OrderService.ApplyMembershipExtensionsAsync:1583`](POS.Services/Service/OrderService.cs#L1583). Enables parent-buys-for-member purchases. |
| Retail / Enterprise plan | OrderItem | `WeightGrams` | `decimal?` | Captured when `Product.IsSoldByWeight = true`. The actual weight at sale time drives the variable line price. |
| Services / Estética, Consultorio, Taller, Gimnasio | OrderItem | `AppointmentAt` | `DateTime?` | When the line represents a future-scheduled service (e.g. corte programado para mañana 10:00). Distinct from `Order.CreatedAt`. |
| F&B / Restaurant (sub-giro 1) | Order | `DiningPersons` | `int?` | Standard restaurant POS metric (party size). Drives table-sizing analytics and dish-count heuristics. No existing strict column. |
| Delivery (Order.OrderSource ≠ Direct) | Order | `DeliveryAddressLine` | `string?` | `Order.DeliveryCustomerName` exists; full address does not. Required to print a complete delivery commanda when the order arrives from UberEats/Rappi/DidiFood. |
| Universal CRM | Customer | `DateOfBirth` | `DateOnly?` | Birthday marketing campaigns (Manual §4 "Programa de Lealtad"). Standard CRM field across F&B, Retail, Services. |
| Universal CRM (compliance) | Customer | `MarketingOptIn` | `bool?` | Required for any future SMS/Email automated campaign. GDPR/LFPDPPP-aligned. |
| Services / Gimnasio + Wellness | Customer | `EmergencyContactPhone` | `string?` | Standard fitness/wellness vertical field; safety regulation when handling physical-activity members. |
| Universal payments | OrderPayment | `RawProviderJson`, `AuthorizationCode`, `Last4`, `CardBrand` | `string?` × 4 | Already approved in BDD-019 §5.4. Drives reconciliation, receipt rendering, and audit trail for Clip / MercadoPago / manual flows. |

---

## 2. Domain Models — definitive Day-1 specification

### 2.1 `ProductMetadata`

| Field | Type | Day-1 Source |
|-------|------|--------------|
| `MembershipDurationDays` | `int?` | Gym (existing) |
| `ServiceDurationMinutes` | `int?` | Services (Day-1 anticipation) |
| `KitchenPrepMinutes` | `int?` | F&B / QS (Day-1 anticipation) |
| `IsAlcoholic` | `bool?` | Bar / Sports Bar |
| `IsSoldByWeight` | `bool?` | Retail Enterprise (scales) |

### 2.2 `OrderItemMetadata`

| Field | Type | Day-1 Source |
|-------|------|--------------|
| `BeneficiaryCustomerId` | `int?` | Gym (existing) |
| `WeightGrams` | `decimal?` | Retail Enterprise (scales) |
| `AppointmentAt` | `DateTime?` | Services |

### 2.3 `OrderMetadata`

| Field | Type | Day-1 Source |
|-------|------|--------------|
| `DiningPersons` | `int?` | F&B Restaurant |
| `DeliveryAddressLine` | `string?` | Delivery platforms |

### 2.4 `CustomerMetadata`

| Field | Type | Day-1 Source |
|-------|------|--------------|
| `DateOfBirth` | `DateOnly?` | Universal CRM |
| `MarketingOptIn` | `bool?` | Compliance |
| `EmergencyContactPhone` | `string?` | Gym / Wellness |

### 2.5 `PaymentMetadata`

| Field | Type | Day-1 Source |
|-------|------|--------------|
| `RawProviderJson` | `string?` | BDD-019 carry-over |
| `AuthorizationCode` | `string?` | BDD-019 carry-over |
| `Last4` | `string?` | BDD-019 carry-over |
| `CardBrand` | `string?` | BDD-019 carry-over |

### 2.6 Dynamic catch-all (lives on the **parent entity**, not on the metadata class)

| Parent Entity | Dynamic Property | Type | Column Type |
|---------------|------------------|------|-------------|
| `Product` | `ExtensionData` | `JsonDocument?` | `jsonb` |
| `OrderItem` | `ExtensionData` | `JsonDocument?` | `jsonb` |
| `Order` | `ExtensionData` | `JsonDocument?` | `jsonb` |
| `Customer` | `ExtensionData` | `JsonDocument?` | `jsonb` |
| `OrderPayment` | `ExtensionData` | `JsonDocument?` | `jsonb` |

---

## 3. EF Core 9 Configuration — exact mapping per entity

| Entity | Strict Metadata mapping | ExtensionData mapping | DB columns |
|--------|--------------------------|------------------------|------------|
| `Product` | `entity.OwnsOne(p => p.Metadata, b => b.ToJson())` (no converter, no comparer) | `entity.Property(p => p.ExtensionData).HasColumnType("jsonb")` | `Metadata jsonb`, `ExtensionData jsonb` |
| `OrderItem` | `entity.OwnsOne(i => i.Metadata, b => b.ToJson())` | `entity.Property(i => i.ExtensionData).HasColumnType("jsonb")` | `Metadata jsonb`, `ExtensionData jsonb` |
| `Order` | `entity.OwnsOne(o => o.Metadata, b => b.ToJson())` | `entity.Property(o => o.ExtensionData).HasColumnType("jsonb")` | `Metadata jsonb`, `ExtensionData jsonb` |
| `Customer` | `entity.OwnsOne(c => c.Metadata, b => b.ToJson())` | `entity.Property(c => c.ExtensionData).HasColumnType("jsonb")` | `Metadata jsonb`, `ExtensionData jsonb` |
| `OrderPayment` | `entity.OwnsOne(p => p.PaymentMetadata, b => b.ToJson())` | `entity.Property(p => p.ExtensionData).HasColumnType("jsonb")` | `PaymentMetadata jsonb`, `ExtensionData jsonb` |

| Concern | Resolution |
|---------|------------|
| `JsonDocument` mapping | Npgsql.EntityFrameworkCore.PostgreSQL ≥ 9 maps `JsonDocument?` natively to `jsonb` as a scalar column. No converter required. |
| `JsonDocument` lifecycle | `JsonDocument` implements `IDisposable`; EF tracks ownership and disposes on entity detach. Read-only after load. To mutate, callers replace the document with a new one. |
| Native queryability | `WHERE products."ExtensionData" @> '{"k":"v"}'` ; `WHERE products."ExtensionData" -> 'k' ->> 'subk' = '...'`. No string unwrap. |
| Indexing | Optional GIN index on hot `ExtensionData` columns: `CREATE INDEX IX_Products_ExtensionData_GIN ON "Products" USING GIN ("ExtensionData")` — defer until a tenant produces enough rows to warrant it. |
| Owned-type model discovery | Strict properties only (primitives or `Dictionary<,>` of primitives). No `JsonNode` / `JsonObject` / `JsonElement` inside the owned type. P1's `JsonObjectConverter` workaround is removed. |

---

## 4. Implementation Phases

```
                     ┌──────────────────────────────┐
                     │  Current state (post-P1)     │
                     │                               │
                     │  • 5 Metadata classes exist  │
                     │  • ExtensionData : JsonObject?│
                     │  • JsonObjectConverter used  │
                     │  • Migration 20260506021953  │
                     │    generated (not applied)   │
                     └──────────────┬───────────────┘
                                    │
                                    ▼
        ┌──────────────────────────────────────────────────┐
        │  CORRECTIVE — single deliverable                  │
        │                                                    │
        │  A. Refactor 5 Metadata classes:                  │
        │     - Drop ExtensionData : JsonObject?            │
        │     - Add the strict typed properties from §2     │
        │                                                    │
        │  B. Add ExtensionData : JsonDocument? to:         │
        │     Product, OrderItem, Order, Customer,          │
        │     OrderPayment (parent entities — NOT inside    │
        │     metadata classes)                              │
        │                                                    │
        │  C. Delete POS.Repository/Utils/                  │
        │     JsonObjectConverter.cs (incl. comparer)       │
        │                                                    │
        │  D. ApplicationDbContext: simplify the 5×         │
        │     OwnsOne(...).ToJson() (no converter); add     │
        │     5× HasColumnType("jsonb") for ExtensionData   │
        │                                                    │
        │  E. Remove existing migration                     │
        │     20260506021953_AddTypedMetadataJsonColumns    │
        │     (`dotnet ef migrations remove`) and           │
        │     regenerate as a single clean migration        │
        │                                                    │
        │  F. dotnet build POS.API → 0 errors expected      │
        └──────────────────────────────┬───────────────────┘
                                       │
                                       ▼
              ┌────────────────────────────────────┐
              │  Resume BDD-019 sequence: P2 → P5  │
              │  (CustomerMembership, IMemberhip-   │
              │   Service, endpoints, cleanup)      │
              └────────────────────────────────────┘
```

| Phase | Deliverable | Complexity | Depends on |
|-------|-------------|:----------:|-----------|
| **CORRECTIVE / Step A** | Refactor 5 Metadata classes per §2 | Low | — |
| **CORRECTIVE / Step B** | Add `ExtensionData : JsonDocument?` to 5 parent entities | Low | A |
| **CORRECTIVE / Step C** | Delete `JsonObjectConverter.cs` | Trivial | A |
| **CORRECTIVE / Step D** | Simplify `ApplicationDbContext` per §3 | Low | A, B, C |
| **CORRECTIVE / Step E** | `dotnet ef migrations remove` + regenerate | Low | D |
| **CORRECTIVE / Step F** | `dotnet build POS.API` → 0 errors | Trivial | E |
| **Then resume** | BDD-019 P2 (`CustomerMembership` aggregate + backfill) | Medium | All Corrective steps |
| **Then resume** | BDD-019 P3 (`IMembershipService` + sync hook) | High | P2 |
| **Then resume** | BDD-019 P4 (Customer read endpoints) | Low | P2 |
| **Then resume** | BDD-019 P5 (Cleanup + docs) | Low | P1–P4 |

---

## 5. Backwards-incompatible changes (vs current P1 partial state)

| # | Change | Impact |
|---|--------|--------|
| BC-01 | `XxxMetadata.ExtensionData : JsonObject?` removed | Internal-only — no callers exist yet; P1 was not deployed. |
| BC-02 | `Entity.ExtensionData : JsonDocument?` added (5 parent entities) | New columns. Wire shape on `GET /api/products/{id}` etc. gains a new optional `extensionData` field. Frontend may ignore until needed. |
| BC-03 | Existing migration `20260506021953_AddTypedMetadataJsonColumns` removed and regenerated | Single clean migration replaces the previous one. Nothing to roll back since the previous one was never applied to a shared environment. |
| BC-04 | `JsonObjectConverter` / `JsonObjectComparer` deleted | Internal repository utility — no public callers. |
| BC-05 | Strict typed properties added per §2 | New optional fields on the wire (per `ProductResponse.Metadata`, etc.). No breaking change since prior shape had no equivalent fields. |

---

## 6. Acceptance criteria

A1. After the corrective is applied, every parent entity exposes:
  - `Metadata` of its strict typed class (`OwnsOne(...).ToJson()` jsonb column), and
  - `ExtensionData` as a separate native `jsonb` scalar column.
A2. A query like `SELECT * FROM "Products" WHERE "ExtensionData" @> '{"foo":"bar"}'` parses without error.
A3. `JsonObjectConverter.cs` no longer exists in the repository.
A4. `dotnet build POS.API` returns 0 errors.
A5. Exactly one migration covers the typed metadata foundation (the previous one is removed and replaced).
A6. The 5 Metadata classes carry exactly the typed properties listed in §2 — no extras, no empties.

---

**End of design document. Awaiting explicit confirmation before applying the corrective.**
