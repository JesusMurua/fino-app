import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
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
const DEVICE_TOKEN_MODES: readonly DeviceConfig['mode'][] = ['kitchen', 'kiosk'];

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
  // Capture the injector instead of resolving AuthService eagerly. AuthService's
  // constructor triggers an HTTP call (catalog fetch via TenantContextService),
  // which re-enters this interceptor — eager `inject(AuthService)` here would
  // cycle (NG0200). The 401 handler uses `runInInjectionContext` below to lazy-
  // inject AuthService only when actually needed; by then the constructor has
  // returned and the cached instance is available.
  const injector = inject(EnvironmentInjector);
  const configService = inject(ConfigService);
  const deviceService = inject(DeviceService);

  const isPublic = PUBLIC_PATHS.some(path => req.url.includes(path));

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let request = req.clone({
    setHeaders: { 'X-Timezone': timezone },
  });

  if (!isPublic) {
    const bearer = resolveBearerToken(configService, deviceService);
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
          if (!isPublicRoute) {
            // Lazy-inject AuthService inside the captured injector context.
            // By the time a 401 fires, AuthService is fully constructed and
            // cached, so this resolves to the singleton without re-entering DI.
            runInInjectionContext(injector, () => inject(AuthService).logout());
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
 * Zero-fallback policy for infrastructure devices:
 *   - If the device mode is one of `DEVICE_TOKEN_MODES` (kitchen /
 *     kiosk), we commit to the device token. A valid token is returned
 *     verbatim; anything else resolves to `null` so the request fires
 *     without an Authorization header. The resulting 401 is the
 *     intended signal — it tells the backend and the frontend that
 *     the machine has lost its identity and must be re-provisioned.
 *     Under NO circumstance does an infrastructure device borrow a
 *     human user's token.
 *
 *   - For every other mode (cashier / tables / mobile) we keep the
 *     existing user-token flow, skipping the `offline-session-*`
 *     marker that must never hit the API.
 */
function resolveBearerToken(
  configService: ConfigService,
  deviceService: DeviceService,
): string | null {
  const mode = configService.deviceConfig$.getValue().mode;

  if (DEVICE_TOKEN_MODES.includes(mode)) {
    return deviceService.hasValidDeviceToken()
      ? deviceService.getDeviceToken()
      : null;
  }

  const userToken = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!userToken) return null;
  if (userToken.startsWith('offline-session-')) return null;
  return userToken;
}
