# AUDIT-042 — Login Routing Trap: How an Email Login Lands on `/setup`

**Status:** Read-only audit. No files modified.
**Scope:** Strictly the routing chain. UI of `/setup` is **not** in scope here (covered by AUDIT-041).
**Date:** 2026-04-26
**Branch:** `refactor/settings-and-product-ux`

---

## TL;DR — five smoking guns

| # | File:Line | Bug | Effect on Admin login |
|---|-----------|-----|----------------------|
| 1 | [app.routes.ts:14-19](src/app/app.routes.ts#L14-L19) | `''` redirects unconditionally to `'pin'` | Every Admin who lands at `/` is treated as a terminal user before any role check. |
| 2 | [app.routes.ts:113-117](src/app/app.routes.ts#L113-L117) | Catch-all `'**'` redirects to `'pin'` | Any unknown URL (including stale Back Office bookmarks) flows into the terminal entry. |
| 3 | [auth.guard.ts:22-25](src/app/core/guards/auth.guard.ts#L22-L25) | Unauthenticated → redirects to `/pin` (not `/login`) | An unauthenticated user trying to reach `/admin/*` is funneled into the terminal flow. |
| 4 | [auth.service.ts:370-386](src/app/core/services/auth.service.ts#L370-L386) | `logout()` hard-navigates to `/pin` | When mid-flight rehydration kicks an Admin out, the redirect target is the terminal entry. |
| 5 | [admin-shell.guard.ts:25-29](src/app/core/guards/admin-shell.guard.ts#L25-L29) | On `unauthorized`, redirects to `/pin` | The Back Office shell guard itself sends a Back Office user to the terminal when its rehydration call fails. |

Items #4 and #5 race each other (both fire on a 401 from `/auth/me`); items #1, #2, #3 close the door on returning. Items #1 and #2 cannot see the role because they execute before any auth resolution.

---

## 1. The exact route the login submits

[login.component.ts:43-66](src/app/modules/login/login.component.ts#L43-L66):

```ts
async submit(): Promise<void> {
  if (!this.email || !this.password) return;
  …
  const user = await this.authService.emailLogin(this.email, this.password);
  …
  if (user) {
    const returnUrl = this.authService.consumeReturnUrl();
    const resolved = this.deviceRoutingService.getPostLoginRoute(user.roleId);
    const defaultRoute = resolved.kind === 'route' ? resolved.route : '/admin';
    this.router.navigateByUrl(returnUrl ?? defaultRoute);
  }
  …
}
```

For an Owner / Manager:
- `getPostLoginRoute(Owner)` returns `/admin` ([device-routing.service.ts:51-54](src/app/core/services/device-routing.service.ts#L51-L54)).
- `defaultRoute` resolves to `'/admin'`.
- `returnUrl` reads `RETURN_URL_KEY` from localStorage (set earlier by `authGuard`).

So **`router.navigateByUrl(returnUrl ?? '/admin')`** is the navigation target. **By itself this line is correct.** The trap is everything that happens after the navigation starts.

### Caveat: `returnUrl` is half-broken
[auth.guard.ts:23](src/app/core/guards/auth.guard.ts#L23):

```ts
localStorage.setItem(RETURN_URL_KEY, route.routeConfig?.path ?? '/');
```

`route.routeConfig?.path` is the **route definition string** (e.g. `'admin'`), not the user's actual URL (e.g. `/admin/products/123/edit`). So when login resumes, the user is dropped at `/admin` regardless of how deep they were trying to go. Cosmetic for this audit, but worth flagging — the contract of "return to where you were" is silently violated.

---

## 2. The default empty path is hostile to Back Office users

[app.routes.ts:14-19](src/app/app.routes.ts#L14-L19):

```ts
{
  path: '',
  redirectTo: 'pin',
  pathMatch: 'full',
},
```

The empty path **does not evaluate the user's role**. It hard-redirects to `/pin` (terminal entry), and the catch-all at [app.routes.ts:113-117](src/app/app.routes.ts#L113-L117):

```ts
{
  path: '**',
  redirectTo: 'pin',
},
```

…does the same for any unknown URL. An Admin with a perfectly valid JWT, but who lands at `/`, has zero opportunity to be routed to `/admin` from this layer — they are pushed into terminal territory before any guard inspects who they are.

This is what enables Path A in the trap chain (Section 4).

---

## 3. The Back Office shell guard returns an Admin to the terminal on rehydration failure

### `adminShellGuard` — the wrong fallback

[admin-shell.guard.ts:21-32](src/app/core/guards/admin-shell.guard.ts#L21-L32):

```ts
export const adminShellGuard: CanActivateFn = async () => {
  const rehydration = inject(SessionRehydrationService);
  const router = inject(Router);

  const result = await rehydration.hydrateForShell('admin');

  if (result === 'unauthorized' || result === 'no-session') {
    return router.createUrlTree(['/pin']);   // ← BUG: should be /login
  }

  return true;
};
```

Comment at [admin-shell.guard.ts:18-19](src/app/core/guards/admin-shell.guard.ts#L18-L19) acknowledges `unauthorized` and `no-session` are the two failure paths, but both route to `/pin` — the **terminal** entry — not `/login`. A Back Office user who arrived from the Back Office is sent through the terminal's setupGuard.

### `SessionRehydrationService` already calls `logout()` on 401

[session-rehydration.service.ts:104-126](src/app/core/services/session-rehydration.service.ts#L104-L126):

```ts
private async runRefresh(shell?: ShellId): Promise<RehydrationResult> {
  try {
    await firstValueFrom(this.authService.rehydrate());
    return 'ok';
  } catch (error: unknown) {
    …
    const status = this.readStatus(error);
    if (status === 401 || status === 403) {
      this.authService.logout();          // ← this also navigates to /pin
      return 'unauthorized';
    }
    …
  }
}
```

So when `/auth/me` returns 401, the shell guard:
1. Receives `'unauthorized'` from the service.
2. The service has **already called `authService.logout()`**.
3. `logout()` clears state AND navigates: [auth.service.ts:370-386](src/app/core/services/auth.service.ts#L370-L386):
   ```ts
   logout(): void {
     localStorage.removeItem(AUTH_TOKEN_KEY);
     localStorage.removeItem(AUTH_USER_KEY);
     …
     this.currentUser.set(null);
     …
     this.router.navigate(['/pin']);
   }
   ```
4. Then the shell guard tries to return a `UrlTree` for `/pin`. By the time the router resolves that, `currentUser()` is already null.

Two redirects to `/pin` race each other, and either way, the Admin lands at `/pin` with their session wiped.

---

## 4. Step-by-step execution chains that trap the Admin

### Chain C — the most likely match for the user's report

User reports: "I logged in as Admin and was unexpectedly forced into `/setup`."

| Step | URL | Code path | State after |
|------|-----|-----------|-------------|
| 1 | `/login` | User submits credentials. [login.component.ts:49](src/app/modules/login/login.component.ts#L49) | JWT received; `handleLoginSuccess` writes token + user to localStorage + signals at [auth.service.ts:558-566](src/app/core/services/auth.service.ts#L558-L566). |
| 2 | `/login` | [login.component.ts:55-61](src/app/modules/login/login.component.ts#L55-L61) computes `defaultRoute = '/admin'` and calls `router.navigateByUrl('/admin')`. | Navigation begins. |
| 3 | `/admin/...` | `authGuard` runs. `isAuthenticated()` is `true`. `isOnboardingComplete()` is `true`. Guard passes. ([auth.guard.ts:22-29](src/app/core/guards/auth.guard.ts#L22-L29)) | Continues. |
| 4 | `/admin/...` | `roleGuard` runs. Owner is in `[Owner, Manager]`. Passes. ([app.routes.ts:74-78](src/app/app.routes.ts#L74-L78)) | Continues. |
| 5 | `/admin/...` | `adminShellGuard` runs. Calls `hydrateForShell('admin')` → `runRefresh` → `GET /auth/me`. ([admin-shell.guard.ts:25](src/app/core/guards/admin-shell.guard.ts#L25), [session-rehydration.service.ts:70-79](src/app/core/services/session-rehydration.service.ts#L70-L79)) | Network call in flight. |
| 6 | (in flight) | `/auth/me` returns **401** (clock skew, token-issuance lag, or backend invalidating very-recent tokens for some reason). | — |
| 7 | (synchronous) | [session-rehydration.service.ts:115-118](src/app/core/services/session-rehydration.service.ts#L115-L118) calls `this.authService.logout()`. `logout()` clears localStorage + signals AND triggers `this.router.navigate(['/pin'])`. ([auth.service.ts:370-386](src/app/core/services/auth.service.ts#L370-L386)) | `currentUser()` = null. localStorage tokens removed. Navigation to `/pin` queued. |
| 8 | `/pin` | `setupGuard` runs. ([setup.guard.ts:23-40](src/app/core/guards/setup.guard.ts#L23-L40)) | — |
| 9 | `/pin` (still in guard) | `sessionType()` is null (no user). `isBackOfficeRole(currentUser()?.roleId)` is `false` (user is null). | Both bypasses fail. |
| 10 | `/pin` (still in guard) | `configService.isDeviceConfigured()` is `false` (this device has never been provisioned with a code). | Guard returns `router.createUrlTree(['/setup'])`. |
| 11 | `/setup` | `provisioningGuard` runs. `isDeviceConfigured()` is `false`. ([provisioning.guard.ts:21-23](src/app/core/guards/provisioning.guard.ts#L21-L23)) | Allows. |
| 12 | `/setup` | `SetupComponent` renders. The Owner is now staring at the device-pairing UI. | **Trapped.** |

### Chain B — Admin clicks a Back Office bookmark while their session expired

| Step | URL | What happens |
|------|-----|--------------|
| 1 | `/admin/products` | User opens a stale tab / clicks bookmark. |
| 2 | `/admin/products` | `authGuard` finds `isAuthenticated()` is `false` (token expired). Stores `RETURN_URL_KEY = 'admin'` (note: NOT `/admin/products` — see Section 1 caveat) and redirects to `/pin`. ([auth.guard.ts:22-25](src/app/core/guards/auth.guard.ts#L22-L25)) |
| 3 | `/pin` | `setupGuard`: no session, no email, device not configured → `/setup`. ([setup.guard.ts:23-40](src/app/core/guards/setup.guard.ts#L23-L40)) |
| 4 | `/setup` | Trapped. |

### Chain A — Admin lands at the app root

| Step | URL | What happens |
|------|-----|--------------|
| 1 | `/` | Empty path matches the redirect rule at [app.routes.ts:14-19](src/app/app.routes.ts#L14-L19). |
| 2 | `/pin` | `setupGuard`. If the session is in any way invalid (or simply not yet loaded), fails the bypasses. Device not configured → `/setup`. |
| 3 | `/setup` | Trapped. |

---

## 5. Why the bypass logic in `setupGuard` cannot save them

[setup.guard.ts:23-40](src/app/core/guards/setup.guard.ts#L23-L40):

```ts
if (authService.sessionType() === 'email') return true;
if (isBackOfficeRole(authService.currentUser()?.roleId)) return true;

if (!configService.isDeviceConfigured()) {
  return router.createUrlTree(['/setup']);
}
```

Both bypasses dereference live state on `authService`. In **Chain C** that state has just been wiped by `logout()` (step 7 above). In **Chain B** the state was never set because the user is not authenticated. In **Chain A** the state may not have been read from storage in time, but more importantly the bypass relies on the user being an Admin — `/pin` is generally a terminal entry, so this guard is not the right place to save Admins.

The guard is also missing a sticky "this user was Back Office last login" hint — there is no `previousRole` flag persisted across logout. Once `logout()` clears localStorage at [auth.service.ts:371-373](src/app/core/services/auth.service.ts#L371-L373), the routing layer has no way to remember "this is an Admin who needs `/login`, not a Cashier who needs `/pin`."

---

## 6. Where the wrong assumption is encoded

The whole routing tree implicitly treats `/pin` as **the** unauthenticated landing page. Five separate places (#1–#5 in the TL;DR) bake that assumption in. None of them differentiate between:

- A terminal user (Cashier / Waiter) whose post-auth path runs through PIN — `/pin` is correct.
- A Back Office user (Owner / Manager) whose post-auth path runs through email — `/login` is correct.

The fix is structural: every redirect that today says `'/pin'` must first ask "is this a Back Office surface or a terminal surface?" and pick the corresponding entry. The cleanest split is to add a tiny helper (e.g. `routeAccessPolicy.entryRouteFor(targetUrl)`) and have every `router.navigate(['/pin'])` and `router.createUrlTree(['/pin'])` route through it.

---

## 7. Summary of the bad redirects (file + line)

| Place | Current behavior | Why it traps Admin |
|-------|------------------|---------------------|
| [app.routes.ts:14-19](src/app/app.routes.ts#L14-L19) | `''` → `pin` | Loses the chance to inspect role at the entry. |
| [app.routes.ts:113-117](src/app/app.routes.ts#L113-L117) | `'**'` → `pin` | Same problem on every unknown URL. |
| [auth.guard.ts:22-25](src/app/core/guards/auth.guard.ts#L22-L25) | Unauth → `/pin` | Sends an Admin trying to reach `/admin/*` into terminal flow. |
| [auth.service.ts:370-386](src/app/core/services/auth.service.ts#L370-L386) | `logout()` always navigates to `/pin` | Wipes the Admin's session and dumps them at the terminal entry. |
| [admin-shell.guard.ts:25-29](src/app/core/guards/admin-shell.guard.ts#L25-L29) | `unauthorized` / `no-session` → `/pin` | Back Office shell sends Back Office users to terminal. |
| [auth.guard.ts:23](src/app/core/guards/auth.guard.ts#L23) | Stores `route.routeConfig?.path` | `RETURN_URL_KEY` loses deep URL — Admin returns to `/admin`, not `/admin/products/123`. |

These are independently broken; fixing only one will not fully unstick the Admin. The minimum coherent set is **#3, #4, #5 all simultaneously**, and ideally **#1 and #2** too so the empty path and catch-all do role-aware routing.

No files were modified by this audit.
