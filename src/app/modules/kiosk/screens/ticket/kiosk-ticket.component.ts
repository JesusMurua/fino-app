import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { CartItem, Order } from '../../../../core/models';
import { CartService } from '../../../../core/services/cart.service';
import { ConfigService } from '../../../../core/services/config.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { KioskDataService } from '../../../../core/services/kiosk-data.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Seconds before auto-reset to the welcome screen */
const AUTO_RESET_S = 30;

@Component({
  selector: 'app-kiosk-ticket',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './kiosk-ticket.component.html',
  styleUrl: './kiosk-ticket.component.scss',
})
export class KioskTicketComponent implements OnInit, OnDestroy {

  //#region Properties

  readonly orderNumber  = signal(0);
  readonly totalCents   = signal(0);
  readonly businessName = signal('');
  readonly countdown    = signal(AUTO_RESET_S);

  /** Items captured before clearCart() — used for WhatsApp text generation */
  private completedItems: CartItem[] = [];

  private resetTimer: ReturnType<typeof setInterval> | null = null;

  //#endregion

  //#region Constructor
  private readonly kioskDataService = inject(KioskDataService);

  constructor(
    private readonly cartService: CartService,
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    // ── Step 1: Snapshot cart from signal ──
    const snapshot = this.cartService.getSnapshot();

    if (snapshot.length === 0) {
      this.router.navigate(['/kiosk/welcome']);
      return;
    }

    // ── Step 2: Compute total from snapshot items — avoids signal desync ──
    const total = snapshot.reduce((sum, item) => sum + item.totalPriceCents, 0);

    // ── Step 3: Async operations (DB reads + config) ──
    const deviceConfig = this.configService.deviceConfig$.getValue();
    const [orderCount, branchConfig] = await Promise.all([
      this.db.orders.count(),
      this.kioskDataService.loadConfig(deviceConfig.branchId),
    ]);
    const num = orderCount + 1;

    // ── Step 4: Persist order BEFORE clearing the cart ──
    const order: Order = {
      id:            crypto.randomUUID(),
      orderNumber:   num,
      items:         snapshot,
      totalCents:    total,
      payments: [],  // kiosk: customer pays at counter after pickup
      paidCents: 0,
      changeCents: 0,
      paymentProvider: null,
      syncStatus:    'Pending',
      createdAt:     new Date(),
      branchId:      deviceConfig.branchId,
    };
    await this.db.orders.add(order);

    // ── Step 5: Clear cart AFTER order is safely stored ──
    await this.cartService.clearCart();

    // ── Step 6: Set all signals at once — single render pass ──
    this.completedItems = snapshot;
    this.orderNumber.set(num);
    this.totalCents.set(total);
    this.businessName.set(branchConfig.businessName);

    // ── Step 7: Start auto-reset countdown ──
    this.startCountdown();
  }

  ngOnDestroy(): void {
    this.stopCountdown();
  }

  //#endregion

  //#region Actions

  newOrder(): void {
    this.stopCountdown();
    this.router.navigate(['/kiosk/welcome']);
  }

  openWhatsApp(): void {
    const text = this.buildWhatsAppText();
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  }

  //#endregion

  //#region Countdown

  private startCountdown(): void {
    this.countdown.set(AUTO_RESET_S);
    this.resetTimer = setInterval(() => {
      const next = this.countdown() - 1;
      if (next <= 0) {
        this.stopCountdown();
        this.router.navigate(['/kiosk/welcome']);
      } else {
        this.countdown.set(next);
      }
    }, 1_000);
  }

  private stopCountdown(): void {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
      this.resetTimer = null;
    }
  }

  //#endregion

  //#region Helpers

  private buildWhatsAppText(): string {
    const lines: string[] = [
      `*${this.businessName()}*`,
      `Orden #${this.orderNumber()}`,
      '',
      ...this.completedItems.map(item => {
        const size   = item.size ? ` (${item.size.label})` : '';
        const extras = item.extras.length ? ' + ' + item.extras.map(e => e.label).join(', ') : '';
        return `${item.quantity}× ${item.product.name}${size}${extras}`;
      }),
      '',
      `Total: $${(this.totalCents() / 100).toFixed(2)} MXN`,
      '',
      'Presenta este número en caja para pagar.',
    ];
    return lines.join('\n');
  }

  //#endregion

}
