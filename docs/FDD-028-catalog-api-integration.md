# FDD-028 — Catalog API Integration with Offline Persistence

**Date:** 2026-05-23
**Status:** Draft — pending approval. Not implemented.
**Type:** Frontend Design Document.
**Driver:** Absorb the BDD-021 backend contract shipped in `pos-api` (12 DTO-bound catalog endpoints with ETag + 304 negotiation) into the Angular 18 frontend; replace the hardcoded fallback constants with a Dexie-backed offline cache.
**Cross-repo reference:** [`pos-api/docs/BDD-021-Dynamic-Catalogs-API.md`](BDD-021-Dynamic-Catalogs-API.md) (mirrored under `docs/` for traceability — source of truth lives in `pos-api`).
**Numbering note.** This FDD is the frontend counterpart of `BDD-021`. The numbers do **not** match because the FDD series is monotonic per repo and the frontend already used `FDD-021` for an unrelated identity-fix delivery. The cross-repo traceability is preserved via the explicit reference in this header.

---

## 1. Executive Summary

**Problem statement.** The Angular frontend currently reads 7 of the 12 catalog endpoints (kitchen-statuses, display-statuses, payment-methods, device-modes, business-types, zone-types, plans) in a single boot-time `Promise.allSettled` and falls back to two hardcoded files when the API is unreachable. The hardcoded files encode 20 `BusinessType` rows (with derived flags that no longer exist on the backend DTO) and the entire `PLAN_CATALOG` feature mix. With `BDD-021` shipping a reshaped `BusinessTypeDto`, a new `MacroCategoryDto`, ETag/304 negotiation, and a 1-hour TTL across all 12 endpoints, the current frontend integration is **incompatible with the new contract** on three fronts: shape (BusinessType reshape), caching (no ETag, no persistence), and source-of-truth (frontend pretends to be authoritative via fallback constants).

**Proposed solution.** Replace the existing `CatalogService` integration with a three-layer architecture: (a) a Dexie-backed `catalogCache` store as the durable client-side cache (survives cold-boot and offline); (b) an extended `ApiService.getFull<T>()` that surfaces response headers so ETags can be persisted alongside bodies; (c) an in-memory `signal<T[]>` public surface that is hydrated from Dexie on boot and revalidated in background via `If-None-Match` (stale-while-revalidate). The two hardcoded fallback files are deleted; their replacement is a set of build-time seed JSONs committed to `src/assets/catalog-seed/` and refreshed manually via `npm run sync-catalog-seed` against production backend. The `MacroCategoryType` enum migration — the highest-risk piece — is deferred to the final phase (F5), gated on F1–F4 having shipped to production with zero exceptions in catalog code paths for ≥ 7 days.

**Expected outcome.** Sub-50 ms warm-cache reads from `signal<T[]>` (in-process); 304 round-trips on every revalidation thanks to ETag negotiation; durable catalog data that survives cold-boot and offline; deletion of `BUSINESS_TYPES` and `PLAN_CATALOG` hardcoded arrays (215 lines removed); unlocked deletion of the AUDIT-058 §1.2 critical bug (`macroOfBusinessType()` ID-range helper) by switching to a typed `MacroCategoryDto` join; AUDIT-058 §1.4 hasKitchen race condition resolved because Dexie hydrates before any consumer reads the flag.

---

## 2. Current State Analysis

### 2.1 Existing components involved

| Layer | File | Role |
|-------|------|------|
| Service | [src/app/core/services/catalog.service.ts](../src/app/core/services/catalog.service.ts) | Loads 7 endpoints via `Promise.allSettled` on boot; falls back to hardcoded arrays on failure |
| Service | [src/app/core/services/api.service.ts](../src/app/core/services/api.service.ts) | Returns `Observable<T>` (body-only); 30+ callers depend on this signature |
| Service | [src/app/core/services/database.service.ts](../src/app/core/services/database.service.ts) | Dexie schema container; currently at version 27 (see FDD-026) |
| Model | [src/app/core/models/catalog.model.ts](../src/app/core/models/catalog.model.ts) | 6 catalog interfaces (`BusinessTypeCatalog`, `KitchenStatusCatalog`, etc.) |
| Model | [src/app/core/models/catalog.constants.ts](../src/app/core/models/catalog.constants.ts) | 85-line hardcoded fallback (20 BusinessTypes + 5 catalogs) |
| Model | [src/app/core/models/catalog.fallback.ts](../src/app/core/models/catalog.fallback.ts) | 130-line hardcoded PLAN_CATALOG with feature mix |
| Model | [src/app/core/enums/config.enum.ts](../src/app/core/enums/config.enum.ts) | Hosts `MacroCategoryType` enum + `macroOfBusinessType()` ID-range helper (AUDIT-058 §1.2) |
| Service | [src/app/core/services/tenant-context.service.ts](../src/app/core/services/tenant-context.service.ts) | Consumes `currentBusinessType().hasKitchen` (field is going away with `BusinessTypeDto` reshape) |
| Component | 15 consumers of `MacroCategoryType` enum (Phase 0 inventory) | F5 migration target |

### 2.2 Wire-contract delta introduced by BDD-021

| Endpoint | Today (frontend) | After BDD-021 |
|----------|------------------|---------------|
| `/api/Catalog/business-types` | `BusinessTypeCatalog { id, code, name, hasKitchen, hasTables, posExperience, sortOrder }` | `BusinessTypeDto { id, primaryMacroCategoryId, name }` — **5 fields removed** |
| `/api/Catalog/macro-categories` | (not consumed) | `MacroCategoryDto { id, internalCode, publicName, description, posExperience, hasKitchen, hasTables }` — **NEW** |
| `/api/Catalog/plans` | `PlanCatalogDto { planTypeId, features: string[] }` | Same wire shape; cache TTL bumped 30 min → 1 h; ETag added |
| `/api/Taxes` | (not consumed by `CatalogService` today; used by `BusinessService`) | Now ETag-negotiated; `[Authorize]` posture preserved |
| `/api/Catalog/kitchen-statuses`<br>`/api/Catalog/display-statuses`<br>`/api/Catalog/payment-methods`<br>`/api/Catalog/device-modes`<br>`/api/Catalog/zone-types` | Wire-compatible with current interfaces | Wire shape unchanged; ETag added |
| `/api/Catalog/plan-types`<br>`/api/Catalog/access-reasons`<br>`/api/Catalog/access-methods` | (not consumed today) | NEW consumer surface |

### 2.3 Current pain points

| # | Pain | Source |
|---|------|--------|
| C1 | `BusinessTypeCatalog.hasKitchen / hasTables / posExperience` will disappear from the wire; `currentBusinessType().hasKitchen` in `TenantContextService` will return `undefined` for all callers. | [tenant-context.service.ts:86](../src/app/core/services/tenant-context.service.ts#L86) + 5-field removal in `BusinessTypeDto` |
| C2 | `getBusinessType(code: string)` lookup API breaks because `code` is no longer in the wire shape. | [catalog.service.ts:164](../src/app/core/services/catalog.service.ts#L164) |
| C3 | `Promise.allSettled` boot pattern re-downloads every catalog on every cold-boot. No `If-None-Match`, no 304s, no persistence. | [catalog.service.ts:83-101](../src/app/core/services/catalog.service.ts#L83-L101) |
| C4 | Hardcoded fallback constants (`BUSINESS_TYPES`, `PLAN_CATALOG`) drift silently from backend seed; they were last updated against `commit 75eacdf` per the file comment, and currently encode 20 business types with derived flags that the backend no longer ships. | [catalog.constants.ts:43-77](../src/app/core/models/catalog.constants.ts#L43-L77), [catalog.fallback.ts](../src/app/core/models/catalog.fallback.ts) |
| C5 | `parsePlanDto` silently drops unknown `FeatureKey` strings — if backend adds a feature, the frontend hides it for up to 1 hour. | [catalog.service.ts:123-131](../src/app/core/services/catalog.service.ts#L123-L131) |
| C6 | `macroOfBusinessType(id)` resolves macro via hardcoded ID ranges (`if (id <= 3)` etc.) — AUDIT-058 §1.2 critical bug. Drift between backend seed and frontend range table is silent. | [config.enum.ts:106-111](../src/app/core/enums/config.enum.ts#L106-L111) |
| C7 | `MacroCategoryType` enum is duplicated across the frontend and assumed to mirror backend seed identifiers; the backend has **no** equivalent C# enum — the taxonomy is DB-driven. Adding a macro requires touching ≥ 5 frontend files. | [config.enum.ts:55](../src/app/core/enums/config.enum.ts#L55) + 15 consumer files |
| C8 | `getAccessReasons()` returns `Promise<AccessReasonCatalog[]>` — asymmetric to the rest of the service which exposes `signal<T[]>`. Will pay double overhead under the new ETag pattern (network + parse) on every call. | [catalog.service.ts:174-178](../src/app/core/services/catalog.service.ts#L174-L178) |

### 2.4 Overlap analysis vs FDD-024 and FDD-027

| FDD | Scope overlap with FDD-028 | Action |
|-----|---------------------------|--------|
| [FDD-024 — POS Multi-Giro Neutrality](FDD-024-pos-multi-giro-neutrality.md) | Touches `tenantContext.currentMacro()` and `hasKitchen()` consumers in POS module; deliberately **does NOT** add `Product.requiresKitchenNotes` to API. | **No overlap with FDD-028.** FDD-024 polishes UI copy and routing within the POS module; FDD-028 changes the underlying catalog wire contract. The `hasKitchen()` gate that FDD-024 §7.1 sanctions remains valid — its source (`tenantContext.currentBusinessType()?.hasKitchen` today, `resolveMacro(...).hasKitchen` after FDD-028 F4) is internal plumbing. FDD-024's acceptance criteria are unaffected. |
| [FDD-027 — Chameleon Frontend Alignment](FDD-027-chameleon-frontend-alignment.md) | Refactors `Customer` / `Order` / `Product` metadata to `*Metadata` typed interfaces. Adds `CustomerMembership` aggregate. Bumps Dexie to v28. | **Partial overlap on Dexie versioning only.** FDD-027 introduces the `customerMemberships` store at Dexie v28. FDD-028 needs to add the `catalogCache` store — must coordinate as Dexie v29 (assuming FDD-027 ships first) or v28 (if FDD-027 has not yet bumped). The metadata typing work is orthogonal to the catalog wire contract. |

**Cohabitation rule.** When FDD-028 lands after FDD-027, the Dexie bump is `v28 → v29` (add `catalogCache` store). If they ship in the other order or together, coordinate the version number at merge time.

### 2.5 Performance baseline (today)

| Concern | Today | After FDD-028 |
|---------|-------|---------------|
| Cold-boot catalog hydration | 7 parallel HTTP requests, blocks `App` init for the slowest one (typically 200–1500 ms on Render free tier) | Hydrate from Dexie (≤ 20 ms total); revalidate via `If-None-Match` in background |
| Repeat-boot catalog cost | Same 7 requests, full payloads | 7 × 304 (no body) — ~30–80 ms total against warm backend |
| Offline cold-boot | Hardcoded fallback rendered (potentially drifted from backend) | Dexie last-known-good rendered; if Dexie empty, seed JSON rendered; UI is identical to last online state |
| `getBusinessType(code)` lookup | O(n) over hardcoded 20 rows | O(n) over cached BusinessTypeDtos (~14 rows from backend seed) — after F3, lookup is by `id` not `code` |

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-001 | The frontend consumes all 12 BDD-021 endpoints with ETag/304 negotiation. | DevTools Network panel shows `If-None-Match` request header on every catalog GET after the first; the backend responds 304 on unchanged data. |
| FR-002 | A new Dexie store `catalogCache` persists `{ route, payload, etag, fetchedAt }` per endpoint. | Schema visible in IndexedDB DevTools; survives full browser restart; row count = 12 after first online boot. |
| FR-003 | `CatalogService` exposes `signal<T[]>` for every catalog (replacing the current 6 signals + 1 Promise asymmetry from C8). | All consumers read via `catalogService.macroCategories()`, `catalogService.businessTypes()`, etc. — no Promises in the public surface. |
| FR-004 | `BusinessTypeDto` is joined client-side against `MacroCategoryDto` to recover the `hasKitchen` / `hasTables` / `posExperience` attributes that the backend no longer ships on `BusinessTypeDto`. | A new `resolveMacro(businessTypeId)` helper on `CatalogService` returns a `MacroCategoryDto`; `tenantContext.currentBusinessType()` plumbing transparently consumes it. |
| FR-005 | The `macroOfBusinessType(id)` ID-range helper is deleted; macro resolution flows through the join in FR-004. | `grep "macroOfBusinessType" src/` returns 0 matches after F4. |
| FR-006 | The two hardcoded fallback files (`catalog.constants.ts`, `catalog.fallback.ts`) are deleted. | `git rm` lands in F6; no consumer remains. Seed JSONs under `src/assets/catalog-seed/*.json` replace them. |
| FR-007 | Build-time seed JSONs are committed in git and refreshed manually via `npm run sync-catalog-seed`. | Script lives in `package.json`; targets `${env.PROD_API_URL || 'https://pos-api-kw8n.onrender.com/api'}/Catalog/*`; writes one JSON per endpoint under `src/assets/catalog-seed/`. |
| FR-008 | Seed JSONs are used **only** on first cold-boot when Dexie is empty AND network is unavailable. | Unit test asserts the fallback chain: in-memory signal → Dexie → network → seed JSON. |
| FR-009 | The unknown-feature policy on `/plans` is warn-and-keep (currently silent-drop). | Console emits `console.warn` listing unknown FeatureKey strings; the unknowns remain in the in-memory signal so the UI can render them as locked/unknown features. |
| FR-010 | The `posExperience` synonyms `'Quick'` and `'Services'` are coalesced to `'Services'` at the cache hydration boundary (in-memory signal layer). | The coalescing rule lives in a pure helper; downstream consumers see only `'Services'`. The Dexie row preserves the raw backend value for forensic audit. |
| FR-011 | The `MacroCategoryType` enum is replaced with a compile-time string-literal mirror derived from `MacroCategoryDto.internalCode` (F5). | Per-file migration spec is deferred to a sub-doc `docs/FDD-028-F5-enum-migration.md` opened at F5 execution time. F5 only proceeds when F1–F4 have been in production for ≥ 7 days with zero exceptions in catalog code paths (or user manual confirmation if no Sentry/observability is wired). |
| FR-012 | `getAccessReasons()` migrates from Promise to `signal<AccessReasonCatalog[]>` to align with the rest of the service surface. | Symmetric API: `catalogService.accessReasons()` returns the signal value synchronously. |

### 3.2 Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| Latency | Cold-boot catalog read p95 < 20 ms (Dexie hydration). Online revalidation p95 < 100 ms (304 round-trip on warm Render). |
| Offline support | Catalog data is available offline for any session that has been online at least once. First-install offline boot uses seed JSONs as last resort. |
| Bundle size | Net delta ≤ +6 KB gzipped (Dexie store registration + 12 seed JSONs at ~300 bytes each minified). |
| Cache lifetime | Cache-Control says max-age=3600 (1 h, per BDD-021); client hard eviction cap = 24 h to defend against negotiation bugs. |
| TypeScript | All new code is strictly typed; no `any`. New DTOs live under `src/app/core/models/catalog-dto.model.ts`. |
| Migration safety | Each phase (F1–F6) is independently shippable and leaves the app functional. F5 is the last phase and gated on production validation of F1–F4. |
| Backwards compatibility | The public surface of `CatalogService` (signals consumed by ~14 components) is preserved during F1–F4; method signature changes only in F3 (`getBusinessType(code)` → `getBusinessType(id)`) and F4 (helper additions). |
| Accessibility | No UI changes in this FDD; A11y is preserved by inheritance. |

---

## 4. Component Architecture

### 4.1 Component Hierarchy

The architectural changes are confined to the service layer + models + Dexie store. No new Angular components, no template changes.

```
CatalogService (refactored)
├── extends ApiService.getFull<T>()              [D3]
├── reads from CatalogCacheStore                  [D2]
│   └── Dexie table `catalogCache`
├── orchestrates fallback chain                   [D4]
│   ├── in-memory signal<T[]>
│   ├── Dexie record
│   ├── network (with If-None-Match)
│   └── seed JSON (src/assets/catalog-seed/*)
└── exposes resolveMacro(businessTypeId)          [D6 F4]

ApiService (extended)
└── + getFull<T>(path, options): Observable<HttpResponse<T>>   [D3]

DatabaseService (Dexie bump)
└── + table catalogCache { route, payload, etag, fetchedAt }   [D2]
```

### 4.2 Architectural Decisions (D1–D6)

#### D1 — Cache layer placement: localize in `CatalogService`

**Decision.** The ETag/304 negotiation + Dexie persistence logic lives **inside `CatalogService`** as private methods, not as a global `HttpInterceptor`.

**Justification — Rule of 3.**
There are 12 cacheable endpoints today, all under `/api/Catalog/*` + `/api/Taxes`. A global interceptor would have to pattern-match on URL prefix to know which routes are cacheable, mixing transport concerns with route knowledge. If a 13th cacheable endpoint appears outside the catalog cluster (e.g. `/api/Reports/templates`), we promote to an interceptor. Until then, localizing avoids:

- Coupling `HttpInterceptor` to route patterns (which become a god-config over time).
- Forcing all 30+ existing `ApiService` callers through cache machinery they do not use.
- Complicating tests of unrelated services (every spec would need an `IndexedDB` mock).

The localized approach also lets `CatalogService` own its public signal surface end-to-end (hydration, revalidation, eviction) without consulting another layer.

#### D2 — Storage layer: Dexie `catalogCache` table

**Decision.** Persist `{ route, payload, etag, fetchedAt }` in a new Dexie store named `catalogCache`. Schema versioning bumps the Dexie database version (target `v29` if landing after FDD-027; coordinate at merge time).

**Schema.**

| Column | Type | Notes |
|--------|------|-------|
| `route` | `string` (PK) | Canonical route, lowercase: `/catalog/macro-categories`, `/catalog/business-types`, `/Taxes`, etc. |
| `payload` | `unknown[]` | The raw DTO array as returned by the backend. |
| `etag` | `string` | Verbatim value of the response `ETag` header (including surrounding `"…"`). |
| `fetchedAt` | `number` | `Date.now()` at the moment of the successful network response (200 or 304). |

**Dexie upgrade step.**
The `v28 → v29` migration (or `v27 → v28` if FDD-027 has not yet shipped) only creates the new store; no data migration is needed. The old hardcoded fallbacks are removed in F6 by deleting their TypeScript modules — they leave no Dexie footprint.

**Eviction policy.**
Reads check `fetchedAt`; if `Date.now() - fetchedAt > 24 * 60 * 60 * 1000` (24 h hard cap), the cached entry is treated as missing (fall through to network). This defends against negotiation bugs where the backend stops emitting fresh ETags for whatever reason; the client never serves data older than 24 h without an attempted revalidation.

**Justification.**
Aligned with CLAUDE.md's offline-first contract ("Products/catalog: cached in IndexedDB on first load"). Survives full browser restart. Read latency is ≤ 20 ms (negligible compared to network). The Dexie table is small (≤ 12 rows, ~30 KB total).

#### D3 — HTTP plumbing: extend `ApiService` with `getFull<T>()`

**Decision.** Add a new method to `ApiService` with the following contract:

| Method | Signature | Returns | Behavior |
|--------|-----------|---------|----------|
| `getFull<T>(path, options?)` | `(path: string, options?: { params?: ApiParams; headers?: Record<string, string> }) => Observable<HttpResponse<T>>` | Full Angular `HttpResponse<T>` so callers can read `body`, `status`, and `headers.get('ETag')`. | Uses `observe: 'response'` under the hood; same 60 s timeout + error handling as the existing `get<T>()`. |

**Justification.**
The existing `get<T>(path, params?)` returns the body only (line 52 of api.service.ts). Adding the full-response variant is **non-breaking** for the ~30 existing callers; they keep using `get<T>()`. Only `CatalogService` consumes `getFull<T>()`.

We do **not** modify the existing `get<T>()` because (a) most callers do not need headers, and (b) the change would force every spec to mock `HttpResponse` instead of plain bodies.

#### D4 — 304 handling & cold-boot stale-while-revalidate

**Decision.** Adopt a deterministic fallback chain with explicit 304 handling. The flow is documented in §7.

**Sequence diagram (textual).**

```
[1] Component reads catalogService.businessTypes()
       │
       ▼
[2] If in-memory signal is populated  →  return value (synchronous)
       │
       │  (signal is empty on cold boot)
       ▼
[3] CatalogService.bootHydrate()
       │
       ├── Read Dexie row for /catalog/business-types
       │       │
       │       ├── HIT  →  set signal from payload   →  schedule background revalidate (step 5)
       │       │
       │       └── MISS →  step 4
       │
[4] (Dexie miss) Network GET /catalog/business-types (no If-None-Match)
       │
       ├── 200  →  write Dexie row, set signal, return
       │
       └── network error  →  read seed JSON src/assets/catalog-seed/business-types.json
                              set signal from seed; flag as "seeded — not yet synced"
                              schedule retry on next online event
       │
[5] (Background revalidate, triggered when Dexie hit was used in step 3)
       │
       Network GET /catalog/business-types with If-None-Match: <dexie.etag>
       │
       ├── 304  →  update Dexie fetchedAt only (payload unchanged)
       │
       ├── 200  →  write Dexie row with new ETag, update signal
       │
       └── network error  →  silently keep existing signal; retry on next online event
```

**Cold-boot stale-while-revalidate.**
Step 3-HIT immediately renders cached data (≤ 20 ms); step 5 reconciles in the background. The user never sees a loading state for catalog data after the first online boot.

**Evicted-cache fallback.**
If Dexie was wiped (browser storage cleared, fresh install) AND seed JSON is present AND network is unavailable, the seed JSON is used. Seed JSONs are flagged with `fetchedAt: 0` so the next online event triggers a re-fetch and replaces them with authoritative data.

**24h hard cap.**
A Dexie row older than 24 h is treated as missing in step 3 (skip to step 4). This bypasses ETag negotiation entirely and forces a full body fetch. Protects against the edge case where backend emits an indefinitely-stable ETag for stale data.

#### D5 — Unknown-feature policy on `/plans`: warn-and-keep

**Decision.** When `parsePlanDto()` encounters a `FeatureKey` string that is not in the local enum, emit `console.warn` listing the unknowns and **keep** them in the signal as opaque strings. Do NOT drop them.

**Justification.**
The current behavior (silent drop, [catalog.service.ts:127](../src/app/core/services/catalog.service.ts#L127)) means a backend deploy that introduces a new feature is invisible to the frontend for up to 1 hour of TTL — and even after the TTL the feature is dropped permanently from the rendered plan card until the frontend is redeployed with an updated `FeatureKey` enum. Warn-and-keep:

- Surfaces the drift in DevTools console for any developer who happens to be looking.
- Lets the rendering layer choose how to display unknowns (recommended: render as a locked feature with a generic label).
- Preserves the data — the operator can see that the backend says the plan has feature X even if the frontend does not yet know what X means.

**Migration shape.**
The signal type for plans becomes `Map<PlanTypeId, (FeatureKey | string)[]>` — the discriminated union signals the rendering layer that some entries are unknown.

#### D6 — Macro resolution migration (F4 + F5)

**Decision F4.**
Introduce a public helper on `CatalogService`:

```text
resolveMacro(businessTypeId: number): MacroCategoryDto | null
```

That joins `businessTypes()` (signal) + `macroCategories()` (signal) by `primaryMacroCategoryId`. Returns the `MacroCategoryDto` row (carrying `posExperience`, `hasKitchen`, `hasTables`, `internalCode`) or `null` if either catalog is not yet hydrated.

The existing `macroOfBusinessType(id: BusinessTypeId): MacroCategoryType` helper in [config.enum.ts:106](../src/app/core/enums/config.enum.ts#L106) is **deleted** in F4.

**F4 — `TenantContextService.currentBusinessType()` join strategy (Option A — chosen).**

`TenantContextService.currentBusinessType()` is **redefined** in F4 to return a synthetic computed view that joins the raw `BusinessTypeDto` (cached) with its corresponding `MacroCategoryDto` (cached) and surfaces the macro-derived fields as part of the same object:

```text
type ResolvedBusinessType = {
  // From BusinessTypeDto (backend wire, post-BDD-021)
  id: number;
  primaryMacroCategoryId: number;
  name: string;

  // Joined from MacroCategoryDto via primaryMacroCategoryId
  hasKitchen: boolean;
  hasTables: boolean;
  posExperience: PosExperience;
  internalCode: string;
};

currentBusinessType: Signal<ResolvedBusinessType | null>;
```

**Why Option A (synthetic join) instead of forcing consumers to call `resolveMacro()` directly:**

- The existing public API surface (`currentBusinessType()?.hasKitchen`, `.hasTables`, `.posExperience`) is preserved verbatim. Zero consumer-side migration for those 3 derived fields.
- The join logic lives in exactly one place (`TenantContextService`), not duplicated across every consumer.
- Keeps F3 (BusinessTypeDto interface reshape) low-blast: F3 only updates the `BusinessTypeCatalog` interface in [catalog.model.ts](../src/app/core/models/catalog.model.ts) to mirror the backend's `{ id, primaryMacroCategoryId, name }` shape; the join wrapper absorbs the impact.
- `resolveMacro(businessTypeId)` remains a public helper for callers that want the raw `MacroCategoryDto` (e.g. UI that renders the macro's `publicName` or `description`); it is **not** the only path to `hasKitchen` / `hasTables` / `posExperience`.

**Timing of the synthetic shape introduction.** The redefinition lands in **F4** (when `resolveMacro` and `macroCategories()` signal are available). F3 reshapes the underlying DTO interface but consumers continue to read the joined fields through the synthetic shape that F4 has already established.

**Operative urgency.** Today (before F1), the backend already ships `BusinessTypeDto` without `hasKitchen` / `hasTables` / `posExperience` (BDD-021 is deployed). The current frontend reads `currentBusinessType().hasKitchen` as `undefined` and falls through to the macro-based fallback at [tenant-context.service.ts:99-100](../src/app/core/services/tenant-context.service.ts#L99-L100). The F4 join is therefore not just architectural cleanup — it restores correctness to a live regression.

**Decision F5 (deferred plan only).**
The `MacroCategoryType` numeric enum is replaced with a compile-time string-literal mirror derived from `MacroCategoryDto.internalCode`. The mirror is a `const` declaration like:

```text
export const MacroCategoryCode = {
  FoodBeverage: 'food-beverage',
  QuickService: 'quick-service',
  Retail:       'retail',
  Services:     'services',
} as const;

export type MacroCategoryCode = typeof MacroCategoryCode[keyof typeof MacroCategoryCode];
```

Compile-time string literals retain TypeScript exhaustivity (switches over `MacroCategoryCode` still error-out without `default`) while removing the dependence on numeric IDs that the backend no longer guarantees as stable across deploys.

**F5 touchpoints — enumeration with one-line intent each.** Per the prompt's constraint, this FDD lists touchpoints; the per-file detailed refactor is deferred to a sub-doc `docs/FDD-028-F5-enum-migration.md` opened at F5 execution time.

| File | One-line migration intent |
|------|---------------------------|
| [config.enum.ts:55-110](../src/app/core/enums/config.enum.ts#L55) | Replace `enum MacroCategoryType { FoodBeverage = 1, … }` + `macroOfBusinessType()` with `const MacroCategoryCode = { … } as const` + delete the ID-range helper. |
| [feature-key.enum.ts:157-161](../src/app/core/enums/feature-key.enum.ts#L157-L161) | Re-key `GIRO_FEATURE_MAP` from numeric `MacroCategoryType` to string `MacroCategoryCode`. |
| [auth-portal.component.ts:41-64](../src/app/modules/auth-portal/auth-portal.component.ts#L41-L64) | Rekey `OPERATIONAL_CARD_BY_MACRO` + rewrite `macroFromPosExperience` returns. |
| [tables.component.ts:1182](../src/app/modules/tables/tables.component.ts#L1182) | Replace `=== MacroCategoryType.FoodBeverage` with `=== MacroCategoryCode.FoodBeverage`. |
| [setup.component.ts:163-182](../src/app/modules/setup/setup.component.ts#L163-L182) | Same pattern; `tenantMacro` signal type becomes `MacroCategoryCode | null`. |
| [register.component.ts:17-108](../src/app/modules/register/register.component.ts#L17-L108) | Rekey `MACRO_BADGE_ICON` + dropdown options + form control type. |
| [onboarding.component.ts:74-149,217,230,426,434](../src/app/modules/onboarding/onboarding.component.ts) | Rekey `AVAILABLE_PLANS_BY_MACRO` + 4 macro card definitions + 2 signals + 2 method args. |
| [registration.utils.ts:25-69,99,126,174](../src/app/core/utils/registration.utils.ts) | Rekey the entire slug map + `resolveMacroSlug` return + `primaryMacroCategoryId` field types. |
| [jwt.utils.ts:52-79](../src/app/core/utils/jwt.utils.ts#L52-L79) | Rewrite `parseMacroCategoryClaim` to return `MacroCategoryCode`; preserve string-to-string mapping. |
| [business-giro.model.ts:17,32](../src/app/core/models/business-giro.model.ts#L17-L32) | Field type `primaryMacroCategoryId: MacroCategoryType` → `MacroCategoryCode`. |
| [auth.model.ts:33,66,96](../src/app/core/models/auth.model.ts#L33) | Same field-type swap on 3 interfaces. |
| [device.model.ts:139](../src/app/core/models/device.model.ts#L139) | Same field-type swap on `DeviceConfig.primaryMacroCategoryId`. |
| [admin-branches.component.ts:126-132](../src/app/modules/admin/components/branches/admin-branches.component.ts#L126-L132) | Replace numeric comparisons with string code comparisons. |
| [admin-products.component.ts:92-95](../src/app/modules/admin/components/products/admin-products.component.ts#L92-L95) | Replace `case MacroCategoryType.X:` with `case MacroCategoryCode.X:` (switch labels). |
| [admin-settings.component.ts:344-366](../src/app/modules/admin/components/settings/admin-settings.component.ts#L344-L366) | Rekey `iconByMacro` Record + 2 macro comparisons. |
| [product-form.component.ts:160,244](../src/app/modules/admin/components/products/product-form/product-form.component.ts#L160-L244) | Replace stored enum ref + 2 macro comparisons. |

**Backwards compatibility during F5.**
Recommendation: ship a transitional `MacroCategoryType` alias that maps the legacy numeric enum to string codes via a `Record<MacroCategoryType, MacroCategoryCode>` lookup. This lets F5 be merged file-by-file rather than all 16 files in one PR. The alias is deleted in a final cleanup commit once `grep MacroCategoryType src/` returns 0 matches.

**`posExperience` synonym handling.**
The backend `MacroCategoryDto.posExperience` value can be either `'Quick'` or `'Services'` for `MacroCategoryCode.Services` tenants (per [BDD-021 §5.1.1](BDD-021-Dynamic-Catalogs-API.md#511-get-apicatalogmacro-categories) — string enum has 5 values). The frontend coalesces both to `'Services'` at the signal hydration boundary (FR-010); downstream consumers do not need to know about the synonym. The raw backend value is preserved in the Dexie row for forensic audit but never exposed to components.

### 4.3 Component Communication

No new inter-component channels. All catalog data flows through the existing `CatalogService` signal surface. The `TenantContextService` continues to be the consumer for macro-derived flags (`hasKitchen`, etc.); it switches from `currentBusinessType()?.hasKitchen` to `catalogService.resolveMacro(currentBusinessType()?.id)?.hasKitchen` after F4.

---

## 5. State Management

### 5.1 Component State

No new component-level state. All state lives in `CatalogService` signals.

### 5.2 Service State

| Signal / property | Type | Initial value | Trigger for change |
|---|---|---|---|
| `macroCategories` | `signal<MacroCategoryDto[]>` | `[]` | Dexie hydrate on boot; network revalidate |
| `businessTypes` | `signal<BusinessTypeDto[]>` | `[]` | Same |
| `planTypes` | `signal<PlanTypeDto[]>` | `[]` | Same |
| `paymentMethods` | `signal<PaymentMethodDto[]>` | `[]` | Same |
| `kitchenStatuses` | `signal<KitchenStatusDto[]>` | `[]` | Same |
| `displayStatuses` | `signal<DisplayStatusDto[]>` | `[]` | Same |
| `deviceModes` | `signal<DeviceModeDto[]>` | `[]` | Same |
| `zoneTypes` | `signal<ZoneTypeDto[]>` | `[]` | Same |
| `accessReasons` | `signal<AccessReasonDto[]>` | `[]` | Same (migrated from Promise in F1, per FR-012) |
| `accessMethods` | `signal<AccessMethodDto[]>` | `[]` | New consumer surface in F4 (Cohort C) |
| `planCatalog` (computed) | `Signal<readonly PricingTier[]>` | derived | Recomputes when `_planApiFeatures` changes |
| `_planApiFeatures` | `signal<Map<PlanTypeId, (FeatureKey \| string)[]> \| null>` | `null` | Updated by `parsePlanDto` (warn-and-keep per D5) |
| `taxCatalog` | `signal<TaxDto[]>` | `[]` | Hydrated on demand by `BusinessService` (preserves current auth-gated flow) |

### 5.3 Reactive Patterns

- All signals are read with the `signal()` API (synchronous). No `Observable` exposure.
- Background revalidation is fire-and-forget (not awaited by callers). Errors are logged at `console.warn` and do not surface to the UI.
- A single `bootHydrate()` method runs once at `App` init, kicked off in a `provideAppInitializer()` or equivalent. It hydrates all 12 signals from Dexie in parallel, then schedules background revalidation for each.

### 5.4 Form State

No forms are added or changed by this FDD. Existing forms that consume catalog signals (product-form, settings, etc.) remain unchanged at the signal boundary; only the underlying source-of-truth shifts from hardcoded fallback to Dexie cache.

---

## 6. UI/UX Specifications

No UI changes. This FDD is a service-layer + persistence refactor; all visible behavior is preserved.

The only user-observable improvement is **faster cold-boot** (Dexie hydration ~20 ms vs current ~200–1500 ms network) and **silent offline operation** for any session that has been online at least once. Both improvements are passive — no toast, no loading state changes.

---

## 7. Data Flow

### 7.1 API Integration

| Endpoint | Wire shape (after BDD-021) | Cohort | Phase |
|----------|---------------------------|--------|-------|
| `GET /catalog/kitchen-statuses` | `KitchenStatusDto[]` (wire-compatible with current `KitchenStatusCatalog`) | A1 | F1 |
| `GET /catalog/display-statuses` | `DisplayStatusDto[]` (wire-compatible) | A1 | F1 |
| `GET /catalog/payment-methods` | `PaymentMethodDto[]` (wire-compatible) | A1 | F1 |
| `GET /catalog/device-modes` | `DeviceModeDto[]` (wire-compatible) | A1 | F1 |
| `GET /catalog/zone-types` | `ZoneTypeDto[]` (wire-compatible) | A1 | F1 |
| `GET /catalog/plans` | `PlanCatalogDto[]` (wire-compatible; derived `Map<PlanTypeId, FeatureKey[]>`) | A2 | F2 |
| `GET /Taxes` | `TaxDto[]` (already consumed by `BusinessService`; ETag added) | A2 | F2 |
| `GET /catalog/macro-categories` | `MacroCategoryDto[]` (NEW) | C | F4 |
| `GET /catalog/plan-types` | `PlanTypeDto[]` (NEW consumer surface) | C | F4 |
| `GET /catalog/access-reasons` | `AccessReasonDto[]` (migrated from Promise to signal, per FR-012) | C | F4 |
| `GET /catalog/access-methods` | `AccessMethodDto[]` (NEW) | C | F4 |
| `GET /catalog/business-types` | `BusinessTypeDto[]` (RESHAPED — 5 fields removed) | B | F3 |

**Trigger.** All endpoints are fetched by `bootHydrate()` on app init. `/catalog/access-reasons` is also fetched on demand by reception module pages (existing behavior preserved). `/Taxes` is fetched on demand by `BusinessService` settings flows; the FDD-028 contribution is to wrap that fetch with the same ETag + Dexie machinery used by the rest of the catalog.

**Request parameters.** None for `/catalog/*`. `/Taxes` accepts an optional `?countryCode=` filter; the Dexie cache key includes the country code (`/Taxes?countryCode=MX`) so each filter variant is cached independently.

**Response handling.** See §7.3.

**Error handling.** See §9.

### 7.2 Data Transformation

| Source | Target | Logic |
|--------|--------|-------|
| `MacroCategoryDto` | In-memory signal | Coalesce `posExperience` synonym (`'Quick'` → `'Services'`); pass-through otherwise. |
| `BusinessTypeDto` | In-memory signal | Pass-through; consumers join on `primaryMacroCategoryId` via `resolveMacro()`. |
| `PlanCatalogDto[]` | `Map<PlanTypeId, (FeatureKey \| string)[]>` | `parsePlanDto` (refactored to warn-and-keep unknowns, D5). |
| Backend `ETag` header | Dexie row `etag` column | Verbatim, including surrounding `"…"`. |

### 7.3 ETag contract & cache record shape

**Cache record shape.**

```text
catalogCache row:
  route:      "/catalog/macro-categories"                  // canonical, lowercase
  payload:    [{ id: 1, internalCode: "food-beverage", … }, …]   // raw DTO array
  etag:       "\"a1b2c3…\""                                  // verbatim from response header
  fetchedAt:  1716480000000                                  // Date.now() at write
```

**Fallback chain (read path).**

```text
catalogService.macroCategories()  // synchronous signal read
   │
   ├── signal populated  →  return value
   │
   └── (cold-boot)  →  bootHydrate() has not yet run
                       (signal returns [] until bootHydrate resolves)
```

Asynchronously:

```text
bootHydrate(route) :
   1. Read Dexie row for `route`.
      ├── HIT && fetchedAt within 24h  →  set signal from payload; schedule revalidate
      ├── HIT && fetchedAt > 24h       →  treat as miss (fall to step 2)
      └── MISS                          →  step 2
   2. Network GET `route` (no If-None-Match if MISS in step 1).
      ├── 200  →  write Dexie row (payload + etag + fetchedAt); set signal
      ├── network error && seed JSON exists  →  set signal from seed JSON; flag for retry
      └── network error && no seed JSON      →  signal remains []; flag for retry
   3. (Background) Revalidate: Network GET `route` with `If-None-Match: <dexie.etag>`.
      ├── 304  →  Dexie.update({ fetchedAt: Date.now() }); signal unchanged
      ├── 200  →  Dexie.update({ payload, etag, fetchedAt }); set signal
      └── network error  →  silently keep current signal; retry on next online event
```

**Route case standardization.**
All routes are lowercase `/catalog/...` (and `/Taxes` as the sole exception, preserving the production case). The Dexie key is the canonical route. ASP.NET Core is case-insensitive in routing, so the backend accepts either; standardizing on the client side avoids cache fragmentation if a future edge cache treats `/Catalog/foo` and `/catalog/foo` as distinct keys.

### 7.4 Data Refresh Strategy

- **Initial load:** `bootHydrate()` runs once at app init, reads Dexie + revalidates in background.
- **Manual refresh:** Not exposed in v1. A future admin "reload catalogs" button can call `catalogService.invalidate(route?)` to force re-fetch.
- **Automatic refresh:** Background revalidation triggered by `window.online` event (already used by `SyncService`); reuse the same channel.
- **TTL:** 24 h hard cap on Dexie row staleness; otherwise rely on backend ETag for fresh-or-not decision.

---

## 8. Performance Optimization

### 8.1 Rendering Optimization

No new rendering hot paths. Signals are read once per change-detection cycle; consumers using OnPush (e.g. `product-form`) already benefit from signal-driven reactivity. No virtual scrolling, no trackBy work needed.

### 8.2 Data Optimization

- **Lazy loading:** Not applicable; the entire catalog is small (~30 KB total across 12 endpoints).
- **Pagination:** Not applicable; backend returns full lists (≤ 100 rows per catalog).
- **Caching:** Dexie + in-memory signal layer described in §7. The 24 h hard cap balances stale-data risk against backend load.

### 8.3 Bundle Optimization

- 12 seed JSONs under `src/assets/catalog-seed/*.json` are loaded on demand via `fetch('/assets/catalog-seed/<route>.json')` — they do NOT inflate the main bundle.
- Deleting `catalog.constants.ts` (85 LOC) and `catalog.fallback.ts` (130 LOC) removes ~215 lines from the bundle.
- The Dexie store registration adds ~200 bytes minified to the existing `database.service.ts`.

**Net delta:** ≤ +6 KB gzipped (mostly seed JSONs loaded only on first cold-boot offline).

---

## 9. Error Handling

### 9.1 Error Types

| Error | Origin | UX |
|-------|--------|----|
| Network timeout (60 s, per `ApiService`) | `getFull<T>()` | Silent; cached/seed value remains; retry on next online event. |
| Backend 5xx | `getFull<T>()` | Silent; cached/seed value remains; `console.warn` logged. |
| Backend 400 (only `/Taxes` validation per BDD-021 VR-001) | `getFull<T>()` | Surfaced to caller (`BusinessService`); existing error UX preserved. |
| Backend 401 (only `/Taxes`) | `getFull<T>()` | Handled by existing `authInterceptor`; no change. |
| Dexie write failure (storage quota, browser eviction) | `catalogCache.put()` | Silent; in-memory signal still set; `console.warn` logged. Next boot will re-fetch from network. |
| Unknown `FeatureKey` in `/plans` response | `parsePlanDto` | `console.warn` listing unknowns; unknowns preserved in the signal per D5. |
| Seed JSON missing or malformed | `bootHydrate()` fallback path | `console.error`; signal remains `[]`; UI shows skeleton/empty state until network recovers. |

### 9.2 User Feedback

No toast notifications for catalog-layer errors. Catalog data is infrastructure: when it fails, the UI degrades silently (skeleton states, cached values, or seed fallback). Only `/Taxes` 400 surfaces because it carries user-facing validation context.

---

## 10. Accessibility

No UI changes. Inherited A11y is preserved. Existing screen-reader behavior on dropdown selectors that consume catalog data (e.g. business-type pickers, payment-method choices) is unchanged because the option labels still derive from the same DTO field names (`name`).

---

## 11. Testing Requirements

### 11.1 Unit Tests

| Subject | Scenarios |
|---------|-----------|
| `parsePlanDto` | (a) all features known → returns typed `FeatureKey[]`. (b) some unknown → warn-and-keep returns `(FeatureKey \| string)[]` with the unknowns preserved. (c) empty input → empty Map. |
| `resolveMacro(businessTypeId)` (D6 / F4) | (a) BusinessType + Macro both hydrated → returns the joined `MacroCategoryDto`. (b) BusinessType hydrated, Macro not yet → returns `null`. (c) unknown `businessTypeId` → returns `null`. |
| Cache record lifecycle | (a) cold boot, Dexie hit + fresh → signal populated, no network call. (b) cold boot, Dexie hit + stale > 24 h → network called, fresh body stored. (c) cold boot, Dexie miss + network 200 → write Dexie + signal. (d) revalidate path returns 304 → Dexie `fetchedAt` updated, payload unchanged. |
| `posExperience` coalescing (FR-010) | (a) `'Quick'` from backend → signal carries `'Services'`. (b) `'Services'` from backend → signal carries `'Services'`. (c) raw Dexie row preserves the original backend value. |
| Dexie upgrade migration | Fresh install at v29 (or v28) opens cleanly; existing v27 (or v26) DB upgrades without data loss. |

### 11.2 E2E Tests

Leverage the existing `seedJwtClaims()` fixture (per §3.2 of AUDIT-058, now RESOLVED) and the 5 `TEST_TENANT_SCENARIOS`.

| Spec | Scenario |
|------|----------|
| `catalog-etag-roundtrip.spec.ts` (NEW) | (1) Boot app fresh (Dexie empty). (2) Wait for catalog hydrate. (3) Reload page. (4) Assert via `page.on('response')` that the second boot's `/catalog/*` requests returned 304 OR were satisfied from cache (no body re-download). Use Playwright `page.on('response')` event introspection as the primary path; CDP Network domain (`page.context().newCDPSession`) as fallback if introspection is insufficient. |
| Existing `jwt-mock-smoke.spec.ts` | No change. Catalog hydration runs in the background; smoke contract is unaffected. |

**304 assertion technique.**
`page.on('response', r => {...})` exposes `r.status()` and `r.headers()`. Filter for `r.url().includes('/catalog/')` on the second boot and assert `r.status() === 304` for at least one request. If Playwright does not surface 304 reliably (some browsers fold 304 into 200 at the level the event sees), fall back to CDP `Network.responseReceived` which always reports the wire status.

---

## 12. Implementation Phases

> **Phasing rationale.** F# numbers reflect conceptual buckets, not strict chronology. The `Deps` column is authoritative for merge order. F5 was originally planned as the **last** phase gated on F1–F4 production validation (≥ 7 days zero exceptions in catalog code paths, or user manual confirmation). That gate was **waived per user decision** (single-dev startup context, no customers depending on stability) and F5 shipped immediately after F1–F4 in the same sprint.

| F#  | Scope | Deps | Risk | Status |
|-----|-------|------|------|--------|
| **F1** | Dexie `catalogCache` table (v28 or v29 depending on FDD-027 ship order) + `ApiService.getFull<T>()` + ETag/304 plumbing in a new `CatalogCacheStore` private helper + Cohort A1 migration (5 wire-compatible endpoints: kitchen-statuses, display-statuses, payment-methods, device-modes, zone-types). Public signal surface preserved; existing consumers see no change. | — | Low | ✅ `bc84c29` |
| **F2** | Cohort A2: `/plans` (`Map<PlanTypeId, (FeatureKey \| string)[]>` derived signal with warn-and-keep per D5). `/Taxes` was scoped out during execution and shipped as a separate **F2.1** below — `tax.service.ts` carries offline-create + tenant-default business logic that warranted its own focused migration. | F1 | Medium | ✅ `70659c8` |
| **F2.1** | `/taxes` ETag wrapping in `tax.service.ts` (READ path only): stale-while-revalidate against `catalogCache`, ETag negotiation, `clear()` extended to wipe the cache row on logout (cross-tenant safety). Legacy Dexie `taxes` table preserved as offline-create scratch + mirrored on every successful network response. Public API surface unchanged. | F1 | Low | ✅ `bb50a7a` |
| **F4** | Cohort C: `/macro-categories` adoption (new signal `macroCategories()`); `/plan-types` adoption (new signal); `/access-methods` adoption (new signal); `/access-reasons` migrated from Promise to signal (FR-012). `resolveMacro(businessTypeId)` helper introduced. `macroOfBusinessType(id)` deleted from `config.enum.ts`. `TenantContextService.currentBusinessType()?.hasKitchen` rewired to use `resolveMacro()`. | F1 | High | ✅ `807e28c` |
| **F3** | Cohort B: `/business-types` reshape — wire shape switches to `BusinessTypeDto { id, primaryMacroCategoryId, name }`. `getBusinessType(code: string)` API broken — replaced by `getBusinessTypeById(id: number)`. All consumers migrated to use `resolveMacro()` for the moved attributes (`hasKitchen`, `hasTables`, `posExperience`). | F4 | High | ✅ `bbefbe1` |
| **F6** | Delete `src/app/core/models/catalog.constants.ts` and `src/app/core/models/catalog.fallback.ts`. Commit seed JSONs under `src/assets/catalog-seed/*.json` generated by a new `npm run sync-catalog-seed` script. Script targets `${PROD_API_URL \|\| 'https://pos-api-kw8n.onrender.com/api'}/Catalog/*`; writes one JSON per endpoint. Script is documented in `README.md` as a manual sync to re-run when backend `DbInitializer` changes. | F1, F3, F4 | Low | ✅ `6333d14` |
| **F5** | `MacroCategoryType` enum migration — 16-file refactor per the touchpoint table in §4.2 / D6. Replace numeric enum with `const MacroCategoryCode = { … } as const` + string-literal type. Ship a transitional `MacroCategoryType → MacroCategoryCode` alias to allow file-by-file migration; delete alias in a final commit. Detailed per-file refactor spec deferred to `docs/FDD-028-F5-enum-migration.md` opened at F5 execution time. | F1-F4 (gate waived per user — startup, no customers) | VERY HIGH | ✅ `27e63ad` → `ccc129c` (B0-B4) |

Each phase is a standalone PR; each leaves the app shippable. F1 is independent and can ship first. F2 and F4 can be parallel after F1. F3 depends on F4 (needs `MacroCategoryDto` available to join). F6 depends on F1 + F3 + F4 (needs all consumers migrated to the cache layer before fallback constants can be deleted). F5 is the final, highest-risk phase and is gated on production validation of F1–F4.

### 12.1 Phase exit criteria

| Phase | Exit when |
|-------|-----------|
| F1 | Dexie opens cleanly on fresh install AND upgrade from v27 (or v28). 5 Cohort A1 endpoints serve from cache on second boot (verified via DevTools Network panel). Existing consumers of `kitchenStatuses()` / etc. signals see no behavior change. |
| F2 | `/plans` and `/Taxes` revalidate via `If-None-Match` and return 304 on unchanged data. `parsePlanDto` warn-and-keep behavior visible in console when synthetic unknown FeatureKey is injected. |
| F4 | `grep "macroOfBusinessType" src/` returns 0 matches. `catalogService.resolveMacro(1)` returns the FoodBeverage `MacroCategoryDto`. `TenantContextService.currentBusinessType()?.hasKitchen` returns the correct value (via `resolveMacro` plumbing). |
| F3 | `getBusinessTypeById(id: number)` returns the right `BusinessTypeDto`. `getBusinessType(code: string)` call sites have been migrated. `TenantContextService.currentBusinessType()` returns the synthetic `ResolvedBusinessType` shape per D6 / F4 Option A; consumers reading `.hasKitchen` / `.hasTables` / `.posExperience` continue to receive the right values via the F4-established join. |
| F6 | `git rm` lands for both hardcoded files. `src/assets/catalog-seed/*.json` exists for all 12 endpoints. `npm run sync-catalog-seed` runs locally without error. Fresh install with network unavailable boots from seed JSONs and renders identical UI to a network boot. |
| F5 | `grep "MacroCategoryType" src/` returns 0 matches (transitional alias removed). All 16 touchpoint files now reference `MacroCategoryCode`. `ng build` + `npm test` + `npm run lint` all green. |

---

## Appendix A — Cross-Repo Audit Sync (proposed AUDIT-058 diff)

> **Status: APPLIED.** The §2.6 / §3.4 / §1.2 / §1.4 markers below were formally written into AUDIT-058 on 2026-05-23 and 2026-05-24. This appendix is retained as the design record of the proposed diff; the consummated changes live in AUDIT-058's changelog entries for those dates.
>
> **Historical context (pre-application):** This appendix originally proposed the AUDIT-058 status updates that follow from the cross-repo work delivered in `pos-api` (BDD-021 + the WebApplicationFactory infrastructure + global query filters), plus the closures unlocked by FDD-028's phases.

### A.1 Proposed status changes

| Section | Current status | Proposed status | Evidence |
|---------|----------------|-----------------|----------|
| **TL;DR table — `B — Backend Global Filters`** | 🔴 `[NO VERIFICADO]` | 🟢 **RESOLVED** | See A.2.1 |
| **TL;DR table — Add new row `C — WebApplicationFactory`** (currently §3.4 is documented but not in TL;DR) | n/a | 🟢 **RESOLVED** | See A.2.2 |
| **§1.2 — ID-range mapping for `macroOfBusinessType()`** | 🔴 Crítico | 🟡 **RESOLVABLE — gated on FDD-028 F4** | See A.2.3 |
| **§1.4 — `hasKitchen` race condition** | OPEN | 🟡 **RESOLVABLE — gated on FDD-028 F3 + F6** | See A.2.4 |
| **§2.6 — Backend EF Core Global Query Filters** | 🔴 `[NO VERIFICADO]` | 🟢 **RESOLVED** | See A.2.1 |
| **§3.4 — WebApplicationFactory audit** | 🔴 `[NO VERIFICADO]` | 🟢 **RESOLVED** | See A.2.2 |
| **§2.7 — Bridge supervisors** | `[NO VERIFICADO]` | **STILL OPEN — no evidence delivered** | See A.2.5 |
| **§3.5 — SignalR loopback** | 🔴 Crítico | **STILL OPEN — confirmed MISSING in backend** | See A.2.6 |

### A.2 Evidence detail

#### A.2.1 §2.6 / TL;DR row B — Global Query Filters RESOLVED

The backend audit (cross-repo, in `pos-api`) confirmed presence of EF Core Global Query Filters in [`POS.Repository/ApplicationDbContext.cs`](https://github.com/...) (`ApplyTenantFilters` method invoked from `OnModelCreating`). Implementation details:

- Two marker interfaces drive filter discovery: `IBranchScoped { int BranchId }` and `IBusinessScoped { int BusinessId }`, both under `POS.Domain/Interfaces/`.
- `ITenantContext { int? BranchId, int? BusinessId }` is injected into `DbContext` constructor; resolved per-request from JWT claims by `POS.Repository/Tenancy/HttpTenantContext.cs` (registered Scoped in `POS.Repository/Dependencies/RepositoryDependencies.cs`).
- `ApplyTenantFilters(ModelBuilder)` iterates `modelBuilder.Model.GetEntityTypes()` and assigns expression-tree filters of the shape `e => !ctx.{Scope}.HasValue || e.{Scope} == ctx.{Scope}.Value` via `IMutableEntityType.SetQueryFilter`.
- Write-side guard: `POS.Repository/Interceptors/BranchInjectionInterceptor.cs` overwrites `BranchId` on inserts for `IBranchScoped` entities.
- Filters degrade to no-op when `ITenantContext` returns `null` (background jobs, EF design-time tooling, migrations, seeding) by design.

**Note on the SAME row in the AUDIT-058 TL;DR.** The original TL;DR row reads:

> *B — Backend Global Filters | 🔴 `[NO VERIFICADO]` | Endpoints exigen `branchId` explícito (`/branch/{id}/config`, `/api/Devices/limits?branchId=`) → fuerte sospecha de que EF Core **NO** tiene `HasQueryFilter` transparente.*

The new evidence **falsifies the suspicion**. Filters DO exist; the URL-level `branchId` parameters are independent of the DbContext-level filter (likely for explicit-scope flows like cross-branch admin reports). The "Data-leak risk" claim is downgraded; routine endpoints are protected.

#### A.2.2 §3.4 / new TL;DR row C — WebApplicationFactory RESOLVED

Confirmed presence of `POS.IntegrationTests` project (cross-repo, in `pos-api`):

- `POS.IntegrationTests.csproj` — xUnit 2.9.3, `Microsoft.AspNetCore.Mvc.Testing` 10.0.3, EF Core InMemory 10.0.4.
- `POS.IntegrationTests/Infrastructure/CustomWebApplicationFactory.cs` — extends `WebApplicationFactory<Program>`. Static constructor sets JWT/Stripe/HMAC test secrets before `Program.Main`. `ConfigureWebHost` swaps `DbContextOptions<ApplicationDbContext>` to `UseInMemoryDatabase($"PosTests_{Guid.NewGuid():N}")`, removes hosted services in `POS.API.Workers` namespace (Stripe, payment webhook, KDS dispatcher workers).
- `POS.IntegrationTests/Infrastructure/JwtTestFactory.cs` — forges real HS256 tokens using the same key the test host validates against. Methods: `CreateUserToken(businessId, branchId, userId, role)`, `CreateDeviceToken(businessId, branchId, mode, features[])`.
- `POS.IntegrationTests/Infrastructure/FakeTenantContext.cs` — mutable `ITenantContext` for direct DbContext-level tests.
- `POS.IntegrationTests/Infrastructure/InMemoryModelCustomizer.cs` — registers `JsonDocument? ↔ string` value converter so InMemory provider validates the model.
- `POS.IntegrationTests/Tenancy/TenantIsolationTests.cs` — seeds two tenants, asserts cross-tenant queries return empty (`IClassFixture<CustomWebApplicationFactory>`).
- Additionally, `POS.IntegrationTests/Catalogs/CatalogApiTests.cs` ships 13 integration tests for BDD-021 (35/35 facts passing including 11 theory expansions on IT-3 and IT-12). See [`pos-api/docs/BDD-021-Dynamic-Catalogs-API.md §9.2`](BDD-021-Dynamic-Catalogs-API.md).

#### A.2.3 §1.2 — ID-range mapping RESOLVABLE (gated on FDD-028 F4)

The `macroOfBusinessType(id: BusinessTypeId): MacroCategoryType` ID-range helper in [config.enum.ts:106-111](../src/app/core/enums/config.enum.ts#L106-L111) becomes deletable when FDD-028 F4 ships. Replacement: `catalogService.resolveMacro(businessTypeId)` joins `BusinessTypeDto` against the new `MacroCategoryDto` cache by `primaryMacroCategoryId`. No hardcoded ID ranges remain.

Section marker after F4 ships: `[RESOLVED via FDD-028 F4]`.

#### A.2.4 §1.4 — `hasKitchen` race condition RESOLVABLE (gated on FDD-028 F3 + F6)

The race condition described in AUDIT-058 §1.4 (UI may boot without kitchen flag before catalog hydrates) is eliminated by FDD-028's Dexie persistence + seed JSON fallback:

- After F3, `hasKitchen` is sourced from `catalogService.resolveMacro(businessTypeId)?.hasKitchen` against the cached `MacroCategoryDto`.
- After F6, the seed JSONs guarantee `MacroCategoryDto` is available on any boot (including first-install offline). The signal never returns `null` on a hydrated app.
- The current fallback `currentMacro() === MacroCategoryType.FoodBeverage` in [tenant-context.service.ts:99-100](../src/app/core/services/tenant-context.service.ts#L99-L100) becomes unnecessary and can be removed in F5 alongside the enum migration.

Section marker after F3 + F6 + F5 ship: `[RESOLVED via FDD-028 F3+F6+F5]`.

#### A.2.5 §2.7 — Bridge supervisors STILL OPEN

The backend audit covered `pos-api` only; the supervisor lifecycle in `pos-local-bridge` was not inspected. The frontend cannot verify whether bridge supervisors (printer, scanner, scale, biometric) consult the `features` claim before initializing. **Action:** request a separate cross-repo audit of `pos-local-bridge` focused on supervisor lifecycle vs feature claims. No FDD-028 changes affect this.

#### A.2.6 §3.5 — SignalR loopback STILL OPEN (CONFIRMED MISSING)

The backend audit explicitly checked and confirmed: `grep` on `POS.IntegrationTests` for `HubConnection`, `HubConnectionBuilder`, `Microsoft.AspNetCore.SignalR.Client`, `TestServer.*Hub`, and `SignalRTest` returns **zero matches**. The `Microsoft.AspNetCore.SignalR.Client` NuGet is not referenced from the test project. The two hubs in production (`/hubs/kds`, `/hubs/bridge`) have no loopback or end-to-end test asserting event emission. **Action:** track as a backend testing gap; FDD-028 does not touch this surface.

### A.3 Suggested AUDIT-058 changelog entry

```text
### 2026-05-23 — Cross-repo evidence + FDD-028 closures proposed (via FDD-028 Appendix A)

- §2.6 (Global Query Filters): NO VERIFICADO → RESOLVED. Evidence:
  POS.Repository/ApplicationDbContext.cs::ApplyTenantFilters +
  IBranchScoped/IBusinessScoped + BranchInjectionInterceptor.
- §3.4 (WebApplicationFactory): NO VERIFICADO → RESOLVED. Evidence:
  POS.IntegrationTests/Infrastructure/{CustomWebApplicationFactory,
  JwtTestFactory, FakeTenantContext, InMemoryModelCustomizer}.cs +
  Tenancy/TenantIsolationTests.cs + Catalogs/CatalogApiTests.cs (35/35).
- §1.2 (ID-range mapping): Crítico → RESOLVABLE (gated on FDD-028 F4).
- §1.4 (hasKitchen race condition): OPEN → RESOLVABLE
  (gated on FDD-028 F3 + F6, race eliminated by Dexie persistence +
  seed JSON fallback).
- §2.7 (Bridge supervisors): still NO VERIFICADO — pos-local-bridge
  audit pending.
- §3.5 (SignalR loopback): Crítico — CONFIRMED MISSING in backend.
- TL;DR table updated: B-Backend Global Filters row → RESOLVED;
  new C-WebApplicationFactory row added → RESOLVED.
```

---

**End of design document. Awaiting explicit confirmation before applying Appendix A diff to AUDIT-058 or beginning any implementation phase (F1–F6).**
