import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { RadioButtonModule } from 'primeng/radiobutton';

import { environment } from '../../../../../environments/environment';
import { formatCustomerName } from '../../../../shared/pipes/customer-name.pipe';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { MessageService } from 'primeng/api';

import { CartItem, CUSTOMER_PAYMENT_OPTIONS, DiscountPreset, InvoiceRequest, Order, OrderPayment, PaymentMethod, ALL_PAYMENT_METHOD_OPTIONS, PaymentMethodOption, getPaymentLabel } from '../../../../core/models';
import { KitchenStatusId, PaymentStatus, SyncStatusId, TableStatus } from '../../../../core/enums';
import { DEFAULT_TAX_RATE, calculateItemTax } from '../../../../core/utils/tax.utils';
import { CartService } from '../../../../core/services/cart.service';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { ConfigService } from '../../../../core/services/config.service';
import { CustomerService } from '../../../../core/services/customer.service';
import { InvoicingService } from '../../../../core/services/invoicing.service';
import { CustomerSelectorComponent } from '../../../../shared/components/customer-selector/customer-selector.component';
import { CustomerFiscalModalComponent } from '../../../../shared/components/customer-fiscal-modal/customer-fiscal-modal.component';
import { PaymentProviderService } from '../../../../core/services/payment-provider.service';
import { PaymentProcessingDialogComponent } from '../payment-processing-dialog/payment-processing-dialog.component';
import { DatabaseService } from '../../../../core/services/database.service';
import { DiscountService } from '../../../../core/services/discount.service';
import { PrinterService } from '../../../../core/services/printer.service';
import { PrintService } from '../../../../core/services/print.service';
import { ProductService } from '../../../../core/services/product.service';
import { OrderContextService } from '../../../../core/services/order-context.service';
import { OrderPullDto, SyncService } from '../../../../core/services/sync.service';
import { TableService } from '../../../../core/services/table.service';
import { AuthService } from '../../../../core/services/auth.service';
import { PromotionService } from '../../../../core/services/promotion.service';
import { formatMeasureUnit, isMeasureItem } from '../../../../core/utils/product.utils';

/** Internal step of the checkout flow */
type CheckoutStep = 'payment' | 'confirmed';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    RadioButtonModule,
    PricePipe,
    PaymentProcessingDialogComponent,
    CustomerFiscalModalComponent,
    CustomerSelectorComponent,
  ],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.scss',
})
export class CheckoutComponent implements OnInit {

  //#region Properties

  /** Template predicate for measure-based items — drives kg/L/m display in summary. */
  readonly isMeasureItem = isMeasureItem;

  /** Template helper for the dynamic unit suffix from the SAT code. */
  readonly formatMeasureUnit = formatMeasureUnit;

  /** Guards against double-tap on the confirm payment button */
  readonly isProcessing = signal(false);

  /** Current checkout step */
  readonly step = signal<CheckoutStep>('payment');

  // ---- Multi-payment state ----
  readonly pendingPayments = signal<OrderPayment[]>([]);
  readonly showPaymentDialog = signal(false);
  readonly dialogMethod = signal<PaymentMethod>(PaymentMethod.Cash);
  dialogAmountPesos = 0;
  dialogReference = '';

  /** Available payment methods (base + providers + customer balance methods) */
  readonly paymentOptions = computed(() => {
    const base = this.paymentProviderService.getAvailableOptions();
    const customer = this.customerService.selectedCustomer();
    if (!customer) return base;

    const extras: PaymentMethodOption[] = [];
    if (customer.creditBalanceCents > 0) {
      extras.push(CUSTOMER_PAYMENT_OPTIONS.find(o => o.method === PaymentMethod.StoreCredit)!);
    }
    if (customer.pointsBalance > 0) {
      extras.push(CUSTOMER_PAYMENT_OPTIONS.find(o => o.method === PaymentMethod.LoyaltyPoints)!);
    }
    return [...base, ...extras];
  });

  /** Controls visibility of the PaymentProcessingDialog */
  readonly showProcessingDialog = signal(false);

  /** The completed order, available after confirmPayment() succeeds */
  readonly completedOrder = signal<Order | null>(null);

  /** Whether the kitchen confirmation dialog is visible */
  readonly showKitchenConfirm = signal(false);

  /** Whether to show the table release prompt (false if other active orders remain) */
  readonly showTableRelease = signal(false);

  /** Snapshot of cart items taken at mount — cart is cleared after confirm */
  readonly cartItems = signal<CartItem[]>([]);

  /** Whether the printer fallback "Ver ticket" button should be shown */
  readonly showTicketFallback = computed(() => !this.printService.hasThermalPrinter());

  /** Timestamp of component init — used to debounce empty-cart redirect */
  private readonly initTime = Date.now();

  // ---- Discount state ----

  /** Available discount presets from API/Dexie */
  readonly presets = signal<DiscountPreset[]>([]);

  /** Currently selected preset (null = none) */
  readonly selectedPreset = signal<DiscountPreset | null>(null);

  /** Whether custom discount mode is active */
  readonly isCustomDiscount = signal(false);

  /** Custom discount type when in custom mode */
  readonly customDiscountType = signal<'percent' | 'fixed'>('percent');

  /** Custom discount value (percent 0–100 or fixed amount in cents) */
  readonly customDiscountValue = signal(0);

  /** Optional reason for applying the discount */
  readonly discountReason = signal('');

  /** Whether the discount section is expanded */
  readonly showDiscountSection = signal(false);

  // ---- Table context (delegated to OrderContextService SSOT) ----
  readonly tableId = computed(() => this.orderContextService.activeTable()?.tableId ?? null);
  readonly tableName = computed(() => this.orderContextService.activeTableName());

  // ---- Existing order context (charging a table order from /orders) ----
  /**
   * Full Order loaded from Dexie/API when charging an existing table order.
   * Single source of truth — all derived state (id, totals) reads from this.
   */
  readonly loadedOrder = signal<Order | null>(null);

  /** Convenience: id of the loaded order (null for brand-new orders) */
  readonly existingOrderId = computed(() => this.loadedOrder()?.id ?? null);

  /** Convenience: total of the loaded order (0 when there is no loaded order) */
  readonly existingTotalCents = computed(() => this.loadedOrder()?.totalCents ?? 0);

  /** Pre-generated UUID for new orders — used by provider intents before the order is saved */
  readonly preGeneratedOrderId = crypto.randomUUID();

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  /** Promotion evaluation from cart service */
  readonly cartEvaluation = this.cartService.cartEvaluation;

  /** Promotion discount in cents (from auto promos) */
  readonly promoDiscountCents = computed(() =>
    this.cartEvaluation()?.totalDiscountCents ?? 0
  );

  /** Raw subtotal before any discounts (promo + manual) */
  readonly rawSubtotalCents = computed(() => {
    if (this.existingOrderId()) return this.existingTotalCents();
    return this.cartService.totalCents() + this.promoDiscountCents();
  });

  /** Subtotal after promo discounts, before manual discount */
  readonly subtotalCents = computed(() =>
    this.existingOrderId() ? this.existingTotalCents() : this.cartService.totalCents()
  );

  /** Discount amount in cents */
  readonly discountCents = computed(() => {
    const preset = this.selectedPreset();
    if (preset) {
      return this.discountService.calculateDiscount(preset, this.subtotalCents());
    }
    if (this.isCustomDiscount() && this.customDiscountValue() > 0) {
      const rawValue = this.customDiscountValue();
      // Phase 4: Safe float→cents conversion using toFixed to avoid IEEE 754 drift.
      // E.g. 0.15 * 100 could yield 14.999... — toFixed(0) rounds correctly.
      const fakePreset = {
        type: this.customDiscountType(),
        value: this.customDiscountType() === 'fixed'
          ? Number((rawValue * 100).toFixed(0))
          : rawValue,
      } as DiscountPreset;
      return this.discountService.calculateDiscount(fakePreset, this.subtotalCents());
    }
    return 0;
  });

  /** Final total after discount */
  readonly totalWithDiscount = computed(() =>
    Math.max(0, this.subtotalCents() - this.discountCents()),
  );

  /** Tax (IVA) extracted from the final total — uses per-item rates */
  readonly taxAmountCents = computed(() => {
    const items = this.cartItems();
    if (items.length === 0) return 0;
    const totalBeforeDiscount = items.reduce((s, i) => s + i.totalPriceCents, 0);
    const totalAfterDiscount = this.totalWithDiscount();
    if (totalBeforeDiscount === 0) return 0;

    // Prorate totalAfterDiscount across items; last item absorbs rounding
    // remainder so Σ(shares) === totalAfterDiscount exactly (no cent drift).
    const shares: number[] = new Array(items.length);
    let allocated = 0;
    for (let i = 0; i < items.length - 1; i++) {
      const share = Math.round(items[i].totalPriceCents * totalAfterDiscount / totalBeforeDiscount);
      shares[i] = share;
      allocated += share;
    }
    shares[items.length - 1] = totalAfterDiscount - allocated;

    return items.reduce((sum, item, idx) => {
      const rate = item.taxRate ?? DEFAULT_TAX_RATE;
      const isTaxIncluded = item.product.isTaxIncluded !== false;
      return sum + calculateItemTax(shares[idx], 0, rate, isTaxIncluded);
    }, 0);
  });

  /** Subtotal pre-tax (total minus extracted tax) */
  readonly subtotalPreTaxCents = computed(() =>
    Math.max(0, this.totalWithDiscount() - this.taxAmountCents()),
  );

  /** Display label for the applied discount */
  readonly discountLabel = computed(() => {
    const preset = this.selectedPreset();
    if (preset) return preset.name;
    if (this.isCustomDiscount() && this.customDiscountValue() > 0) {
      return this.customDiscountType() === 'percent'
        ? `${this.customDiscountValue()}% personalizado`
        : 'Descuento monto fijo';
    }
    return '';
  });

  /** Sum of all pending payment amounts in cents */
  readonly totalPaidCents = computed(() =>
    this.pendingPayments().reduce((s, p) => s + p.amountCents, 0),
  );

  /** Amount still needed to cover the order total */
  readonly remainingCents = computed(() =>
    Math.max(0, this.totalWithDiscount() - this.totalPaidCents()),
  );

  /** Change to give back to the customer in cents */
  readonly changeCents = computed(() =>
    Math.max(0, this.totalPaidCents() - this.totalWithDiscount()),
  );

  /**
   * True when at least one cart line is a membership product but has
   * not been assigned a beneficiary in `metadata.beneficiaryCustomerId`.
   * Blocks the confirm-payment button so the cashier cannot finalize a
   * sale that would silently lose the membership-extension intent.
   */
  readonly hasUnassignedMemberships = computed(() =>
    this.cartItems().some(item => {
      const days = item.product.metadata?.membershipDurationDays;
      const isMembership = typeof days === 'number' && days > 0;
      if (!isMembership) return false;
      const beneficiaryId = item.metadata?.beneficiaryCustomerId;
      return typeof beneficiaryId !== 'number';
    }),
  );

  /** True when total paid covers the order total */
  readonly canConfirm = computed(() => {
    // Zero-total orders (100%-off promos, giveaways) are already covered.
    if (this.totalWithDiscount() === 0) return true;
    return this.totalPaidCents() >= this.totalWithDiscount();
  });

  /** Item count from cart service */
  readonly itemCount = this.cartService.itemCount;

  // ---- Split payment ----
  readonly showSplitDialog = signal(false);
  readonly splitParts = signal(2);
  readonly splitCurrentPart = signal(1);

  /** Per-part amount using floor so parts never exceed the total */
  readonly splitBaseAmountCents = computed(() =>
    Math.floor(this.totalWithDiscount() / this.splitParts()),
  );

  /** Amount for the current part — last part absorbs the remainder */
  readonly splitAmountCents = computed(() => {
    const total = this.totalWithDiscount();
    const parts = this.splitParts();
    const base = Math.floor(total / parts);
    if (this.splitCurrentPart() >= parts) {
      return total - base * (parts - 1);
    }
    return base;
  });

  readonly splitPartsArray = computed(() =>
    Array.from({ length: this.splitParts() }, (_, i) => i + 1),
  );

  /** Expose for template */
  readonly PaymentMethod = PaymentMethod;

  /** True when no cash register session is open — blocks payment confirmation */
  readonly sessionBlocked = computed(() => !this.cashRegisterService.hasOpenSession());

  // ---- Invoicing (FDD-004) ----
  /** Controls visibility of the fiscal data modal */
  readonly showFiscalModal = signal(false);

  /** True when the "Facturar" button should be visible */
  readonly canInvoice = computed(() => {
    const order = this.completedOrder();
    return order !== null
      && this.configService.hasInvoicing()
      && !order.invoiceRequest;
  });

  /** True when the order has been successfully invoiced */
  readonly isInvoiced = computed(() =>
    this.completedOrder()?.invoiceRequest?.status === 'completed',
  );

  // ---- Customer (FDD-005) ----
  /** Selected customer from the CustomerSelectorComponent */
  readonly selectedCustomer = this.customerService.selectedCustomer;

  /** Returns display label for an order's payments */
  orderPaymentLabel(order: Order): string {
    return getPaymentLabel(order);
  }

  //#endregion

  //#region Constructor

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly cartService: CartService,
    private readonly syncService: SyncService,
    private readonly cashRegisterService: CashRegisterService,
    private readonly configService: ConfigService,
    readonly customerService: CustomerService,
    private readonly invoicingService: InvoicingService,
    readonly paymentProviderService: PaymentProviderService,
    private readonly printService: PrintService,
    private readonly printerService: PrinterService,
    private readonly discountService: DiscountService,
    private readonly tableService: TableService,
    private readonly productService: ProductService,
    private readonly promotionService: PromotionService,
    private readonly orderContextService: OrderContextService,
    private readonly db: DatabaseService,
    private readonly http: HttpClient,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly messageService: MessageService,
  ) {
    // Phase 2: Replace orphaned cart$.subscribe() with an effect
    effect(() => {
      const items = this.cartService.items();
      if (this.step() !== 'payment') return;
      if (!this.existingOrderId()) {
        this.cartItems.set(items);
      }
      if (items.length === 0 && !this.existingOrderId() && (Date.now() - this.initTime) > 1000) {
        this.router.navigate(['/pos']);
      }
    });
  }
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    // Table context is read reactively from OrderContextService.activeTable() —
    // no sessionStorage access needed here.

    // Check if charging an existing table order
    const orderId = this.route.snapshot.queryParamMap.get('orderId');
    if (orderId) {
      await this.loadExistingOrder(orderId);
    }

    // Load discount presets
    await this.discountService.loadPresets(this.authService.branchId);
    const presets = await this.discountService.getPresets(this.authService.branchId);
    this.presets.set(presets);
  }

  //#endregion

  //#region Multi-Payment Methods

  /**
   * Opens the appropriate payment dialog for a given method.
   * Provider-backed methods (Clip, MercadoPago) open the processing dialog.
   * Standard methods open the simple amount/reference dialog.
   * @param method The payment method to add
   */
  openAddPayment(method: PaymentMethod): void {
    if (this.paymentProviderService.requiresProcessing(method)) {
      this.startProviderPayment(method);
      return;
    }
    this.dialogMethod.set(method);

    // Cap credit/points amounts to available balance
    const remaining = this.remainingCents();
    const customer = this.customerService.selectedCustomer();
    if (method === PaymentMethod.StoreCredit && customer) {
      this.dialogAmountPesos = Math.min(remaining, customer.creditBalanceCents) / 100;
    } else if (method === PaymentMethod.LoyaltyPoints && customer) {
      this.dialogAmountPesos = Math.min(remaining, customer.pointsBalance * 100) / 100;
    } else {
      this.dialogAmountPesos = remaining / 100;
    }

    this.dialogReference = '';
    this.showPaymentDialog.set(true);
  }

  /**
   * Adds the dialog payment to pendingPayments and closes the dialog.
   * Only Cash is allowed to overpay (generates change); all other methods
   * are capped to the remaining balance to prevent phantom change.
   */
  confirmAddPayment(): void {
    const amountCents = Math.round(this.dialogAmountPesos * 100);
    if (amountCents <= 0) return;

    const method = this.dialogMethod();
    if (method !== PaymentMethod.Cash && amountCents > this.remainingCents()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Monto excede el saldo',
        detail: 'Solo los pagos en efectivo pueden generar cambio.',
        life: 3000,
      });
      return;
    }

    const payment: OrderPayment = {
      method,
      paymentStatusId: PaymentStatus.Completed,
      amountCents,
      reference: this.dialogReference.trim() || undefined,
    };

    this.pendingPayments.update(arr => [...arr, payment]);
    this.showPaymentDialog.set(false);
  }

  /**
   * Removes a payment from pendingPayments by index.
   * @param index The index of the payment to remove
   */
  removePayment(index: number): void {
    this.pendingPayments.update(arr => arr.filter((_, i) => i !== index));
  }

  /** Returns display label for a payment method (including providers) */
  getPaymentMethodLabel(method: PaymentMethod): string {
    return ALL_PAYMENT_METHOD_OPTIONS.find(o => o.method === method)?.label ?? method;
  }

  /** Whether the reference field should show for a method */
  showReferenceField(): boolean {
    const m = this.dialogMethod();
    return m === PaymentMethod.Card || m === PaymentMethod.Transfer;
  }

  //#endregion

  //#region Provider Payment Methods

  /**
   * Starts a provider-backed payment transaction.
   * Opens the processing dialog and initiates the provider flow.
   */
  private async startProviderPayment(method: PaymentMethod): Promise<void> {
    const amountCents = this.remainingCents();
    if (amountCents <= 0) return;

    const orderId = this.existingOrderId() ?? this.preGeneratedOrderId;
    this.showProcessingDialog.set(true);
    await this.paymentProviderService.startTransaction(method, amountCents, orderId);
  }

  /** Handles a confirmed payment from the processing dialog */
  onProviderPaymentConfirmed(payment: OrderPayment): void {
    this.pendingPayments.update(arr => [...arr, payment]);
    this.showProcessingDialog.set(false);
  }

  /** Handles cancellation from the processing dialog */
  onProviderPaymentCancelled(): void {
    this.showProcessingDialog.set(false);
  }

  //#endregion

  //#region Split Payment

  openSplitDialog(): void {
    this.splitParts.set(2);
    this.splitCurrentPart.set(1);
    this.showSplitDialog.set(true);
  }

  registerSplitPayment(method: PaymentMethod): void {
    const payment: OrderPayment = {
      method,
      paymentStatusId: PaymentStatus.Completed,
      amountCents: this.splitAmountCents(),
    };
    this.pendingPayments.update(arr => [...arr, payment]);

    if (this.splitCurrentPart() >= this.splitParts()) {
      this.showSplitDialog.set(false);
    } else {
      this.splitCurrentPart.update(n => n + 1);
    }
  }

  //#endregion

  //#region Discount Methods

  /** Selects a preset discount — toggles off if already selected */
  selectPreset(preset: DiscountPreset): void {
    if (this.selectedPreset()?.id === preset.id) {
      this.selectedPreset.set(null);
    } else {
      this.selectedPreset.set(preset);
      this.isCustomDiscount.set(false);
      this.customDiscountValue.set(0);
    }
  }

  /** Activates custom discount mode and clears preset */
  enableCustomDiscount(): void {
    this.isCustomDiscount.set(true);
    this.selectedPreset.set(null);
  }

  /** Removes all discounts */
  clearDiscount(): void {
    this.selectedPreset.set(null);
    this.isCustomDiscount.set(false);
    this.customDiscountValue.set(0);
    this.discountReason.set('');
    this.showDiscountSection.set(false);
  }

  /** Called by the custom discount InputNumber */
  onCustomValueChange(value: number | null): void {
    if (this.customDiscountType() === 'fixed') {
      this.customDiscountValue.set(value ?? 0);
    } else {
      this.customDiscountValue.set(value ?? 0);
    }
  }

  //#endregion

  //#region Checkout Flow

  /**
   * Loads an existing order from Dexie (or API fallback) for payment.
   * Pre-fills cart items and table context.
   */
  private async loadExistingOrder(orderId: string): Promise<void> {
    let order = await this.db.orders.get(orderId);

    if (!order) {
      order = await this.loadOrderFromApi(orderId);
      if (order) {
        await this.db.orders.put(order);
      }
    }

    if (!order) return;

    // Block re-payment of fully paid orders; allow partial payment completion
    if (order.payments && order.payments.length > 0) {
      const totalPaid = order.payments.reduce((sum, p) => sum + p.amountCents, 0);
      if (totalPaid >= order.totalCents) {
        this.completedOrder.set(order);
        this.step.set('confirmed');
        return;
      }
      this.pendingPayments.set(order.payments);
    }

    this.loadedOrder.set(order);
    this.cartItems.set(order.items);

    // Publish table context via SSOT so release/keep flows can read it.
    if (order.tableId && order.tableName) {
      this.orderContextService.setActiveTable({
        tableId: order.tableId,
        tableName: order.tableName,
      });
    }
  }

  /** Fetches an order from the API and maps it to the local Order shape */
  private async loadOrderFromApi(orderId: string): Promise<Order | undefined> {
    try {
      const dto = await firstValueFrom(
        this.http.get<OrderPullDto>(`${environment.apiUrl}/orders/${orderId}`),
      );
      if (!dto) return undefined;
      return this.syncService.mapPullDto(dto);
    } catch {
      return undefined;
    }
  }

  /**
   * Checks kitchen status before confirming payment.
   * If order is still in kitchen, shows a confirmation dialog first.
   * Guarded against double-tap via isProcessing signal.
   */
  async onConfirmPayment(): Promise<void> {
    if (!this.requireOpenSession()) return;
    if (this.isProcessing() || !this.canConfirm() || this.hasUnassignedMemberships()) return;

    // Check if existing order is still in kitchen
    if (this.existingOrderId()) {
      const existing = await this.db.orders.get(this.existingOrderId()!);
      const ks = existing?.kitchenStatusId;
      if (ks === KitchenStatusId.Pending) {
        this.showKitchenConfirm.set(true);
        return;
      }
    }

    await this.confirmPayment();
  }

  /**
   * Confirms the payment and completes the order.
   * Order: save to IndexedDB → print ticket → advance to confirmed step → teardown.
   * Locked by isProcessing to prevent duplicate orders from button-mashing.
   */
  async confirmPayment(): Promise<void> {
    this.showKitchenConfirm.set(false);
    // Re-guard: the session may have been closed from another tab while
    // the kitchen confirmation dialog was open.
    if (!this.requireOpenSession()) return;
    if (this.isProcessing() || !this.canConfirm() || this.hasUnassignedMemberships()) return;

    this.isProcessing.set(true);
    try {
      const payments = this.pendingPayments();
      const discount = this.discountCents();
      const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
      // Safe: requireOpenSession() above guarantees an active session at this point.
      const activeSessionId = this.cashRegisterService.activeSession()!.id;
      let order: Order;

      if (this.existingOrderId()) {
        // Charging an existing table order — update it
        const existing = await this.db.orders.get(this.existingOrderId()!);
        if (!existing) return;

        const finalTotal = discount > 0 ? Math.max(0, existing.totalCents - discount) : existing.totalCents;

        order = {
          ...existing,
          payments,
          paidCents,
          changeCents: Math.max(0, paidCents - finalTotal),
          subtotalCents: existing.totalCents,
          orderDiscountCents: discount > 0 ? discount : undefined,
          totalDiscountCents: discount > 0 ? discount : undefined,
          orderPromotionName: this.discountLabel() || undefined,
          totalCents: finalTotal,
          taxAmountCents: this.taxAmountCents(),
          syncStatusId: SyncStatusId.Pending,
          cashRegisterSessionId: existing.cashRegisterSessionId ?? activeSessionId,
        };

        await this.db.orders.put(order);
        await this.syncService.syncPendingOrders();
      } else {
        // Normal new order flow
        const orderNumber = this.syncService.consumeOrderNumber();

        order = {
          id: this.preGeneratedOrderId,
          orderNumber,
          items: this.cartItems(),
          subtotalCents: this.subtotalCents(),
          orderDiscountCents: discount > 0 ? discount : undefined,
          totalDiscountCents: discount > 0 ? discount : undefined,
          orderPromotionName: this.discountLabel() || undefined,
          totalCents: this.totalWithDiscount(),
          taxAmountCents: this.taxAmountCents(),
          payments,
          paidCents,
          changeCents: this.changeCents(),
          paymentProvider: this.derivePaymentProvider(payments),
          createdAt: new Date(),
          syncStatusId: SyncStatusId.Pending,
          branchId: this.authService.branchId,
          cashRegisterSessionId: activeSessionId,
          customerId: this.customerService.selectedCustomer()?.id,
          customerName: formatCustomerName(this.customerService.selectedCustomer()) || undefined,
          tableId: this.tableId() ?? undefined,
          tableName: this.tableName() ?? undefined,
        };

        await this.syncService.saveOrder(order);
      }

      // Inventory deduction is handled atomically by the backend during SyncService.saveOrder().
      // No frontend deduction needed — optimistic local stock was already adjusted by CartService.

      // Fire-and-forget cash drawer kick for any cash-tender payment. A
      // disconnected drawer or a printer mid-reconnect must never block
      // the order confirmation, so errors are swallowed.
      if (payments.some(p => p.method === PaymentMethod.Cash)) {
        this.printerService.openCashDrawer().catch(() => { /* ignored */ });
      }

      try {
        await this.printService.printTicket(order);
      } catch {
        // Print failed — order is saved, show fallback ticket button.
        // showTicketFallback is already true when no printer or print fails.
        console.warn('[Checkout] Print failed — ticket available via "Ver ticket"');
      }

      this.completedOrder.set(order);
      this.step.set('confirmed');

      // Phase 3: Full state teardown — clears cart, coupons, and session context
      await this.resetCheckoutState();

      // Check if table has remaining active orders before showing release prompt
      if (order.tableId) {
        try {
          const remaining = await this.tableService.getActiveOrdersByTable(order.tableId);
          this.showTableRelease.set(remaining.length === 0);
        } catch {
          this.showTableRelease.set(true); // Fallback: show prompt if check fails
        }
      }
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Phase 3: Complete teardown of transient state after a successful order.
   * Clears cart, active coupons, and session-scoped context so nothing
   * leaks into the next customer's order.
   */
  private async resetCheckoutState(): Promise<void> {
    // Delegates to the centralised cleanup on CartService so every
    // payment surface stays in sync. Note: activeTable is cleaned by
    // releaseTable()/keepTable() — intentionally not part of the
    // centralised reset so the F&B table-release prompt still works
    // on the confirmed step.
    await this.cartService.resetTransactionState();
  }

  /** Delegates to the centralized session guard in CashRegisterService */
  private requireOpenSession(): boolean {
    return this.cashRegisterService.requireOpenSession();
  }

  /**
   * Derives the order-level paymentProvider from the payments array.
   * Returns the single provider if all payments use the same one,
   * 'mixed' if multiple providers are used, or null if none.
   */
  private derivePaymentProvider(payments: OrderPayment[]): string | null {
    const providers = [...new Set(payments.map(p => p.paymentProvider).filter(Boolean))];
    if (providers.length === 0) return null;
    if (providers.length === 1) return providers[0]!;
    return 'mixed';
  }

  /** Navigates back to the POS grid without completing the order */
  cancel(): void {
    this.router.navigate(['/pos']);
  }

  /** Releases the table — awaits full HTTP response before navigating */
  async releaseTable(): Promise<void> {
    const tableId = this.orderContextService.activeTable()?.tableId ?? null;
    this.orderContextService.clearActiveTable();

    if (tableId) {
      const token = localStorage.getItem('pos_auth_token');
      try {
        await firstValueFrom(
          this.http.patch(
            `${environment.apiUrl}/table/${tableId}/status`,
            { tableStatusId: TableStatus.Available },
            { headers: { Authorization: `Bearer ${token}` } },
          )
        );
      } catch (e) {
        console.error('Error liberando mesa:', e);
      }
    }

    this.router.navigate(['/tables']);
  }

  /** Keeps the table occupied and navigates back to tables */
  keepTable(): void {
    this.orderContextService.clearActiveTable();
    this.router.navigate(['/tables']);
  }

  /** Starts a new order — cart is already cleared, navigate back to POS */
  startNewOrder(): void {
    this.router.navigate(['/pos']);
  }

  //#endregion

  //#region Invoicing (FDD-004)

  /** Opens the fiscal data modal */
  onRequestInvoice(): void {
    this.showFiscalModal.set(true);
  }

  /** Handles successful invoice request from the modal */
  onInvoiceRequested(req: InvoiceRequest): void {
    const order = this.completedOrder();
    if (order) {
      this.completedOrder.set({ ...order, invoiceRequest: req });
    }
    this.showFiscalModal.set(false);
  }

  //#endregion

  //#region Ticket

  /** Opens a styled ticket preview in a new window and triggers print */
  viewTicket(): void {
    const order = this.completedOrder();
    if (!order) return;

    const html = this.printService.getTicketHtml(order);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Ticket #${order.orderNumber}</title>
          <style>
            body { margin: 0; padding: 0; background: white; }
            @media print {
              @page { size: 80mm auto; margin: 2mm; }
            }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `);
    win.document.close();
    win.print();
  }

  //#endregion

}
