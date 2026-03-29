import { Component, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';

import { Product } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { ProductService } from '../../../../core/services/product.service';
import { ScannerService } from '../../../../core/services/scanner.service';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '../../data/pos.fixture';
import { CartPanelComponent } from '../cart-panel/cart-panel.component';
import { PosHeaderComponent } from '../pos-header/pos-header.component';
import { ProductCardComponent } from '../product-card/product-card.component';

@Component({
  selector: 'app-product-grid',
  standalone: true,
  imports: [
    ButtonModule,
    ToastModule,
    ProductCardComponent,
    CartPanelComponent,
    PosHeaderComponent,
  ],
  templateUrl: './product-grid.component.html',
  styleUrl: './product-grid.component.scss',
  providers: [MessageService],
})
export class ProductGridComponent implements OnInit, OnDestroy {

  //#region Properties — exposed from service for template binding
  readonly isLoading = this.productService.isLoading;
  readonly categories = this.productService.categories;
  readonly filteredProducts = this.productService.filteredProducts;
  readonly selectedCategoryId = this.productService.selectedCategoryId;

  private readonly destroy$ = new Subject<void>();
  private scanSubscription?: Subscription;
  //#endregion

  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly scannerService = inject(ScannerService);
  private readonly messageService = inject(MessageService);

  //#region Constructor
  constructor(
    private readonly productService: ProductService,
    private readonly router: Router,
  ) {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.productService.loadCatalog();
    }, { allowSignalWrites: true });
  }
  //#endregion

  //#region Lifecycle
  async ngOnInit(): Promise<void> {
    await this.productService.loadCatalog();

    // Fallback: seed fixtures only if both API and Dexie returned empty
    if (this.productService.products().length === 0) {
      await this.productService.seedCatalog(SEED_PRODUCTS, SEED_CATEGORIES);
    }

    this.startScannerListener();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.scannerService.stopListening();
  }
  //#endregion

  //#region Category Methods

  /**
   * Sets the active category filter.
   * Passing null shows all available products.
   */
  selectCategory(id: number | null): void {
    this.productService.selectCategory(id);
  }
  //#endregion

  //#region Scanner Integration

  /**
   * Starts barcode scanner listener for the POS screen.
   * On scan: finds product by barcode and adds it to cart.
   * Only active while this component is alive.
   */
  private startScannerListener(): void {
    this.scanSubscription = this.scannerService.onScan()
      .pipe(takeUntil(this.destroy$))
      .subscribe(code => this.handleBarcodeScan(code));

    this.scannerService.startListening();
  }

  /**
   * Handles a scanned barcode in POS context.
   * Finds the product and adds it to cart, or shows not-found toast.
   * Products with sizes/extras navigate to the detail screen instead.
   * @param code The scanned barcode string
   */
  private handleBarcodeScan(code: string): void {
    this.productService.findByBarcode(code).subscribe({
      next: (product) => {
        if (product) {
          const hasOptions = product.sizes.length > 0 || product.extras.length > 0;
          if (hasOptions) {
            this.router.navigate(['/pos/add-meal', product.id]);
          } else {
            this.cartService.addItem(product);
            this.messageService.add({
              severity: 'success',
              summary: 'Producto agregado',
              detail: product.name,
              life: 2000,
            });
          }
        } else {
          this.showBarcodeNotFound(code);
        }
      },
      error: () => this.showBarcodeNotFound(code),
    });
  }

  /**
   * Shows a smart "not found" toast with guidance to register the product.
   * @param code The unrecognized barcode
   */
  private showBarcodeNotFound(code: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Código no registrado',
      detail: `"${code}" — ve al catálogo para asignarlo a un producto`,
      life: 5000,
    });
  }

  //#endregion

  //#region Product Methods

  /**
   * Navigates to the product detail page for customization.
   * Products without sizes or extras are added directly to the cart.
   */
  onProductSelected(product: Product): void {
    const hasOptions = product.sizes.length > 0 || product.extras.length > 0;

    if (hasOptions) {
      this.router.navigate(['/pos/add-meal', product.id]);
    } else {
      this.router.navigate(['/pos/add-meal', product.id]);
    }
  }
  //#endregion

}
