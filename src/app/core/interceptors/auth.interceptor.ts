import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { tap } from 'rxjs';

import { AUTH_TOKEN_KEY, DeviceConfig } from '../models';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';
import { DeviceService } from '../services/device.service';

/** Public endpoints that must never receive a Bearer token */
const PUBLIC_PATHS = ['/api/auth/pin-login', '/api/auth/email-login'];

/** Routes where a 401 should NOT trigger logout (user is not expected to be authenticated) */
const PUBLIC_ROUTES = ['/register', '/setup', '/onboarding', '/login'];

/**
 * Device modes that prefer the long-lived device token over the user
 * token. Admin-mode devices still use the user token because back
 * office API calls need the human context (who created this report).
 */
const DEVICE_TOKEN_MODES: readonly DeviceConfig['mode'][] = ['kitchen', 'kiosk', 'reception'];

/**
 * Functional HTTP interceptor (Angular 18+).
 *
 * - Attaches Authorization: Bearer {token} to every request except public auth endpoints
 * - On infrastructure devices (mode: kitchen / kiosk) the long-lived
 *   device token is preferred over the user token, so the machine can
 *   talk to the API without a human being logged in
 * - On 401 response → calls AuthService.logout() to clear state and redirect to /pin
 *   (skipped on public routes where 401 is expected)
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const authService = inject(AuthService);
  const configService = inject(ConfigService);
  const deviceService = inject(DeviceService);

  const isPublic = PUBLIC_PATHS.some(path => req.url.includes(path));

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let request = req.clone({
    setHeaders: { 'X-Timezone': timezone },
  });

  if (!isPublic) {
    const bearer = resolveBearerToken(configService, deviceService, req.url);
    if (bearer) {
      request = request.clone({
        setHeaders: { Authorization: `Bearer ${bearer}`, 'X-Timezone': timezone },
      });
    }
  }

  const messageService = inject(MessageService);

  return next(request).pipe(
    tap({
      error: (error) => {
        if (error.status === 401 && !isPublic) {
          const currentPath = window.location.pathname;
          const isPublicRoute = PUBLIC_ROUTES.some(route => currentPath.startsWith(route));
          // `/redeem-link-code` carries the device JWT (see `resolveBearerToken`).
          // A 401 here means the device JWT is missing/expired or the code does
          // not match this device — it is NOT a session-auth failure, so we let
          // the error propagate to the caller's `catch` for an inline toast
          // instead of nuking the user's session and bouncing them to /pin.
          const isRedeemRoute = request.url.includes('/redeem-link-code');
          if (!isPublicRoute && !isRedeemRoute) {
            authService.logout();
          }
        }

        if (error.status === 402) {
          const body = error.error;
          const detail = body?.message ?? 'Límite de plan alcanzado. Mejora a Pro para continuar.';
          messageService.add({
            severity: 'warn',
            summary: 'Plan limitado',
            detail,
            life: 6000,
          });
        }
      },
    }),
  );
};

/**
 * Resolves which bearer token this request should carry.
 *
 * Resolution order (first match wins):
 *
 *   1. URL-specific override — `/redeem-link-code` (FDD-019) is the
 *      ONLY endpoint that resolves its target device server-side from
 *      the device JWT and does not require a human role claim. It
 *      MUST carry the device token even when the local mode is
 *      `cashier` / `tables`. Zero-fallback applies: if the device
 *      token is missing or expired we return `null` so the backend
 *      responds with a clean 401 instead of accepting a misleading
 *      user JWT that would never satisfy the redeem-link-code
 *      contract. (See FDD-022 for why other endpoints — formerly
 *      under this override in FDD-020/021 — were rolled back.)
 *
 *   2. Infrastructure-mode policy — if the device mode is one of
 *      `DEVICE_TOKEN_MODES` (kitchen / kiosk / reception) we commit
 *      to the device token. A valid token is returned verbatim;
 *      anything else resolves to `null` so the request fires without
 *      an Authorization header. The resulting 401 tells the backend
 *      and the frontend that the machine has lost its identity and
 *      must be re-provisioned. Under NO circumstance does an
 *      infrastructure device borrow a human user's token.
 *
 *   3. Default — for every other mode (cashier / tables / mobile) we
 *      keep the existing user-token flow, skipping the
 *      `offline-session-*` marker that must never hit the API.
 *
 * @param url Full request URL — used by step (1) to detect endpoints
 *            that require the device JWT regardless of the local mode.
 */
function resolveBearerToken(
  configService: ConfigService,
  deviceService: DeviceService,
  url: string,
): string | null {
  // (1) URL-specific override — `/redeem-link-code` only.
  //     The backend resolves the redeeming device strictly from the
  //     device JWT (caja-binding domain, no human role required).
  //     Zero-fallback: if the device token is missing/expired we
  //     return `null` so the backend gets a clean 401.
  if (url.includes('/redeem-link-code')) {
    return deviceService.hasValidDeviceToken()
      ? deviceService.getDeviceToken()
      : null;
  }

  const mode = configService.deviceConfig$.getValue().mode;

  // (2) Infrastructure-mode policy
  if (DEVICE_TOKEN_MODES.includes(mode)) {
    return deviceService.hasValidDeviceToken()
      ? deviceService.getDeviceToken()
      : null;
  }

  // (3) Default — user-token flow
  const userToken = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!userToken) return null;
  if (userToken.startsWith('offline-session-')) return null;
  return userToken;
}
