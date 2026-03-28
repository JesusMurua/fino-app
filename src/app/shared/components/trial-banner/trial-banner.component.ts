import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';

/** localStorage key prefix for banner dismissal */
const DISMISS_KEY_PREFIX = 'trial-banner-dismissed-';

/**
 * Trial expiration banner shown in the admin shell.
 *
 * Display rules:
 *   - Show when user is on trial and trialDaysLeft <= 30
 *   - Hide if user dismissed via localStorage
 *   - Three variants: amber (>7 days), orange (<=7), red (expired)
 */
@Component({
  selector: 'app-trial-banner',
  standalone: true,
  templateUrl: './trial-banner.component.html',
  styleUrl: './trial-banner.component.scss',
})
export class TrialBannerComponent {

  //#region Properties

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  private readonly dismissed = signal(this.loadDismissed());

  readonly planInfo = this.authService.planInfo;

  /** Whether the banner should be visible */
  readonly isVisible = computed(() => {
    if (this.dismissed()) return false;
    const info = this.planInfo();
    // Show for active trial with <= 30 days, or expired trial (Free plan, had trial)
    return (info.isOnTrial && info.trialDaysLeft <= 30)
      || (info.trialEndsAt && !info.isOnTrial && !info.isPaid);
  });

  /** Banner color variant */
  readonly variant = computed<'amber' | 'orange' | 'red'>(() => {
    const info = this.planInfo();
    if (!info.isOnTrial) return 'red';
    if (info.trialDaysLeft <= 7) return 'orange';
    return 'amber';
  });

  /** Banner message text */
  readonly message = computed(() => {
    const info = this.planInfo();
    if (!info.isOnTrial) return 'Tu período de prueba ha terminado';
    if (info.trialDaysLeft <= 7) {
      return `Tu prueba vence en ${info.trialDaysLeft} día${info.trialDaysLeft !== 1 ? 's' : ''} — no pierdas el acceso`;
    }
    return `Tu prueba gratuita vence en ${info.trialDaysLeft} días`;
  });

  /** CTA button text */
  readonly ctaText = computed(() => {
    const info = this.planInfo();
    if (!info.isOnTrial) return 'Activar plan';
    if (info.trialDaysLeft <= 7) return 'Activar plan ahora';
    return 'Ver planes';
  });

  //#endregion

  //#region Actions

  /** Navigates to plans/billing page */
  onCtaClick(): void {
    this.router.navigate(['/admin/settings']);
  }

  /** Dismisses the banner and persists to localStorage */
  dismiss(): void {
    this.dismissed.set(true);
    const branchId = this.authService.branchId;
    localStorage.setItem(`${DISMISS_KEY_PREFIX}${branchId}`, 'true');
  }

  //#endregion

  //#region Private Helpers

  /** Checks localStorage for previous dismissal */
  private loadDismissed(): boolean {
    const branchId = this.authService.branchId;
    return localStorage.getItem(`${DISMISS_KEY_PREFIX}${branchId}`) === 'true';
  }

  //#endregion

}
