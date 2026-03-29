import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { KitchenService } from '../../core/services/kitchen.service';
import { KitchenOrderCardComponent } from './kitchen-order-card.component';

@Component({
  selector: 'app-kitchen-display',
  standalone: true,
  imports: [DatePipe, KitchenOrderCardComponent],
  templateUrl: './kitchen-display.component.html',
  styleUrl: './kitchen-display.component.scss',
})
export class KitchenDisplayComponent implements OnInit, OnDestroy {

  //#region Properties
  readonly activeOrders = this.kitchenService.activeOrders;

  /** Current time — updated every second for the header clock and elapsed timers */
  readonly now = signal(new Date());

  /** Set of order IDs currently fading out after being marked done */
  readonly fadingOut = signal<Set<string>>(new Set());

  /** Whether the device is online — controls offline banner */
  readonly isOnline = signal(navigator.onLine);

  private clockTimerId: ReturnType<typeof setInterval> | null = null;
  private readonly onOnline = () => this.isOnline.set(true);
  private readonly onOffline = () => this.isOnline.set(false);
  //#endregion

  //#region Constructor
  constructor(private readonly kitchenService: KitchenService) {}
  //#endregion

  //#region Lifecycle
  async ngOnInit(): Promise<void> {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    await this.kitchenService.start();
    this.clockTimerId = setInterval(() => this.now.set(new Date()), 1000);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.kitchenService.stop();
    if (this.clockTimerId !== null) {
      clearInterval(this.clockTimerId);
    }
  }
  //#endregion

  //#region Actions

  /**
   * Marks an order as ready with a 3-second fade-out before removal.
   */
  async onMarkDone(orderId: string): Promise<void> {
    this.fadingOut.update(s => { s.add(orderId); return new Set(s); });

    setTimeout(async () => {
      await this.kitchenService.markAsReady(orderId);
      this.fadingOut.update(s => { s.delete(orderId); return new Set(s); });
    }, 3000);
  }

  isFading(orderId: string): boolean {
    return this.fadingOut().has(orderId);
  }

  //#endregion

}
