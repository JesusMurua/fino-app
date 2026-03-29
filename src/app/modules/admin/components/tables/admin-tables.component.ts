import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { environment } from '../../../../../environments/environment';
import { FeatureKey, RestaurantTable, Zone, ZoneType } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { FeatureFlagService } from '../../../../core/services/feature-flag.service';
import { TableService } from '../../../../core/services/table.service';
import { ZoneService } from '../../../../core/services/zone.service';

/** Shape of the table form used in create/edit dialog */
interface TableForm {
  name: string;
  capacity: number | null;
  zoneId: number | null;
  isActive: boolean;
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
    TooltipModule,
  ],
  templateUrl: './admin-tables.component.html',
  styleUrl: './admin-tables.component.scss',
  providers: [ConfirmationService],
})
export class AdminTablesComponent implements OnInit {

  //#region Injections

  private readonly tableService = inject(TableService);
  private readonly zoneService = inject(ZoneService);
  private readonly featureFlags = inject(FeatureFlagService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  //#endregion

  //#region Properties

  /** Active tab: map (floor map — untouched) or config (kanban) */
  readonly activeTab = signal<'map' | 'config'>('config');

  /** Expose enums for template */
  readonly ZoneType = ZoneType;

  // ---- Config data ----
  readonly configZones = signal<Zone[]>([]);
  readonly configTables = signal<RestaurantTable[]>([]);
  readonly isLoadingConfig = signal(false);

  // ---- Add zone inline form ----
  readonly showAddZoneForm = signal(false);
  readonly newZoneName = signal('');
  readonly newZoneType = signal<ZoneType>(ZoneType.Salon);

  readonly zoneTypeOptions = [
    { label: 'Salón', value: ZoneType.Salon },
    { label: 'Barra', value: ZoneType.BarSeats },
    { label: 'Otro',  value: ZoneType.Other },
  ];

  // ---- Table dialog ----
  readonly showTableDialog = signal(false);
  readonly editingTable = signal<RestaurantTable | null>(null);
  form: TableForm = this.emptyForm();

  // ---- Edit zone dialog ----
  readonly showZoneEditDialog = signal(false);
  readonly editingZone = signal<Zone | null>(null);
  editZoneName = '';
  editZoneType: ZoneType = ZoneType.Salon;

  // ---- Error messages ----
  readonly tableDialogError = signal('');
  readonly tableNameError = signal('');
  readonly tableCapacityError = signal('');
  readonly zoneDialogError = signal('');
  readonly zoneAddError = signal('');

  //#endregion

  //#region Computeds

  /** Display name of the active branch */
  readonly branchName = computed(() => {
    const branches = this.authService.availableBranches();
    const id = this.authService.activeBranchId();
    return branches.find(b => b.id === id)?.name ?? 'tu sucursal';
  });

  /** Whether the Zones kanban is available (plan gate) */
  readonly canUseZones = computed(() =>
    this.featureFlags.canUse(FeatureKey.Zones),
  );

  /** Tables not assigned to any zone */
  readonly tablesWithoutZone = computed(() =>
    this.configTables().filter(t => !t.zoneId),
  );

  /** Zones with their pre-grouped tables for the static map */
  readonly staticMapZones = computed(() =>
    this.configZones().map(zone => ({
      zone,
      tables: this.configTables()
        .filter(t => t.zoneId === zone.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
  );

  //#endregion

  //#region Constructor

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadConfigData();
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadConfigData();
  }

  //#endregion

  //#region Data Loading

  /** Loads zones and tables for the config kanban */
  async loadConfigData(): Promise<void> {
    this.isLoadingConfig.set(true);
    try {
      await this.zoneService.loadZones();
      const zones = this.zoneService.getActiveZones();
      this.configZones.set(zones);

      const tables = await this.tableService.getAllTables(this.authService.branchId);
      this.configTables.set(tables);
    } catch {
      console.warn('[AdminTables] Failed to load config data');
    } finally {
      this.isLoadingConfig.set(false);
    }
  }

  /** Returns tables belonging to a specific zone, sorted by name */
  getTablesForZone(zoneId: number): RestaurantTable[] {
    return this.configTables()
      .filter(t => t.zoneId === zoneId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  //#endregion

  //#region Zone CRUD

  /** Opens the add zone inline form */
  openAddZoneForm(): void {
    this.zoneAddError.set('');
    this.showAddZoneForm.set(true);
  }

  /** Creates a new zone from the inline form */
  async saveNewZone(): Promise<void> {
    const name = this.newZoneName().trim();
    if (!name) return;
    this.zoneAddError.set('');

    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/zone`, {
          branchId: this.authService.branchId,
          name,
          type: this.newZoneType(),
          sortOrder: this.configZones().length + 1,
          isActive: true,
        }),
      );
      this.messageService.add({ severity: 'success', summary: 'Zona creada', life: 3000 });
      this.showAddZoneForm.set(false);
      this.newZoneName.set('');
      this.newZoneType.set(ZoneType.Salon);
      await this.loadConfigData();
    } catch (err: any) {
      this.zoneAddError.set(this.extractApiError(err));
    }
  }

  /** Opens the edit zone dialog */
  editZone(zone: Zone): void {
    this.editingZone.set(zone);
    this.editZoneName = zone.name;
    this.editZoneType = zone.type;
    this.zoneDialogError.set('');
    this.showZoneEditDialog.set(true);
  }

  /** Saves the edited zone */
  async saveEditZone(): Promise<void> {
    const zone = this.editingZone();
    if (!zone || !this.editZoneName.trim()) return;
    this.zoneDialogError.set('');

    try {
      await firstValueFrom(
        this.http.put(`${environment.apiUrl}/zone/${zone.id}`, {
          ...zone,
          name: this.editZoneName.trim(),
          type: this.editZoneType,
        }),
      );
      this.messageService.add({ severity: 'success', summary: 'Zona actualizada', life: 3000 });
      this.showZoneEditDialog.set(false);
      await this.loadConfigData();
    } catch (err: any) {
      this.zoneDialogError.set(this.extractApiError(err));
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
          await this.loadConfigData();
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

  //#region Table CRUD

  /** Opens the add table dialog with auto-generated name and default capacity */
  openAddTable(zoneId: number | null): void {
    this.editingTable.set(null);
    const zone = zoneId !== null
      ? this.configZones().find(z => z.id === zoneId)
      : null;

    const existingCount = zoneId !== null
      ? this.getTablesForZone(zoneId).length
      : this.tablesWithoutZone().length;
    const nextNum = existingCount + 1;

    let suggestedName = `Mesa ${nextNum}`;
    let defaultCapacity: number | null = 4;

    if (zone) {
      switch (zone.type) {
        case ZoneType.Salon:
          suggestedName = `Mesa ${nextNum}`;
          defaultCapacity = 4;
          break;
        case ZoneType.BarSeats:
          suggestedName = `B${nextNum}`;
          defaultCapacity = 1;
          break;
        case ZoneType.Other:
          suggestedName = `${zone.name.split(' ')[0]} ${nextNum}`;
          defaultCapacity = 4;
          break;
      }
    }

    this.form = { name: suggestedName, capacity: defaultCapacity, zoneId, isActive: true };
    this.clearTableErrors();
    this.showTableDialog.set(true);
  }

  /** Opens the edit table dialog */
  editTable(table: RestaurantTable): void {
    this.editingTable.set(table);
    this.form = {
      name: table.name,
      capacity: table.capacity ?? null,
      zoneId: table.zoneId ?? null,
      isActive: table.isActive,
    };
    this.clearTableErrors();
    this.showTableDialog.set(true);
  }

  /** Saves table (create or update) */
  async saveTable(): Promise<void> {
    this.tableDialogError.set('');
    if (!this.validateTableForm()) return;

    try {
      if (this.editingTable()) {
        await this.tableService.updateTable(this.editingTable()!.id, {
          name: this.form.name.trim(),
          capacity: this.form.capacity ?? undefined,
          zoneId: this.form.zoneId ?? undefined,
          isActive: this.form.isActive,
        });
        this.messageService.add({ severity: 'success', summary: 'Mesa actualizada', life: 3000 });
      } else {
        await this.tableService.createTable(this.authService.branchId, {
          name: this.form.name.trim(),
          capacity: this.form.capacity ?? undefined,
          zoneId: this.form.zoneId ?? undefined,
          isActive: this.form.isActive,
        });
        this.messageService.add({ severity: 'success', summary: 'Mesa creada', life: 3000 });
      }

      this.showTableDialog.set(false);
      await this.loadConfigData();
    } catch (err: any) {
      this.tableDialogError.set(this.extractApiError(err));
    }
  }

  /** Toggles table active status inline */
  async toggleTableActive(table: RestaurantTable): Promise<void> {
    try {
      await this.tableService.toggleTable(table.id);
      await this.loadConfigData();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al cambiar estado', life: 3000 });
    }
  }

  //#endregion

  //#region Navigation

  /** Navigates to billing/plans settings */
  goToPlans(): void {
    this.router.navigate(['/admin/settings']);
  }

  //#endregion

  //#region Display Helpers

  /** Returns zone type label */
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

  /** Clears all table dialog error signals */
  private clearTableErrors(): void {
    this.tableDialogError.set('');
    this.tableNameError.set('');
    this.tableCapacityError.set('');
  }

  /** Validates the table form before API call */
  private validateTableForm(): boolean {
    let valid = true;
    this.tableNameError.set('');
    this.tableCapacityError.set('');

    const name = this.form.name.trim();
    if (!name) {
      this.tableNameError.set('El nombre es obligatorio');
      valid = false;
    } else if (name.length > 50) {
      this.tableNameError.set('Máximo 50 caracteres');
      valid = false;
    }

    if (this.form.capacity !== null) {
      if (this.form.capacity < 1) {
        this.tableCapacityError.set('La capacidad mínima es 1');
        valid = false;
      } else if (this.form.capacity > 50) {
        this.tableCapacityError.set('La capacidad máxima es 50');
        valid = false;
      }
    }

    return valid;
  }

  /** Extracts a user-friendly error message from an API error response */
  private extractApiError(err: any): string {
    const data = err?.error;
    if (typeof data === 'string') return data;
    if (data?.message) return data.message;
    if (data?.errors) {
      const messages = Object.values<string[]>(data.errors).flat();
      return messages.join('. ');
    }
    return 'Ocurrió un error inesperado';
  }

  //#endregion

}
