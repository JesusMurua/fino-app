import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { CartService } from '../../../../core/services/cart.service';
import { ConfigService } from '../../../../core/services/config.service';
import { KioskDataService } from '../../../../core/services/kiosk-data.service';

/** Seconds of inactivity on the welcome screen before resetting an active cart */
const WELCOME_IDLE_S = 60;

@Component({
  selector: 'app-kiosk-welcome',
  standalone: true,
  imports: [],
  templateUrl: './kiosk-welcome.component.html',
  styleUrl: './kiosk-welcome.component.scss',
})
export class KioskWelcomeComponent implements OnInit, OnDestroy {

  //#region Properties

  readonly businessName = signal('');

  /** Long-press detection for the logo → admin PIN */
  private logoPressTimer: ReturnType<typeof setTimeout> | null = null;

  /** Idle reset timer — clears cart if user lands here and does nothing */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  //#endregion

  //#region Constructor
  private readonly kioskDataService = inject(KioskDataService);

  constructor(
    private readonly configService: ConfigService,
    private readonly cartService: CartService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const branchId = this.configService.deviceConfig$.getValue().branchId;
    const config = await this.kioskDataService.loadConfig(branchId);
    this.businessName.set(config.businessName);

    // If a cart exists from a previous abandoned order, reset it after 60s
    this.startIdleReset();
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  //#endregion

  //#region Navigation

  startOrder(): void {
    this.clearTimers();
    this.router.navigate(['/kiosk/catalog']);
  }

  //#endregion

  //#region Long-press → admin (3 seconds)

  onLogoPressStart(event: Event): void {
    event.preventDefault();
    this.logoPressTimer = setTimeout(() => {
      this.router.navigate(['/pin'], { queryParams: { returnTo: '/admin' } });
    }, 3_000);
  }

  onLogoPressEnd(): void {
    if (this.logoPressTimer) {
      clearTimeout(this.logoPressTimer);
      this.logoPressTimer = null;
    }
  }

  //#endregion

  //#region Idle reset

  private startIdleReset(): void {
    this.idleTimer = setTimeout(() => {
      void this.cartService.clearCart();
    }, WELCOME_IDLE_S * 1_000);
  }

  private clearTimers(): void {
    if (this.logoPressTimer) { clearTimeout(this.logoPressTimer); this.logoPressTimer = null; }
    if (this.idleTimer)      { clearTimeout(this.idleTimer);      this.idleTimer = null; }
  }

  //#endregion

}
