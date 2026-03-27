import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';

import { RestaurantTable } from '../../../../core/models';
import { TableService } from '../../../../core/services/table.service';
import { AuthService } from '../../../../core/services/auth.service';

/** Shape of the table form used in create/edit dialog */
interface TableForm {
  name: string;
  capacity: number | null;
  isActive: boolean;
}

@Component({
  selector: 'app-admin-tables',
  standalone: true,
  imports: [
    FormsModule,
    DialogModule,
    InputNumberModule,
    InputSwitchModule,
    InputTextModule,
    TableModule,
    ToastModule,
  ],
  templateUrl: './admin-tables.component.html',
  styleUrl: './admin-tables.component.scss',
  providers: [MessageService],
})
export class AdminTablesComponent implements OnInit {

  private readonly tableService = inject(TableService);
  private readonly messageService = inject(MessageService);
  private readonly authService = inject(AuthService);

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadTables();
    }, { allowSignalWrites: true });
  }

  readonly tables = signal<RestaurantTable[]>([]);
  readonly loading = signal(false);
  readonly showDialog = signal(false);
  readonly editingTable = signal<RestaurantTable | null>(null);

  form: TableForm = this.emptyForm();

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadTables();
  }

  //#endregion

  //#region Data Loading

  /** Loads all tables including inactive */
  async loadTables(): Promise<void> {
    this.loading.set(true);
    const tables = await this.tableService.getAllTables(this.authService.branchId);
    this.tables.set(tables);
    this.loading.set(false);
  }

  //#endregion

  //#region Dialog

  /** Opens dialog to create new table */
  openNewDialog(): void {
    this.editingTable.set(null);
    this.form = this.emptyForm();
    this.showDialog.set(true);
  }

  /** Opens dialog to edit existing table */
  openEditDialog(table: RestaurantTable): void {
    this.editingTable.set(table);
    this.form = {
      name: table.name,
      capacity: table.capacity ?? null,
      isActive: table.isActive,
    };
    this.showDialog.set(true);
  }

  //#endregion

  //#region CRUD

  /** Saves table (create or update) */
  async saveTable(): Promise<void> {
    if (!this.form.name.trim()) return;

    try {
      if (this.editingTable()) {
        await this.tableService.updateTable(this.editingTable()!.id, {
          name: this.form.name.trim(),
          capacity: this.form.capacity ?? undefined,
          isActive: this.form.isActive,
        });
        this.messageService.add({
          severity: 'success', summary: 'Mesa actualizada', life: 3000,
        });
      } else {
        await this.tableService.createTable(this.authService.branchId, {
          name: this.form.name.trim(),
          capacity: this.form.capacity ?? undefined,
          isActive: this.form.isActive,
        });
        this.messageService.add({
          severity: 'success', summary: 'Mesa creada', life: 3000,
        });
      }

      this.showDialog.set(false);
      await this.loadTables();
    } catch {
      this.messageService.add({
        severity: 'error', summary: 'Error al guardar la mesa', life: 3000,
      });
    }
  }

  /** Toggles table active status */
  async onToggleTable(table: RestaurantTable): Promise<void> {
    try {
      const isActive = await this.tableService.toggleTable(table.id);
      this.messageService.add({
        severity: 'success',
        summary: isActive ? 'Mesa activada' : 'Mesa desactivada',
        life: 3000,
      });
      await this.loadTables();
    } catch {
      this.messageService.add({
        severity: 'error', summary: 'Error al cambiar estado', life: 3000,
      });
    }
  }

  //#endregion

  //#region Helpers

  private emptyForm(): TableForm {
    return { name: '', capacity: null, isActive: true };
  }

  //#endregion
}
