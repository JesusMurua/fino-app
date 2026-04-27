# AUDIT-043 — "Lost" Portal: where the dual-entry UX actually lives

**Status:** Read-only audit. No files modified.
**Date:** 2026-04-26
**Branch:** `refactor/settings-and-product-ux`

---

## TL;DR

1. **No `auth-portal` component was ever deleted.** Searches across the file system and git history (`git log --diff-filter=D`) return zero traces of any component named portal / auth-portal / entry / landing / gateway. It never existed under those names.
2. **The "Admin vs Code" Portal is alive — it is the `'choose'` step inside `SetupComponent`.** Two buttons: *"Soy el administrador"* (email pairing flow) and *"Tengo un código"* (6-digit activation). Both flows are intact; `submitCode` still lives at [setup.component.ts:363-382](src/app/modules/setup/setup.component.ts#L363-L382).
3. **The actual regression** in AUDIT-042's fix is a single line in `entryRedirect`: fresh installs now default to `/login` (Admin-only) instead of `/setup` (the dual Portal). That cuts off the activation-code paste path on brand-new devices.
4. **Waiters are not broken.** A Waiter cannot use a non-configured device — devices must be paired first. Once configured, `entryRedirect` correctly sends them to `/pin` because either `LAST_AUTH_ENTRY === 'pin'` or, if absent, `isDeviceConfigured()` is true.

The fix is one line in [app.routes.ts:38](src/app/app.routes.ts#L38) — change the fresh-install fallback from `'/login'` to `'/setup'`.

---

## 1. The "Portal" component — where it actually is

### Search results
- `Glob '**/auth-portal*'` → no matches.
- `Glob '**/portal*'` → no matches in `src/`. Only `node_modules/caniuse-lite/data/features/portals.js` (irrelevant browser data).
- `Glob '**/entry*'`, `'**/gateway*'`, `'**/landing*'` → no matches in `src/`.
- `git log --all --diff-filter=D --name-only` → only `src/app/modules/punto-venta/*` was deleted (Angular 10 migration). No portal/entry/landing component appears.
- `git log` shows the recent routing commit (`1a0e93f fix: rediseño arquitectónico del ruteo dual (login vs pin)`) — the one from AUDIT-042's task. Nothing before that touched a Portal.

**Conclusion:** there is nothing to "restore." The mental model the user has — a screen with two buttons "Back Office vs Activation Code" — already exists in `SetupComponent`'s `'choose'` step.

### The `choose` step IS the Portal
[setup.component.html:20-61](src/app/modules/setup/setup.component.html#L20-L61):

```html
@if (!isValidating() && step() === 'choose') {
  <div class="setup-options">
    <button class="setup-option" (click)="goToEmail()">
      <span class="setup-option__icon"><i class="pi pi-envelope"></i></span>
      <span class="setup-option__text">
        <strong>Soy el administrador</strong>
        <span>Iniciar con email y contraseña</span>
      </span>
    </button>

    <button class="setup-option" (click)="goToCode()">
      <span class="setup-option__icon"><i class="pi pi-key"></i></span>
      <span class="setup-option__text">
        <strong>Tengo un código</strong>
        <span>Código de activación de 6 dígitos</span>
      </span>
    </button>
  </div>
}
```

This is a true two-button Portal — the only thing the previous fix did was stop landing fresh devices on it.

### The flows are intact
- `goToCode()` → step `'code'` → `submitCode()` POSTs to `/device/activate` and resolves into the `'code-review'` confirmation. ([setup.component.ts:362-382](src/app/modules/setup/setup.component.ts#L362-L382))
- `goToEmail()` → step `'email'` → `submitEmail()` POSTs to `/device/setup`, returns branches, then `'branch'` → `'mode'`. Email-pairing flow.

Neither was deleted. Both still register the device + persist its token via `DeviceService.registerDevice` before navigating.

---

## 2. What `app.routes.ts` actually contains today

[app.routes.ts:32-39](src/app/app.routes.ts#L32-L39):

```ts
function entryRedirect(): string {
  const configService = inject(ConfigService);
  const lastEntry = localStorage.getItem(LAST_AUTH_ENTRY_KEY);

  if (lastEntry === 'email') return '/login';
  if (configService.isDeviceConfigured()) return '/pin';
  return '/login';   // ← THE BUG
}
```

The fall-through return value is wrong. On a fresh install:
- `LAST_AUTH_ENTRY` is unset (no prior session in this browser).
- `isDeviceConfigured()` is false (never paired).
- The function returns `/login`.

`/login` is the **Back-Office-only email form**. It does **not** offer the activation-code path. There is no UI affordance from there to "I have a 6-digit code" — the user has to know to manually type `/setup` in the URL bar.

The `/setup` route ([app.routes.ts:56-61](src/app/app.routes.ts#L56-L61)) and its `provisioningGuard` are intact and untouched. The route just isn't reached automatically anymore.

---

## 3. What "Waiters use only PIN" actually means in this codebase

A Waiter:
- Never logs in via email. Their account uses a 4-digit PIN.
- The PIN form lives at `/pin` (PinComponent).
- PIN authentication requires a **configured terminal** — without device config, the terminal-side guards (`terminalGuard`, etc.) reject PIN-bound roles.
- Therefore: a Waiter cannot ever land on a fresh, unpaired device. Pairing always happens first, performed by an Admin.

So the worry "Waiters can't get in" isn't strictly true given the current redirect: once a device is paired, `isDeviceConfigured()` is true, and `entryRedirect` returns `/pin`. Waiters get there exactly as expected.

The real victim of the regression is the **Admin standing in front of a fresh terminal** holding a 6-digit code (or about to email-pair the device). They land on `/login` (which only authenticates a browser session, never registers a device token), are confused, and have no clear path to `/setup`.

---

## 4. Routing plan — restore the Portal access without re-trapping Admins

### Recommended fix (minimal — one line)
Change [app.routes.ts:38](src/app/app.routes.ts#L38):

```diff
-  return '/login';
+  return '/setup';
```

Resulting decision matrix:

| State | Browser localStorage | Device config | Resolves to | Why |
|------|----------------------|---------------|-------------|-----|
| Fresh install (default) | none | not configured | **`/setup`** | Portal's `'choose'` step shows email + code options. |
| Admin laptop, 2nd visit | `LAST_AUTH_ENTRY = 'email'` | (any) | `/login` | Returning Admin straight to Back Office login. |
| Configured terminal, post-pair | unset OR `'pin'` | configured | `/pin` | PIN entry for Cashiers / Waiters. |
| Admin re-opens after PIN session | `LAST_AUTH_ENTRY = 'pin'` | configured | `/pin` | Same browser was last a terminal. |
| Mid-session 401 from `/admin/*` | `LAST_AUTH_ENTRY = 'email'` (set by `handleLoginSuccess`) | configured | `/login` (via `adminShellGuard`/`logout()`) | AUDIT-042 fixes still apply. |

This single change:
- Restores the Portal access for fresh installs.
- Keeps the AUDIT-042 fixes for the trap chains (paths A/B/C in that audit).
- Does not require any new component or guard.

### Why NOT build a brand-new `/portal` route
A separate `/portal` would duplicate UX that already exists at `/setup`. Two costs:
- The same buttons in two places (drift risk, maintenance overhead).
- The "Tengo un código" button on `/portal` would either re-route to `/setup` (redundant) or duplicate the entire activation state machine. Both options are worse than just landing the user on `/setup` to begin with.

The only argument for a separate `/portal` is if the design wants to **add** a third option — "I just want to log in to the Back Office on this browser, not pair a device." That's a legitimate UX, but it's an additive feature, not a regression fix. Worth scoping as a follow-up if/when the design team asks.

### Optional polish (not required for the fix)
Inside `SetupComponent`'s `'choose'` step, a subtle link "¿Solo quieres entrar al Back Office?" → `/login` would let Admins who don't intend to pair a device skip past `/setup` cleanly. One line of HTML, no routing changes. Defer until the design pass.

---

## 5. What `app.routes.ts` should look like after the fix

```ts
function entryRedirect(): string {
  const configService = inject(ConfigService);
  const lastEntry = localStorage.getItem(LAST_AUTH_ENTRY_KEY);

  // Returning Back Office users — straight to email login.
  if (lastEntry === 'email') return '/login';

  // Returning terminal users (or any browser whose device was paired) —
  // straight to PIN entry. Cashiers / Waiters / Hosts live here.
  if (configService.isDeviceConfigured()) return '/pin';

  // Fresh install — go to the Portal (`/setup`'s `choose` step) which
  // exposes BOTH email pairing and 6-digit activation code paths.
  return '/setup';
}
```

No other route in the file needs to change. `provisioningGuard` already permits `/setup` for unconfigured devices.

---

## 6. Summary

- The "lost" Portal is not lost — it is the `'choose'` step at [setup.component.html:20-61](src/app/modules/setup/setup.component.html#L20-L61).
- The regression is a one-line wrong fall-through in [app.routes.ts:38](src/app/app.routes.ts#L38) sending fresh installs to `/login` instead of `/setup`.
- The activation-code flow is fully intact: [setup.component.ts:362-417](src/app/modules/setup/setup.component.ts#L362-L417).
- Waiters are not actually trapped — they can only reach configured devices, which still resolve to `/pin`.
- Recommended fix: change the fall-through return from `'/login'` to `'/setup'`. No new component, no new guard, no UI rework.

No files were modified by this audit.
