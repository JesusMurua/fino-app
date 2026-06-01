import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

import { AuthService } from '../services/auth.service';

/**
 * First-Run Experience gate.
 *
 * Redirects authenticated users to `/welcome` exactly once — on the
 * first authenticated navigation after the tenant has completed
 * onboarding (via the wizard OR via the super-admin "alta directa"
 * flow). Once the user closes the welcome screen the backend stamps
 * `User.WelcomeShownAt`, which flips this guard into a passthrough
 * for the rest of the session and forever after.
 *
 * Activation rules:
 *   1. No authenticated user → passthrough. `authGuard` is responsible
 *      for handling the unauthenticated case; we never bounce login.
 *   2. Onboarding still pending (`onboardingStatusId !== 3`) → passthrough.
 *      The onboarding wizard owns that flow.
 *   3. Welcome already seen (`welcomeShownAt != null`) → passthrough.
 *   4. Otherwise → redirect to `/welcome`.
 *
 * Apply alongside `authGuard` on the post-login surfaces that the
 * user would otherwise reach directly (`/admin`, `/pos`, `/tables`,
 * `/orders`). NOT on `/welcome` itself (would loop) nor on
 * unattended-device shells (`/kiosk`, `/kitchen`, `/reception`) which
 * never run through a human session.
 */
export const welcomeShownGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.currentUser();
  if (!user) return true;

  // Onboarding not complete → let the onboarding guard / route handle it.
  if (user.onboardingStatusId !== 3) return true;

  // Welcome already seen → carry on.
  if (auth.welcomeShownAt() !== null) return true;

  router.navigate(['/welcome']);
  return false;
};
