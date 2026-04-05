import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Subject } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { CartItem, Order, OrderPayment, PaymentMethod, Product } from '../../../../core/models';
import { calcUnitPriceCents } from '../../../../core/models/cart-item.model';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { PosHeaderComponent } from '../pos-header/pos-header.component';
import { AuthService } from '../../../../core/services/auth.service';
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

/** Sentinel product ID for free-form quick items (no catalog product) */
const QUICK_ITEM_PRODUCT_ID = 0;

@Component({
  selector: 'app-quick-pos',
  standalone: true,
  imports: [ButtonModule, DialogModule, ToastModule, PricePipe, PosHeaderComponent],
  templateUrl: './quick-pos.component.html',
  styleUrl: './quick-pos.component.scss',
  providers: [MessageService],
})
export class QuickPosComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly destroy$ = new Subject<void>();
  private readonly authService = inject(AuthService);
  private readonly productService = inject(ProductService);
  private readonly syncService = inject(SyncService);
  private readonly printService = inject(PrintService);
  private readonly messageService = inject(MessageService);

  /** Reference to the description input for re-focus after add */
  readonly descriptionInput = viewChild<ElementRef<HTMLInputElement>>('descriptionInput');

  /** All loaded catalog products */
  readonly products = this.productService.products;

  /** Bill denomination buttons */
  readonly bills = BILL_DENOMINATIONS;

  // ---- Quick product form ----

  /** Quick item description */
  readonly quickDescription = signal('');

  /** Quick item price as user-typed string in pesos (e.g. "150") */
  readonly quickPricePesos = signal('');

  /** Whether the quick form can be submitted */
  readonly canAddQuick = computed(() =>
    this.quickDescription().trim().length > 0
    && this.parsePriceCents() > 0
  );

  // ---- Catalog search ----

  /** Catalog search term */
  readonly catalogSearch = signal('');

  /** Whether catalog products exist for this branch */
  readonly hasCatalog = computed(() => this.products().length > 0);

  /** Filtered catalog results based on search */
  readonly catalogResults = computed(() => {
    const term = this.catalogSearch().trim().toLowerCase();
    if (!term || term.length < 2) return [];
    return this.products()
      .filter(p => p.isAvailable && p.name.toLowerCase().includes(term))
      .slice(0, 10);
  });

  // ---- Cart ----

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

  // ---- Payment ----

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

  //#region Quick Product Form

  /** Updates the description signal from input */
  onDescriptionInput(event: Event): void {
    this.quickDescription.set((event.target as HTMLInputElement).value);
  }

  /** Updates the price signal from input */
  onPriceInput(event: Event): void {
    this.quickPricePesos.set((event.target as HTMLInputElement).value);
  }

  /**
   * Adds a quick (free-form) product to the cart.
   * Creates a virtual Product with sentinel id 0.
   * Clears form and re-focuses description input.
   */
  addQuickItem(): void {
    const description = this.quickDescription().trim();
    const priceCents = this.parsePriceCents();
    if (!description || priceCents <= 0) return;

    const virtualProduct: Product = {
      id: QUICK_ITEM_PRODUCT_ID,
      name: description,
      priceCents,
      categoryId: 0,
      isAvailable: true,
      sizes: [],
      extras: [],
    };

    const item: CartItem = {
      id: crypto.randomUUID(),
      product: virtualProduct,
      quantity: 1,
      extras: [],
      unitPriceCents: priceCents,
      totalPriceCents: priceCents,
      discountCents: 0,
    };

    this.cartItems.set([...this.cartItems(), item]);

    // Clear form and re-focus
    this.quickDescription.set('');
    this.quickPricePesos.set('');
    this.descriptionInput()?.nativeElement.focus();
  }

  /** Parses the peso string input into centavos */
  private parsePriceCents(): number {
    const raw = this.quickPricePesos().replace(/[^0-9.]/g, '');
    const pesos = parseFloat(raw);
    if (isNaN(pesos) || pesos <= 0) return 0;
    return Math.round(pesos * 100);
  }

  //#endregion

  //#region Catalog Search

  /** Updates catalog search term */
  onCatalogSearchInput(event: Event): void {
    this.catalogSearch.set((event.target as HTMLInputElement).value);
  }

  /** Adds a catalog product to the cart (same merge logic as other POS variants) */
  addCatalogProduct(product: Product): void {
    const items = this.cartItems();
    const existing = items.find(i => i.product.id === product.id && product.id !== QUICK_ITEM_PRODUCT_ID && !i.size && i.extras.length === 0);

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

    this.catalogSearch.set('');
    this.messageService.add({
      severity: 'success',
      summary: 'Producto agregado',
      detail: product.name,
      life: 2000,
    });
  }

  //#endregion

  //#region Cart Methods

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
