import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { NgHttpLoaderComponent } from 'ng-http-loader';

import { AuthService } from './core/services/auth.service';
import { CatalogService } from './core/services/catalog.service';
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

  ngOnInit(): void {
    this.printerService.tryAutoConnect();
    this.catalogService.loadAll();

    // Refresh subscription status once per session if authenticated
    if (this.authService.isAuthenticated()) {
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
