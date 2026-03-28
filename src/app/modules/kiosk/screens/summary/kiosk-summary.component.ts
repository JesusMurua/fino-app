import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { CartItem } from '../../../../core/models';

import { CartService } from '../../../../core/services/cart.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-kiosk-summary',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './kiosk-summary.component.html',
  styleUrl: './kiosk-summary.component.scss',
})
export class KioskSummaryComponent implements OnInit {

  //#region Properties

  readonly items = signal<CartItem[]>([]);
  readonly totalCents = this.cartService.totalCents;
  readonly cartEvaluation = this.cartService.cartEvaluation;

  private cartSub?: Subscription;

  //#endregion

  //#region Constructor
  constructor(
    private readonly cartService: CartService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.cartSub = this.cartService.cart$.subscribe(items => {
      this.items.set(items);
      // If cart becomes empty redirect back to catalog
      if (items.length === 0) {
        this.router.navigate(['/kiosk/catalog']);
      }
    });
  }

  ngOnDestroy(): void {
    this.cartSub?.unsubscribe();
  }

  //#endregion

  //#region Cart Item Actions

  /** Decreases item quantity by 1 — removes item if quantity reaches 0 */
  async decreaseQuantity(item: CartItem): Promise<void> {
    await this.cartService.updateQuantity(item.id, item.quantity - 1);
  }

  /** Increases item quantity by 1 */
  async increaseQuantity(item: CartItem): Promise<void> {
    await this.cartService.updateQuantity(item.id, item.quantity + 1);
  }

  /** Removes item from cart entirely */
  async removeItem(item: CartItem): Promise<void> {
    await this.cartService.removeItem(item.id);
  }

  //#endregion

  //#region Helpers

  extrasLabel(item: CartItem): string {
    return item.extras.map(e => e.label).join(', ');
  }

  //#endregion

  //#region Navigation

  confirmOrder(): void {
    this.router.navigate(['/kiosk/ticket']);
  }

  async cancelOrder(): Promise<void> {
    await this.cartService.clearCart();
    this.router.navigate(['/kiosk/welcome']);
  }

  goBack(): void {
    this.router.navigate(['/kiosk/catalog']);
  }

  //#endregion

}
