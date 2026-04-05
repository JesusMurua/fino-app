import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { CartItem, Order, OrderPayment, PaymentMethod, Product } from '../../../../core/models';
import { calcUnitPriceCents } from '../../../../core/models/cart-item.model';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfigService } from '../../../../core/services/config.service';
import { ProductService } from '../../../../core/services/product.service';
import { SyncService } from '../../../../core/services/sync.service';
import { PrintService } from '../../../../core/services/print.service';

/** Bill denominations in MXN (in centavos) */
const BILL_DENOMINATIONS = [
  { label: '$20',   cents: 2000 },
  { label: '$50',   cents: 5000 },
  { label: '$100',  cents: 10000 },
  { label: '$200',  cents: 20000 },
  { label: '$500',  cents: 50000 },
  { label: '$1000', cents: 100000 },
];

@Component({
  selector: 'app-counter-pos',
  standalone: true,
  imports: [ButtonModule, DialogModule, ToastModule, PricePipe],
  templateUrl: './counter-pos.component.html',
  styleUrl: './counter-pos.component.scss',
  providers: [MessageService],
})
export class CounterPosComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly destroy$ = new Subject<void>();
  private readonly authService = inject(AuthService);
  private readonly configService = inject(ConfigService);
  private readonly productService = inject(ProductService);
  private readonly syncService = inject(SyncService);
  private readonly printService = inject(PrintService);
  private readonly messageService = inject(MessageService);

  /** All loaded products */
  readonly products = this.productService.products;

  /** All loaded categories */
  readonly categories = this.productService.categories;

  /** Whether the catalog is loading */
  readonly isLoading = this.productService.isLoading;

  /** Bill denomination buttons */
  readonly bills = BILL_DENOMINATIONS;

  /** Whether this business has a kitchen (shows ENVIAR A COCINA button) */
  readonly hasKitchen = this.configService.hasKitchen;

  /** Search term for filtering products by name */
  readonly searchTerm = signal('');

  /** Selected category filter (null = all) */
  readonly selectedCategory = signal<number | null>(null);

  /** Filtered products based on category and search term */
  readonly filteredProducts = computed(() => {
    let items = this.products().filter(p => p.isAvailable);
    const catId = this.selectedCategory();
    if (catId !== null) {
      items = items.filter(p => p.categoryId === catId);
    }
    const term = this.searchTerm().trim().toLowerCase();
    if (term) {
      items = items.filter(p => p.name.toLowerCase().includes(term));
    }
    return items;
  });

  /** Local cart items (signal-based, no BehaviorSubject) */
  readonly cartItems = signal<CartItem[]>([]);

  /** Cart total in centavos */
  readonly cartTotal = computed(() =>
    this.cartItems().reduce((sum, item) => sum + item.totalPriceCents, 0)
  );

  /** Number of items in cart */
  readonly cartItemCount = computed(() =>
    this.cartItems().reduce((sum, item) => sum + item.quantity, 0)
  );

  /** Amount tendered by customer in centavos */
  readonly amountTendered = signal(0);

  /** Change to return in centavos */
  readonly change = computed(() =>
    Math.max(0, this.amountTendered() - this.cartTotal())
  );

  /** Whether the payment confirmation dialog is visible */
  readonly showPayDialog = signal(false);

  //#endregion

  //#region Constructor

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.productService.loadCatalog();
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.productService.loadCatalog();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  //#endregion

  //#region Search Methods

  /** Filters products by name on input change — no debounce needed */
  onSearchInput(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  /** Clears the search term */
  clearSearch(): void {
    this.searchTerm.set('');
  }

  //#endregion

  //#region Category Methods

  /** Sets the active category filter */
  selectCategory(id: number | null): void {
    this.selectedCategory.set(id);
  }

  //#endregion

  //#region Cart Methods

  /** Adds a product to the cart or increments quantity if already present */
  addToCart(product: Product): void {
    const items = this.cartItems();
    const existing = items.find(i => i.product.id === product.id && !i.size && i.extras.length === 0);

    if (existing) {
      this.cartItems.set(items.map(i =>
        i.id === existing.id
          ? { ...i, quantity: i.quantity + 1, totalPriceCents: i.unitPriceCents * (i.quantity + 1) }
          : i
      ));
    } else {
      const unitPrice = calcUnitPriceCents(product);
      const item: CartItem = {
        id: crypto.randomUUID(),
        product,
        quantity: 1,
        extras: [],
        unitPriceCents: unitPrice,
        totalPriceCents: unitPrice,
        discountCents: 0,
      };
      this.cartItems.set([...items, item]);
    }
  }

  /** Updates quantity for a cart item; removes if quantity reaches 0 */
  updateQuantity(itemId: string, delta: number): void {
    const items = this.cartItems();
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      this.removeItem(itemId);
      return;
    }

    this.cartItems.set(items.map(i =>
      i.id === itemId
        ? { ...i, quantity: newQty, totalPriceCents: i.unitPriceCents * newQty }
        : i
    ));
  }

  /** Removes an item from the cart */
  removeItem(itemId: string): void {
    this.cartItems.set(this.cartItems().filter(i => i.id !== itemId));
  }

  /** Clears the entire cart */
  clearCart(): void {
    this.cartItems.set([]);
    this.amountTendered.set(0);
  }

  //#endregion

  //#region Kitchen Methods

  /**
   * Sends the current order to the kitchen without payment.
   * Creates an Order with kitchenStatus: 'Pending' and no payments.
   * Same pattern as cart-panel.createKitchenOrder() but without table context.
   */
  async sendToKitchen(): Promise<void> {
    if (this.cartItems().length === 0) return;

    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber: this.syncService.consumeOrderNumber(),
      items: this.cartItems(),
      totalCents: this.cartTotal(),
      subtotalCents: this.cartTotal(),
      payments: [],
      paidCents: 0,
      changeCents: 0,
      paymentProvider: null,
      syncStatus: 'Pending',
      kitchenStatus: 'Pending',
      createdAt: new Date(),
      branchId: this.authService.branchId,
    };

    await this.syncService.saveOrder(order);

    this.messageService.add({
      severity: 'success',
      summary: `Orden #${order.orderNumber} enviada a cocina`,
      life: 3000,
    });

    this.clearCart();
  }

  //#endregion

  //#region Payment Methods

  /** Sets the tendered amount from a bill denomination button */
  selectBill(cents: number): void {
    this.amountTendered.set(cents);
  }

  /** Opens the payment confirmation dialog */
  openPayDialog(): void {
    if (this.cartItems().length === 0) return;
    if (this.amountTendered() === 0) {
      this.amountTendered.set(this.cartTotal());
    }
    this.showPayDialog.set(true);
  }

  /** Confirms payment and persists the order using existing SyncService pattern */
  async confirmPayment(): Promise<void> {
    this.showPayDialog.set(false);

    const totalCents = this.cartTotal();
    const paidCents = Math.max(this.amountTendered(), totalCents);
    const orderNumber = this.syncService.consumeOrderNumber();

    const payment: OrderPayment = {
      method: PaymentMethod.Cash,
      amountCents: paidCents,
    };

    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber,
      items: this.cartItems(),
      subtotalCents: totalCents,
      totalCents,
      payments: [payment],
      paidCents,
      changeCents: Math.max(0, paidCents - totalCents),
      paymentProvider: null,
      createdAt: new Date(),
      syncStatus: 'Pending',
      branchId: this.authService.branchId,
    };

    await this.syncService.saveOrder(order);

    // Inventory deduction is handled atomically by the backend during SyncService.saveOrder().

    try {
      await this.printService.printTicket(order);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error de impresora',
        detail: 'No se pudo imprimir el ticket. Reimprime desde Órdenes.',
        life: 5000,
      });
    }

    this.messageService.add({
      severity: 'success',
      summary: `Venta #${orderNumber}`,
      detail: `Cambio: ${(order.changeCents / 100).toFixed(2)}`,
      life: 3000,
    });

    this.clearCart();
  }

  //#endregion

}
