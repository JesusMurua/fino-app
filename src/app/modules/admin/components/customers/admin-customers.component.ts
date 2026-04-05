import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TableModule } from 'primeng/table';
import { MessageService } from 'primeng/api';

import { CreateCustomerRequest, Customer } from '../../../../core/models';
import { CustomerService } from '../../../../core/services/customer.service';
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
