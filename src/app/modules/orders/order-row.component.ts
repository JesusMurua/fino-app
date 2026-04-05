import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { CartItem, Order, getPaymentLabel } from '../../core/models';
import { OrderSource } from '../../core/enums';
import { OrderDisplayStatus } from '../../core/services/orders.service';
import { PrintService } from '../../core/services/print.service';
import { PlatformChipComponent } from '../../shared/components/platform-chip/platform-chip.component';
import { PricePipe } from '../../shared/pipes/price.pipe';

@Component({
  selector: 'app-order-row',
  standalone: true,
  imports: [DatePipe, PricePipe, PlatformChipComponent],
  templateUrl: './order-row.component.html',
  styleUrl: './order-row.component.scss',
})
export class OrderRowComponent {

  private readonly printService = inject(PrintService);

  //#region Inputs
  @Input({ required: true }) order!: Order;
  @Input({ required: true }) now!: Date;
  @Input({ required: true }) status!: OrderDisplayStatus;
  @Input() canDeliver = false;
  @Input() canCancel = false;
  @Input() isDelivered = false;
  @Input() isCancelled = false;
  //#endregion

  //#region Outputs
  @Output() markDelivered = new EventEmitter<Order>();
  @Output() cancelOrder = new EventEmitter<string>();
  @Output() viewTicket = new EventEmitter<Order>();
  @Output() chargeOrder = new EventEmitter<Order>();
  @Output() printError = new EventEmitter<string>();
  //#endregion

  readonly OrderSource = OrderSource;

  //#region State
  readonly expanded = signal(false);
  //#endregion

  //#region Computed

  /** Whether this order is finalized (cancelled or delivered) — timer stops */
  get isFinalized(): boolean {
    return this.isCancelled || this.isDelivered;
  }

  /**
   * Elapsed seconds since order creation.
   * For cancelled orders: freezes at cancelledAt.
   * For delivered orders: uses current time (no deliveredAt field yet).
   */
  private get elapsedSeconds(): number {
    const created = new Date(this.order.createdAt).getTime();
    // Freeze timer when order is finalized
    if (this.isCancelled && this.order.cancelledAt) {
      return Math.max(0, Math.floor((new Date(this.order.cancelledAt).getTime() - created) / 1000));
    }
    if (this.isDelivered && !this._frozenElapsed) {
      this._frozenElapsed = Math.max(0, Math.floor((this.now.getTime() - created) / 1000));
    }
    if (this._frozenElapsed) return this._frozenElapsed;
    return Math.max(0, Math.floor((this.now.getTime() - created) / 1000));
  }
  private _frozenElapsed: number | null = null;

  /** Formatted elapsed time as "M:SS" */
  get elapsedFormatted(): string {
    const sec = this.elapsedSeconds;
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return `${min}:${s.toString().padStart(2, '0')}`;
  }

  get isOverdue(): boolean {
    return this.elapsedSeconds >= 600;
  }

  /** Display label for the order's payment methods */
  get paymentLabel(): string {
    return getPaymentLabel(this.order);
  }

  //#endregion

  //#region Actions

  toggle(): void {
    this.expanded.update(v => !v);
  }

  onDeliver(): void {
    this.markDelivered.emit(this.order);
  }

  onCancel(): void {
    this.cancelOrder.emit(this.order.id);
  }

  onViewTicket(): void {
    this.viewTicket.emit(this.order);
  }

  /**
   * Prints a kitchen comanda (items + qty + table, NO prices).
   * If thermal printer connected → ESC/POS (non-blocking).
   * If not → falls back to window.print() (blocking).
   */
  async onPrint(): Promise<void> {
    try {
      await this.printService.printKitchenComanda(this.order);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error de impresora';
      this.printError.emit(msg);
    }
  }

  //#endregion

  //#region Helpers

  getExtraLabels(item: CartItem): string {
    return item.extras.map(e => e.label).join(', ');
  }

  //#endregion

}
