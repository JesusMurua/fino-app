import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Subject } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { CartItem, Order, OrderPayment, PaymentMethod, Product } from '../../../../core/models';
import { PaymentStatus, SyncStatusId } from '../../../../core/enums';
import { calcUnitPriceCents } from '../../../../core/models/cart-item.model';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { PosHeaderComponent } from '../pos-header/pos-header.component';
import { AuthService } from '../../../../core/services/auth.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { ProductService } from '../../../../core/services/product.service';
import { SyncService } from '../../../../core/services/sync.service';
import { PrintService } from '../../../../core/services/print.service';

/** Bill denominations in MXN (in centavos) — modifier maps to SCSS color theme */
const BILL_DENOMINATIONS = [
  { label: '$20',   cents: 2000,   modifier: 'b20'   },
  { label: '$50',   cents: 5000,   modifier: 'b50'   },
  { label: '$100',  cents: 10000,  modifier: 'b100'  },
  { label: '$200',  cents: 20000,  modifier: 'b200'  },
  { label: '$500',  cents: 50000,  modifier: 'b500'  },
  { label: '$1000', cents: 100000, modifier: 'b1000' },
];

/** Lightweight descriptor for the recent-items quick re-add list */
interface RecentItem {
  name: string;
  priceCents: number;
}

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
  private readonly cashRegisterService = inject(CashRegisterService);
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

  // ---- Recent items (tablet+desktop) ----

  /** Last items added in this session, newest first, capped at 5 (deduped by name+price) */
  readonly recentItems = signal<RecentItem[]>([]);

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

  /** Amount received from customer in centavos — accumulates with each bill tap */
  readonly receivedAmount = signal(0);

  /** Free-form amount typed by the cashier (raw string in pesos) */
  readonly customAmountInput = signal('');

  /** Change to return in centavos (0 when nothing has been received yet) */
  readonly changeAmount = computed(() => {
    const received = this.receivedAmount();
    if (received === 0) return 0;
    return Math.max(0, received - this.cartTotal());
  });

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
      modifierGroups: [],
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
    this.pushRecent({ name: description, priceCents });

    // Clear form and re-focus
    this.quickDescription.set('');
    this.quickPricePesos.set('');
    this.descriptionInput()?.nativeElement.focus();
  }

  /** Re-adds a recent item to the cart with quantity 1 (no merge — always a new line) */
  addRecentItem(item: RecentItem): void {
    const virtualProduct: Product = {
      id: QUICK_ITEM_PRODUCT_ID,
      name: item.name,
      priceCents: item.priceCents,
      categoryId: 0,
      isAvailable: true,
      sizes: [],
      modifierGroups: [],
    };
    const cartItem: CartItem = {
      id: crypto.randomUUID(),
      product: virtualProduct,
      quantity: 1,
      extras: [],
      unitPriceCents: item.priceCents,
      totalPriceCents: item.priceCents,
      discountCents: 0,
    };
    this.cartItems.set([...this.cartItems(), cartItem]);
    this.pushRecent(item);
  }

  /** Pushes an item to the recents list (newest first, deduped, capped at 5) */
  private pushRecent(item: RecentItem): void {
    const filtered = this.recentItems().filter(
      r => !(r.name === item.name && r.priceCents === item.priceCents),
    );
    this.recentItems.set([item, ...filtered].slice(0, 5));
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

    this.pushRecent({ name: product.name, priceCents: calcUnitPriceCents(product) });
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
    this.resetReceived();
  }

  //#endregion

  //#region Payment Methods

  /** Adds a bill denomination to the running received amount (accumulates) */
  addBillAmount(cents: number): void {
    this.receivedAmount.update(prev => prev + cents);
    this.customAmountInput.set('');
  }

  /** Updates the received amount from the free-form custom-amount input */
  onCustomAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.customAmountInput.set(raw);
    const pesos = parseFloat(raw);
    if (!isNaN(pesos) && pesos > 0) {
      this.receivedAmount.set(Math.round(pesos * 100));
    } else if (raw.trim() === '') {
      this.receivedAmount.set(0);
    }
  }

  /** Resets the received amount and the custom-amount input together */
  resetReceived(): void {
    this.receivedAmount.set(0);
    this.customAmountInput.set('');
  }

  /**
   * Opens the payment confirmation dialog.
   * If no amount has been received yet, the dialog opens with an empty
   * editable Recibido field so the cashier can type it inside the dialog.
   */
  openPayDialog(): void {
    if (this.cartItems().length === 0) return;
    this.showPayDialog.set(true);
  }

  /** Updates the received amount from the dialog's editable Recibido field */
  onDialogReceivedInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const pesos = parseFloat(raw);
    if (!isNaN(pesos) && pesos > 0) {
      this.receivedAmount.set(Math.round(pesos * 100));
    } else if (raw.trim() === '') {
      this.receivedAmount.set(0);
    }
  }

  /** Confirms payment and persists the order using existing SyncService pattern */
  async confirmPayment(): Promise<void> {
    const sessionId = this.cashRegisterService.activeSession()?.id;
    if (sessionId == null) {
      this.messageService.add({
        severity: 'error',
        summary: 'Caja cerrada',
        detail: 'Abre un turno de caja antes de cobrar.',
        life: 4000,
      });
      return;
    }

    this.showPayDialog.set(false);

    const totalCents = this.cartTotal();
    const paidCents = Math.max(this.receivedAmount(), totalCents);
    const orderNumber = this.syncService.consumeOrderNumber();

    const payment: OrderPayment = {
      method: PaymentMethod.Cash,
      paymentStatusId: PaymentStatus.Completed,
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
      syncStatusId: SyncStatusId.Pending,
      branchId: this.authService.branchId,
      cashRegisterSessionId: sessionId,
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
