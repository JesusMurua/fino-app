import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';

import { environment } from '../../../../../environments/environment';
import { RestaurantTable, Zone, ZoneType } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { TableService } from '../../../../core/services/table.service';
import { ZoneService } from '../../../../core/services/zone.service';

/** Shape of the table form used in create/edit dialog */
interface TableForm {
  name: string;
  capacity: number | null;
  zoneId: number | null;
  isActive: boolean;
}

/** Shape of the zone inline form */
interface ZoneForm {
  name: string;
  type: ZoneType;
  sortOrder: number;
}

@Component({
  selector: 'app-admin-tables',
  standalone: true,
  imports: [
    FormsModule,
    ConfirmDialogModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputSwitchModule,
    InputTextModule,
    SelectButtonModule,
    TableModule,
  ],
  templateUrl: './admin-tables.component.html',
  styleUrl: './admin-tables.component.scss',
  providers: [ConfirmationService],
})
export class AdminTablesComponent implements OnInit {

  //#region Injections

  private readonly tableService = inject(TableService);
  private readonly zoneService = inject(ZoneService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);

  //#endregion

  //#region Properties

  /** Active tab */
  readonly activeTab = signal<'tables' | 'zones'>('tables');

  // ---- Tables ----
  readonly tables = signal<RestaurantTable[]>([]);
  readonly loading = signal(false);
  readonly showDialog = signal(false);
  readonly editingTable = signal<RestaurantTable | null>(null);
  form: TableForm = this.emptyForm();

  // ---- Zones ----
  readonly zones = this.zoneService.zones;
  readonly loadingZones = signal(false);
  readonly showZoneForm = signal(false);
  readonly editingZone = signal<Zone | null>(null);
  zoneForm: ZoneForm = this.emptyZoneForm();

  readonly zoneTypeOptions = [
    { label: 'Salón', value: ZoneType.Salon },
    { label: 'Barra', value: ZoneType.BarSeats },
    { label: 'Otro',  value: ZoneType.Other },
  ];

  /** Zones tab always visible — all business types can organize tables into zones */
  readonly showZonesTab = signal(true);


  //#endregion

  //#region Constructor

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) {
        this.loadTables();
        this.loadZones();
      }
    }, { allowSignalWrites: true });

  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.loadTables(),
      this.loadZones(),
    ]);
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

  /** Loads zones via ZoneService */
  async loadZones(): Promise<void> {
    this.loadingZones.set(true);
    await this.zoneService.loadZones();
    this.loadingZones.set(false);
  }

  //#endregion

  //#region Table Dialog

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
      zoneId: table.zoneId ?? null,
      isActive: table.isActive,
    };
    this.showDialog.set(true);
  }

  //#endregion

  //#region Table CRUD

  /** Saves table (create or update) */
  async saveTable(): Promise<void> {
    if (!this.form.name.trim()) return;

    try {
      if (this.editingTable()) {
        await this.tableService.updateTable(this.editingTable()!.id, {
          name: this.form.name.trim(),
          capacity: this.form.capacity ?? undefined,
          zoneId: this.form.zoneId ?? undefined,
          isActive: this.form.isActive,
        });
        this.messageService.add({
          severity: 'success', summary: 'Mesa actualizada', life: 3000,
        });
      } else {
        await this.tableService.createTable(this.authService.branchId, {
          name: this.form.name.trim(),
          capacity: this.form.capacity ?? undefined,
          zoneId: this.form.zoneId ?? undefined,
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

  //#region Zone Inline Form

  /** Opens the inline zone form for creating */
  openNewZoneForm(): void {
    this.editingZone.set(null);
    this.zoneForm = this.emptyZoneForm();
    this.showZoneForm.set(true);
  }

  /** Opens the inline zone form for editing */
  openEditZoneForm(zone: Zone): void {
    this.editingZone.set(zone);
    this.zoneForm = {
      name: zone.name,
      type: zone.type,
      sortOrder: zone.sortOrder,
    };
    this.showZoneForm.set(true);
  }

  /** Cancels the inline zone form */
  cancelZoneForm(): void {
    this.showZoneForm.set(false);
    this.editingZone.set(null);
  }

  //#endregion

  //#region Zone CRUD

  /** Saves zone (create or update) */
  async saveZone(): Promise<void> {
    if (!this.zoneForm.name.trim()) return;

    const payload = {
      branchId: this.authService.branchId,
      name: this.zoneForm.name.trim(),
      type: this.zoneForm.type,
      sortOrder: this.zoneForm.sortOrder,
      isActive: true,
    };

    try {
      if (this.editingZone()) {
        await firstValueFrom(
          this.http.put(`${environment.apiUrl}/zone/${this.editingZone()!.id}`, payload),
        );
        this.messageService.add({ severity: 'success', summary: 'Zona actualizada', life: 3000 });
      } else {
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/zone`, payload),
        );
        this.messageService.add({ severity: 'success', summary: 'Zona creada', life: 3000 });
      }

      this.showZoneForm.set(false);
      this.editingZone.set(null);
      await this.loadZones();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al guardar la zona', life: 3000 });
    }
  }

  /** Toggles zone active status */
  async toggleZoneActive(zone: Zone): Promise<void> {
    try {
      await firstValueFrom(
        this.http.put(`${environment.apiUrl}/zone/${zone.id}`, {
          ...zone,
          isActive: !zone.isActive,
        }),
      );
      await this.loadZones();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al cambiar estado', life: 3000 });
    }
  }

  /** Deletes a zone with confirmation */
  deleteZone(zone: Zone): void {
    this.confirmationService.confirm({
      message: `¿Eliminar la zona "${zone.name}"?`,
      header: 'Confirmar eliminación',
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      accept: async () => {
        try {
          await firstValueFrom(
            this.http.delete(`${environment.apiUrl}/zone/${zone.id}`),
          );
          this.messageService.add({ severity: 'success', summary: 'Zona eliminada', life: 3000 });
          await this.loadZones();
        } catch (err: any) {
          const msg = err?.status === 400
            ? 'No se puede eliminar, tiene mesas u órdenes activas'
            : 'Error al eliminar la zona';
          this.messageService.add({ severity: 'error', summary: msg, life: 4000 });
        }
      },
    });
  }

  //#endregion

  //#region Display Helpers

  /** Returns zone name by ID for the tables list */
  zoneName(id: number | undefined): string {
    if (!id) return '—';
    return this.zones().find(z => z.id === id)?.name ?? '—';
  }

  /** Returns type label for a zone */
  zoneTypeLabel(type: ZoneType): string {
    switch (type) {
      case ZoneType.Salon:    return 'Salón';
      case ZoneType.BarSeats: return 'Barra';
      case ZoneType.Other:    return 'Otro';
      default:                return type;
    }
  }

  //#endregion

  //#region Helpers

  private emptyForm(): TableForm {
    return { name: '', capacity: null, zoneId: null, isActive: true };
  }

  private emptyZoneForm(): ZoneForm {
    return { name: '', type: ZoneType.Salon, sortOrder: 0 };
  }

  //#endregion

}
