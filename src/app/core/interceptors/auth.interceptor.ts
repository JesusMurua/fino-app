import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';

import { AUTH_TOKEN_KEY } from '../models';
import { AuthService } from '../services/auth.service';

/** Public endpoints that must never receive a Bearer token */
const PUBLIC_PATHS = ['/api/auth/pin-login', '/api/auth/email-login'];

/** Routes where a 401 should NOT trigger logout (user is not expected to be authenticated) */
const PUBLIC_ROUTES = ['/register', '/setup', '/onboarding', '/login'];

/**
 * Functional HTTP interceptor (Angular 18+).
 *
 * - Attaches Authorization: Bearer {token} to every request except public auth endpoints
 * - On 401 response → calls AuthService.logout() to clear state and redirect to /pin
 *   (skipped on public routes where 401 is expected)
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const authService = inject(AuthService);

  const isPublic = PUBLIC_PATHS.some(path => req.url.includes(path));

  let request = req;
  if (!isPublic) {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      request = req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      });
    }
  }

  return next(request).pipe(
    tap({
      error: (error) => {
        if (error.status === 401 && !isPublic) {
          const currentPath = window.location.pathname;
          const isPublicRoute = PUBLIC_ROUTES.some(route => currentPath.startsWith(route));
          if (!isPublicRoute) {
            authService.logout();
          }
        }
      },
    }),
  );
};
