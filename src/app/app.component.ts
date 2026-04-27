import { Component, OnInit, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { NgHttpLoaderComponent } from 'ng-http-loader';

import { AuthService } from './core/services/auth.service';
import { CatalogService } from './core/services/catalog.service';
import { IdleService } from './core/services/idle.service';
import { PrinterService } from './core/services/printer.service';
import { SyncService } from './core/services/sync.service';
import { ExpiredOverlayComponent } from './shared/components/expired-overlay/expired-overlay.component';
import { InstallBannerComponent } from './shared/components/install-banner/install-banner.component';
import { UpdateBannerComponent } from './shared/components/update-banner/update-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ExpiredOverlayComponent, InstallBannerComponent, UpdateBannerComponent, ToastModule, NgHttpLoaderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {

  private readonly authService = inject(AuthService);
  private readonly idleService = inject(IdleService);
  private readonly printerService = inject(PrinterService);
  private readonly syncService = inject(SyncService);
  private readonly catalogService = inject(CatalogService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

  /** URLs excluded from the global loading spinner (polling endpoints) */
  readonly filteredUrls = [
    'table/status',
    'orders/pull',
    'orders/last-number',
    'branch/.*/config',
    'subscription/status',
  ];

  /** Routes where pull sync should be active */
  private readonly POS_ROUTES = ['/pos', '/kitchen', '/tables', '/kiosk', '/orders'];

  constructor() {
    // Reactively initialize sync and idle lock when auth state becomes true.
    // Both services are idempotent — safe on repeated calls.
    effect(() => {
      if (this.authService.isAuthenticated()) {
        this.syncService.initialize();
        this.idleService.start();
      }
    });

    // Enable/disable pull sync AND toggle the global `touch-shell` body
    // class based on current route. The body class scopes the touch-target
    // rules in `_touch.scss` to terminal surfaces only — Back Office stays
    // with PrimeNG default button sizing. (See AUDIT-044.)
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(),
    ).subscribe(e => {
      const isPosRoute = this.POS_ROUTES.some(r => e.urlAfterRedirects.startsWith(r));
      if (isPosRoute) {
        this.syncService.enablePull();
      } else {
        this.syncService.disablePull();
      }
      document.body.classList.toggle('touch-shell', isPosRoute);
    });
  }

  ngOnInit(): void {
    this.printerService.tryAutoConnect();
    this.catalogService.loadAll();

    // Refresh subscription on page refresh when already authenticated
    // (configService.load() is handled by APP_INITIALIZER before any component renders)
    if (this.authService.isAuthenticated()) {
      this.authService.refreshSubscriptionStatus();
    }

    // Detect Stripe checkout redirect — refresh subscription and clean URL
    this.handleCheckoutRedirect();
  }

  /**
   * Handles the `?checkout=(success|canceled)` redirect from Stripe:
   *   - success  → refresh subscription status so plan/trial signals are live
   *   - canceled → inform the user the payment did not go through
   * In both cases the query param is stripped so refreshes don't replay it.
   */
  private handleCheckoutRedirect(): void {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('checkout');
    if (outcome !== 'success' && outcome !== 'canceled') return;

    if (outcome === 'success') {
      this.authService.refreshSubscriptionStatus();
      this.messageService.add({
        severity: 'success',
        summary: 'Pago confirmado',
        detail: 'Tu plan está activo.',
        life: 5000,
      });
    } else {
      this.messageService.add({
        severity: 'warn',
        summary: 'Pago cancelado',
        detail: 'No se procesó ningún cargo. Puedes activar tu plan desde Configuración.',
        life: 6000,
      });
    }

    params.delete('checkout');
    const clean = params.toString();
    const path = window.location.pathname + (clean ? '?' + clean : '');
    window.history.replaceState({}, '', path);
  }

}
