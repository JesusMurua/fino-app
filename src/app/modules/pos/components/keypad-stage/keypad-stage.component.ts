import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, distinctUntilChanged, filter, from, switchMap, tap } from 'rxjs';
import { MessageService } from 'primeng/api';
import {
  AutoCompleteCompleteEvent,
  AutoCompleteModule,
  AutoCompleteSelectEvent,
} from 'primeng/autocomplete';

import { Product } from '../../../../core/models';
import { calcUnitPriceCents } from '../../../../core/models/cart-item.model';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { CartFlowService } from '../../../../core/services/cart-flow.service';
import { CartService } from '../../../../core/services/cart.service';
import { ProductService } from '../../../../core/services/product.service';

/** Persisted descriptor for the recently-added items quick re-add list. */
interface RecentItem {
  productId: number;
  name: string;
  priceCents: number;
}

/** Maximum number of recent items kept and persisted (per branch). */
const MAX_RECENT_ITEMS = 5;

/** Maximum number of suggestions returned by the autocomplete `(completeMethod)`. */
const MAX_AUTOCOMPLETE_RESULTS = 10;

/** localStorage key prefix; final key is `<prefix><branchId>`. */
const RECENTS_STORAGE_KEY_PREFIX = 'pos_keypad_recents:';

/**
 * Keypad / calculator stage of the unified POS chameleon shell.
 *
 * Renders a catalog autocomplete and a list of recently added products.
 * Free-form manual entry was removed (FDD-025) so every cart line carries
 * a real `ProductId` for BI integrity. Cart writes flow through
 * `CartService.addItem`. Recents persist per branch to `localStorage`
 * so cashiers do not lose the re-add list across reloads or shift changes.
 */
@Component({
  selector: 'app-keypad-stage',
  standalone: true,
  imports: [AutoCompleteModule, FormsModule, PricePipe],
  templateUrl: './keypad-stage.component.html',
  styleUrl: './keypad-stage.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeypadStageComponent {

  //#region Properties

  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly cartFlowService = inject(CartFlowService);
  private readonly productService = inject(ProductService);
  private readonly messageService = inject(MessageService);

  /** All loaded catalog products — re-exposed from the service. */
  readonly products = this.productService.products;

  /** Catalog loading flag — re-exposed from the service. */
  readonly isLoading = this.productService.isLoading;

  /** True when at least one product is loaded. Drives empty-state copy. */
  readonly hasCatalog = computed(() => this.products().length > 0);

  /** Currently selected product in the autocomplete (null after add). */
  readonly catalogSelected = signal<Product | null>(null);

  /** Suggestions populated by the autocomplete `(completeMethod)`. */
  readonly catalogSuggestions = signal<Product[]>([]);

  /** Recently added items, newest first, deduped by productId, capped. */
  readonly recentItems = signal<RecentItem[]>([]);

  //#endregion

  //#region Constructor — reactive catalog hydration

  /**
   * Single reactive pipeline driven by `activeBranchId`. Replaces the
   * legacy `effect` (which required `allowSignalWrites: true`) and the
   * duplicate `ngOnInit` `loadCatalog()` call. On every distinct branch
   * change we hydrate recents from localStorage and trigger a catalog
   * load. `switchMap` cancels any in-flight load when the branch
   * changes again. `takeUntilDestroyed` cleans up automatically.
   */
  constructor() {
    toObservable(this.authService.activeBranchId)
      .pipe(
        distinctUntilChanged(),
        filter((id): id is number => id !== null && id !== undefined),
        tap((branchId) => this.recentItems.set(this.loadRecents(branchId))),
        switchMap(() => from(this.productService.loadCatalog()).pipe(
          catchError((err) => {
            console.error('Catalog load failed:', err);
            return EMPTY;
          }),
        )),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  //#endregion

  //#region Catalog autocomplete

  /**
   * Filters the in-memory catalog by the typed query against `name` and
   * `barcode`, diacritic- and case-insensitive, capped at
   * `MAX_AUTOCOMPLETE_RESULTS`. Available products only.
   */
  onCatalogComplete(event: AutoCompleteCompleteEvent): void {
    const term = this.normalize(event.query);
    if (term.length < 2) {
      this.catalogSuggestions.set([]);
      return;
    }
    const matches = this.products()
      .filter((p) => {
        if (!p.isAvailable) return false;
        const name = this.normalize(p.name);
        const barcode = p.barcode ? this.normalize(p.barcode) : '';
        return name.includes(term) || barcode.includes(term);
      })
      .slice(0, MAX_AUTOCOMPLETE_RESULTS);
    this.catalogSuggestions.set(matches);
  }

  /**
   * Routes the selected product through `CartFlowService` so weight
   * items open the capture dialog, configurable items go to the detail
   * page, and plain items are added in place. Recents and the success
   * toast fire only when the product actually landed in the cart.
   */
  async onCatalogSelect(event: AutoCompleteSelectEvent): Promise<void> {
    const product = event.value as Product;
    try {
      const result = await this.cartFlowService.handleProductClick(product);
      if (result === 'added') {
        this.pushRecent({
          productId: product.id,
          name: product.name,
          priceCents: calcUnitPriceCents(product),
        });
        this.messageService.add({
          severity: 'success',
          summary: 'Producto agregado',
          detail: product.name,
          life: 2000,
        });
      }
    } catch (err) {
      console.error('Failed to add catalog product:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'No se pudo agregar el producto',
        detail: product.name,
        life: 4000,
      });
    } finally {
      this.catalogSelected.set(null);
    }
  }

  //#endregion

  //#region Recents

  /**
   * Re-adds a recent item to the cart. The recent is resolved against the
   * current catalog by `productId`; if the product no longer exists or
   * has become unavailable, surface a `warn` toast and skip the cart
   * write. Always creates a new line — recents do not merge.
   */
  async addRecentItem(item: RecentItem): Promise<void> {
    const product = this.products().find(
      (p) => p.id === item.productId && p.isAvailable,
    );
    if (!product) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Producto no disponible',
        detail: item.name,
        life: 4000,
      });
      return;
    }
    try {
      // Route through CartFlowService — recents stay frozen unless the
      // item actually landed in the cart (weight items open the dialog
      // and the recent entry is preserved without an erroneous re-push).
      const result = await this.cartFlowService.handleProductClick(product);
      if (result === 'added') {
        this.pushRecent(item);
      }
    } catch (err) {
      console.error('Failed to re-add recent item:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'No se pudo agregar el producto',
        detail: item.name,
        life: 4000,
      });
    }
  }

  //#endregion

  //#region Helpers

  /**
   * Pushes an item to recents (newest first, deduped by `productId`,
   * capped at `MAX_RECENT_ITEMS`, and persisted to localStorage scoped
   * to the active branch).
   */
  private pushRecent(item: RecentItem): void {
    const branchId = this.authService.activeBranchId();
    if (branchId === null || branchId === undefined) return;
    const filtered = this.recentItems().filter((r) => r.productId !== item.productId);
    const next = [item, ...filtered].slice(0, MAX_RECENT_ITEMS);
    this.recentItems.set(next);
    this.persistRecents(branchId, next);
  }

  /**
   * Reads recents for the given branch from localStorage. Returns an
   * empty array on missing key, parse error, or storage unavailability.
   * Validates each entry's shape and discards malformed records (so a
   * legacy schema does not survive the upgrade).
   */
  private loadRecents(branchId: number): RecentItem[] {
    const key = `${RECENTS_STORAGE_KEY_PREFIX}${branchId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((it): it is RecentItem =>
          it !== null
          && typeof it === 'object'
          && typeof (it as RecentItem).productId === 'number'
          && typeof (it as RecentItem).name === 'string'
          && typeof (it as RecentItem).priceCents === 'number',
        )
        .slice(0, MAX_RECENT_ITEMS);
    } catch {
      try { localStorage.removeItem(key); } catch { /* storage may be sealed */ }
      return [];
    }
  }

  /** Persists recents for the branch; silent on quota or privacy errors. */
  private persistRecents(branchId: number, items: RecentItem[]): void {
    const key = `${RECENTS_STORAGE_KEY_PREFIX}${branchId}`;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      /* quota / privacy mode — keep working in-memory only */
    }
  }

  /** Lower-cases, trims, and strips diacritics for case-fold search. */
  private normalize(s: string): string {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  }

  //#endregion
}
