import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';

import { Product } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { ProductService } from '../../../../core/services/product.service';
import { CategorySidebarComponent } from '../category-sidebar/category-sidebar.component';
import { ProductCardComponent, ProductCardViewMode } from '../product-card/product-card.component';

/**
 * Catalog stage of the unified POS chameleon shell.
 *
 * Owns:
 *   - Category sidebar
 *   - Product grid (visual tiles or dense list — toggle persisted in
 *     localStorage under `pos_view_mode`, independent of the keypad/grid
 *     chameleon toggle owned by `PosViewModeService`)
 *   - Empty state + loading state
 *   - Catalog seed fallback when the API + Dexie return empty
 *
 * Excluded:
 *   - POS header (mounted by the unified shell)
 *   - Cart panel (mounted by the unified shell)
 *   - Scanner listener (lives in the unified shell, gated by view mode)
 */
@Component({
  selector: 'app-product-grid-inner',
  standalone: true,
  imports: [CategorySidebarComponent, ProductCardComponent],
  templateUrl: './product-grid-inner.component.html',
  styleUrl: './product-grid-inner.component.scss',
})
export class ProductGridInnerComponent implements OnInit {

  //#region Properties — exposed from service for template binding
  readonly isLoading = this.productService.isLoading;
  readonly categories = this.productService.categories;
  readonly filteredProducts = this.productService.filteredProducts;
  readonly selectedCategoryId = this.productService.selectedCategoryId;

  /** localStorage key for the persisted card-view-mode preference (tiles vs list). */
  private static readonly VIEW_MODE_STORAGE_KEY = 'pos_view_mode';

  /**
   * Toggles between visual grid and dense list layouts. Hydrated from
   * `localStorage` so the cashier's last choice survives reloads. This is
   * orthogonal to the keypad/grid chameleon toggle owned by
   * `PosViewModeService`.
   */
  readonly viewMode = signal<ProductCardViewMode>(this.loadStoredViewMode());

  private readonly authService = inject(AuthService);

  //#endregion

  //#region Constructor
  constructor(
    private readonly productService: ProductService,
    private readonly cartService: CartService,
    private readonly messageService: MessageService,
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
  }
  //#endregion

  //#region View toggle (tiles ↔ list)

  /** Switches the catalog rendering between visual grid and dense list. */
  setViewMode(mode: ProductCardViewMode): void {
    this.viewMode.set(mode);
    try {
      localStorage.setItem(ProductGridInnerComponent.VIEW_MODE_STORAGE_KEY, mode);
    } catch { /* storage quota / privacy mode — keep working in-memory */ }
  }

  /** Reads the persisted view-mode from localStorage, falling back to `grid`. */
  private loadStoredViewMode(): ProductCardViewMode {
    try {
      const raw = localStorage.getItem(ProductGridInnerComponent.VIEW_MODE_STORAGE_KEY);
      return raw === 'list' || raw === 'grid' ? raw : 'grid';
    } catch {
      return 'grid';
    }
  }

  //#endregion

  //#region Category Methods

  /** Sets the active category filter. Null shows all available products. */
  selectCategory(id: number | null): void {
    this.productService.selectCategory(id);
  }

  //#endregion

  //#region Product Methods

  /**
   * Routes the product based on whether it requires customization (FDD-024).
   * Products with sizes or modifier groups navigate to the detail page so
   * the cashier can configure them; products with neither are added to the
   * cart directly to save taps in non-F&B verticals (memberships, simple
   * retail items, services). Mirrors `UnifiedPosComponent.handleBarcodeScan`.
   */
  onProductSelected(product: Product): void {
    if (this.productRequiresDetailPage(product)) {
      this.router.navigate(['/pos/add-meal', product.id]);
      return;
    }
    this.cartService.addItem(product);
    this.messageService.add({
      severity: 'success',
      summary: 'Producto agregado',
      detail: product.name,
      life: 2000,
    });
  }

  /**
   * Returns true when a product needs the detail page to be configured —
   * either it has size variants or at least one non-empty modifier group.
   */
  private productRequiresDetailPage(product: Product): boolean {
    return product.sizes.length > 0
      || (product.modifierGroups?.some(g => g.extras.length > 0) ?? false);
  }

  //#endregion
}
