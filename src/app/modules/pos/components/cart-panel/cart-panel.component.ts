import { Component, OnInit, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';

import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { CartItem } from '../../../../core/models';
import { CartService } from '../../../../core/services/cart.service';
import { SyncService } from '../../../../core/services/sync.service';

@Component({
  selector: 'app-cart-panel',
  standalone: true,
  imports: [AsyncPipe, ButtonModule, DividerModule, PricePipe],
  templateUrl: './cart-panel.component.html',
  styleUrl: './cart-panel.component.scss',
})
export class CartPanelComponent implements OnInit {

  //#region Properties
  readonly cart$ = this.cartService.cart$;
  readonly totalCents = this.cartService.totalCents;
  readonly itemCount = this.cartService.itemCount;
  readonly nextOrderNumber = this.syncService.nextOrderNumber;
  readonly activeTableName = signal<string | null>(null);
  //#endregion

  //#region Constructor
  constructor(
    private readonly cartService: CartService,
    private readonly syncService: SyncService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle
  ngOnInit(): void {
    const activeTable = sessionStorage.getItem('activeTable');
    if (activeTable) {
      const { tableName } = JSON.parse(activeTable);
      this.activeTableName.set(tableName);
    }
  }
  //#endregion

  //#region Cart Methods

  /** Increases item quantity by 1 */
  async increment(item: CartItem): Promise<void> {
    await this.cartService.updateQuantity(item.id, item.quantity + 1);
  }

  /**
   * Decreases item quantity by 1.
   * If quantity reaches 0, the item is removed automatically by CartService.
   */
  async decrement(item: CartItem): Promise<void> {
    await this.cartService.updateQuantity(item.id, item.quantity - 1);
  }

  /** Removes an item from the cart entirely */
  async remove(item: CartItem): Promise<void> {
    await this.cartService.removeItem(item.id);
  }

  /** Navigates to the checkout page (Phase 7) */
  onCheckout(): void {
    this.router.navigate(['/pos/checkout']);
  }

  /** Clears the entire cart after user confirmation */
  async onCancelOrder(): Promise<void> {
    await this.cartService.clearCart();
  }
  //#endregion

  /** Returns a comma-separated string of extra labels for display */
  getExtraLabels(item: CartItem): string {
    return item.extras.map(e => e.label).join(', ');
  }

  /** trackBy for the cart items @for loop */
  trackById(_: number, item: CartItem): string {
    return item.id;
  }

}
