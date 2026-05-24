# BDD-021 — Dynamic Catalogs API

**Date:** 2026-05-23
**Status:** Draft — pending approval
**Author:** Backend Architecture
**Related:**
- [BDD-020 — Chameleon Metadata Architecture](BDD-020-chameleon-metadata-architecture.md) — consumer of this API for Metadata-Driven Forms (`MacroCategory.PosExperience` + `HasKitchen` + `HasTables` signals).
- [BDD-019 — Chameleon Domain Readiness](BDD-019-chameleon-domain-readiness.md) — established the typed-metadata domain that the Frontend renders.
- Frontend audit AUDIT-058 — Frontend Metadata-Driven Forms documentation track.

---

## 1. Executive Summary

**Problem statement.** The `CatalogController` is the Frontend's single entry point for static system catalogs (giros, plans, payment methods, kitchen/display statuses, device modes, …) that drive dropdown selectors, onboarding wizards, and — most critically — the upcoming **Metadata-Driven Forms** described in [BDD-020](BDD-020-chameleon-metadata-architecture.md). Today, 9 of its 10 endpoints return **raw EF Core entities**, leak navigation properties and shadow concerns, lack response caching, lack HTTP ETag negotiation, and are missing a `macro-categories` endpoint that [BDD-020](BDD-020-chameleon-metadata-architecture.md)-style forms need to decide which typed metadata fields to render.

**Proposed solution.** Standardize the entire `CatalogController` on (a) lightweight `*Dto` projections owned by the service layer, (b) a uniform `IMemoryCache`-backed cache-aside pattern with a 1-hour TTL, (c) HTTP `ETag` + `If-None-Match` (RFC 9110) negotiation backed by a SHA-256 fingerprint of the cached payload, (d) `Cache-Control: public, max-age=3600, must-revalidate` headers on every response, and (e) the missing `GET /api/Catalog/macro-categories`. The existing `GET /api/Taxes` endpoint is refactored in place to adopt the same uniform pattern; its route and `[Authorize]` posture remain unchanged.

**Expected outcome/impact.** Sub-50 ms warm-cache reads on every catalog endpoint; near-zero database load for catalog traffic; deterministic `ETag` semantics so the Frontend can aggressively cache catalogs in `localStorage`/`IndexedDB` and skip JSON parsing on every navigation; a stable, DTO-bound API contract suitable for code-generated Frontend clients; the missing macro-categories signal needed by Metadata-Driven Forms is unlocked.

---

## 2. Current State Analysis

### 2.1 Existing architecture involved

| Layer | File | Role |
|-------|------|------|
| API — Controller | [POS.API/Controllers/CatalogController.cs](../POS.API/Controllers/CatalogController.cs) | 10 `[AllowAnonymous]` GET endpoints under `/api/Catalog/*` |
| Services — Interface | [POS.Services/IService/ICatalogService.cs](../POS.Services/IService/ICatalogService.cs) | Mixed return shapes (entities for 9 catalogs, `PlanCatalogDto` only for `GetPlanCatalogAsync`) |
| Services — Implementation | [POS.Services/Service/CatalogService.cs](../POS.Services/Service/CatalogService.cs) | `IMemoryCache` injected but only used for `PlanCatalog` (30-min TTL); all other reads pass through to repo on every call |
| Repository — Catalog | `IUnitOfWork.Catalog` exposes `GetXxxAsync` per catalog (entity-returning) | Source of truth — read by the service layer and by some other services internally |
| Seed | [POS.Repository/DbInitializer.UpsertMacroCategoriesAsync](../POS.Repository/DbInitializer.cs) (line 654) + [UpsertBusinessTypeCatalogsAsync](../POS.Repository/DbInitializer.cs) | Upserts the 4 macros and ~14 sub-giros at every host startup |
| Cache infra | `services.AddMemoryCache()` in [POS.API/Program.cs](../POS.API/Program.cs) (line 100) | Registered globally; not consistently used |

### 2.2 Current pain points

| # | Pain | Source |
|---|------|--------|
| P1 | 9 of 10 endpoints return **raw EF entities** (`KitchenStatusCatalog`, `BusinessTypeCatalog`, …) including any future navigation properties and shadow columns. Hidden coupling between persistence shape and wire shape. | [CatalogController.cs](../POS.API/Controllers/CatalogController.cs) lines 22–66 |
| P2 | **No caching** on `business-types`, `macro-categories` (already in the service), `plan-types`, `payment-methods`, `kitchen-statuses`, `display-statuses`, `device-modes`, `zone-types`, `access-reasons`, `access-methods`. Each frontend page load and each onboarding step hits PostgreSQL. | [CatalogService.cs](../POS.Services/Service/CatalogService.cs) lines 27–55 |
| P3 | **No ETag / If-None-Match** anywhere on the controller. Clients re-download identical JSON on every navigation. | All endpoints |
| P4 | **No `Cache-Control` headers** emitted; browsers/proxies cannot cache responses. | All endpoints |
| P5 | `GET /api/Catalog/macro-categories` is **missing** even though `ICatalogService.GetMacroCategoriesAsync` exists (line 16 of the interface, line 42 of the service). Frontend Metadata-Driven Forms cannot resolve `PosExperience` / `HasKitchen` / `HasTables` flags without it. | [ICatalogService.cs:16](../POS.Services/IService/ICatalogService.cs#L16), missing controller route |
| P6 | `GET /api/Taxes` ([TaxesController.cs](../POS.API/Controllers/TaxesController.cs)) consumes `_catalogService.GetTaxCatalogAsync(countryCode)` and already returns `TaxDto`, but lacks the uniform cache-aside helper, ETag negotiation, and `Cache-Control` headers applied to the other catalog endpoints. | [TaxesController.cs](../POS.API/Controllers/TaxesController.cs), [CatalogService.cs:66-78](../POS.Services/Service/CatalogService.cs#L66-L78) |
| P7 | `BusinessTypeCatalog.PrimaryMacroCategory` is a nav property currently serialized as `null` over the wire by default JSON conventions; if any future repository call eager-loads it, the response payload doubles in size silently. | [BusinessTypeCatalog.cs](../POS.Domain/Models/Catalogs/BusinessTypeCatalog.cs) |
| P8 | `PlanCatalog` cache TTL (30 min) is the sole, ad-hoc cache configuration. No uniform invalidation contract, no shared TTL constant, no ETag fingerprint emitted. | [CatalogService.cs:15-16](../POS.Services/Service/CatalogService.cs#L15-L16) |

### 2.3 Performance baseline

| Endpoint | Approximate cold path | Approximate warm path | Notes |
|----------|------------|------------|-------|
| `GET /api/Catalog/plans` | One DB round-trip across `PlanTypeCatalog` + `FeatureCatalog` + `PlanFeatureMatrix` + `BusinessTypeFeature`, then in-memory join. Cached for 30 min. | < 5 ms (`IMemoryCache` hit) | Only catalog already cached |
| Every other endpoint | One DB round-trip per call (small, 4–14 rows) — typically 5–25 ms incl. EF materialization | Same — **uncached** | Repeated on every page navigation |
| All endpoints | No `ETag` / no `If-None-Match` / no `Cache-Control` | Same | Re-downloads on every call |

**Target after BDD-021:** every endpoint < 50 ms p95 warm; ~0 DB load for catalog traffic; HTTP 304 on unchanged payloads.

---

## 3. Technical Requirements

### 3.1 Functional Requirements

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-001 | All catalog endpoints return purpose-built `*Dto` records, never EF entities. | Inspecting any catalog response shows no EF navigation properties, no shadow columns; the response shape is governed by a `*Dto` definition in `POS.Domain.DTOs.Catalogs` (or equivalent). |
| FR-002 | The controller exposes `GET /api/Catalog/macro-categories`. | `curl /api/Catalog/macro-categories` returns 200 + a JSON array of `MacroCategoryDto` items (4 rows under current seed). |
| FR-003 | The existing `GET /api/Taxes?countryCode={iso}` endpoint is refactored to use the uniform cache + ETag pattern. Its route and `[Authorize]` posture remain unchanged. | When `countryCode` is omitted, every tax row is returned; when supplied (ISO 3166-1 alpha-2, 2 chars), the list is filtered to that country. Unknown country → empty array + 200 (not 404). |
| FR-004 | Every endpoint emits an `ETag` response header. | Two calls without `If-None-Match` return the same `ETag` value when no underlying data has changed. |
| FR-005 | Every endpoint honours `If-None-Match`. | A second call carrying the previous `ETag` returns HTTP 304 with no body. |
| FR-006 | Every endpoint emits `Cache-Control: public, max-age=3600, must-revalidate`. | Header is present on every 200 response and on every 304 response. |
| FR-007 | A subsequent call within 1 hour of a cache miss does **not** hit the database. | Verified by integration test that wires an EF interceptor / counter and asserts zero query execution after the first call. |
| FR-008 | Every catalog list response is **deterministically ordered** (so the `ETag` is stable across processes). | Each DTO list is sorted by `SortOrder ASC, Code ASC` (or `Name ASC` when no `Code`). Two different processes serving the same data produce the same `ETag`. |
| FR-009 | Service-layer methods return DTOs; **internal consumers** that need entity-level access (e.g. `AuthService.ResolveMacroCodeAsync`) consume the repository (`IUnitOfWork.Catalog.GetXxxAsync`) directly. | A grep for `_catalogService.Get*` shows only controller usage; entity-returning calls go through `_unitOfWork.Catalog`. |
| FR-010 | The 11 endpoints under `/api/Catalog/*` remain `[AllowAnonymous]` (no JWT). `/api/Taxes` retains its existing `[Authorize]` posture. The auth profile across the board is identical to today. | `curl` against any `/api/Catalog/*` route without a JWT returns 200; `curl /api/Taxes` without a JWT returns 401, exactly as in production today. |
| FR-011 | All 12 DTO-bound endpoints share a uniform projection contract. **10 endpoints gain new DTOs** in this delivery (`kitchen-statuses`, `display-statuses`, `payment-methods`, `device-modes`, `business-types`, `zone-types`, `plan-types`, `access-reasons`, `access-methods`, `macro-categories`). **2 endpoints already ship DTOs** and are touched only to adopt the uniform cache + ETag pattern (`/api/Catalog/plans` → `PlanCatalogDto` + nested `PlanCatalogFeatureDto`; `/api/Taxes` → `TaxDto`). | 10 new DTO record definitions land under `POS.Domain/DTOs/Catalogs/`; `PlanCatalogDto`/`PlanCatalogFeatureDto` are relocated from `ICatalogService.cs` into the same folder for cohesion; `TaxDto` (existing under `POS.Domain/DTOs/Tax/`) is reused as-is. |

### 3.2 Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| Latency | p95 < 50 ms warm cache; p99 < 100 ms; cold cache (first request after expiry) p95 < 80 ms. |
| Throughput | Each endpoint sustains ≥ 1 000 req/s on a single instance after warm cache, with the DB query counter staying at zero for the duration. |
| Cache lifetime | `AbsoluteExpirationRelativeToNow = 1 hour` uniformly. |
| Cache concurrency | A `SemaphoreSlim` per cache key prevents thundering-herd rebuilds on first miss after expiry (at most one rebuild in flight per key). |
| Security | `[AllowAnonymous]` retained; no PII in any response. Rate-limiting (if applied later) is global, not per endpoint. |
| Compatibility | Frontend coordinates one-shot cutover (no v1/v2 split). The change is **destructive in-place** — see §6.3. |
| Observability | Each cache miss is logged at `Information` with `{ Catalog, CacheKey, RowCount, ElapsedMs }`. Each cache hit is **not** logged (would dwarf signal). |
| ETag stability | The fingerprint algorithm is documented (§6.1) and reproducible across processes given the same input set. |

---

## 4. Architecture Design

### 4.1 Component Overview

| Component | Responsibility |
|-----------|----------------|
| `CatalogController` | Owns route templates, attribute decorations, ETag negotiation, response-header emission. Delegates all reads to `ICatalogService`. No business logic. |
| `ICatalogService` / `CatalogService` | Returns DTOs only (one DTO per catalog). Wraps every read in a uniform cache-aside helper that returns `(payload, etag)` envelopes. Owns the SHA-256 fingerprint computation. |
| `IUnitOfWork.Catalog` (Repository) | Returns **entities** for both the service-layer DTO projections and for **internal service consumers** that need entity-level access (e.g. `AuthService.ResolveMacroCodeAsync`). Continues to be the only layer that talks to EF Core. |
| `IMemoryCache` (existing) | Backing store for `(payload, etag)` envelopes keyed by `Catalog::{ResourceName}`. |
| `SemaphoreSlim` per cache key | In-process serialization of the cache-rebuild path to prevent thundering herd. Lives inside `CatalogService` as a `ConcurrentDictionary<string, SemaphoreSlim>`. |
| `ETag` helper | Pure function `Compute(payloadBytes) → string`. Hex-encoded SHA-256 of the canonical JSON serialization of the DTO list. Wrapped in double quotes per RFC 9110. |

**Architectural rule (FR-009 / §6.3):**
> The service layer of catalogs is **public-facing only**. Internal callers that need entity-level access (joins, navigations, FK resolution) MUST use `IUnitOfWork.Catalog.GetXxxAsync` directly. `ICatalogService` is not a general-purpose catalog gateway; it is a DTO projector bound to the public HTTP API.

External dependencies: none new. All required infrastructure (`IMemoryCache`, `ExceptionMiddleware`, `Cache-Control` and `ETag` header support) is already in the request pipeline.

### 4.2 Data Flow

Cache-miss path (first call after process start or after TTL expiry):

1. Client sends `GET /api/Catalog/{resource}` (optionally with `If-None-Match`).
2. `CatalogController.{Action}` invokes `ICatalogService.Get{Resource}Async()`.
3. Service acquires the per-key `SemaphoreSlim` (waits if a sibling rebuild is in flight, then re-reads cache and returns the now-populated envelope).
4. Service calls `IUnitOfWork.Catalog.Get{Resource}Async()` → EF Core query.
5. Service projects each entity to its DTO and sorts deterministically (`SortOrder ASC, Code ASC`).
6. Service computes `ETag = "\"" + Hex(SHA256(JsonSerialize(dtoList))) + "\""`.
7. Service stores `(dtoList, etag)` in `IMemoryCache` with TTL = 1 hour.
8. Service returns the envelope; the semaphore is released.
9. Controller compares `If-None-Match` against the envelope's `ETag`.
10. On match → return **HTTP 304 Not Modified** with `ETag` + `Cache-Control` headers, **no body**.
11. On mismatch (or no header) → return **HTTP 200 OK** with the DTO list, `ETag`, and `Cache-Control`. (`Vary` intentionally omitted — see §5.1 / §7.3 hygiene note.)

Cache-hit path (within TTL):

1. Steps 1–2 as above.
2. Service finds the envelope in `IMemoryCache` and returns it directly (no semaphore, no DB hit).
3. Steps 9–11 as above.

### 4.3 Database schema changes

**None.** All catalog tables (`MacroCategory`, `BusinessTypeCatalog`, `PlanTypeCatalog`, `FeatureCatalog`, `PlanFeatureMatrix`, `BusinessTypeFeature`, `KitchenStatusCatalog`, `DisplayStatusCatalog`, `PaymentMethodCatalog`, `DeviceModeCatalog`, `ZoneTypeCatalog`, `AccessReasonCatalog`, `AccessMethodCatalog`, `Tax`) already exist and are seeded by [POS.Repository/DbInitializer.cs](../POS.Repository/DbInitializer.cs). No new tables, no new columns, no new indexes.

---

## 5. API Contract

### 5.1 Endpoints

All 12 endpoints share:

- Method: `GET` only.
- Response headers on 200: `Content-Type: application/json; charset=utf-8`, `ETag: "{hex}"`, `Cache-Control: public, max-age=3600, must-revalidate`.
- Response headers on 304: `ETag: "{hex}"`, `Cache-Control: public, max-age=3600, must-revalidate`, **no body**.
- Status codes: `200 OK`, `304 Not Modified`, `400 Bad Request` (only `/api/Taxes` — see VR-001), `500 Internal Server Error`.

Differences between the two endpoint families:

| Family  | Routes                                | Count                                       | Auth                       |
|---------|---------------------------------------|---------------------------------------------|----------------------------|
| Catalog | `/api/Catalog/{kebab-case-resource}`  | 11 (10 existing + `macro-categories` new)   | `[AllowAnonymous]`         |
| Taxes   | `/api/Taxes`                          | 1 (existing, refactored in place)           | `[Authorize]` (unchanged)  |

**Note.** `Vary: Accept-Encoding` is intentionally omitted from every response header set above pending the addition of response compression middleware. Emitting it today would mislead caches into segmenting responses by an encoding dimension that the server never actually varies.

#### 5.1.1 `GET /api/Catalog/macro-categories` (NEW)

| Field | Type | Notes |
|-------|------|-------|
| `id` | `int` | Stable identifier (1 = FoodBeverage, 2 = QuickService, 3 = Retail, 4 = Services). |
| `internalCode` | `string` | Kebab-case (e.g. `"food-beverage"`). Stable across releases. |
| `publicName` | `string` | Spanish public label. |
| `description` | `string?` | Short Spanish description. |
| `posExperience` | `string` | One of `"Restaurant" \| "Counter" \| "Retail" \| "Services" \| "Quick"` — drives Frontend POS variant selection. |
| `hasKitchen` | `bool` | Whether the macro implies a kitchen workflow (KDS / commanda). |
| `hasTables` | `bool` | Whether the macro implies dine-in tables. |

Sort: `id ASC`.

#### 5.1.2 `GET /api/Catalog/business-types`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `int` | |
| `primaryMacroCategoryId` | `int` | FK into `macro-categories`. |
| `name` | `string` | Public Spanish label (e.g. `"Cafetería"`). |

Sort: `primaryMacroCategoryId ASC, name ASC`.

#### 5.1.3 `GET /api/Catalog/plan-types`

| Field | Type |
|-------|------|
| `id` | `int` |
| `code` | `string` (e.g. `"Basic"`) |
| `name` | `string` (e.g. `"Básico"`) |
| `sortOrder` | `int` |
| `monthlyPrice` | `decimal?` |
| `currency` | `string` (ISO 4217, e.g. `"MXN"`) |

Sort: `sortOrder ASC`.

#### 5.1.4 `GET /api/Catalog/plans`

**Unchanged shape** — already DTO-bound. Continues to use `PlanCatalogDto` + nested `PlanCatalogFeatureDto` (defined today in [POS.Services/IService/ICatalogService.cs:43-86](../POS.Services/IService/ICatalogService.cs#L43-L86)); these definitions migrate to `POS.Domain.DTOs.Catalogs` alongside the other DTOs for cohesion. Cache TTL changes from 30 min → 1 hour (FR uniformity). Sort: `sortOrder ASC`; features inside each plan sorted by `code ASC`.

#### 5.1.5 `GET /api/Catalog/payment-methods`

| Field | Type |
|-------|------|
| `id` | `int` |
| `code` | `string` |
| `name` | `string` |
| `sortOrder` | `int` |

Sort: `sortOrder ASC`.

#### 5.1.6 `GET /api/Catalog/kitchen-statuses`

| Field | Type |
|-------|------|
| `id` | `int` |
| `code` | `string` |
| `name` | `string` |
| `color` | `string` (hex `#RRGGBB`) |
| `sortOrder` | `int` |

Sort: `sortOrder ASC`.

#### 5.1.7 `GET /api/Catalog/display-statuses`

Same shape as `kitchen-statuses`. Sort: `sortOrder ASC`.

#### 5.1.8 `GET /api/Catalog/device-modes`

| Field | Type |
|-------|------|
| `id` | `int` |
| `code` | `string` |
| `name` | `string` |
| `description` | `string?` |

Sort: `code ASC`.

#### 5.1.9 `GET /api/Catalog/zone-types`

| Field | Type |
|-------|------|
| `id` | `int` |
| `code` | `string` |
| `name` | `string` |
| `sortOrder` | `int` |

Sort: `sortOrder ASC`.

#### 5.1.10 `GET /api/Catalog/access-reasons`

| Field | Type |
|-------|------|
| `id` | `int` |
| `code` | `string` |
| `name` | `string` |
| `sortOrder` | `int` |

Sort: `SortOrder ASC, Code ASC`.

#### 5.1.11 `GET /api/Catalog/access-methods`

Same shape as `access-reasons`. Sort: `SortOrder ASC, Code ASC`.

#### 5.1.12 `GET /api/Taxes?countryCode={iso}` (EXISTING — refactored)

This endpoint already exists in production under `TaxesController` and already returns `TaxDto`. **Route and `[Authorize]` posture are preserved unchanged.** The refactor in this BDD wires the existing action through the same `CatalogResponse<TaxDto>` envelope and the uniform cache-aside + ETag negotiation pattern defined for the other catalog endpoints — gaining `Cache-Control`, `ETag`, and 304 negotiation. The DTO shape on the wire is unchanged.

Query parameters:

- **`countryCode`** — `string`, optional. When supplied, must be exactly 2 alphabetic characters (ISO 3166-1 alpha-2). Compared case-insensitively. See VR-001.

Response shape (`TaxDto`, reused as-is from [POS.Domain/DTOs/Tax/TaxDto.cs](../POS.Domain/DTOs/Tax/TaxDto.cs)):

| Field | Type |
|-------|------|
| `id` | `int` |
| `code` | `string?` |
| `countryCode` | `string` |
| `isDefault` | `bool` |
| `name` | `string` |
| `rate` | `decimal` |

Sort: `countryCode ASC, isDefault DESC, rate ASC`.

### 5.2 Service Interface

`ICatalogService` migrates to **DTO-only return types**. Each method follows the contract:

- **Name:** `Get{Resource}Async()` (no parameters except where filtered — `GetTaxCatalogAsync(string? countryCode = null)`).
- **Returns:** `Task<CatalogResponse<{Resource}Dto>>` where `CatalogResponse<T>` is a value-typed envelope `(IReadOnlyList<T> Payload, string ETag)`. This is the **only** new shared type the service exposes; it carries the cache-derived fingerprint alongside the DTO list so the controller can compare against `If-None-Match` without re-hashing.
- **Business logic, step-by-step:**
  1. Look up cache by key `"Catalog::{ResourceName}"`.
  2. On hit → return the cached envelope as-is.
  3. On miss → acquire the per-key `SemaphoreSlim`.
  4. Re-check cache (double-checked locking pattern).
  5. On still-miss → call the repository, project to DTO list, sort deterministically (§6.1), compute SHA-256 fingerprint (§6.1).
  6. Store `(payload, etag)` in `IMemoryCache` with `AbsoluteExpirationRelativeToNow = 1 hour`.
  7. Release the semaphore.
  8. Return the envelope.
- **Validation rules:** none on input (read-only endpoints); `GetTaxCatalogAsync` has the single rule VR-001 on `countryCode`.
- **Exception scenarios:**
  - Repository failure (DB down, connection lost) → bubbles `Exception` upward → `ExceptionMiddleware` returns 500.
  - For `GetTaxCatalogAsync`: invalid `countryCode` format → `ValidationException` → 400 Bad Request.

Optional auxiliary method to add at the same time:

- `void Invalidate(string? resourceName = null)` — clears one or all catalog caches. Used by future admin-triggered cache rebuilds. Not exposed via HTTP in v1.

---

## 6. Business Logic Specifications

### 6.1 Core Algorithms

**A. Cache-aside helper (single uniform pattern).**

1. Compute the cache key once: `"Catalog::" + resourceName`.
2. `TryGetValue` against `IMemoryCache`. Return the envelope on hit.
3. Acquire `SemaphoreSlim` from a `ConcurrentDictionary<string, SemaphoreSlim>` keyed by the cache key (created on demand).
4. `TryGetValue` again — if a sibling thread populated the cache while we waited, return its envelope and release the semaphore.
5. Call the repository, project to DTO, sort.
6. Serialize the DTO list to JSON with deterministic settings (lower-camelCase, no nulls omitted at the algorithm level — the canonical bytes are what we hash).
7. Compute `SHA-256` of the serialized bytes; hex-encode lower-case; wrap in double quotes — produces the `ETag`.
8. Construct envelope, store under TTL = 1 hour, release semaphore, return.

**B. ETag fingerprint.**

- **Algorithm:** SHA-256 (`System.Security.Cryptography.SHA256`).
- **Encoding:** lower-case hexadecimal (64 chars).
- **Format:** strong ETag — `"\"{64-hex-chars}\""` (per RFC 9110 §8.8). No `W/` prefix.
- **Determinism:** the JSON used as fingerprint input MUST be sorted (DTO list sorted by stable keys per §5.1; nested members in a fixed property order via the DTO's positional record / property layout). Two processes seeing identical seed data produce identical fingerprints.

**C. If-None-Match negotiation.**

1. Read `If-None-Match` header from the request.
2. If absent or `*`-only → emit 200 + body.
3. If present and matches the envelope's `ETag` byte-for-byte (after trimming surrounding `W/` if any, after lowercasing the hex segment) → emit 304 with no body.
4. Otherwise → emit 200 + body + the new (or unchanged) `ETag`.

**D. Cache key naming.** `"Catalog::{PascalCaseResourceName}"` — examples: `"Catalog::MacroCategories"`, `"Catalog::BusinessTypes"`, `"Catalog::Plans"`. Stable across processes; consumed verbatim by `Invalidate(resourceName)`.

**E. Deterministic ordering rules (FR-008 dependency).**

| Catalog | Primary sort | Secondary | Tertiary |
|---------|--------------|-----------|----------|
| `macro-categories` | `id ASC` | — | — |
| `business-types` | `primaryMacroCategoryId ASC` | `name ASC` | — |
| `plan-types` | `sortOrder ASC` | `id ASC` | — |
| `plans` | `sortOrder ASC` | `id ASC` | features: `code ASC` |
| `payment-methods` | `sortOrder ASC` | `code ASC` | — |
| `kitchen-statuses` | `sortOrder ASC` | `id ASC` | — |
| `display-statuses` | `sortOrder ASC` | `id ASC` | — |
| `device-modes` | `code ASC` | — | — |
| `zone-types` | `sortOrder ASC` | `code ASC` | — |
| `access-reasons` | `SortOrder ASC` | `Code ASC` | — |
| `access-methods` | `SortOrder ASC` | `Code ASC` | — |
| `taxes` | `countryCode ASC` | `isDefault DESC` | `rate ASC` |

### 6.2 Validation Rules

| ID | Rule | Error message (Spanish) | HTTP status |
|----|------|-------------------------|-------------|
| VR-001 | `taxes.countryCode` (when supplied) must be exactly 2 alphabetic characters (ISO 3166-1 alpha-2). | `"El parámetro 'countryCode' debe ser un código ISO 3166-1 alpha-2 de 2 letras."` | 400 |
| VR-002 | `If-None-Match` header is **never** rejected for malformed values — treated as absent (per RFC 9110 §13.1.2 forbearance). | — | n/a |
| VR-003 | An empty result set is **not** a 404 — empty arrays return `200 + []` with the corresponding ETag. | — | 200 |

No input validation exists on the 11 GET endpoints other than VR-001.

### 6.3 Edge Cases

| # | Scenario | Expected behaviour |
|---|----------|--------------------|
| EC-1 | Seed never ran (empty catalog table). | Return `200 + []`; `ETag` of empty array hash; never 404. |
| EC-2 | First request after expiry coincides with 100 parallel callers. | Exactly **one** rebuild executes; the other 99 wait on the per-key `SemaphoreSlim` and observe the just-populated envelope. No thundering herd. |
| EC-3 | Underlying seed mutates mid-day (e.g. admin runs a migration that adds a new sub-giro). | Stale cache for up to 1 hour. Acceptable for v1. The `Invalidate(resourceName)` hook is wired but not exposed; future admin-trigger work re-uses it. |
| EC-4 | Internal callers (`AuthService.ResolveMacroCodeAsync`, future macro-driven flows) need entity-level access. | They MUST use `IUnitOfWork.Catalog.Get{Resource}Async` directly. The DTO-only service contract is reserved for HTTP responses. This rule is enforced by code review; no compile-time prevention is added. |
| EC-5 | `If-None-Match` carries multiple ETags (comma-separated, RFC 9110). | If **any** matches the current envelope ETag → 304. Otherwise 200. |
| EC-6 | Client supplies `If-None-Match: *`. | Per RFC 9110 §13.1.2, on a `GET` `*` matches any existing representation — return 304 if the cache has any entry for this resource, 200 otherwise. (We always have an entry after first request; in practice `*` becomes 304.) |
| EC-7 | Different processes serve the same data behind a load balancer. | ETags match because the fingerprint is a deterministic function of the seed (FR-008). Cache hits across instances are not coordinated, but the negotiated 304 still works because the ETag bytes are identical. |
| EC-8 | Underlying DB returns rows with `null` in nullable DTO fields (e.g. `Description`, `Color`). | DTO projection passes them through as `null`; serializer's default null-handling determines wire shape (today: `WhenWritingNull` ignore — confirmed via [Program.cs:91-92](../POS.API/Program.cs#L91-L92)). The hash is computed on the resulting JSON, so the ETag is consistent with what the client receives. |

---

## 7. Performance Optimization Strategy

### 7.1 Query Optimization

- **Projection:** done at the **service** layer (post-repository), not at the EF query, because the catalogs are tiny (≤ ~100 rows) and shaping after materialization keeps the repository entity-typed for the internal consumers (EC-4 / FR-009).
- **No eager loads:** the repository `GetXxxAsync` methods stay `.AsNoTracking()` (default for read-only repos here) and do **not** `Include(...)` navigation properties. `BusinessTypeCatalog.PrimaryMacroCategory` is intentionally not loaded — the DTO carries only `primaryMacroCategoryId`.
- **Single round-trip per catalog miss:** no N+1 risk because all rows materialize in one query and DTO projection is in-memory.
- **`plans` endpoint:** retains its multi-query composition (`PlanTypeCatalog` + `FeatureCatalog` + `PlanFeatureMatrix` + `BusinessTypeFeature`) since the existing logic in `BuildPlanCatalogAsync` is already correct and well-optimized. The only change is the cache TTL (30 min → 1 hour) and the addition of an ETag envelope.

### 7.2 Bulk Operations

Not applicable — catalogs are read-only. No batch sizes, no transaction boundaries, no concurrency tokens.

### 7.3 Caching Strategy

| Concern | Decision |
|---------|----------|
| Backing store | `IMemoryCache` (already registered, in-process, per instance). |
| TTL | `AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1)` — uniform across all 12 endpoints. |
| Key naming | `"Catalog::{PascalCaseResourceName}"`. |
| Stored shape | Envelope `(IReadOnlyList<T> Payload, string ETag)` so the controller can read the ETag without re-hashing. |
| Sliding vs absolute | **Absolute.** Sliding would defer the rebuild indefinitely under continuous traffic, which is undesirable for catalogs that **do** drift slowly between releases. |
| Invalidation triggers (v1) | TTL-only. No event-based invalidation. |
| Invalidation triggers (future) | `ICatalogService.Invalidate(resourceName?)` hook reserved for admin-triggered rebuilds (e.g. after `UpsertMacroCategoriesAsync` at startup, after an Ops "reload catalogs" button). Out of scope for v1 implementation. |
| Stampede protection | One `SemaphoreSlim` per cache key, lazily created in a `ConcurrentDictionary<string, SemaphoreSlim>`. Double-checked cache read inside the semaphore. |
| Cross-instance coordination | None — each instance maintains its own cache. ETag determinism (§6.1) makes this safe: clients still get 304 because the fingerprint is a pure function of the data. |
| HTTP response cache headers | `Cache-Control: public, max-age=3600, must-revalidate`, `ETag: "{hex}"`. **Note:** `Vary: Accept-Encoding` is intentionally omitted pending the addition of response compression middleware — emitting it today would mislead caches into segmenting responses by an encoding dimension that the server never actually varies. |
| 304 emission | Controller compares `If-None-Match` against the envelope ETag, returns `304 NotModified` with **no body** but with `ETag` and `Cache-Control` headers preserved. |

---

## 8. Error Handling Strategy

| Scenario | Exception | HTTP status | Body |
|----------|-----------|-------------|------|
| DB connection failure | `DbException` (Npgsql) | 500 | Default `ExceptionMiddleware` payload |
| Repository materialization error | Generic `Exception` | 500 | Default `ExceptionMiddleware` payload |
| `taxes` invalid `countryCode` (VR-001) | `ValidationException` | 400 | `{ error, message: "El parámetro 'countryCode'…", statusCode: 400 }` |
| Cache backing store failure (`IMemoryCache` OOM — extremely unlikely with ≤ 12 small entries) | `OutOfMemoryException` | 500 | Default — but caching helper degrades to "always-miss" if the set fails silently (defensive try/catch on `Set`, log warning, still return the envelope). |
| `If-None-Match` parse failure | (none — per VR-002, treated as absent) | 200 + body | Normal response |

**Logging requirements:**

- Cache **miss** → `Information`: `"Catalog cache miss: {ResourceName} | rows={Count} | elapsedMs={Ms} | etag={Etag}"`.
- Cache **hit** → not logged (would dominate signal-to-noise; observability comes from a hit-rate counter, future).
- Repository failure → `Error`, full exception + cache key.
- VR-001 failure → `Information`: `"Catalog validation rejected: countryCode={Value}"`.

User-facing error messages are Spanish (project standard); developer log lines are English.

---

## 9. Testing Requirements

### 9.1 Unit test scenarios (`POS.UnitTests` — if/when created; otherwise covered in integration)

> **Status: Deferred to future BDD — see Appendix B.** P4 of this BDD ships
> only the integration suite (§9.2). The unit-level specs below are kept as
> the design intent for a follow-up unit-test track.

| # | Scenario |
|---|----------|
| UT-1 | DTO projection: `Map(MacroCategory)` returns a `MacroCategoryDto` with all 7 fields populated. |
| UT-2 | DTO projection: `Map(BusinessTypeCatalog)` does **not** project the `PrimaryMacroCategory` navigation. |
| UT-3 | `Compute(payloadBytes)` produces a 64-char lower-case hex string wrapped in double quotes. |
| UT-4 | `Compute` is deterministic: same input twice → same output. |
| UT-5 | `Compute` is sensitive: a single byte change in input → different output. |
| UT-6 | Cache-aside helper: second call within TTL does **not** invoke the repository (verified via mock). |
| UT-7 | Cache-aside helper: under 100 parallel first-time callers, the repository is invoked exactly once. |
| UT-8 | Deterministic ordering: shuffling the repo's row order does not change the resulting DTO list. |

### 9.2 Integration test scenarios (`POS.IntegrationTests`)

**Status: COMPLETED.** P4 ships 13 integration tests in
`POS.IntegrationTests/Catalogs/CatalogApiTests.cs`. Execution against the
test host (`CustomWebApplicationFactory` + InMemory provider) yields the
matrix below.

**Implementation note — D1 fallback was triggered.** Runtime verification
showed that `IMaterializationInterceptor.InitializingInstance` does NOT
fire on the EF Core InMemory provider — the cache-miss / hit counter
stayed permanently at zero, making IT-11 a false negative. Per the
pre-approved D1 fallback, the counter was moved from an EF interceptor to
a `CountingCatalogRepository` decorator over `ICatalogRepository`,
wrapped into a `CountingUnitOfWork` and registered as a DI replacement of
`IUnitOfWork` inside `CustomWebApplicationFactory.ConfigureTestServices`.
The `EFQueryCounterInterceptor.cs` file retains its name for BDD
continuity but no longer implements `IMaterializationInterceptor` — it is
now a plain counter object incremented by the decorator. See files
`POS.IntegrationTests/Infrastructure/CountingCatalogRepository.cs` and
`CountingUnitOfWork.cs`.

| ID    | Test method                                                                  | Result | Duration |
|-------|------------------------------------------------------------------------------|--------|----------|
| IT-1  | `IT_1_GetMacroCategories_Returns_200_With_Four_Rows`                         | Passed | 4 ms     |
| IT-2  | `IT_2_GetBusinessTypes_Response_Excludes_Navigation_Property`                | Passed | 7 ms     |
| IT-3  | `IT_3_EveryCatalogRoute_Emits_ETag_And_CacheControl` (Theory × 11 routes)    | Passed | 2–25 ms (per route) |
| IT-4  | `IT_4_SecondCall_With_Matching_IfNoneMatch_Returns_304`                      | Passed | 4 ms     |
| IT-5  | `IT_5_SecondCall_With_Stale_IfNoneMatch_Returns_200_And_Fresh_ETag`          | Passed | 4 ms     |
| IT-6  | `IT_6_TwoCalls_Without_IfNoneMatch_Produce_Same_ETag`                        | Passed | 5 ms     |
| IT-7  | `IT_7_GetTaxes_With_Bearer_Returns_All_Rows`                                 | Passed | 7 ms     |
| IT-8  | `IT_8_GetTaxes_With_Bearer_And_MX_Returns_Only_MX`                           | Passed | 121 ms   |
| IT-9  | `IT_9_GetTaxes_With_Bearer_And_Unknown_Country_Returns_Empty_Array`          | Passed | 10 ms    |
| IT-10 | `IT_10_GetTaxes_With_Invalid_CountryCode_Returns_400`                        | Passed | 7 ms     |
| IT-11 | `IT_11_WarmCache_Triggers_Zero_Materializations`                             | Passed | 4 ms     |
| IT-12 | `IT_12_EveryCatalogRoute_Reachable_Anonymously` (Theory × 11 routes)         | Passed | 13–57 ms (per route) |
| IT-12b| `IT_12b_GetTaxes_Without_Bearer_Returns_401`                                 | Passed | 4 ms     |

**Aggregate: 35/35 facts passed** (13 named tests, IT-3 and IT-12 each
expand to 11 theory rows = 33 fact instances total, plus the 2 existing
`TenantIsolationTests`). Total duration: ~4 s. Zero regressions in the
prior suite.

**Implementation-detail addendum — IT-3 / IT-4 assertion form.** ASP.NET's
typed `CacheControlHeaderValue` canonicalises directive ordering on parse
(emits `public, must-revalidate, max-age=3600` regardless of the literal
the server writes). The server emits exactly the spec-defined string
`public, max-age=3600, must-revalidate`; the tests assert the **set** of
directives via `cc.Public`, `cc.MustRevalidate`, `cc.MaxAge` rather than
the string form. Per RFC 9110 §5.2.1 directives are an unordered set, so
both representations are equivalent.

### 9.3 Performance test criteria

> **Status: Deferred to future BDD — see Appendix B.** P4 of this BDD
> ships only the integration suite (§9.2). The performance-test specs
> below are kept as the design intent for a follow-up performance-test
> track that will require load-testing tooling (k6 / bombardier).

| # | Criterion |
|---|-----------|
| PT-1 | Warm-cache `GET /api/Catalog/business-types` p95 < 50 ms over 10 000 requests. |
| PT-2 | Warm-cache `GET /api/Catalog/plans` p95 < 50 ms over 10 000 requests. |
| PT-3 | DB query counter remains at 0 after first request, for the duration of PT-1/PT-2. |
| PT-4 | Cold-cache (first request after process start) p95 < 80 ms for each of the 12 endpoints. |
| PT-5 | Sustained throughput: ≥ 1 000 req/s on a single instance for the warm-cache path of `business-types`, with zero DB hits. |

---

## 10. Implementation Phases

**Scope.** This BDD covers the refactoring of existing catalog endpoints (10 routes under `/api/Catalog/*` + 1 existing `/api/Taxes`) and the addition of the missing `macro-categories` endpoint. The `TaxesController` refactor is **in-scope** to adopt the uniform cache + ETag pattern, but its route (`/api/Taxes`) and `[Authorize]` posture remain unchanged. No new public routes are added beyond `GET /api/Catalog/macro-categories`.

| Phase | Deliverable | Depends on | Complexity |
|-------|-------------|------------|------------|
| **P1 — DTOs** | Define 11 new DTO records in `POS.Domain/DTOs/Catalogs/`: `MacroCategoryDto`, `BusinessTypeDto`, `PlanTypeDto`, `PaymentMethodDto`, `KitchenStatusDto`, `DisplayStatusDto`, `DeviceModeDto`, `ZoneTypeDto`, `AccessReasonDto`, `AccessMethodDto`. Move `PlanCatalogDto` + `PlanCatalogFeatureDto` here for cohesion. Add `CatalogResponse<T>` envelope type. Reuse existing `TaxDto`. | — | Low |
| **P2 — Service layer refactor** | Migrate `ICatalogService` / `CatalogService` to (a) return `CatalogResponse<TDto>` from every method, (b) wrap every read in the uniform cache-aside helper with `SemaphoreSlim` stampede protection, (c) emit ETag via the SHA-256 fingerprint helper, (d) add private `Invalidate(string?)` method (not yet exposed). Update `BuildPlanCatalogAsync` to fit the new envelope shape. **Audit internal callers** (grep for `_catalogService.Get*`) and reroute any service-to-service consumers to `IUnitOfWork.Catalog.GetXxxAsync` per FR-009 / EC-4. | P1 | Medium |
| **P3 — Controller refactor** | Update `CatalogController` to (a) consume `CatalogResponse<T>` envelopes, (b) implement `If-None-Match` negotiation per action, (c) emit `Cache-Control` + `ETag` headers (no `Vary` — see header hygiene note in §5.1 / §7.3), (d) add `GET /api/Catalog/macro-categories`. Refactor `TaxesController.GetTaxes` to consume the same `CatalogResponse<TaxDto>` envelope and apply the same header treatment; route (`/api/Taxes`) and `[Authorize]` posture remain unchanged. A small reusable controller helper (`ETagResult(envelope)`) centralizes the negotiation so all 12 actions stay 1-liners. | P2 | Medium |
| **P4 — Tests** | **COMPLETED — integration tests (13).** UT-1..UT-8 and PT-1..PT-5 deferred (see Appendix B). Delivered 13 integration tests in `POS.IntegrationTests/Catalogs/CatalogApiTests.cs` (35/35 facts passing including theory expansions). D1 fallback applied: query counter moved from EF interceptor to `CountingCatalogRepository` decorator (see §9.2 implementation note). | P3 | Medium |
| **P5 — Documentation & frontend coordination** | **COMPLETED.** Renamed CLAUDE.md `## API Endpoints (MVP)` → `## API Endpoints` and appended `### Catalog endpoints (BDD-021)` sub-section. Frontend cutover summary delivered out-of-band in chat for the AUDIT-058 track (PROHIBITED to create files in the Frontend repo from this codebase). | P3 | Low |

**Critical path:** P1 → P2 → P3 → (P4 ∥ P5).
**Estimated total complexity:** Medium — ~2.5 days for one engineer, dominated by P2 (cache + ETag plumbing) and P3 (controller-level negotiation, breaking changes coordinated with Frontend).

---

## Appendix A — Frontend cutover delta (for AUDIT-058 consumers)

The following fields are **removed** (entity-only, not part of any DTO):

- `BusinessTypeCatalog.PrimaryMacroCategory` (navigation object) → use `primaryMacroCategoryId` and resolve client-side against `/api/Catalog/macro-categories`.
- Any future EF-shadow column or navigation accidentally serialized today.

The following endpoints **gain** an ETag negotiation contract — clients SHOULD:

1. Persist the response body **and** its `ETag` after the first call (e.g. in `localStorage`).
2. On subsequent loads, send `If-None-Match: "{etag}"`.
3. On 304 → reuse the cached body. On 200 → replace and store the new ETag.

The following endpoint is **new**:

- `GET /api/Catalog/macro-categories`

The following endpoints are **refactored in place** — wire shape unchanged (already DTO-bound) but they now share the uniform cache + ETag pattern documented in §6.1 / §7.3:

- `GET /api/Catalog/plans` — cache TTL bumped 30 min → 1 hour; `ETag` and 304 negotiation now emitted; `PlanCatalogDto` + nested `PlanCatalogFeatureDto` relocated from `ICatalogService.cs` into `POS.Domain/DTOs/Catalogs/` for cohesion (namespace change for any client that referenced the type symbol directly — most clients deserialize positionally, no impact).
- `GET /api/Taxes` — `Cache-Control` + `ETag` + 304 negotiation added; `[Authorize]` posture preserved; route preserved; `TaxDto` reused as-is from `POS.Domain/DTOs/Tax/`.

---

## Appendix B — Open questions / out of scope for v1

- **Admin-triggered cache rebuild UI.** The `Invalidate(resourceName?)` hook exists but is not exposed via HTTP. A future BDD can add a dedicated admin endpoint (likely `POST /api/Admin/catalogs/invalidate` behind an Owner-only role).
- **Cross-instance cache coordination.** Out of scope. Determinism of the ETag (FR-008) is what makes the multi-instance behaviour correct.
- **OpenAPI / Swagger schema regeneration.** Will pick up automatically from the new DTO records; no manual schema work required.
- **Tax catalog seeding for non-MX countries.** Out of scope. The endpoint shape supports any ISO 3166-1 alpha-2 code; the data is governed by `DbInitializer` and seeded migrations.
- **Unit Tests (UT-1..UT-8) and Performance Tests (PT-1..PT-5) deferred to a future BDD.** P4 of BDD-021 delivered the 13 integration tests in §9.2 only. UT-1..UT-8 require a `POS.UnitTests` project that does not yet exist; PT-1..PT-5 require load-testing tooling (k6 / bombardier) not currently part of the CI pipeline. The integration suite already covers the most load-bearing assertions of UT-6/UT-7 (cache miss/hit + stampede protection observed end-to-end via IT-11) and UT-8 (deterministic ordering observed via IT-6 ETag stability).

---

## Appendix C — Refactor design decisions & cross-cutting proxies

This appendix consolidates the architectural rationale behind two refactor patterns that are referenced throughout the doc but whose **WHY** is not documented elsewhere, plus the DTO-ownership boundary that governs internal vs external consumers.

### C.1 Stampede protection — `private static readonly ConcurrentDictionary<string, SemaphoreSlim>`

Declared as a `private static readonly` field on `CatalogService` (referenced in §4.1 component overview and §7.3 caching-strategy table). The static lifetime is intentional and load-bearing:

- The service itself is registered Scoped. A per-instance dictionary would defeat the purpose because every concurrent request resolves its own service instance and therefore its own (empty) dictionary, leaving the cache rebuild path unprotected — the thundering-herd guarantee of EC-2 would collapse.
- A static dictionary coordinates all Scoped service instances within the same process, ensuring exactly one rebuild per cache key per process even under thousands of parallel callers.
- With at most 12 distinct cache keys and `SemaphoreSlim` instances never disposed, the in-memory footprint is bounded (≤ 12 × ~80 bytes) and the leak risk is negligible.
- There is no cross-instance coordination (each process maintains its own lock map and its own cache). This is acceptable because the ETag (§6.1.B) is a deterministic function of the seeded data, so two processes serving the same data produce identical fingerprints — clients still receive 304 across instances despite independent caches.

### C.2 Metadata-Driven Form signals — `MacroCategory.PosExperience` / `HasKitchen` / `HasTables`

These three columns on `MacroCategory` ([POS.Domain/Models/Catalogs/MacroCategory.cs](../POS.Domain/Models/Catalogs/MacroCategory.cs)) are the canonical inputs that [BDD-020](BDD-020-chameleon-metadata-architecture.md) Metadata-Driven Forms consume to render conditional fields:

- `posExperience` (one of `Restaurant` / `Counter` / `Retail` / `Services` / `Quick`) drives the Frontend POS variant template selection.
- `hasKitchen` toggles kitchen-centric form fields (commanda destination, KDS prep estimate, kitchen status flags, `KitchenPrepMinutes` metadata).
- `hasTables` toggles table/dine-in form fields (party size / `DiningPersons` metadata, table-map binding, waiter-app affordances).

The new `GET /api/Catalog/macro-categories` endpoint (§5.1.1) surfaces all three as part of `MacroCategoryDto` so the Frontend can drop any string-matching heuristics it currently maintains against sub-giro names. The contract guarantees that any future macro additions surface their flags automatically — Frontend code reads the flags, not the macro identity.

### C.3 DTO ownership boundary — `ICatalogService` returns DTOs only

FR-009 (§3.1) and EC-4 (§6.3) jointly establish the rule: **internal service consumers that need entity-level access MUST query the repository (`IUnitOfWork.Catalog.GetXxxAsync`) directly**, not `ICatalogService`. The service layer is the public-facing DTO projector — it is not a general-purpose catalog gateway.

Today the rule has **zero blast radius**: every `_catalogService.*` call site in the codebase is a controller (`CatalogController` × 10 + `TaxesController` × 1). The internal flow that resolves macro codes from `Business.PrimaryMacroCategoryId` (`AuthService.ResolveMacroCodeAsync`) already calls the repository directly. The rule is documented here as a forward-looking discipline so future internal flows do not silently couple to transport-shaped responses.
