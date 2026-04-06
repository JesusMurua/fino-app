import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SidebarModule } from 'primeng/sidebar';
import { TableModule } from 'primeng/table';
import { MessageService } from 'primeng/api';

import { CreateCustomerRequest, Customer } from '../../../../core/models';
import { CustomerService } from '../../../../core/services/customer.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

/** Lightweight order row returned by the customer orders endpoint */
interface CustomerOrderRow {
  orderNumber: number;
  createdAt: string;
  totalCents: number;
  paymentMethod: string;
}

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
    RadioButtonModule,
    SidebarModule,
    TableModule,
    PricePipe,
  ],
  templateUrl: './admin-customers.component.html',
  styleUrl: './admin-customers.component.scss',
})
export class AdminCustomersComponent implements OnInit {

  //#region Properties
  private readonly customerService = inject(CustomerService);
  private readonly messageService = inject(MessageService);

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
      c.name.toLowerCase().includes(q)
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
  readonly customerOrders = signal<CustomerOrderRow[]>([]);
  readonly isLoadingOrders = signal(false);

  //#endregion

  //#region Adjust Dialogs

  readonly showAdjustPointsDialog = signal(false);
  readonly showAdjustCreditDialog = signal(false);
  readonly adjustType = signal<'add' | 'subtract'>('add');
  readonly adjustAmount = signal<number>(0);
  readonly adjustReason = signal('');
  readonly isAdjusting = signal(false);

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
    if (!this.createForm.name.trim() || !this.createForm.phone.trim()) return;

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

  /** Opens the profile drawer for the clicked customer row */
  async onRowClick(customer: Customer): Promise<void> {
    this.drawerCustomer.set(customer);
    this.showDrawer.set(true);
    this.customerOrders.set([]);
    this.isLoadingOrders.set(true);

    try {
      const orders = await this.customerService.getCustomerOrders(customer.id);
      this.customerOrders.set(orders);
    } finally {
      this.isLoadingOrders.set(false);
    }
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

  //#region Helpers

  /** Formats a phone number for display (e.g., 6671234567 → 667 123 4567) */
  formatPhone(phone: string): string {
    if (phone.length === 10) {
      return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
    }
    return phone;
  }

  private emptyCreateForm(): CreateCustomerRequest {
    return { name: '', phone: '', email: undefined, notes: undefined, creditLimitCents: 0 };
  }

  //#endregion

}
