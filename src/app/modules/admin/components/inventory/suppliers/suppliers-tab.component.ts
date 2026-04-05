import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';

import {
  CreateSupplierRequest,
  Supplier,
  UpdateSupplierRequest,
} from '../../../../../core/models';
import { SupplierService } from '../../../../../core/services/supplier.service';
import { SupplierFormDialogComponent, SupplierFormPayload } from './supplier-form-dialog.component';
import { SuppliersTableComponent } from './suppliers-table.component';

/**
 * Smart container for the Suppliers tab.
 * Owns the data loading lifecycle, search state, dialog visibility,
 * and delegates rendering to presentational child components.
 */
@Component({
  selector: 'app-suppliers-tab',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    ToastModule,
    SuppliersTableComponent,
    SupplierFormDialogComponent,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <!-- Toolbar -->
    <div class="flex align-items-center gap-3 mb-4">
      <span class="p-input-icon-left flex-grow-1" style="max-width: 400px">
        <i class="pi pi-search"></i>
        <input
          [ngModel]="searchTerm()"
          (ngModelChange)="searchTerm.set($event)"
          type="text"
          pInputText
          placeholder="Buscar proveedor..."
          class="w-full"
        />
      </span>
      <p-button
        label="Nuevo proveedor"
        icon="pi pi-plus"
        (onClick)="onNewSupplier()"
        class="ml-auto"
      />
    </div>

    <!-- Table -->
    <div class="border-round-xl shadow-1 surface-card overflow-hidden">
      <app-suppliers-table
        [suppliers]="filteredSuppliers()"
        [isLoading]="isLoading()"
        (edit)="onEdit($event)"
        (toggleActive)="onToggleActive($event)"
      />
    </div>

    <!-- Form dialog -->
    <app-supplier-form-dialog
      [supplier]="editingSupplier()"
      [visible]="showDialog()"
      (visibleChange)="showDialog.set($event)"
      (save)="saveSupplier($event)"
    />
  `,
})
export class SuppliersTabComponent implements OnInit {

  //#region Injections

  private readonly supplierService = inject(SupplierService);
  private readonly messageService = inject(MessageService);

  //#endregion

  //#region Signals — Data

  readonly suppliers = signal<Supplier[]>([]);
  readonly isLoading = signal(false);
  readonly searchTerm = signal('');

  /** Client-side filter by name and contactName */
  readonly filteredSuppliers = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const list = this.suppliers();
    if (!term) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        (s.contactName?.toLowerCase().includes(term) ?? false),
    );
  });

  //#endregion

  //#region Signals — Dialog

  readonly showDialog = signal(false);
  readonly editingSupplier = signal<Supplier | null>(null);

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.loadSuppliers();
  }

  //#endregion

  //#region Data Loading

  private loadSuppliers(): void {
    this.isLoading.set(true);
    this.supplierService.getAll().subscribe({
      next: (data) => {
        this.suppliers.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error al cargar proveedores',
          life: 4000,
        });
        this.isLoading.set(false);
      },
    });
  }

  //#endregion

  //#region Dialog Actions

  onNewSupplier(): void {
    this.editingSupplier.set(null);
    this.showDialog.set(true);
  }

  onEdit(supplier: Supplier): void {
    this.editingSupplier.set(supplier);
    this.showDialog.set(true);
  }

  saveSupplier(payload: SupplierFormPayload): void {
    const editing = this.editingSupplier();

    if (editing) {
      this.supplierService.update(editing.id, payload as UpdateSupplierRequest).subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Proveedor actualizado', life: 3000 });
          this.showDialog.set(false);
          this.loadSuppliers();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error al guardar proveedor', life: 4000 });
        },
      });
    } else {
      this.supplierService.create(payload as CreateSupplierRequest).subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Proveedor creado', life: 3000 });
          this.showDialog.set(false);
          this.loadSuppliers();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error al guardar proveedor', life: 4000 });
        },
      });
    }
  }

  //#endregion

  //#region Toggle Active

  onToggleActive(supplier: Supplier): void {
    const payload: UpdateSupplierRequest = {
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      notes: supplier.notes,
      isActive: !supplier.isActive,
    };

    this.supplierService.update(supplier.id, payload).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: supplier.isActive ? 'Proveedor desactivado' : 'Proveedor activado',
          life: 3000,
        });
        this.loadSuppliers();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al actualizar proveedor', life: 4000 });
      },
    });
  }

  //#endregion
}
