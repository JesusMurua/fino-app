import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';

import { CreateCustomerRequest, Customer } from '../../../core/models/customer.model';
import { CustomerService } from '../../../core/services/customer.service';
import { PricePipe } from '../../pipes/price.pipe';

@Component({
  selector: 'app-customer-selector',
  standalone: true,
  imports: [FormsModule, ButtonModule, DialogModule, InputTextModule, PricePipe],
  templateUrl: './customer-selector.component.html',
  styleUrl: './customer-selector.component.scss',
})
export class CustomerSelectorComponent {

  //#region Properties
  private readonly customerService = inject(CustomerService);

  /** The selected customer (two-way binding) */
  readonly selectedCustomer = model<Customer | null>(null);

  /** Placeholder text for the search input */
  readonly placeholder = input('Buscar cliente...');

  /** Compact mode for inline use (cart-panel sidebar) */
  readonly compact = input(false);

  /** Emitted when a customer is selected or cleared */
  readonly customerChanged = output<Customer | null>();

  // ---- Search state ----
  readonly query = signal('');
  readonly results = signal<Customer[]>([]);
  readonly showDropdown = signal(false);
  readonly isSearching = signal(false);

  // ---- Quick-create dialog ----
  readonly showCreateDialog = signal(false);
  readonly isSavingNew = signal(false);
  createForm: CreateCustomerRequest = { name: '', phone: '' };

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  //#endregion

  //#region Search Methods

  /** Called on each keystroke in the search input */
  onQueryChange(value: string): void {
    this.query.set(value);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    if (value.trim().length < 2) {
      this.results.set([]);
      this.showDropdown.set(false);
      return;
    }

    this.debounceTimer = setTimeout(() => this.search(value), 300);
  }

  /** Executes the Dexie search */
  private async search(q: string): Promise<void> {
    this.isSearching.set(true);
    const found = await this.customerService.searchByPhoneOrName(q);
    this.results.set(found);
    this.showDropdown.set(found.length > 0);
    this.isSearching.set(false);
  }

  /** Selects a customer from the results dropdown */
  selectResult(customer: Customer): void {
    this.selectedCustomer.set(customer);
    this.customerChanged.emit(customer);
    this.showDropdown.set(false);
    this.query.set('');
    this.results.set([]);
  }

  /** Clears the selected customer */
  clear(): void {
    this.selectedCustomer.set(null);
    this.customerChanged.emit(null);
  }

  /** Hides the dropdown (called on blur with delay for click capture) */
  onBlur(): void {
    setTimeout(() => this.showDropdown.set(false), 200);
  }

  //#endregion

  //#region Quick-Create

  /** Opens the quick-create dialog */
  openCreate(): void {
    this.createForm = { name: this.query().trim(), phone: '' };
    this.showCreateDialog.set(true);
  }

  /** Creates a new customer and auto-selects them */
  async saveNewCustomer(): Promise<void> {
    if (!this.createForm.name.trim() || !this.createForm.phone.trim()) return;

    this.isSavingNew.set(true);
    try {
      const customer = await this.customerService.createCustomer(this.createForm);
      this.selectResult(customer);
      this.showCreateDialog.set(false);
    } catch {
      // Error handled by CustomerService toast
    } finally {
      this.isSavingNew.set(false);
    }
  }

  //#endregion

  //#region Helpers

  /** Formats phone for display */
  formatPhone(phone: string): string {
    if (phone.length === 10) {
      return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
    }
    return phone;
  }

  //#endregion

}
