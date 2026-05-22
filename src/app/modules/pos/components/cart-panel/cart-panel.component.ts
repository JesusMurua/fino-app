import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DividerModule } from 'primeng/divider';
import { MessageService } from 'primeng/api';

import { InputTextModule } from 'primeng/inputtext';

import { formatCustomerName } from '../../../../shared/pipes/customer-name.pipe';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import {
  CartItem,
  Customer,
  Order,
  RejectedPromotion,
  RejectionReason,
  getBeneficiaryId,
  isMembershipItem,
} from '../../../../core/models';
import { KitchenStatusId, SyncStatusId } from '../../../../core/enums';
import { calculateOrderTaxFromSnapshot } from '../../../../core/utils/tax.utils';
import { AuthService } from '../../../../core/services/auth.service';
import { CartFlowService } from '../../../../core/services/cart-flow.service';
import { CartService } from '../../../../core/services/cart.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { ConfigService } from '../../../../core/services/config.service';
import { CustomerService } from '../../../../core/services/customer.service';
import { DatabaseService } from '../../../../core/services/database.service';
import { OrderContextService } from '../../../../core/services/order-context.service';
import { PromotionService } from '../../../../core/services/promotion.service';
import { SyncService } from '../../../../core/services/sync.service';
import { TableAssignmentService } from '../../../../core/services/table-assignment.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { formatMeasureUnit, isMeasureItem } from '../../../../core/utils/product.utils';
import { CustomerSelectorComponent } from '../../../../shared/components/customer-selector/customer-selector.component';
import { TableSelectorDialogComponent, TableSelectedEvent } from '../table-selector-dialog/table-selector-dialog.component';
import { QuickPayComponent } from '../quick-pay/quick-pay.component';
import { WeightCaptureDialogComponent } from '../weight-capture-dialog/weight-capture-dialog.component';

@Component({
  selector: 'app-cart-panel',
  standalone: true,
  imports: [DecimalPipe, FormsModule, ButtonModule, DialogModule, DividerModule, InputTextModule, PricePipe, CustomerSelectorComponent, TableSelectorDialogComponent, QuickPayComponent, WeightCaptureDialogComponent],
  templateUrl: './cart-panel.component.html',
  styleUrl: './cart-panel.component.scss',
})
export class CartPanelComponent implements OnInit {

  //#region Properties

  /**
   * Opt-in glassmorphism mode. Set to `true` only inside the unified POS
   * shell (`<app-unified-pos>`) where the cart panel sits over a
   * page-bg gradient and benefits from the translucent backdrop blur.
   * Stays `false` in `<app-restaurant-hub>` so the legacy F&B shell keeps
   * its solid white surface and avoids the transparent-bleed regression
   * documented in AUDIT-050. See `project_glassmorphism_scope.md`.
   */
  readonly isGlassMode = input<boolean>(false);

  /** Template predicate for measure-based items — drives kg/L/m display + button gate. */
  readonly isMeasureItem = isMeasureItem;

  /** Template helper for the dynamic unit suffix from the SAT code. */
  readonly formatMeasureUnit = formatMeasureUnit;

  /** Orchestrator for POS catalog clicks — the dialog reads its request signal. */
  readonly cartFlowService = inject(CartFlowService);

  readonly cartItems = this.cartService.items;
  readonly totalCents = this.cartService.totalCents;
  readonly totalTaxCents = this.cartService.totalTaxCents;
  readonly subtotalPreTaxCents = this.cartService.subtotalPreTaxCents;
  readonly itemCount = this.cartService.itemCount;
  readonly cartEvaluation = this.cartService.cartEvaluation;
  readonly nextOrderNumber = this.syncService.nextOrderNumber;

  /** Guards against double-tap on kitchen/checkout actions */
  readonly isProcessing = signal(false);

  // ---- Coupon state ----
  readonly activeCoupon = this.promotionService.activeCoupon;
  readonly couponCode = signal('');
  readonly couponError = signal('');
  readonly couponLoading = signal(false);

  // ---- Rejected promos toggle ----
  readonly showRejected = signal(false);

  /** Context when adding items to an existing table order — SSOT in OrderContextService */
  readonly addingToOrder = this.orderContextService.addingToOrder;

  /** True when the business has a kitchen — determines button label */
  readonly showSendToKitchen = computed(() => this.configService.hasKitchen());

  /**
   * True when the tenant can route line items to a kitchen (kitchen
   * tickets, KDS screens, or table-map assignment). Drives the
   * mesa / send-to-kitchen / checkout-vs-quick-pay branching.
   *
   * Delegated to `TenantContextService.supportsKitchenOrders`, which
   * is mapped to the underlying capability features (PrintedTickets /
   * MaxKdsScreens / TableMap) rather than the macro itself — keeps
   * this component vertical-agnostic per AUDIT-058 Vector A.
   */
  readonly supportsKitchenOrders = this.tenantContext.supportsKitchenOrders;

  /**
   * Controls the inline `<app-quick-pay>` dialog used by non-kitchen
   * verticals (Services, Retail, Counter, Quick) to skip `/pos/checkout`
   * and complete a cash sale in one step. Wired only when
   * `!supportsKitchenOrders()`.
   */
  readonly showQuickPay = signal(false);

  // ---- Table assignment (FDD-001) ----
  /** Controls TableSelectorDialog visibility */
  readonly showTableSelector = signal(false);

  /** True when a table can be assigned to the active order */
  readonly canAssignTable = this.orderContextService.canAssignTable;

  /** Display name of the active table — unified signal across all sources */
  readonly activeTableName = this.orderContextService.activeTableName;

  // ---- Item-level beneficiary selector (Gym vertical) ----
  /** Cart item id whose beneficiary picker is currently open; null = closed */
  readonly activeBeneficiaryItemId = signal<string | null>(null);
  /** True when the beneficiary picker dialog is visible */
  readonly beneficiaryDialogOpen = computed(() => this.activeBeneficiaryItemId() !== null);

  /**
   * Customer currently assigned as beneficiary on the line whose dialog
   * is open — used to pre-fill the customer-selector so reopening an
   * already-assigned item highlights the existing pick instead of a
   * blank search box. Returns null when nothing is assigned yet or
   * when the customer is not in the local cache.
   */
  readonly activeBeneficiaryCustomer = computed<Customer | null>(() => {
    const itemId = this.activeBeneficiaryItemId();
    if (!itemId) return null;
    const item = this.cartItems().find(i => i.id === itemId);
    if (!item) return null;
    const beneficiaryId = this.getBeneficiaryId(item);
    if (beneficiaryId === null) return null;
    return this.customerService.customers().find(c => c.id === beneficiaryId) ?? null;
  });

  /**
   * True when at least one cart line is a membership product
   * (`product.metadata.membershipDurationDays` is set) but has not
   * yet been assigned a `metadata.beneficiaryCustomerId`. Drives the
   * checkout-blocking guard on the pay buttons so cashiers cannot
   * complete a sale that would silently lose the membership intent.
   */
  readonly hasUnassignedMemberships = computed(() =>
    this.cartItems().some(item =>
      this.isMembershipItem(item) && this.getBeneficiaryId(item) === null,
    ),
  );
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
    private readonly tenantContext: TenantContextService,
    private readonly messageService: MessageService,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle
  ngOnInit(): void {
    // activeTable and addingToOrder are hydrated reactively from OrderContextService.
    // We only need to load the full order into the context service so the table
    // assignment dialog can bind to orderContextService.activeOrder().
    const ctx = this.orderContextService.addingToOrder();
    if (ctx) {
      this.loadActiveOrder(ctx.orderId);
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

  /**
   * Handles the measure-capture dialog confirmation: pulls the pending
   * product from the orchestrator, calls `addItem` with the decimal
   * quantity verbatim (the backend stores `Quantity decimal(18,4)`),
   * and clears the request so the dialog closes.
   */
  async onMeasureCaptured(event: { quantity: number }): Promise<void> {
    const prod = this.cartFlowService.weightCaptureRequest();
    if (prod) {
      await this.cartService.addItem(prod, undefined, [], undefined, event.quantity);
    }
    this.cartFlowService.clearWeightCaptureRequest();
  }

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

  /**
   * Primary checkout action.
   *
   * - Kitchen-capable tenants (`supportsKitchenOrders()`): navigates to
   *   the full `/pos/checkout` page, which supports card / split
   *   payments + tipping.
   * - Non-kitchen tenants (Services, Retail, Counter, Quick): opens the
   *   inline `<app-quick-pay>` dialog so the cashier can ring up a cash
   *   sale in one tap without leaving the POS view. This preserves the
   *   legacy `quick-pos` / `retail-pos` UX after the unified-shell
   *   refactor.
   */
  onCheckout(): void {
    if (!this.requireOpenSession()) return;
    if (this.supportsKitchenOrders()) {
      this.router.navigate(['/pos/checkout']);
      return;
    }
    this.showQuickPay.set(true);
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
      if (this.addingToOrder()) {
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
    const table = this.orderContextService.activeTable();
    if (!table) {
      this.messageService.add({ severity: 'warn', summary: 'Selecciona una mesa primero', life: 3000 });
      return;
    }

    const sessionId = this.cashRegisterService.activeSession()?.id;
    if (sessionId == null) {
      this.messageService.add({ severity: 'error', summary: 'Caja cerrada', detail: 'Abre un turno antes de enviar a cocina.', life: 4000 });
      return;
    }

    // subtotalCents is the raw pre-discount sum (per order.model.ts contract).
    // totalCents reflects promo discounts applied by CartService.
    const subtotalCents = items.reduce((sum, i) => sum + i.totalPriceCents, 0);

    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber: this.syncService.consumeOrderNumber(),
      items,
      totalCents: this.cartService.totalCents(),
      subtotalCents,
      taxAmountCents: calculateOrderTaxFromSnapshot(items),
      payments: [],
      paidCents: 0,
      changeCents: 0,
      paymentProvider: null,
      syncStatusId: SyncStatusId.Pending,
      kitchenStatusId: KitchenStatusId.Pending,
      tableId: table.tableId,
      tableName: table.tableName,
      customerId: this.customerService.selectedCustomer()?.id,
      customerName: formatCustomerName(this.customerService.selectedCustomer()) || undefined,
      createdAt: new Date(),
      branchId: this.authService.branchId,
      cashRegisterSessionId: sessionId,
    };

    await this.syncService.saveOrder(order);
    this.orderContextService.setActiveOrder(order);
    await this.cartService.clearCart();
    this.orderContextService.clearActiveTable();

    this.messageService.add({ severity: 'success', summary: 'Orden enviada a cocina', life: 3000 });
    setTimeout(() => this.router.navigate(['/tables']), 500);
  }

  /** Adds new items to an existing table order */
  private async addItemsToExistingOrder(newItems: CartItem[]): Promise<void> {
    const ctx = this.orderContextService.addingToOrder();
    if (!ctx) return;

    const existing = await this.db.orders.get(ctx.orderId);
    if (!existing) {
      this.messageService.add({ severity: 'error', summary: 'Orden no encontrada', life: 3000 });
      return;
    }

    existing.items = [...existing.items, ...newItems];
    const totalCents = existing.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
    existing.subtotalCents = totalCents;
    existing.totalCents = totalCents;
    existing.syncStatusId = SyncStatusId.Pending;

    await this.syncService.saveOrder(existing);
    await this.cartService.clearCart();
    this.orderContextService.clearAddingToOrder();
    this.orderContextService.clearActiveTable();

    this.messageService.add({ severity: 'success', summary: `Items agregados a Orden #${ctx.orderNumber}`, life: 3000 });
    setTimeout(() => this.router.navigate(['/tables']), 500);
  }

  /**
   * Cancels adding items to existing order.
   * Clears context and navigates back to tables.
   */
  async onCancelAddingItems(): Promise<void> {
    this.orderContextService.clearAddingToOrder();
    this.orderContextService.clearActiveTable();
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
      // activeTableName (computed) reflects the change automatically once
      // TableAssignmentService patches the active order via
      // OrderContextService.updateTableAssignment().
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

  //#region Membership Beneficiary (Gym vertical)

  /**
   * Pure-helper re-exports for template binding. The functions live in
   * `cart-item.model.ts`; Angular templates can only call class
   * properties, so we expose class-level references here.
   */
  readonly isMembershipItem = isMembershipItem;
  readonly getBeneficiaryId = getBeneficiaryId;

  /**
   * Looks up the beneficiary's name from the customer cache so the cart
   * can show "Para: Juan Pérez" instead of an opaque id. Returns null
   * when the customer is not in the local cache (e.g. just-created
   * record that has not been broadcast yet).
   */
  getBeneficiaryName(item: CartItem): string | null {
    const id = this.getBeneficiaryId(item);
    if (id === null) return null;
    const found = this.customerService.customers().find(c => c.id === id);
    return found ? formatCustomerName(found) : null;
  }

  /** Opens the beneficiary picker dialog for the given cart line. */
  openBeneficiarySelector(item: CartItem): void {
    this.activeBeneficiaryItemId.set(item.id);
  }

  /** Closes the beneficiary picker dialog without committing a change. */
  closeBeneficiarySelector(): void {
    this.activeBeneficiaryItemId.set(null);
  }

  /**
   * Commits the picked customer as the beneficiary for the active
   * membership line. Writes the typed `OrderItemMetadata` payload that
   * the backend's membership service consumes — only the beneficiary
   * id is needed; the duration is resolved server-side from the
   * product's `Metadata.MembershipDurationDays` (BDD-019 §6.1.1).
   *
   * A `null` payload means the user clicked the chip's clear button to
   * search for a different beneficiary — keep the dialog open so they
   * can pick again, and don't touch the cart. Closes only on a real
   * pick. No-ops when the active item disappeared from the cart while
   * the dialog was open or when the line is not a membership product.
   */
  async onBeneficiarySelected(customer: Customer | null): Promise<void> {
    if (!customer) return;

    const itemId = this.activeBeneficiaryItemId();
    this.closeBeneficiarySelector();
    if (!itemId) return;

    const item = this.cartItems().find(i => i.id === itemId);
    if (!item) return;

    if (!this.isMembershipItem(item)) return;

    await this.cartService.setItemMetadata(item.id, {
      beneficiaryCustomerId: customer.id,
    });
  }

  //#endregion

}
