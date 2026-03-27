import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';

import { InventoryItem, InventoryMovement } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

/** Shape of the item form used in create/edit dialog */
interface ItemForm {
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPesos: number;
}

/** Shape of the movement form */
interface MovementForm {
  quantity: number;
  reason: string;
}

@Component({
  selector: 'app-admin-inventory',
  standalone: true,
  imports: [
    FormsModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    TableModule,
    ToastModule,
    DatePipe,
    ButtonModule,
    TooltipModule,
  ],
  templateUrl: './admin-inventory.component.html',
  styleUrl: './admin-inventory.component.scss',
  providers: [MessageService],
})
export class AdminInventoryComponent implements OnInit {

  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly messageService = inject(MessageService);
  private readonly http = inject(HttpClient);

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.inventoryService.loadFromApi();
    }, { allowSignalWrites: true });
  }

  //#region Properties

  readonly items = this.inventoryService.items;
  readonly isLoading = this.inventoryService.isLoading;

  // ---- Item dialog ----
  readonly showItemDialog = signal(false);
  readonly editingItem = signal<InventoryItem | null>(null);
  form: ItemForm = this.emptyItemForm();

  // ---- History dialog ----
  readonly showHistoryDialog = signal(false);
  readonly historyItem = signal<InventoryItem | null>(null);
  readonly movements = signal<InventoryMovement[]>([]);
  readonly loadingMovements = signal(false);

  // ---- Movement dialog ----
  readonly showMovementDialog = signal(false);
  readonly movementItemId = signal(0);
  readonly movementType = signal<'in' | 'out'>('in');
  movementForm: MovementForm = { quantity: 0, reason: '' };

  readonly unitOptions = [
    { label: 'Pieza', value: 'pza' },
    { label: 'Kilogramo', value: 'kg' },
    { label: 'Litro', value: 'lt' },
    { label: 'Caja', value: 'caja' },
    { label: 'Gramo', value: 'g' },
    { label: 'Mililitro', value: 'ml' },
  ];

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.inventoryService.loadFromApi();
  }

  //#endregion

  //#region Item Dialog

  /** Opens dialog to create new item */
  openNewItemDialog(): void {
    this.editingItem.set(null);
    this.form = this.emptyItemForm();
    this.showItemDialog.set(true);
  }

  /** Opens dialog to edit existing item */
  openEditItemDialog(item: InventoryItem): void {
    this.editingItem.set(item);
    this.form = {
      name: item.name,
      unit: item.unit,
      currentStock: item.currentStock,
      lowStockThreshold: item.lowStockThreshold,
      costPesos: item.costCents / 100,
    };
    this.showItemDialog.set(true);
  }

  /** Saves item (create or update) */
  async saveItem(): Promise<void> {
    if (!this.form.name.trim()) return;

    const payload = {
      name: this.form.name.trim(),
      unit: this.form.unit as InventoryItem['unit'],
      currentStock: this.form.currentStock,
      lowStockThreshold: this.form.lowStockThreshold,
      costCents: Math.round(this.form.costPesos * 100),
      isActive: true,
    };

    try {
      if (this.editingItem()) {
        await this.inventoryService.update(this.editingItem()!.id, payload);
        this.messageService.add({ severity: 'success', summary: 'Insumo actualizado', life: 3000 });
      } else {
        await this.inventoryService.create(payload);
        this.messageService.add({ severity: 'success', summary: 'Insumo creado', life: 3000 });
      }
      this.showItemDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al guardar', life: 3000 });
    }
  }

  //#endregion

  //#region Movement Dialog

  /** Opens movement dialog for stock entry */
  openEntryDialog(item: InventoryItem): void {
    this.movementItemId.set(item.id);
    this.movementType.set('in');
    this.movementForm = { quantity: 0, reason: '' };
    this.showMovementDialog.set(true);
  }

  /** Opens movement dialog for stock withdrawal */
  openExitDialog(item: InventoryItem): void {
    this.movementItemId.set(item.id);
    this.movementType.set('out');
    this.movementForm = { quantity: 0, reason: '' };
    this.showMovementDialog.set(true);
  }

  /** Saves the stock movement */
  async saveMovement(): Promise<void> {
    if (this.movementForm.quantity <= 0) return;

    try {
      await this.inventoryService.addMovement(
        this.movementItemId(),
        this.movementType(),
        this.movementForm.quantity,
        this.movementForm.reason.trim() || undefined,
      );
      const label = this.movementType() === 'in' ? 'Entrada' : 'Salida';
      this.messageService.add({ severity: 'success', summary: `${label} registrada`, life: 3000 });
      this.showMovementDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al registrar movimiento', life: 3000 });
    }
  }

  //#endregion

  //#region History Dialog

  /** Opens movement history dialog for an inventory item */
  async openHistoryDialog(item: InventoryItem): Promise<void> {
    this.historyItem.set(item);
    this.movements.set([]);
    this.showHistoryDialog.set(true);
    this.loadingMovements.set(true);
    try {
      const data = await firstValueFrom(
        this.http.get<InventoryMovement[]>(
          `${environment.apiUrl}/inventory/${item.id}/movements`
        )
      );
      this.movements.set(data);
    } catch {
      this.movements.set([]);
    } finally {
      this.loadingMovements.set(false);
    }
  }

  /** Returns display label for movement type */
  movementTypeLabel(type: string): string {
    switch (type) {
      case 'in':         return 'Entrada';
      case 'out':        return 'Salida';
      case 'adjustment': return 'Ajuste';
      default:           return type;
    }
  }

  /** Returns CSS class for movement type badge */
  movementTypeSeverity(type: string): string {
    switch (type) {
      case 'in':         return 'movement-badge--in';
      case 'out':        return 'movement-badge--out';
      case 'adjustment': return 'movement-badge--adj';
      default:           return '';
    }
  }

  //#endregion

  //#region Helpers

  /** Returns true if item is at or below low-stock threshold */
  isLowStock(item: InventoryItem): boolean {
    return item.currentStock <= item.lowStockThreshold;
  }

  private emptyItemForm(): ItemForm {
    return { name: '', unit: 'pza', currentStock: 0, lowStockThreshold: 5, costPesos: 0 };
  }

  //#endregion
}
