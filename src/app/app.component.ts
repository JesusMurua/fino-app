import { Component, OnInit, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { ToastModule } from 'primeng/toast';
import { NgHttpLoaderComponent } from 'ng-http-loader';

import { AuthService } from './core/services/auth.service';
import { CatalogService } from './core/services/catalog.service';
import { ConfigService } from './core/services/config.service';
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
  private readonly configService = inject(ConfigService);
  private readonly printerService = inject(PrinterService);
  private readonly syncService = inject(SyncService);
  private readonly catalogService = inject(CatalogService);
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
    // Reactively initialize sync when auth state becomes true.
    // SyncService.initialize() is idempotent — safe on repeated calls.
    effect(() => {
      if (this.authService.isAuthenticated()) {
        this.syncService.initialize();
      }
    });

    // Enable/disable pull sync based on current route
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
    });
  }

  ngOnInit(): void {
    this.printerService.tryAutoConnect();
    this.catalogService.loadAll();

    // Load config + refresh subscription on page refresh when already authenticated
    if (this.authService.isAuthenticated()) {
      this.configService.load();
      this.authService.refreshSubscriptionStatus();
    }

    // Detect Stripe checkout redirect — refresh subscription and clean URL
    this.handleCheckoutRedirect();
  }

  /**
   * Checks for ?checkout=success in the current URL.
   * If found, refreshes subscription status and removes the query param.
   */
  private handleCheckoutRedirect(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      this.authService.refreshSubscriptionStatus();
      // Remove query param without full navigation
      params.delete('checkout');
      const clean = params.toString();
      const path = window.location.pathname + (clean ? '?' + clean : '');
      window.history.replaceState({}, '', path);
    }
  }

}
