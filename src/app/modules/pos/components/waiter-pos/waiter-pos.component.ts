import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';

import { CartItem, Order, Product, RestaurantTable } from '../../../../core/models';
import { KitchenStatusId, SyncStatusId } from '../../../../core/enums';
import { calcUnitPriceCents } from '../../../../core/models/cart-item.model';
import { NotificationToggleComponent } from '../../../../shared/components/notification-toggle/notification-toggle.component';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { ProductService } from '../../../../core/services/product.service';
import { SyncService } from '../../../../core/services/sync.service';
import { TableService } from '../../../../core/services/table.service';

/** Draft storage key — namespaced per branch so multiple venues don't collide */
const DRAFT_STORAGE_PREFIX = 'waiter-draft-';

/** Shape of a persisted draft order */
interface WaiterDraft {
  tableId: number;
  tableName: string;
  items: CartItem[];
  updatedAt: string;
}

/**
 * Waiter POS — Pro feature.
 *
 * Mobile-first touch UI for waiters taking orders at tables.
 *
 * Flow: Select Table → Add Items → Send to Kitchen.
 * NO payment UI. NO bill denominations. NO admin clutter.
 *
 * Drafts auto-save to localStorage per table so an accidental refresh or
 * tab close never loses an in-progress order.
 */
@Component({
  selector: 'app-waiter-pos',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    NotificationToggleComponent,
    ToastModule,
    PricePipe,
  ],
  templateUrl: './waiter-pos.component.html',
  styleUrl: './waiter-pos.component.scss',
  providers: [MessageService],
})
export class WaiterPosComponent implements OnInit, OnDestroy {

  //#region Injections

  private readonly destroy$ = new Subject<void>();
  private readonly authService = inject(AuthService);
  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly productService = inject(ProductService);
  private readonly syncService = inject(SyncService);
  private readonly tableService = inject(TableService);
  private readonly messageService = inject(MessageService);

  //#endregion

  //#region Properties

  /** All tables for the current branch */
  readonly tables = signal<RestaurantTable[]>([]);

  /** Currently selected table — null means the waiter is still on the table picker */
  readonly selectedTable = signal<RestaurantTable | null>(null);

  /** All loaded products */
  readonly products = this.productService.products;

  /** All loaded categories */
  readonly categories = this.productService.categories;

  /** Whether the catalog is loading */
  readonly isLoading = this.productService.isLoading;

  /** Search term for filtering products by name */
  readonly searchTerm = signal('');

  /** Selected category filter (null = all) */
  readonly selectedCategory = signal<number | null>(null);

  /** Current cart for the active table */
  readonly cartItems = signal<CartItem[]>([]);

  /** Whether the bottom sheet (cart) is open */
  readonly isCartOpen = signal(false);

  /** Whether the per-item note dialog is open */
  readonly showNoteDialog = signal(false);

  /** Item ID currently being annotated */
  readonly noteItemId = signal<string | null>(null);

  /** Draft value for the note input */
  noteDraft = '';

  /** Whether the send-to-kitchen request is in flight */
  readonly isSending = signal(false);

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

  /** Total items in the cart (sum of quantities) */
  readonly cartItemCount = computed(() =>
    this.cartItems().reduce((sum, item) => sum + item.quantity, 0)
  );

  /** Subtotal in centavos */
  readonly cartTotal = computed(() =>
    this.cartItems().reduce((sum, item) => sum + item.totalPriceCents, 0)
  );

  //#endregion

  //#region Constructor

  constructor() {
    // Reload catalog when the active branch changes
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.productService.loadCatalog();
    }, { allowSignalWrites: true });

    // Auto-persist drafts on every cart change
    effect(() => {
      const items = this.cartItems();
      const table = this.selectedTable();
      if (table) this.saveDraft(table, items);
    });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.productService.loadCatalog(),
      this.loadTables(),
    ]);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  //#endregion

  //#region Table Selection

  /** Loads tables for the current branch */
  private async loadTables(): Promise<void> {
    const branchId = this.authService.branchId;
    const tables = await this.tableService.getTables(branchId);
    this.tables.set(tables);
  }

  /** Selects a table and restores any existing draft for it */
  selectTable(table: RestaurantTable): void {
    this.selectedTable.set(table);
    const draft = this.loadDraft(table.id);
    this.cartItems.set(draft?.items ?? []);
  }

  /** Returns to the table picker, keeping the current draft intact */
  backToTables(): void {
    this.selectedTable.set(null);
    this.cartItems.set([]);
    this.searchTerm.set('');
    this.selectedCategory.set(null);
    this.isCartOpen.set(false);
  }

  //#endregion

  //#region Search & Categories

  /** Updates the search term from the input */
  onSearchInput(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  /** Clears the search term */
  clearSearch(): void {
    this.searchTerm.set('');
  }

  /** Sets the active category filter */
  selectCategory(id: number | null): void {
    this.selectedCategory.set(id);
  }

  //#endregion

  //#region Cart Operations

  /** Adds a product to the cart or increments its quantity */
  addToCart(product: Product): void {
    const items = this.cartItems();
    const existing = items.find(
      i => i.product.id === product.id && !i.size && i.extras.length === 0 && !i.notes,
    );

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

  /** Updates quantity for a cart item; removes if reaches 0 */
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

  /** Opens the bottom sheet cart */
  openCart(): void {
    this.isCartOpen.set(true);
  }

  /** Closes the bottom sheet cart */
  closeCart(): void {
    this.isCartOpen.set(false);
  }

  //#endregion

  //#region Item Notes

  /** Opens the note dialog for a specific cart item */
  openNoteDialog(itemId: string): void {
    const item = this.cartItems().find(i => i.id === itemId);
    if (!item) return;
    this.noteItemId.set(itemId);
    this.noteDraft = item.notes ?? '';
    this.showNoteDialog.set(true);
  }

  /** Saves the note draft to the selected cart item */
  saveNote(): void {
    const itemId = this.noteItemId();
    if (!itemId) return;

    this.cartItems.set(this.cartItems().map(i =>
      i.id === itemId ? { ...i, notes: this.noteDraft.trim() || undefined } : i
    ));
    this.showNoteDialog.set(false);
    this.noteItemId.set(null);
    this.noteDraft = '';
  }

  /** Cancels the note dialog without saving */
  cancelNote(): void {
    this.showNoteDialog.set(false);
    this.noteItemId.set(null);
    this.noteDraft = '';
  }

  //#endregion

  //#region Send to Kitchen

  /**
   * Persists the current cart as an Order in `Pending` kitchen status.
   * Skips the payment gateway entirely — payment happens later at the Caja.
   */
  async sendToKitchen(): Promise<void> {
    const table = this.selectedTable();
    if (!table || this.cartItems().length === 0 || this.isSending()) return;

    const sessionId = this.cashRegisterService.activeSession()?.id;
    if (sessionId == null) {
      this.messageService.add({
        severity: 'error',
        summary: 'Caja cerrada',
        detail: 'Abre un turno de caja antes de enviar a cocina.',
        life: 4000,
      });
      return;
    }

    this.isSending.set(true);

    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber: this.syncService.consumeOrderNumber(),
      items: this.cartItems(),
      subtotalCents: this.cartTotal(),
      totalCents: this.cartTotal(),
      payments: [],
      paidCents: 0,
      changeCents: 0,
      paymentProvider: null,
      syncStatusId: SyncStatusId.Pending,
      kitchenStatusId: KitchenStatusId.Pending,
      createdAt: new Date(),
      branchId: this.authService.branchId,
      cashRegisterSessionId: sessionId,
      tableId: table.id,
      tableName: table.name,
    };

    try {
      await this.syncService.saveOrder(order);

      this.messageService.add({
        severity: 'success',
        summary: `Comanda enviada a ${table.name}`,
        detail: `Orden #${order.orderNumber} lista para cocina`,
        life: 3000,
      });

      this.clearDraft(table.id);
      this.cartItems.set([]);
      this.isCartOpen.set(false);
      this.selectedTable.set(null);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'No se pudo enviar la comanda',
        detail: 'Revisa tu conexión e intenta de nuevo',
        life: 5000,
      });
    } finally {
      this.isSending.set(false);
    }
  }

  //#endregion

  //#region Draft Persistence

  /** Returns the localStorage key for the given table */
  private draftKey(tableId: number): string {
    const branchId = this.authService.branchId;
    return `${DRAFT_STORAGE_PREFIX}${branchId}-${tableId}`;
  }

  /** Persists the current cart to localStorage */
  private saveDraft(table: RestaurantTable, items: CartItem[]): void {
    if (items.length === 0) {
      this.clearDraft(table.id);
      return;
    }

    const draft: WaiterDraft = {
      tableId: table.id,
      tableName: table.name,
      items,
      updatedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(this.draftKey(table.id), JSON.stringify(draft));
    } catch {
      // Quota exceeded — ignore, draft loss is acceptable fallback
    }
  }

  /** Loads a persisted draft for the given table, if any */
  private loadDraft(tableId: number): WaiterDraft | null {
    try {
      const raw = localStorage.getItem(this.draftKey(tableId));
      return raw ? JSON.parse(raw) as WaiterDraft : null;
    } catch {
      return null;
    }
  }

  /** Removes the draft for the given table */
  private clearDraft(tableId: number): void {
    localStorage.removeItem(this.draftKey(tableId));
  }

  //#endregion

}
