import { Component, OnInit, computed, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { RadioButtonModule } from 'primeng/radiobutton';

import { environment } from '../../../../../environments/environment';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { CartItem, DiscountPreset, Order, PaymentMethod } from '../../../../core/models';
import { CartService } from '../../../../core/services/cart.service';
import { DiscountService } from '../../../../core/services/discount.service';
import { PrintService } from '../../../../core/services/print.service';
import { SyncService } from '../../../../core/services/sync.service';
import { TableService } from '../../../../core/services/table.service';

/** Internal step of the checkout flow */
type CheckoutStep = 'payment' | 'confirmed';

/** Branch ID — hardcoded until multi-branch support */
const BRANCH_ID = 1;

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    AsyncPipe,
    FormsModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    RadioButtonModule,
    PricePipe,
  ],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.scss',
})
export class CheckoutComponent implements OnInit {

  //#region Properties

  /** Current checkout step */
  readonly step = signal<CheckoutStep>('payment');

  /** Selected payment method — null until the user picks one */
  readonly selectedMethod = signal<PaymentMethod | null>(null);

  /**
   * Amount tendered by the customer in cents.
   * Bound via InputNumber (displayed in pesos, converted to cents on change).
   */
  readonly tenderedCents = signal<number>(0);

  /** The completed order, available after confirmPayment() succeeds */
  readonly completedOrder = signal<Order | null>(null);

  /** Snapshot of cart items taken at mount — cart is cleared after confirm */
  cartItems: CartItem[] = [];

  /** Whether the printer fallback "Ver ticket" button should be shown */
  readonly showTicketFallback = !this.printService.hasThermalPrinter();

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

  // ---- Table context (from /tables navigation state) ----
  readonly tableId = signal<number | null>(null);
  readonly tableName = signal<string | null>(null);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  /** Subtotal before discount — sum of all cart items */
  readonly subtotalCents = computed(() => this.cartService.totalCents());

  /** Discount amount in cents */
  readonly discountCents = computed(() => {
    const preset = this.selectedPreset();
    if (preset) {
      return this.discountService.calculateDiscount(preset, this.subtotalCents());
    }
    if (this.isCustomDiscount() && this.customDiscountValue() > 0) {
      const fakePreset = {
        type: this.customDiscountType(),
        value: this.customDiscountType() === 'fixed'
          ? Math.round(this.customDiscountValue() * 100)
          : this.customDiscountValue(),
      } as DiscountPreset;
      return this.discountService.calculateDiscount(fakePreset, this.subtotalCents());
    }
    return 0;
  });

  /** Final total after discount */
  readonly totalWithDiscount = computed(() =>
    Math.max(0, this.subtotalCents() - this.discountCents()),
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

  /** Change to give back to the customer in cents (cash payments only) */
  readonly changeCents = computed(() => {
    if (this.selectedMethod() !== 'cash') return 0;
    return Math.max(0, this.tenderedCents() - this.totalWithDiscount());
  });

  /**
   * True when the operator can confirm the payment:
   *   - Total must be greater than zero
   *   - A method must be selected
   *   - For cash: tendered amount must cover the total (after discount)
   */
  readonly canConfirm = computed(() => {
    if (this.totalWithDiscount() === 0) return false;
    const method = this.selectedMethod();
    if (!method) return false;
    if (method === 'cash') return this.tenderedCents() >= this.totalWithDiscount();
    return true;
  });

  /** Item count from cart service */
  readonly itemCount = this.cartService.itemCount;

  //#endregion

  //#region Constructor
  constructor(
    private readonly cartService: CartService,
    private readonly syncService: SyncService,
    private readonly printService: PrintService,
    private readonly discountService: DiscountService,
    private readonly tableService: TableService,
    private readonly http: HttpClient,
    private readonly router: Router,
  ) {}
  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    // Read table context from sessionStorage
    const activeTable = sessionStorage.getItem('activeTable');
    if (activeTable) {
      const { tableId, tableName } = JSON.parse(activeTable);
      this.tableId.set(tableId);
      this.tableName.set(tableName ?? null);
    }

    // Load discount presets
    await this.discountService.loadPresets(BRANCH_ID);
    const presets = await this.discountService.getPresets(BRANCH_ID);
    this.presets.set(presets);

    // Subscribe to cart updates — also handles the empty-cart redirect
    this.cartService.cart$.subscribe(items => {
      if (this.step() !== 'payment') return;
      this.cartItems = items;
      if (items.length === 0 && (Date.now() - this.initTime) > 1000) {
        this.router.navigate(['/pos']);
      }
    });
  }

  //#endregion

  //#region Payment Methods

  /** Selects a payment method and resets tendered amount */
  selectMethod(method: PaymentMethod): void {
    this.selectedMethod.set(method);
    this.tenderedCents.set(0);
  }

  /**
   * Called by the InputNumber when the tendered amount changes.
   * The InputNumber binds in pesos — this converts to cents.
   * @param pesos Value in pesos from the input (may be null when cleared)
   */
  onTenderedChange(pesos: number | null): void {
    this.tenderedCents.set(Math.round((pesos ?? 0) * 100));
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
   * Confirms the payment and completes the order.
   * Order: save to IndexedDB → print ticket → advance to confirmed step → clear cart.
   */
  async confirmPayment(): Promise<void> {
    if (!this.canConfirm()) return;

    const method = this.selectedMethod()!;
    const orderNumber = this.syncService.consumeOrderNumber();
    const discount = this.discountCents();

    const order: Order = {
      id: crypto.randomUUID(),
      orderNumber,
      items: this.cartItems,
      subtotalCents: this.subtotalCents(),
      discountCents: discount > 0 ? discount : undefined,
      discountLabel: this.discountLabel() || undefined,
      discountReason: this.discountReason().trim() || undefined,
      totalCents: this.totalWithDiscount(),
      paymentMethod: method,
      tenderedCents: method === 'cash' ? this.tenderedCents() : undefined,
      paymentProvider: null,
      createdAt: new Date(),
      syncStatus: 'pending',
      businessId: BRANCH_ID,
      tableId: this.tableId() ?? undefined,
      tableName: this.tableName() ?? undefined,
    };

    await this.syncService.saveOrder(order);
    await this.printService.printTicket(order);

    this.completedOrder.set(order);
    this.step.set('confirmed');
    await this.cartService.clearCart();

    // sessionStorage('activeTable') is cleaned by releaseTable() or keepTable()
  }

  /** Navigates back to the POS grid without completing the order */
  cancel(): void {
    this.router.navigate(['/pos']);
  }

  /** Releases the table — awaits full HTTP response before navigating */
  async releaseTable(): Promise<void> {
    const raw = sessionStorage.getItem('activeTable');
    sessionStorage.removeItem('activeTable');

    if (raw) {
      const { tableId } = JSON.parse(raw);
      if (tableId) {
        const token = localStorage.getItem('pos_auth_token');
        try {
          await firstValueFrom(
            this.http.patch(
              `${environment.apiUrl}/table/${tableId}/status`,
              { status: 'available' },
              { headers: { Authorization: `Bearer ${token}` } },
            )
          );
        } catch (e) {
          console.error('Error liberando mesa:', e);
        }
      }
    }

    this.router.navigate(['/tables']);
  }

  /** Keeps the table occupied and navigates back to tables */
  keepTable(): void {
    sessionStorage.removeItem('activeTable');
    this.router.navigate(['/tables']);
  }

  /** Starts a new order — cart is already cleared, navigate back to POS */
  startNewOrder(): void {
    this.router.navigate(['/pos']);
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
