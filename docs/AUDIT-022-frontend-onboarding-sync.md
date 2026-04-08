# AUDIT-022: Frontend Onboarding State Sync with Backend Persistence

**Date:** 2026-04-08
**Status:** Open
**Severity:** High (data loss on refresh — users restart onboarding from scratch)

---

## 1. Executive Summary

The onboarding wizard currently stores step progress exclusively in an Angular signal (`currentStep = signal(1)`). This state is **volatile** — a page refresh, accidental navigation, or browser crash resets the user to Step 1. The backend now exposes `OnboardingStatusId` (1=Pending, 2=InProgress, 3=Completed), `CurrentOnboardingStep` (int), and a new `PUT /api/business/onboarding-step` endpoint. This audit maps the exact integration points needed to make onboarding progress persistent.

---

## 2. Current Architecture (Before)

### 2.1 State Storage

| What | Where | Persistence | Survives Refresh? |
|------|-------|-------------|-------------------|
| Current step (1–4) | `currentStep = signal(1)` | In-memory signal | **No** |
| Selected giros | `selectedGiros = signal<BusinessType[]>([])` | In-memory signal | **No** |
| Custom giro text | `customGiroText = signal('')` | In-memory signal | **No** |
| Zones config | `zones: ZoneDraft[]` | Component property | **No** |
| Folio prefix | `folioPrefix = ''` | Component property | **No** |
| Product form | `productForm: FormGroup` | Reactive form | **No** |
| Device mode | `selectedMode = signal('cashier')` | In-memory signal | **No** |
| Completion flag | localStorage `onboarding-completed-{branchId}` | localStorage | **Yes** |
| Completion flag | JWT claim `onboardingCompleted` | JWT (server) | **Yes** |

**Key problem:** Only the final completion flag survives a refresh. All intermediate progress is lost.

### 2.2 Step Flow in the Component

**File:** [`onboarding.component.ts`](src/app/modules/onboarding/onboarding.component.ts)

```
ngOnInit() (line 320)
  └── Sets jwtGiro, selectedGiros from JWT
  └── refreshZoneSuggestions()
  └── Reads pendingPlan from localStorage
  └── Redirects to /login if not authenticated

nextStep() (line 348)
  └── If leaving step 1 → refreshZoneSuggestions()
  └── currentStep.update(s => s + 1)   ← PURE MEMORY, no API call

prevStep() (line 359)
  └── currentStep.update(s => s - 1)   ← PURE MEMORY, no API call

completeOnboarding() (line 499)
  └── API calls: business/type, zones, folio, products, device config
  └── POST /api/business/complete-onboarding → new JWT
  └── localStorage: onboarding-completed-{branchId} = 'true'
```

### 2.3 Guard Logic

**Two guards** check onboarding status, with **duplicated logic**:

**[`auth.guard.ts:30-49`](src/app/core/guards/auth.guard.ts#L30-L49)** — Step 2 of the guard chain:
```typescript
// Duplicated ONBOARDING_KEY_PREFIX = 'onboarding-completed-'
let onboardingDone = localStorage.getItem(`${ONBOARDING_KEY_PREFIX}${branchId}`) === 'true';
if (!onboardingDone) {
  // Decode JWT → check payload.onboardingCompleted
}
if (!onboardingDone) return router.createUrlTree(['/onboarding']);
```

**[`onboarding.guard.ts:18-45`](src/app/core/guards/onboarding.guard.ts#L18-L45)** — Standalone guard (only on `/admin`):
```typescript
// Same duplicated logic — localStorage first, then JWT claim fallback
```

**Problems:**
1. Both guards duplicate the same `ONBOARDING_KEY_PREFIX` constant and JWT decode logic.
2. Neither guard knows about `OnboardingStatusId` or `CurrentOnboardingStep`.
3. `onboardingGuard` is only applied to `/admin` (line 64 of `app.routes.ts`), but `authGuard` also checks onboarding for all protected routes — so `onboardingGuard` is effectively redundant.

---

## 3. New Backend Contract

### 3.1 New Endpoint

```
PUT /api/business/onboarding-step
Body: { statusId: number, step: number }
Response: 204 No Content
```

| Field | Type | Values |
|-------|------|--------|
| `statusId` | int | 1=Pending, 2=InProgress, 3=Completed |
| `step` | int | 1=Giro, 2=Zones/Folio, 3=Product, 4=Device |

### 3.2 Expected JWT Claim Changes

The backend should include in the JWT (or LoginResponse):
- `onboardingStatusId: number` — replaces the boolean `onboardingCompleted`
- `currentOnboardingStep: number` — which step the user was on

### 3.3 Complete-Onboarding Endpoint (Existing)

```
POST /api/business/complete-onboarding
Response: LoginResponse (new JWT with onboardingStatusId=3)
```

Already called at [`onboarding.component.ts:599-601`](src/app/modules/onboarding/onboarding.component.ts#L599-L601).

---

## 4. Implementation Plan

### Step 1: Update Models — `auth.model.ts`

**File:** [`src/app/core/models/auth.model.ts`](src/app/core/models/auth.model.ts)

Add onboarding fields to both interfaces:

```typescript
// In AuthUser (line 13):
export interface AuthUser {
  // ... existing fields ...
  /** 1=Pending, 2=InProgress, 3=Completed */
  onboardingStatusId?: number;
  /** Last completed onboarding step (1-based) */
  currentOnboardingStep?: number;
}

// In LoginResponse (line 30):
export interface LoginResponse {
  // ... existing fields ...
  onboardingStatusId?: number;
  currentOnboardingStep?: number;
}
```

**Why optional:** Backward compatibility. Old JWTs without these fields still work (guards fall back to existing `onboardingCompleted` check).

### Step 2: Create `BusinessService` — New Service

**File to create:** `src/app/core/services/business.service.ts`

**Rationale:** The onboarding component currently makes raw `HttpClient` calls to `/business/*` endpoints (lines 401-404, 505-510). A dedicated `BusinessService` centralizes these and adds the new step-sync endpoint.

```typescript
@Injectable({ providedIn: 'root' })
export class BusinessService {
  private readonly api = inject(ApiService);

  /** Updates business type(s) */
  updateBusinessTypes(types: BusinessType[], customDesc: string | null): Observable<void> { ... }

  /** Syncs the current onboarding step to the backend */
  syncOnboardingStep(statusId: number, step: number): Observable<void> {
    return this.api.put<void>('/business/onboarding-step', { statusId, step });
  }

  /** Marks onboarding as complete — returns new JWT */
  completeOnboarding(): Observable<LoginResponse> {
    return this.api.post<LoginResponse>('/business/complete-onboarding', {});
  }
}
```

**Why a new service instead of adding to `AuthService`:** AuthService is already 450+ lines and handles authentication, subscription, and branch switching. Business configuration (giro, onboarding, folio) is a separate domain concern. The coding standards recommend feature-oriented services extending a base class.

### Step 3: Wire `syncOnboardingStep()` into `nextStep()` and `prevStep()`

**File:** [`onboarding.component.ts`](src/app/modules/onboarding/onboarding.component.ts)

**Current `nextStep()` (line 348):**
```typescript
nextStep(): void {
  if (this.currentStep() < this.totalSteps()) {
    if (this.currentStep() === 1) {
      this.refreshZoneSuggestions();
    }
    this.currentStep.update(s => s + 1);
    // ← No API call
  }
}
```

**Proposed change — fire-and-forget API sync after each step advance:**

```typescript
nextStep(): void {
  if (this.currentStep() < this.totalSteps()) {
    if (this.currentStep() === 1) this.refreshZoneSuggestions();
    this.currentStep.update(s => s + 1);
    // Sync to backend — best-effort, never blocks UI
    this.businessService.syncOnboardingStep(2, this.currentStep())
      .subscribe({ error: () => {} });
  }
}
```

**Design decisions:**
- **Best-effort, fire-and-forget:** The onboarding must remain offline-friendly. The API call runs in the background; failure doesn't block navigation.
- **statusId=2 (InProgress):** Any step transition means the user is actively onboarding.
- **`this.currentStep()`** is sent **after** the `update()` call — signal updates are synchronous, so the new value is already available.

**`prevStep()` (line 359):** Same pattern — sync the new step number after going back.

### Step 4: Restore Step on `ngOnInit()` (Fast-Forward on Refresh)

**File:** [`onboarding.component.ts:320`](src/app/modules/onboarding/onboarding.component.ts#L320)

**Current `ngOnInit()`:**
```typescript
ngOnInit(): void {
  const jwtGiro = this.authService.businessType();
  if (jwtGiro) { ... }
  this.refreshZoneSuggestions();
  // ← No step restoration
}
```

**Proposed addition — read `currentOnboardingStep` from user profile:**

```typescript
ngOnInit(): void {
  // Restore step from user profile (survives refresh)
  const user = this.authService.currentUser();
  const savedStep = user?.currentOnboardingStep;
  if (savedStep && savedStep > 1 && savedStep <= this.totalSteps()) {
    this.currentStep.set(savedStep);
  }

  // ... existing init logic ...
}
```

**How the step gets into `currentUser()`:** The `handleLoginSuccess()` method in `AuthService` already persists the full `LoginResponse` into localStorage. Once we add `currentOnboardingStep` to the `AuthUser` interface (Step 1), it flows automatically through:

```
Login API → LoginResponse → handleLoginSuccess() → localStorage → loadUserFromStorage() → currentUser()
```

**Edge case — Step data but no form data:** If the user refreshes on Step 3 (product form), we restore them to Step 3 but the form fields are empty. This is acceptable because:
- Step 1 (giros) is re-read from JWT/user profile
- Step 2 (zones/folio) has no required fields
- Step 3 (product) already has a "Skip" button
- Step 4 (device) has sensible defaults

### Step 5: Update `handleLoginSuccess()` in `AuthService`

**File:** [`auth.service.ts:378-407`](src/app/core/services/auth.service.ts#L378-L407)

Add the new fields to the `AuthUser` construction:

```typescript
const user: AuthUser = {
  // ... existing fields ...
  onboardingStatusId: response.onboardingStatusId,
  currentOnboardingStep: response.currentOnboardingStep,
};
```

No other changes needed — the persistence chain (`JSON.stringify → localStorage → loadUserFromStorage`) handles the new fields automatically.

### Step 6: Update Guards to Use `onboardingStatusId`

#### 6a. Consolidate into a single check function

**Problem:** The onboarding-completed check is duplicated in both `auth.guard.ts` (lines 30-49) and `onboarding.guard.ts` (lines 18-45), with identical logic. This should be a single function.

**Proposed approach — helper in `AuthService`:**

```typescript
// In AuthService
readonly isOnboardingComplete = computed(() => {
  const user = this.currentUser();
  // New field takes priority
  if (user?.onboardingStatusId === 3) return true;
  // Fallback: localStorage
  const branchId = this.activeBranchId();
  if (localStorage.getItem(`onboarding-completed-${branchId}`) === 'true') return true;
  // Fallback: JWT claim (backward compat)
  const token = this.getToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.onboardingCompleted === 'true' || payload.onboardingCompleted === true) return true;
    } catch {}
  }
  return false;
});
```

#### 6b. Simplify both guards

**`auth.guard.ts`** — Replace the 15-line onboarding block (lines 30-49) with:

```typescript
// 2. Onboarding check
if (!authService.isOnboardingComplete()) {
  return router.createUrlTree(['/onboarding']);
}
```

**`onboarding.guard.ts`** — Replace the entire guard body with:

```typescript
export const onboardingGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.isOnboardingComplete() ? true : router.createUrlTree(['/onboarding']);
};
```

#### 6c. Status-aware redirect for InProgress users

If `onboardingStatusId === 2` (InProgress), the guard redirects to `/onboarding` and the component's `ngOnInit()` fast-forwards to the saved step. No additional guard logic needed.

### Step 7: Update `completeOnboarding()` — Set statusId=3

**File:** [`onboarding.component.ts:499`](src/app/modules/onboarding/onboarding.component.ts#L499)

The existing `POST /api/business/complete-onboarding` call already sets the backend to Completed (statusId=3). The new JWT returned will include `onboardingStatusId: 3`, which flows through `handleLoginSuccess()` into `currentUser()`.

**One addition needed:** After `handleLoginSuccess()`, sync localStorage:

```typescript
// After handleLoginSuccess(response):
localStorage.setItem(`onboarding-completed-${branchId}`, 'true');
// Already present at line 640 — no change needed
```

---

## 5. Data Flow Diagram (After)

```
┌────────────────────────────────────────────────────────────────────┐
│                    User clicks "Siguiente"                         │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  nextStep()   │
                  └───────┬───────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
   currentStep.update(s+1)    PUT /api/business/onboarding-step
   (immediate, in-memory)     { statusId: 2, step: s+1 }
                              (fire-and-forget, best-effort)
                                      │
                                      ▼
                            ┌─────────────────┐
                            │  Backend writes  │
                            │  OnboardingStep  │
                            │  to SQL Server   │
                            └─────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                    User refreshes browser                          │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  ngOnInit()   │
                  └───────┬───────┘
                          │
                          ▼
         currentUser()?.currentOnboardingStep
         (from localStorage, originally from JWT)
                          │
                          ▼
              ┌───────────────────────┐
              │ currentStep.set(saved)│
              │ → fast-forward to     │
              │   the correct step    │
              └───────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                    User clicks "Finalizar"                         │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ completeOnboarding()  │
              └───────────┬───────────┘
                          │
                          ▼
         POST /api/business/complete-onboarding
                          │
                          ▼
              ┌───────────────────────┐
              │ handleLoginSuccess()  │
              │ → new JWT with        │
              │   onboardingStatusId=3│
              └───────────┬───────────┘
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
           localStorage       currentUser()
           completed=true     statusId=3
```

---

## 6. Files to Modify

| # | File | Changes | Risk |
|---|------|---------|------|
| 1 | [`src/app/core/models/auth.model.ts`](src/app/core/models/auth.model.ts) | Add `onboardingStatusId`, `currentOnboardingStep` to both interfaces | None (optional fields) |
| 2 | `src/app/core/services/business.service.ts` | **Create new file** — `syncOnboardingStep()`, `completeOnboarding()`, `updateBusinessTypes()` | None (new file) |
| 3 | [`src/app/core/services/auth.service.ts`](src/app/core/services/auth.service.ts) | Add `isOnboardingComplete` computed; map new fields in `handleLoginSuccess()` | Low — additive changes |
| 4 | [`src/app/modules/onboarding/onboarding.component.ts`](src/app/modules/onboarding/onboarding.component.ts) | Inject `BusinessService`; add sync calls in `nextStep()`/`prevStep()`; restore step in `ngOnInit()`; use service for API calls | Medium — core wizard logic |
| 5 | [`src/app/core/guards/auth.guard.ts`](src/app/core/guards/auth.guard.ts) | Replace 15-line onboarding block with `isOnboardingComplete()` call | Low — simplification |
| 6 | [`src/app/core/guards/onboarding.guard.ts`](src/app/core/guards/onboarding.guard.ts) | Simplify to use `isOnboardingComplete()` | Low — simplification |

**Total files:** 5 modified, 1 created

---

## 7. Edge Cases & Risks

### 7.1 Offline Users

The `PUT /api/business/onboarding-step` call is fire-and-forget. If the user is offline:
- The step sync silently fails.
- The user can still complete onboarding (all API calls in `completeOnboarding()` are best-effort).
- On next login, the backend still shows step 1 — but this is acceptable because the onboarding will already be completed (statusId=3 from the `complete-onboarding` endpoint which runs at the end).

### 7.2 Backward Compatibility — Old JWTs Without New Fields

- `onboardingStatusId` and `currentOnboardingStep` are optional on `AuthUser`.
- Guards check `onboardingStatusId === 3` first, then fall back to `onboardingCompleted` claim, then localStorage.
- No migration needed for existing users.

### 7.3 Step Restoration Without Form Data

If a user refreshes on Step 3 (product), we restore them to Step 3 but the product form is empty. Acceptable because Step 3 has a prominent "Saltar este paso" button.

**Future improvement (out of scope):** Save draft form data in localStorage keyed by branchId.

### 7.4 Race Condition — Multiple Tabs

If the user opens onboarding in two tabs, both write to the same backend step. The last-write-wins. This is acceptable for the onboarding use case (single-user, single-session).

### 7.5 `onboardingGuard` Redundancy on `/admin`

`authGuard` already checks onboarding for all protected routes. The separate `onboardingGuard` on `/admin` is redundant but harmless. **Recommendation:** Remove `onboardingGuard` from `app.routes.ts:64` after migrating the logic into `authGuard`. This is a cleanup item, not a blocker.

---

## 8. Sequencing Recommendation

| Order | Task | Depends On | Blocked By |
|-------|------|------------|------------|
| 1 | Update `auth.model.ts` (add fields) | Nothing | Nothing |
| 2 | Create `business.service.ts` | auth.model.ts | Nothing |
| 3 | Update `auth.service.ts` (`isOnboardingComplete`, `handleLoginSuccess`) | auth.model.ts | Nothing |
| 4 | Simplify guards (`auth.guard.ts`, `onboarding.guard.ts`) | auth.service.ts changes | Nothing |
| 5 | Wire sync calls into `onboarding.component.ts` | business.service.ts | Backend endpoint deployed |
| 6 | Add step restoration in `ngOnInit()` | auth.model.ts fields present in JWT | Backend including fields in JWT |

**Tasks 1-4 can be shipped immediately** (frontend-only, backward-compatible). Tasks 5-6 require the backend endpoint to be deployed.

---

## 9. Conclusion

The integration is straightforward — 5 modified files and 1 new service. The critical design decision is **fire-and-forget step sync** to preserve the offline-first guarantee. The guard consolidation is a bonus cleanup that removes ~30 lines of duplicated JWT-decode logic across two files.
