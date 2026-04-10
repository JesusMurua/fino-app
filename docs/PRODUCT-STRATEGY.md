# POS Product Strategy & Enforcement Plan

> Last updated: 2026-04-09
> Status: Approved by Tech Lead — pending backend implementation

---

## 1. The Dynamic Architecture (Giro vs Plan)

The POS platform uses two independent axes to shape each merchant's experience:

### BusinessTypeId (Giro) — Controls the User Experience

The business vertical determines **which POS mode loads** and **which features are relevant**.
This is a UX decision, not a monetization decision.

| Giro | POS Experience | Route | Key UX traits |
|------|---------------|-------|---------------|
| Restaurant, Bar | Restaurant | `/pos` | Full catalog grid, cart panel, delivery panel |
| Cafe, FoodTruck, Taqueria | Counter | `/pos/counter` | Kitchen order option, bill denominations |
| Retail, Abarrotes, Ferreteria, Papeleria, Farmacia | Retail | `/pos/retail` | Barcode scanner, stock-guarded cart |
| General, Servicios | Quick | `/pos/quick` | Free-form item entry (name + price), no catalog required |

The mapping is resolved at runtime via `DeviceRoutingService` using the `posExperience` field from `BusinessTypeCatalog`.

### PlanTypeId (Plan) — Controls Feature Access & Limits

The subscription tier determines **what features are unlocked** and **how many resources** the business can create.
This is the monetization axis.

- Free users get the core POS experience for their giro, with quantitative caps.
- Pro users unlock advanced operational features (KDS, Waiter Mode, CFDI, Reports).

### Device Modes — Hardware Roles, Not User Roles

"KDS" and "Master Cashier" are **device configurations**, not user-facing plans or giros:

- A tablet in the kitchen runs in `mode: 'kitchen'` and loads `KitchenDisplayComponent`.
- A cashier terminal runs in `mode: 'cashier'` and loads the appropriate POS experience.
- A kiosk at the entrance runs in `mode: 'kiosk'` and loads the self-service flow.

These are assigned during device setup (onboarding step 4 or admin settings) and stored in localStorage per device.

---

## 2. The Official Plan Tiers

### Free (Gratuito)

| Dimension | Limit |
|-----------|-------|
| Branches | 1 |
| Users | 3 |
| Products | 100 |
| POS experiences | All (Restaurant, Retail, Counter, Quick) |
| Thermal printing | Included |
| Kiosk Mode | Not included |
| Tables / Zones | Not included |
| Inventory | Not included |
| Cash Register sessions | Not included |
| Barcode Scanner | Not included |
| Promotions | Not included |

The Free plan is a fully functional POS for micro-businesses. The merchant can sell, print receipts, and manage a small catalog. It is **not** a trial — it is a permanent tier.

### Pro

| Dimension | Limit |
|-----------|-------|
| Branches | Multiple (`MultiBranch` feature) |
| Users | Unlimited |
| Products | Unlimited |
| POS experiences | All |
| Thermal printing | Included |
| Kiosk Mode | Included |
| Tables / Zones | Included |
| Inventory | Included |
| Cash Register sessions | Included |
| Barcode Scanner | Included |
| Promotions | Included |
| Advanced Reports | Included |
| CFDI Billing | Included |
| Loyalty Program | Included |
| Clients & Credit | Included |
| Reservations | Included |
| Waiter Mode | Included (device mode `tables` for Waiter role) |
| KDS | Included (device mode `kitchen` for Kitchen role) |

### Enterprise (future)

Everything in Pro, plus: Hardware Scale integration, API Access for third-party integrations.

### Reference: Current code constants

```
Frontend:  PLAN_LIMITS      → src/app/core/models/plan.model.ts
Frontend:  PLAN_FEATURE_MAP → src/app/core/models/plan.model.ts
Frontend:  FEATURE_MIN_PLAN → src/app/core/models/plan.model.ts
Frontend:  FeatureFlagService.canUse() → src/app/core/services/feature-flag.service.ts
Backend:   (not yet implemented)
```

---

## 3. The Current Vulnerability (Audit Findings)

### Frontend: Partial enforcement

| Area | Status | Detail |
|------|--------|--------|
| Admin sidebar nav | Enforced | `FeatureFlagService.canUse()` sets `locked: true` on 11 nav items (Reports, Tables, Inventory, Promotions, etc.). Locked items render with `nav-item--locked` class and are not clickable. |
| Admin Tables (Zones) | Enforced | `@if(!canUseZones())` shows an upgrade banner and falls back to a flat table list instead of the zone kanban. |
| Quantitative limits | **NOT enforced** | `PLAN_LIMITS` constants exist (`maxUsers: 3`, `maxProducts: 100` for Free) but are **never consumed** by any component, service, or guard. A Free user can create unlimited users and products. |
| POS route access | **NOT enforced** | All POS mode routes (`/pos`, `/pos/retail`, etc.) are protected by role guards only, not plan gates. |
| KDS / Kitchen route | **NOT enforced by plan** | `/kitchen` is guarded by role (Kitchen, Owner, Manager) but not by plan tier. A Free user with Kitchen role can access KDS. |

### Backend: No enforcement

| Area | Status | Detail |
|------|--------|--------|
| User creation | **No limit** | `POST /api/users` has no check against `maxUsers` for the business's plan. |
| Product creation | **No limit** | `POST /api/products` has no check against `maxProducts` for the business's plan. |
| CFDI endpoints | **Open** | Invoicing endpoints are accessible regardless of plan tier. |
| Advanced Reports | **Open** | `GET /api/report/charts` is accessible regardless of plan tier. |
| Branch creation | **Open** | `POST /api/branches` has no `MultiBranch` feature gate. |
| Feature-gated endpoints | **None exist** | No `[RequiresPlan]` attribute or middleware exists in the API. |

### Risk assessment

A merchant on the Free plan currently has the same backend capabilities as an Enterprise merchant. The only barriers are visual (grayed-out sidebar items). A technically inclined user could call any API endpoint directly and bypass all frontend gates.

---

## 4. Execution Plan (The Roadmap)

### Phase 1 — Backend Security (Priority: Critical)

**Goal:** Make the API the single source of truth for plan enforcement.

| Task | Endpoint | Implementation |
|------|----------|----------------|
| Plan limits middleware | Global | Create `PlanLimitsMiddleware` that reads `planTypeId` from JWT claims and resolves `PlanLimits` from a server-side constants file mirroring the frontend's `PLAN_LIMITS`. |
| User creation gate | `POST /api/users` | In `UserService.CreateAsync`, count existing users for the business. If `count >= maxUsers`, return `402 Payment Required` with body `{ code: "PLAN_LIMIT_USERS", limit: 3, current: 3 }`. |
| Product creation gate | `POST /api/products` | In `ProductService.CreateAsync`, count existing products for the branch. If `count >= maxProducts`, return `402 Payment Required` with body `{ code: "PLAN_LIMIT_PRODUCTS", limit: 100, current: 100 }`. |
| Branch creation gate | `POST /api/branches` | Check `planTypeId` against `MultiBranch` feature. If Free, return `403 Forbidden` with body `{ code: "FEATURE_LOCKED", feature: "MultiBranch", requiredPlan: "Pro" }`. |
| Feature gate attribute | CFDI, Reports controllers | Create `[RequiresPlan(PlanTypeId.Pro)]` attribute. Apply to: `CfdiController`, `ReportController` (advanced endpoints). Return `403` with `{ code: "FEATURE_LOCKED", feature: "Cfdi", requiredPlan: "Pro" }`. |
| KDS/Waiter gate | Device registration | When registering a device with `mode: 'kitchen'` or `mode: 'tables'` (for Waiter role), validate that the business plan includes the feature. |

**API error contract:**

```json
// 402 — Quantitative limit reached
{
  "code": "PLAN_LIMIT_USERS",
  "message": "Has alcanzado el limite de usuarios de tu plan.",
  "limit": 3,
  "current": 3,
  "requiredPlan": "Pro"
}

// 403 — Feature not available on current plan
{
  "code": "FEATURE_LOCKED",
  "message": "Esta funcion requiere el Plan Pro.",
  "feature": "Cfdi",
  "requiredPlan": "Pro"
}
```

### Phase 2 — Frontend Alignment

**Goal:** Consume backend errors and display upgrade prompts.

| Task | Detail |
|------|--------|
| Global error interceptor | In the HTTP interceptor, catch `402` and `403` responses with `PLAN_LIMIT_*` or `FEATURE_LOCKED` codes. Show a reusable `UpgradeDialogComponent` with the plan name and a CTA to the billing page. |
| User creation form | In `AdminUsersComponent`, before calling the API, check `PLAN_LIMITS[planTypeId].maxUsers` against current user count. Show an inline warning if at limit. The backend remains the enforcer — the frontend check is a UX optimization. |
| Product creation form | In `AdminProductsComponent`, same pattern for `maxProducts`. |
| Route guards for plan | Add an optional `requiredFeature` to protected routes. In `authGuard`, check `featureFlags.canUse(feature)` and redirect to an upgrade page if blocked. Apply to `/kitchen` (KDS feature) and `/kiosk` (KioskMode feature). |

### Phase 3 — UX Consolidation

**Goal:** Simplify the operational model.

| Task | Detail |
|------|--------|
| Merge "Cajas" modules | Currently, cash register sessions (`/admin/cash`) and physical register management (`/admin/registers`) are separate admin sections. Merge into a single "Cajas" module with tabs: "Turnos" (sessions) and "Dispositivos" (physical registers + device linking). |
| Waiter Mode (dedicated) | Extract a `WaiterPosComponent` with mobile-first layout optimized for order-taking at the table. Currently waiters share `TablesComponent`. |
| Master Cashier view | Build a `/pos/hub` screen for supervisors showing all open cash register sessions, their running totals, and drawer status with real-time polling. |

---

## 5. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-09 | Free plan includes Thermal Printing | Printing is table-stakes for any POS. Locking it would make the Free plan unusable and damage conversion to paid. |
| 2026-04-09 | Free plan allows 3 users (not 1) | A fonda typically has owner + 1-2 cashiers. Limiting to 1 user makes the product impractical for the target market. |
| 2026-04-09 | KDS and Waiter Mode are Pro features | These require multi-device coordination and represent operational complexity that justifies the paid tier. |
| 2026-04-09 | Backend is the sole enforcer of limits | Frontend gates are UX hints only. The API must reject requests that exceed plan limits, regardless of how the request was made. |
| 2026-04-09 | Basic tier removed from pricing | Simplified to Free + Pro. The `PlanTypeId.Basic` enum value remains in code for backward compatibility and trial logic (trial users are treated as Basic). |
