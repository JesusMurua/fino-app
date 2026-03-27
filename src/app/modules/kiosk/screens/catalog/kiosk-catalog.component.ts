import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Product } from '../../../../core/models';
import { CartService } from '../../../../core/services/cart.service';
import { ConfigService } from '../../../../core/services/config.service';
import { KioskDataService } from '../../../../core/services/kiosk-data.service';
import { ProductService } from '../../../../core/services/product.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-kiosk-catalog',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './kiosk-catalog.component.html',
  styleUrl: './kiosk-catalog.component.scss',
})
export class KioskCatalogComponent implements OnInit {

  //#region Properties

  private readonly kioskDataService = inject(KioskDataService);
  private readonly configService = inject(ConfigService);

  readonly isLoading       = this.productService.isLoading;
  readonly categories      = this.productService.categories;
  readonly selectedCategoryId = this.productService.selectedCategoryId;
  readonly filteredProducts   = this.productService.filteredProducts;

  /** Reactive item count from CartService */
  readonly cartItemCount = this.cartService.itemCount;

  //#endregion

  //#region Constructor
  constructor(
    private readonly productService: ProductService,
    private readonly cartService: CartService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const branchId = this.configService.deviceConfig$.getValue().branchId;
    await this.kioskDataService.loadCatalog(branchId);
  }

  //#endregion

  //#region Category filter

  selectCategory(id: number | null): void {
    this.productService.selectCategory(id);
  }

  //#endregion

  //#region Product selection

  async onProductTapped(product: Product): Promise<void> {
    // Products with sizes or extras require the detail screen for customization.
    // Products without any customization options are added directly to the cart
    // for a faster self-service experience.
    const hasCustomization = product.sizes.length > 0 || product.extras.length > 0;

    if (hasCustomization) {
      this.router.navigate(['/kiosk/detail', product.id]);
    } else {
      await this.cartService.addItem(product);
    }
  }

  //#endregion

  //#region Navigation

  goToSummary(): void {
    this.router.navigate(['/kiosk/summary']);
  }

  async cancelOrder(): Promise<void> {
    await this.cartService.clearCart();
    this.router.navigate(['/kiosk/welcome']);
  }

  //#endregion

}
