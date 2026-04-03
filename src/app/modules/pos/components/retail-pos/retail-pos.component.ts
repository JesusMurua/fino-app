import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { Order, OrderPayment, PaymentMethod, Product } from '../../../../core/models';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { ProductService } from '../../../../core/services/product.service';
import { SyncService } from '../../../../core/services/sync.service';
import { PrintService } from '../../../../core/services/print.service';
import { ScannerService } from '../../../../core/services/scanner.service';

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
  selector: 'app-retail-pos',
  standalone: true,
  imports: [ButtonModule, DialogModule, ToastModule, PricePipe],
  templateUrl: './retail-pos.component.html',
  styleUrl: './retail-pos.component.scss',
  providers: [MessageService],
})
export class RetailPosComponent implements OnInit, OnDestroy {

  //#region Properties

  private readonly destroy$ = new Subject<void>();
  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly productService = inject(ProductService);
  private readonly syncService = inject(SyncService);
  private readonly printService = inject(PrintService);
  private readonly scannerService = inject(ScannerService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);

  /** All loaded products */
  readonly products = this.productService.products;

  /** All loaded categories */
  readonly categories = this.productService.categories;

  /** Whether the catalog is loading */
  readonly isLoading = this.productService.isLoading;

  /** Bill denomination buttons */
  readonly bills = BILL_DENOMINATIONS;

  /** Search term for filtering products */
  readonly searchTerm = signal('');

  /** Selected category filter (null = all) */
  readonly selectedCategory = signal<number | null>(null);

  /** Filtered products based on search and category */
  readonly filteredProducts = computed(() => {
    let items = this.products();
    const catId = this.selectedCategory();
    if (catId !== null) {
      items = items.filter(p => p.categoryId === catId);
    }
    const term = this.searchTerm().trim().toLowerCase();
    if (term) {
      items = items.filter(p =>
        p.name.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term))
      );
    }
    // Sort: available first, then unavailable at end
    return [...items].sort((a, b) => (b.isAvailable ? 1 : 0) - (a.isAvailable ? 1 : 0));
  });

  /** Cart items from the shared CartService */
  readonly cartItems = this.cartService.items;

  /** Cart total from the shared CartService */
  readonly cartTotal = this.cartService.totalCents;

  /** Number of items in cart */
  readonly cartItemCount = this.cartService.itemCount;

  /** Amount tendered by customer in centavos */
  readonly amountTendered = signal(0);

  /** Change to return in centavos */
  readonly change = computed(() =>
    Math.max(0, this.amountTendered() - this.cartTotal())
  );

  /** Whether the payment confirmation dialog is visible */
  readonly showPayDialog = signal(false);

  /** Guards against double-tap on payment */
  readonly isProcessing = signal(false);

  /** Debounce timer for search input */
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  //#endregion

  //#region Constructor

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.productService.loadCatalog();
    }, { allowSignalWrites: true });

    // Show stock-exceeded toast from CartService
    effect(() => {
      const exceeded = this.cartService.stockExceeded();
      if (exceeded) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Sin stock suficiente',
          detail: exceeded.available > 0
            ? `Solo quedan ${exceeded.available} unidades de "${exceeded.productName}"`
            : `"${exceeded.productName}" está agotado`,
          life: 3000,
        });
      }
    });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.productService.loadCatalog();
    this.startScannerListener();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.scannerService.stopListening();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  //#endregion

  //#region Search Methods

  /**
   * Handles search input with 150ms debounce.
   * USB barcode scanners act as keyboard wedge — no special integration needed.
   */
  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTerm.set(value);
    }, 150);
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

  //#region Cart Methods (delegated to CartService)

  /** Adds a product to the cart via CartService (stock-guarded) */
  addToCart(product: Product): void {
    if (!product.isAvailable) return;
    this.cartService.addItem(product);
  }

  /** Updates quantity for a cart item via CartService */
  updateQuantity(itemId: string, delta: number): void {
    const item = this.cartItems().find(i => i.id === itemId);
    if (!item) return;

    const newQty = item.quantity + delta;
    this.cartService.updateQuantity(itemId, newQty);
  }

  /** Removes an item from the cart via CartService */
  removeItem(itemId: string): void {
    this.cartService.removeItem(itemId);
  }

  /** Clears the entire cart via CartService */
  clearCart(): void {
    this.cartService.clearCart();
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
    // Default tender to exact amount if not set
    if (this.amountTendered() === 0) {
      this.amountTendered.set(this.cartTotal());
    }
    this.showPayDialog.set(true);
  }

  /** Confirms payment and persists the order using existing SyncService pattern */
  async confirmPayment(): Promise<void> {
    if (this.isProcessing()) return;
    this.isProcessing.set(true);
    this.showPayDialog.set(false);

    try {
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
        items: this.cartService.getSnapshot(),
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

      await this.printService.printTicket(order);

      this.messageService.add({
        severity: 'success',
        summary: `Venta #${orderNumber}`,
        detail: `Cambio: ${(order.changeCents / 100).toFixed(2)}`,
        life: 3000,
      });

      await this.cartService.clearCart();
      this.amountTendered.set(0);
    } finally {
      this.isProcessing.set(false);
    }
  }

  //#endregion

  //#region Scanner Integration

  /** Starts barcode scanner listener — same pattern as product-grid */
  private startScannerListener(): void {
    this.scannerService.onScan()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => this.handleBarcodeScan(code));

    this.scannerService.startListening();
  }

  /**
   * Handles a scanned barcode: finds product by barcode and adds to cart.
   * Falls back to API lookup if not found locally.
   */
  private handleBarcodeScan(code: string): void {
    // Try local match first
    const local = this.products().find(p => p.barcode === code);
    if (local) {
      this.addToCart(local);
      this.messageService.add({
        severity: 'success',
        summary: 'Producto agregado',
        detail: local.name,
        life: 2000,
      });
      return;
    }

    // Fallback to API barcode lookup
    this.productService.findByBarcode(code).subscribe({
      next: (product) => {
        if (product) {
          this.addToCart(product);
          this.messageService.add({
            severity: 'success',
            summary: 'Producto agregado',
            detail: product.name,
            life: 2000,
          });
        } else {
          this.showBarcodeNotFound(code);
        }
      },
      error: () => this.showBarcodeNotFound(code),
    });
  }

  /** Shows a not-found toast for an unrecognized barcode */
  private showBarcodeNotFound(code: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Código no registrado',
      detail: `"${code}" — ve al catálogo para asignarlo a un producto`,
      life: 5000,
    });
  }

  //#endregion

}
