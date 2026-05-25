import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SidebarModule } from 'primeng/sidebar';
import { TableModule } from 'primeng/table';
import { MessageService } from 'primeng/api';

import {
  CreateCustomerRequest,
  Customer,
  CustomerMembership,
  CustomerOrderRowDto,
  CustomerStatsDto,
  MembershipStatus,
} from '../../../../core/models';
import { QrStatusResponseDto } from '../../../../core/models/qr-access.model';
import { FeatureKey } from '../../../../core/enums';
import { CustomerService } from '../../../../core/services/customer.service';
import { QrAccessService } from '../../../../core/services/qr-access.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { CustomerNamePipe, formatCustomerName } from '../../../../shared/pipes/customer-name.pipe';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-admin-customers',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    PaginatorModule,
    RadioButtonModule,
    SidebarModule,
    TableModule,
    CustomerNamePipe,
    PricePipe,
  ],
  templateUrl: './admin-customers.component.html',
  styleUrl: './admin-customers.component.scss',
})
export class AdminCustomersComponent implements OnInit {

  //#region Properties
  private readonly customerService = inject(CustomerService);
  private readonly qrAccessService = inject(QrAccessService);
  private readonly tenantContext = inject(TenantContextService);
  private readonly messageService = inject(MessageService);

  /**
   * True when the tenant runs real-time access-control flows (gyms, spas,
   * recurring services). Drives visibility of the QR enrollment section
   * in the drawer (FDD-027 / Access Control). Mapped to
   * `FeatureKey.RealtimeAccessControl` per AUDIT-058 Vector A so the
   * capability is uniformly defined across dashboard + customer modules.
   */
  readonly isAccessControlTenant = computed(() =>
    this.tenantContext.hasFeature(FeatureKey.RealtimeAccessControl),
  );

  /** All customers for the data table */
  readonly customers = this.customerService.customers;
  readonly isLoading = this.customerService.isLoading;

  /** Search filter for the table */
  readonly searchQuery = signal('');

  /** Filtered customers based on search query */
  readonly filteredCustomers = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const all = this.customers();
    if (!q) return all;
    return all.filter(c =>
      formatCustomerName(c).toLowerCase().includes(q)
      || c.phone.includes(q)
      || (c.email?.toLowerCase().includes(q)),
    );
  });

  // ---- Create dialog ----
  readonly showCreateDialog = signal(false);
  readonly isSaving = signal(false);
  createForm: CreateCustomerRequest = this.emptyCreateForm();

  //#endregion

  //#region Profile Drawer

  readonly drawerCustomer = signal<Customer | null>(null);
  readonly showDrawer = signal(false);

  // Async sections — each section has independent data + loading signals
  readonly customerStats = signal<CustomerStatsDto | null>(null);
  readonly customerMemberships = signal<CustomerMembership[]>([]);
  readonly customerOrders = signal<CustomerOrderRowDto[]>([]);

  readonly isLoadingStats = signal(false);
  readonly isLoadingMemberships = signal(false);
  readonly isLoadingOrders = signal(false);

  // Pagination — order history page state, mirrors backend `PageData<T>`
  readonly ordersCurrentPage = signal<number>(1);
  readonly ordersTotalRecords = signal<number>(0);
  private static readonly ORDERS_PAGE_SIZE = 10;

  /**
   * Membership cards rendered in the drawer, sorted per FDD-027 §4.2:
   *   1. Active pinned to the top
   *   2. Frozen next
   *   3. Everything else (Expired / Cancelled), each tier sorted by
   *      `validUntil` desc as a tiebreaker.
   * Backend only sorts by `validUntil` desc, so the status pinning is
   * applied client-side.
   */
  readonly sortedMemberships = computed<CustomerMembership[]>(() => {
    const order = (s: MembershipStatus): number =>
      s === MembershipStatus.Active ? 0
      : s === MembershipStatus.Frozen ? 1
      : 2;

    return [...this.customerMemberships()].sort((a, b) => {
      const cmp = order(a.status) - order(b.status);
      if (cmp !== 0) return cmp;
      return new Date(b.validUntil).getTime() - new Date(a.validUntil).getTime();
    });
  });

  /**
   * Spanish UI labels for the membership status badges.
   * Centralised so the template stays declarative and the mapping is
   * reusable in future surfaces (reception gate, dashboard widget).
   */
  readonly MEMBERSHIP_STATUS_LABEL: Record<MembershipStatus, string> = {
    [MembershipStatus.Active]:    'Vigente',
    [MembershipStatus.Expired]:   'Vencida',
    [MembershipStatus.Frozen]:    'Congelada',
    [MembershipStatus.Cancelled]: 'Cancelada',
  };

  //#endregion

  //#region Adjust Dialogs

  readonly showAdjustPointsDialog = signal(false);
  readonly showAdjustCreditDialog = signal(false);
  readonly adjustType = signal<'add' | 'subtract'>('add');
  readonly adjustAmount = signal<number>(0);
  readonly adjustReason = signal('');
  readonly isAdjusting = signal(false);

  //#endregion

  //#region QR Access (Gym vertical)

  /** Latest QR enrollment status for the drawer customer; null while loading or off-vertical. */
  readonly qrStatus = signal<QrStatusResponseDto | null>(null);

  /** Initial-load flag for the QR section (driven by `loadQrStatus`). */
  readonly isLoadingQr = signal(false);

  /** Bound to the inline enroll input — typed/scanned QR code value. */
  readonly qrTokenInput = signal<string>('');

  /** Toggles the revoke-confirmation `<p-dialog>`. */
  readonly showRevokeQrDialog = signal(false);

  /** In-flight flag for the enroll POST. */
  readonly isEnrolling = signal(false);

  /** In-flight flag for the revoke DELETE. */
  readonly isRevoking = signal(false);

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.customerService.loadCustomers();
  }

  //#endregion

  //#region Create Customer

  openCreateDialog(): void {
    this.createForm = this.emptyCreateForm();
    this.showCreateDialog.set(true);
  }

  async saveCustomer(): Promise<void> {
    if (!this.createForm.firstName.trim() || !this.createForm.phone.trim()) return;

    this.isSaving.set(true);
    try {
      await this.customerService.createCustomer(this.createForm);
      this.showCreateDialog.set(false);
      this.messageService.add({
        severity: 'success',
        summary: 'Cliente creado',
        life: 3000,
      });
    } catch (error: any) {
      const detail = error?.error?.message ?? 'No se pudo crear el cliente';
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail,
        life: 4000,
      });
    } finally {
      this.isSaving.set(false);
    }
  }

  //#endregion

  //#region Profile Drawer Methods

  /**
   * Opens the profile drawer for the clicked customer and dispatches
   * the three async fetches concurrently (stats / memberships /
   * orders). All section state is reset up-front so the drawer never
   * flashes data from the previously-selected customer.
   */
  onRowClick(customer: Customer): void {
    this.drawerCustomer.set(customer);
    this.showDrawer.set(true);

    // Reset all section state before kicking off the async loads —
    // prevents stale data from the prior customer leaking through.
    this.customerStats.set(null);
    this.customerMemberships.set([]);
    this.customerOrders.set([]);
    this.ordersCurrentPage.set(1);
    this.ordersTotalRecords.set(0);
    this.qrStatus.set(null);
    this.qrTokenInput.set('');
    this.isLoadingStats.set(true);
    this.isLoadingMemberships.set(true);
    this.isLoadingOrders.set(true);

    // Fire concurrently — each method handles its own try/catch/finally
    // and applies a staleness guard so rapid customer-row switches
    // never cause a stale write.
    void this.loadStats();
    void this.loadMemberships();
    void this.loadQrStatus(customer.id);
    void this.loadOrders(1);
  }

  /**
   * Refreshes the stats KPIs from the dedicated `/stats` endpoint.
   * Captures the customer id at entry and re-checks before every
   * signal write so a fast row-switch never overwrites the new
   * customer's data with the previous customer's response.
   */
  private async loadStats(): Promise<void> {
    const id = this.drawerCustomer()?.id;
    if (id === undefined) return;
    this.isLoadingStats.set(true);
    try {
      const stats = await this.customerService.getStats(id);
      if (this.drawerCustomer()?.id !== id) return;
      this.customerStats.set(stats);
    } catch (err) {
      if (this.drawerCustomer()?.id !== id) return;
      console.warn('[AdminCustomers] Stats load failed:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las estadísticas',
        life: 4000,
      });
    } finally {
      if (this.drawerCustomer()?.id === id) {
        this.isLoadingStats.set(false);
      }
    }
  }

  /**
   * Refreshes the membership list from the BE memberships endpoint.
   * Same staleness guard pattern as `loadStats`.
   */
  private async loadMemberships(): Promise<void> {
    const id = this.drawerCustomer()?.id;
    if (id === undefined) return;
    this.isLoadingMemberships.set(true);
    try {
      const memberships = await this.customerService.getMemberships(id);
      if (this.drawerCustomer()?.id !== id) return;
      this.customerMemberships.set(memberships);
    } catch (err) {
      if (this.drawerCustomer()?.id !== id) return;
      console.warn('[AdminCustomers] Memberships load failed:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las membresías',
        life: 4000,
      });
    } finally {
      if (this.drawerCustomer()?.id === id) {
        this.isLoadingMemberships.set(false);
      }
    }
  }

  /**
   * Loads a single page of the customer's order history. Invoked from
   * `onRowClick` (initial page) and from the paginator
   * (`onOrdersPageChange`). Sets the loading flag at the start so
   * paginator clicks render the spinner correctly.
   */
  async loadOrders(page: number): Promise<void> {
    const id = this.drawerCustomer()?.id;
    if (id === undefined) return;
    this.isLoadingOrders.set(true);
    try {
      const response = await this.customerService.getOrders(id, {
        page,
        pageSize: AdminCustomersComponent.ORDERS_PAGE_SIZE,
      });
      if (this.drawerCustomer()?.id !== id) return;
      this.customerOrders.set(response.data);
      this.ordersCurrentPage.set(response.currentPage);
      this.ordersTotalRecords.set(response.rowsCount);
    } catch (err) {
      if (this.drawerCustomer()?.id !== id) return;
      console.warn('[AdminCustomers] Orders load failed:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo cargar el historial',
        life: 4000,
      });
    } finally {
      if (this.drawerCustomer()?.id === id) {
        this.isLoadingOrders.set(false);
      }
    }
  }

  /**
   * Bridges the PrimeNG paginator's 0-indexed `page` to the backend's
   * 1-indexed pagination contract.
   */
  onOrdersPageChange(event: PaginatorState): void {
    void this.loadOrders((event.page ?? 0) + 1);
  }

  //#endregion

  //#region Adjust Points

  /** Opens the adjust points dialog */
  openAdjustPoints(): void {
    this.adjustType.set('add');
    this.adjustAmount.set(0);
    this.adjustReason.set('');
    this.showAdjustPointsDialog.set(true);
  }

  /** Confirms the points adjustment and refreshes state */
  async confirmAdjustPoints(): Promise<void> {
    const customer = this.drawerCustomer();
    if (!customer || this.adjustAmount() <= 0 || !this.adjustReason().trim()) return;

    const delta = this.adjustType() === 'add' ? this.adjustAmount() : -this.adjustAmount();

    this.isAdjusting.set(true);
    try {
      await this.customerService.adjustPoints(customer.id, delta, this.adjustReason().trim());
      this.showAdjustPointsDialog.set(false);

      // Refresh drawer customer from the updated signal
      const updated = this.customers().find(c => c.id === customer.id);
      if (updated) this.drawerCustomer.set(updated);

      this.messageService.add({
        severity: 'success',
        summary: 'Puntos actualizados',
        life: 3000,
      });
    } catch (error: any) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: error?.error?.message ?? 'No se pudieron ajustar los puntos',
        life: 4000,
      });
    } finally {
      this.isAdjusting.set(false);
    }
  }

  //#endregion

  //#region Adjust Credit

  /** Opens the adjust credit dialog */
  openAdjustCredit(): void {
    this.adjustType.set('add');
    this.adjustAmount.set(0);
    this.adjustReason.set('');
    this.showAdjustCreditDialog.set(true);
  }

  /** Confirms the credit adjustment (amount in pesos → cents) and refreshes state */
  async confirmAdjustCredit(): Promise<void> {
    const customer = this.drawerCustomer();
    if (!customer || this.adjustAmount() <= 0 || !this.adjustReason().trim()) return;

    const deltaCents = this.adjustType() === 'add'
      ? Math.round(this.adjustAmount() * 100)
      : -Math.round(this.adjustAmount() * 100);

    this.isAdjusting.set(true);
    try {
      await this.customerService.adjustCredit(customer.id, deltaCents, this.adjustReason().trim());
      this.showAdjustCreditDialog.set(false);

      const updated = this.customers().find(c => c.id === customer.id);
      if (updated) this.drawerCustomer.set(updated);

      this.messageService.add({
        severity: 'success',
        summary: 'Crédito actualizado',
        life: 3000,
      });
    } catch (error: any) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: error?.error?.message ?? 'No se pudo ajustar el crédito',
        life: 4000,
      });
    } finally {
      this.isAdjusting.set(false);
    }
  }

  //#endregion

  //#region QR Access Methods

  /**
   * Loads the QR enrollment status for the drawer customer. Mirrors the
   * `loadStats`/`loadMemberships` pattern: staleness-guarded against
   * rapid row switches so a late response never overwrites the new
   * customer's data.
   */
  private async loadQrStatus(customerId: number): Promise<void> {
    if (!this.isAccessControlTenant()) return;
    this.isLoadingQr.set(true);
    try {
      const status = await this.qrAccessService.getQrStatus(customerId);
      if (this.drawerCustomer()?.id !== customerId) return;
      this.qrStatus.set(status);
    } catch (err) {
      if (this.drawerCustomer()?.id !== customerId) return;
      console.warn('[AdminCustomers] QR status load failed:', err);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo cargar el estado de la tarjeta QR',
        life: 4000,
      });
    } finally {
      if (this.drawerCustomer()?.id === customerId) {
        this.isLoadingQr.set(false);
      }
    }
  }

  /** Enrolls the typed/scanned QR token for the drawer customer. */
  async onEnrollQr(): Promise<void> {
    const id = this.drawerCustomer()?.id;
    const token = this.qrTokenInput().trim();
    if (!id || !token) return;

    this.isEnrolling.set(true);
    try {
      await this.qrAccessService.enrollQr({ customerId: id, qrToken: token });
      this.qrTokenInput.set('');
      await this.loadQrStatus(id);
      this.messageService.add({
        severity: 'success',
        summary: 'Tarjeta vinculada',
        life: 3000,
      });
    } catch (err: unknown) {
      const detail = this.extractErrorDetail(err, 'No se pudo vincular la tarjeta');
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail,
        life: 4000,
      });
    } finally {
      this.isEnrolling.set(false);
    }
  }

  /** Confirms the revoke flow from the modal, calls the API, refreshes status. */
  async confirmRevokeQr(): Promise<void> {
    const id = this.drawerCustomer()?.id;
    if (!id) return;

    this.isRevoking.set(true);
    try {
      await this.qrAccessService.revokeQr(id);
      this.showRevokeQrDialog.set(false);
      await this.loadQrStatus(id);
      this.messageService.add({
        severity: 'success',
        summary: 'Tarjeta revocada',
        life: 3000,
      });
    } catch (err: unknown) {
      const detail = this.extractErrorDetail(err, 'No se pudo revocar la tarjeta');
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail,
        life: 4000,
      });
    } finally {
      this.isRevoking.set(false);
    }
  }

  /** Defensive extraction of a user-facing message from an HTTP rejection. */
  private extractErrorDetail(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string } } | null;
    return e?.error?.message ?? fallback;
  }

  //#endregion

  //#region Helpers

  /** Formats a phone number for display (e.g., 6671234567 → 667 123 4567) */
  formatPhone(phone: string): string {
    if (phone.length === 10) {
      return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
    }
    return phone;
  }

  private emptyCreateForm(): CreateCustomerRequest {
    return { firstName: '', lastName: '', phone: '', email: undefined, notes: undefined, creditLimitCents: 0 };
  }

  //#endregion

}
