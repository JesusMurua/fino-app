import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';

import { AppConfig, DEFAULT_APP_CONFIG, DEFAULT_DEVICE_CONFIG, DeviceConfig } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfigService } from '../../../../core/services/config.service';

@Component({
  selector: 'app-pos-header',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './pos-header.component.html',
  styleUrl: './pos-header.component.scss',
})
export class PosHeaderComponent implements OnInit, OnDestroy {

  readonly isOnline     = signal(true);
  readonly config       = signal<AppConfig>({ ...DEFAULT_APP_CONFIG });
  readonly deviceConfig = signal<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  /** Show orders button only for Cashier and Owner */
  readonly showOrdersButton: boolean;

  private readonly onOnline  = (): void => this.isOnline.set(true);
  private readonly onOffline = (): void => this.isOnline.set(false);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    const role = this.authService.currentUser()?.role;
    this.showOrdersButton = role === 'Cashier' || role === 'Owner';
    // Business config — reactive
    this.configService.config$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.config.set(cfg));

    // Device config — reactive (mode, deviceName)
    this.configService.deviceConfig$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.deviceConfig.set(cfg));
  }

  async ngOnInit(): Promise<void> {
    this.isOnline.set(navigator.onLine);
    window.addEventListener('online',  this.onOnline);
    window.addEventListener('offline', this.onOffline);

    await this.configService.load(); // triggers config$ emission
  }

  ngOnDestroy(): void {
    window.removeEventListener('online',  this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }

  /** Navigates to the tables view */
  openTables(): void {
    this.router.navigate(['/tables']);
  }

  /** Navigates to the orders list */
  openOrders(): void {
    this.router.navigate(['/orders']);
  }

  /** Navigates to the PIN screen to access the back office */
  openAdmin(): void {
    this.router.navigate(['/pin']);
  }

}
