import { Component, OnInit, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { MessageService } from 'primeng/api';

import { InputTextModule } from 'primeng/inputtext';

import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { CartItem, Order, RejectedPromotion, RejectionReason } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { ConfigService } from '../../../../core/services/config.service';
import { CustomerService } from '../../../../core/services/customer.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { OrderContextService } from '../../../../core/services/order-context.service';
import { PromotionService } from '../../../../core/services/promotion.service';
import { SyncService } from '../../../../core/services/sync.service';
import { TableAssignmentService } from '../../../../core/services/table-assignment.service';
import { CustomerSelectorComponent } from '../../../../shared/components/customer-selector/customer-selector.component';
import { TableSelectorDialogComponent, TableSelectedEvent } from '../table-selector-dialog/table-selector-dialog.component';

@Component({
  selector: 'app-cart-panel',
  standalone: true,
  imports: [FormsModule, ButtonModule, DividerModule, InputTextModule, PricePipe, CustomerSelectorComponent, TableSelectorDialogComponent],
  templateUrl: './cart-panel.component.html',
  styleUrl: './cart-panel.component.scss',
})
export class CartPanelComponent implements OnInit {

  //#region Properties
  readonly cartItems = this.cartService.items;
  readonly totalCents = this.cartService.totalCents;
  readonly totalTaxCents = this.cartService.totalTaxCents;
  readonly subtotalPreTaxCents = this.cartService.subtotalPreTaxCents;
  readonly itemCount = this.cartService.itemCount;
  readonly cartEvaluation = this.cartService.cartEvaluation;
  readonly nextOrderNumber = this.syncService.nextOrderNumber;
  readonly activeTableName = signal<string | null>(null);

  /** Guards against double-tap on kitchen/checkout actions */
  readonly isProcessing = signal(false);

  // ---- Coupon state ----
  readonly activeCoupon = this.promotionService.activeCoupon;
  readonly couponCode = signal('');
  readonly couponError = signal('');
  readonly couponLoading = signal(false);

  // ---- Rejected promos toggle ----
  readonly showRejected = signal(false);

  /** Context when adding items to an existing table order */
  addingToOrder: { orderId: string; orderNumber: number } | null = null;

  /** True when the business has a kitchen — determines button label */
  readonly showSendToKitchen = computed(() => this.configService.hasKitchen());

  // ---- Table assignment (FDD-001) ----
  /** Controls TableSelectorDialog visibility */
  readonly showTableSelector = signal(false);

  /** True when a table can be assigned to the active order */
  readonly canAssignTable = this.orderContextService.canAssignTable;

  /** Display name of the assigned table from OrderContextService */
  readonly activeTableDisplay = this.orderContextService.activeTableName;
  //#endregion

  //#region Constructor
  constructor(
    private readonly cartService: CartService,
    private readonly syncService: SyncService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly cashRegisterService: CashRegisterService,
    readonly customerService: CustomerService,
    private readonly db: DatabaseService,
    private readonly promotionService: PromotionService,
    private readonly orderContextService: OrderContextService,
    private readonly tableAssignmentService: TableAssignmentService,
    private readonly messageService: MessageService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle
  ngOnInit(): void {
    const activeTable = sessionStorage.getItem('activeTable');
    if (activeTable) {
      const { tableName } = JSON.parse(activeTable);
      this.activeTableName.set(tableName);
    }

    const addingTo = sessionStorage.getItem('addingToOrder');
    if (addingTo) {
      this.addingToOrder = JSON.parse(addingTo);
      // Load the full order into OrderContextService for table assignment
      this.loadActiveOrder(this.addingToOrder!.orderId);
    }
  }

  /** Loads an existing order from Dexie into OrderContextService */
  private async loadActiveOrder(orderId: string): Promise<void> {
    const order = await this.db.orders.get(orderId);
    if (order) {
      this.orderContextService.setActiveOrder(order);
    }
  }
  //#endregion

  //#region Cart Methods

  /** Increases item quantity by 1 */
  async increment(item: CartItem): Promise<void> {
    await this.cartService.updateQuantity(item.id, item.quantity + 1);
  }

  /**
   * Decreases item quantity by 1.
   * If quantity reaches 0, the item is removed automatically by CartService.
   */
  async decrement(item: CartItem): Promise<void> {
    await this.cartService.updateQuantity(item.id, item.quantity - 1);
  }

  /** Removes an item from the cart entirely */
  async remove(item: CartItem): Promise<void> {
    await this.cartService.removeItem(item.id);
  }

  /** Navigates to the checkout page */
  onCheckout(): void {
    if (!this.requireOpenSession()) return;
    this.router.navigate(['/pos/checkout']);
  }

  /**
   * Sends order to kitchen or adds items to existing order.
   * Used in waiter/tables mode. Guarded against double-tap.
   */
  async onSendToKitchen(): Promise<void> {
    if (!this.requireOpenSession()) return;
    if (this.isProcessing()) return;

    const newItems = this.cartService.getSnapshot();
    if (newItems.length === 0) return;

    this.isProcessing.set(true);
    try {
      if (this.addingToOrder) {
        await this.addItemsToExistingOrder(newItems);
      } else {
        await this.createKitchenOrder(newItems);
      }
    } finally {
      this.isProcessing.set(false);
    }
  }

  /** Creates a new kitchen order for the active table */
  private async createKitchenOrder(items: CartItem[]): Promise<void> {
    const raw = sessionStorage.getItem('activeTable');
    if (!raw) {
      this.messageService.add({ severity: 'warn', summary: 'Selecciona una mesa primero', life: 3000 });
      return;
    }

    const { tableId, tableName } = JSON.parse(raw);

    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber: this.syncService.consumeOrderNumber(),
      items,
      totalCents: this.cartService.totalCents(),
      subtotalCents: this.cartService.totalCents(),
      payments: [],
      paidCents: 0,
      changeCents: 0,
      paymentProvider: null,
      syncStatus: 'Pending',
      kitchenStatus: 'Pending',
      tableId: tableId ?? undefined,
      tableName: tableName ?? undefined,
      customerId: this.customerService.selectedCustomer()?.id,
      customerName: this.customerService.selectedCustomer()?.name,
      createdAt: new Date(),
      branchId: this.authService.branchId,
      cashRegisterSessionId: this.cashRegisterService.activeSession()?.id,
    };

    await this.syncService.saveOrder(order);
    this.orderContextService.setActiveOrder(order);
    await this.cartService.clearCart();
    sessionStorage.removeItem('activeTable');

    this.messageService.add({ severity: 'success', summary: 'Orden enviada a cocina', life: 3000 });
    setTimeout(() => this.router.navigate(['/tables']), 500);
  }

  /** Adds new items to an existing table order */
  private async addItemsToExistingOrder(newItems: CartItem[]): Promise<void> {
    const existing = await this.db.orders.get(this.addingToOrder!.orderId);
    if (!existing) {
      this.messageService.add({ severity: 'error', summary: 'Orden no encontrada', life: 3000 });
      return;
    }

    existing.items = [...existing.items, ...newItems];
    const totalCents = existing.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
    existing.subtotalCents = totalCents;
    existing.totalCents = totalCents;
    existing.syncStatus = 'Pending';

    await this.syncService.saveOrder(existing);
    await this.cartService.clearCart();
    sessionStorage.removeItem('addingToOrder');
    sessionStorage.removeItem('activeTable');

    const num = this.addingToOrder!.orderNumber;
    this.addingToOrder = null;

    this.messageService.add({ severity: 'success', summary: `Items agregados a Orden #${num}`, life: 3000 });
    setTimeout(() => this.router.navigate(['/tables']), 500);
  }

  /**
   * Cancels adding items to existing order.
   * Clears context and navigates back to tables.
   */
  async onCancelAddingItems(): Promise<void> {
    sessionStorage.removeItem('addingToOrder');
    sessionStorage.removeItem('activeTable');
    this.addingToOrder = null;
    await this.cartService.clearCart();
    this.router.navigate(['/tables']);
  }

  /** Clears the entire cart after user confirmation */
  async onCancelOrder(): Promise<void> {
    await this.cartService.clearCart();
    this.orderContextService.clearActiveOrder();
  }

  /** Delegates to the centralized session guard in CashRegisterService */
  private requireOpenSession(): boolean {
    return this.cashRegisterService.requireOpenSession();
  }
  //#endregion

  //#region Table Assignment Methods (FDD-001)

  /** Opens the table selector dialog */
  onAssignTable(): void {
    this.showTableSelector.set(true);
  }

  /** Handles table selection from the dialog */
  async onTableSelected(event: TableSelectedEvent): Promise<void> {
    const order = this.orderContextService.activeOrder();
    if (!order) return;

    const success = await this.tableAssignmentService.assignTable(
      order.id,
      event.tableId,
      event.tableName,
    );

    if (success) {
      this.activeTableName.set(event.tableName);
      this.messageService.add({
        severity: 'success',
        summary: `Orden asignada a ${event.tableName}`,
        life: 3000,
      });
    }
  }

  //#endregion

  //#region Coupon Methods

  /** Validates and applies the entered coupon code */
  async applyCoupon(): Promise<void> {
    const code = this.couponCode().trim();
    if (!code) return;

    this.couponError.set('');
    this.couponLoading.set(true);
    const error = await this.promotionService.validateCoupon(code);
    this.couponLoading.set(false);

    if (error) {
      this.couponError.set(error);
    } else {
      this.couponCode.set('');
    }
  }

  /** Removes the active coupon */
  removeCoupon(): void {
    this.promotionService.clearCoupon();
    this.couponCode.set('');
    this.couponError.set('');
  }

  //#endregion

  //#region Promotion Helpers

  /** Returns human-readable reason for a rejected promotion */
  rejectionText(rejected: RejectedPromotion): string {
    switch (rejected.reason) {
      case RejectionReason.WrongDay:          return 'Solo aplica ciertos días';
      case RejectionReason.MinOrderNotMet:    return `Mínimo ${this.formatCents(rejected.promotion.minOrderCents ?? 0)} en orden`;
      case RejectionReason.MaxUsesReached:    return 'Límite alcanzado';
      case RejectionReason.Expired:           return 'Expirada';
      case RejectionReason.CouponRequired:    return 'Requiere cupón';
      case RejectionReason.ProductNotMatch:   return 'Producto no incluido';
      case RejectionReason.OutsideDateRange:  return 'Fuera de vigencia';
      default:                                return 'No aplica';
    }
  }

  /** Formats cents to pesos string for inline use */
  private formatCents(cents: number): string {
    return '$' + (cents / 100).toFixed(2);
  }

  //#endregion

  /** Returns a comma-separated string of extra labels for display */
  getExtraLabels(item: CartItem): string {
    return item.extras.map(e => e.label).join(', ');
  }

  /** trackBy for the cart items @for loop */
  trackById(_: number, item: CartItem): string {
    return item.id;
  }

}
