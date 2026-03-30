import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

/** Routes blocked when plan is expired */
const BLOCKED_ROUTES = ['/pos', '/kitchen', '/kiosk'];

@Component({
  selector: 'app-expired-overlay',
  standalone: true,
  templateUrl: './expired-overlay.component.html',
  styleUrl: './expired-overlay.component.scss',
})
export class ExpiredOverlayComponent {

  //#region Properties

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  /** Current route path — updated on every navigation */
  private readonly currentRoute = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Business name for branding */
  readonly businessName = computed(() =>
    this.authService.currentUser()?.name ?? 'Tu negocio'
  );

  /** Whether the overlay should be visible */
  readonly isVisible = computed(() => {
    if (!this.authService.isExpired()) return false;
    const route = this.currentRoute();
    return BLOCKED_ROUTES.some(blocked => route.startsWith(blocked));
  });

  /** True while refreshing subscription status */
  readonly isRefreshing = computed(() => false);

  //#endregion

  //#region Actions

  /** Opens the landing page pricing section in a new tab */
  openPricing(): void {
    window.open(`${environment.landingUrl}/#precios`, '_blank');
  }

  /** Refreshes subscription status from the API */
  async refreshStatus(): Promise<void> {
    await this.authService.refreshSubscriptionStatus();
  }

  //#endregion

}
