import { Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';

import { Product } from '../../../../core/models';
import { calcUnitPriceCents } from '../../../../core/models/cart-item.model';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { ProductService } from '../../../../core/services/product.service';

/** Lightweight descriptor for the recent-items quick re-add list */
interface RecentItem {
  name: string;
  priceCents: number;
}

/**
 * Keypad/calculator stage of the unified POS chameleon shell.
 *
 * Pure UX surface: description input + price input + recents + catalog
 * search. All cart writes go through `CartService` (`addQuickItem` for
 * free-form lines, `addItem` for catalog matches) so coupons, membership
 * beneficiaries, stock guards, and offline persistence work identically
 * to the grid mode. No local cart signal lives in this component.
 */
@Component({
  selector: 'app-keypad-stage',
  standalone: true,
  imports: [PricePipe],
  templateUrl: './keypad-stage.component.html',
  styleUrl: './keypad-stage.component.scss',
})
export class KeypadStageComponent implements OnInit {

  //#region Properties

  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly productService = inject(ProductService);

  /** Reference to the description input for re-focus after add */
  readonly descriptionInput = viewChild<ElementRef<HTMLInputElement>>('descriptionInput');

  /** All loaded catalog products */
  readonly products = this.productService.products;

  /** Quick item description */
  readonly quickDescription = signal('');

  /** Quick item price as user-typed string in pesos (e.g. "150") */
  readonly quickPricePesos = signal('');

  /** Whether the quick form can be submitted */
  readonly canAddQuick = computed(() =>
    this.quickDescription().trim().length > 0
    && this.parsePriceCents() > 0,
  );

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

  /** Last items added in this session, newest first, capped at 5 (deduped by name+price) */
  readonly recentItems = signal<RecentItem[]>([]);

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

  //#endregion

  //#region Quick item form

  /** Updates the description signal from input */
  onDescriptionInput(event: Event): void {
    this.quickDescription.set((event.target as HTMLInputElement).value);
  }

  /** Updates the price signal from input */
  onPriceInput(event: Event): void {
    this.quickPricePesos.set((event.target as HTMLInputElement).value);
  }

  /**
   * Adds a quick (free-form) item to the shared cart via
   * `CartService.addQuickItem`. Pushes the description+price to recents,
   * clears the form, and re-focuses the description input.
   */
  async addQuickItem(): Promise<void> {
    const description = this.quickDescription().trim();
    const priceCents = this.parsePriceCents();
    if (!description || priceCents <= 0) return;

    await this.cartService.addQuickItem(description, priceCents);
    this.pushRecent({ name: description, priceCents });

    this.quickDescription.set('');
    this.quickPricePesos.set('');
    this.descriptionInput()?.nativeElement.focus();
  }

  /** Re-adds a recent item to the cart (always a new line — no merge) */
  async addRecentItem(item: RecentItem): Promise<void> {
    await this.cartService.addQuickItem(item.name, item.priceCents);
    this.pushRecent(item);
  }

  /** Adds a catalog product to the shared cart with stock guards */
  async addCatalogProduct(product: Product): Promise<void> {
    await this.cartService.addItem(product);
    this.pushRecent({ name: product.name, priceCents: calcUnitPriceCents(product) });
    this.catalogSearch.set('');
  }

  /** Updates catalog search term */
  onCatalogSearchInput(event: Event): void {
    this.catalogSearch.set((event.target as HTMLInputElement).value);
  }

  //#endregion

  //#region Helpers

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
}
