import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CalendarModule } from 'primeng/calendar';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';

import {
  CreateStockReceiptRequest,
  StockReceipt,
  Supplier,
} from '../../../../../core/models';
import { InventoryService } from '../../../../../core/services/inventory.service';
import { SupplierService } from '../../../../../core/services/supplier.service';
import { StockReceiptService } from '../../../../../core/services/stock-receipt.service';
import { StockReceiptDetailDialogComponent } from './stock-receipt-detail-dialog.component';
import { StockReceiptFormDialogComponent } from './stock-receipt-form-dialog.component';
import { StockReceiptsTableComponent } from './stock-receipts-table.component';

/**
 * Smart container for the Stock Receipts tab.
 * Manages data loading, filters, and dialog lifecycle.
 */
@Component({
  selector: 'app-stock-receipts-tab',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    CalendarModule,
    DropdownModule,
    ToastModule,
    StockReceiptsTableComponent,
    StockReceiptDetailDialogComponent,
    StockReceiptFormDialogComponent,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <!-- Toolbar: filters + new button -->
    <div class="flex align-items-center gap-3 flex-wrap mb-4">
      <p-dropdown
        [options]="supplierOptions()"
        optionLabel="label"
        optionValue="value"
        [ngModel]="supplierFilter()"
        (ngModelChange)="supplierFilter.set($event)"
        placeholder="Todos los proveedores"
        [showClear]="true"
        [appendTo]="'body'"
        [style]="{ width: '250px' }"
      />
      <p-calendar
        [ngModel]="dateRange()"
        (ngModelChange)="dateRange.set($event)"
        selectionMode="range"
        placeholder="Rango de fechas"
        dateFormat="dd/mm/yy"
        [showIcon]="true"
        [readonlyInput]="true"
        [appendTo]="'body'"
        [style]="{ width: '280px' }"
      />
      <p-button
        label="Filtrar"
        icon="pi pi-filter"
        severity="secondary"
        [outlined]="true"
        (onClick)="applyFilters()"
      />
      <p-button
        label="Nueva recepción"
        icon="pi pi-plus"
        (onClick)="onNewReceipt()"
        class="ml-auto"
      />
    </div>

    <!-- Table -->
    <div class="border-round-xl shadow-1 surface-card overflow-hidden">
      <app-stock-receipts-table
        [receipts]="receipts()"
        [isLoading]="isLoading()"
        (viewDetail)="onViewDetail($event)"
      />
    </div>

    <!-- Detail dialog -->
    <app-stock-receipt-detail-dialog
      [receipt]="selectedReceipt()"
      [visible]="showDetailDialog()"
      (visibleChange)="showDetailDialog.set($event)"
    />

    <!-- Form dialog -->
    <app-stock-receipt-form-dialog
      [visible]="showFormDialog()"
      [suppliers]="suppliers()"
      (visibleChange)="showFormDialog.set($event)"
      (save)="createReceipt($event)"
    />
  `,
})
export class StockReceiptsTabComponent implements OnInit {

  //#region Injections

  private readonly stockReceiptService = inject(StockReceiptService);
  private readonly supplierService = inject(SupplierService);
  private readonly inventoryService = inject(InventoryService);
  private readonly messageService = inject(MessageService);

  //#endregion

  //#region Signals — Data

  readonly receipts = signal<StockReceipt[]>([]);
  readonly isLoading = signal(false);
  readonly suppliers = signal<Supplier[]>([]);

  //#endregion

  //#region Signals — Filters

  readonly supplierFilter = signal<number | null>(null);
  readonly dateRange = signal<Date[] | null>(null);

  /** Supplier options for the filter dropdown */
  readonly supplierOptions = computed(() =>
    this.suppliers()
      .filter((s) => s.isActive)
      .map((s) => ({ label: s.name, value: s.id })),
  );

  //#endregion

  //#region Signals — Dialogs

  readonly showDetailDialog = signal(false);
  readonly selectedReceipt = signal<StockReceipt | null>(null);
  readonly showFormDialog = signal(false);

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.loadSuppliers();
    this.loadReceipts();
  }

  //#endregion

  //#region Data Loading

  private loadReceipts(): void {
    this.isLoading.set(true);

    const supplierId = this.supplierFilter() ?? undefined;
    const range = this.dateRange();
    const from = range?.[0] ? range[0].toISOString() : undefined;
    const to = range?.[1] ? range[1].toISOString() : undefined;

    this.stockReceiptService.getAll(supplierId, from, to).subscribe({
      next: (data) => {
        this.receipts.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error al cargar recepciones',
          life: 4000,
        });
        this.isLoading.set(false);
      },
    });
  }

  private loadSuppliers(): void {
    this.supplierService.getAll().subscribe({
      next: (data) => this.suppliers.set(data),
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error al cargar proveedores',
          life: 4000,
        });
      },
    });
  }

  //#endregion

  //#region Actions

  applyFilters(): void {
    this.loadReceipts();
  }

  onViewDetail(receipt: StockReceipt): void {
    this.selectedReceipt.set(receipt);
    this.showDetailDialog.set(true);
  }

  onNewReceipt(): void {
    this.showFormDialog.set(true);
  }

  createReceipt(payload: CreateStockReceiptRequest): void {
    this.stockReceiptService.create(payload).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Recepción registrada',
          life: 3000,
        });
        this.showFormDialog.set(false);
        this.loadReceipts();
        void this.inventoryService.loadFromApi();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error al registrar recepción',
          life: 4000,
        });
      },
    });
  }

  //#endregion
}
