import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import { BranchDeliveryConfig, UpsertDeliveryConfigRequest } from '../../../../core/models';
import { FeatureKey, MacroCategoryType, OrderSource } from '../../../../core/enums';
import { AuthService } from '../../../../core/services/auth.service';
import { Branch, BranchService } from '../../../../core/services/branch.service';
import { BranchDeliveryConfigService } from '../../../../core/services/branch-delivery-config.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';
import { DeliveryConfigCardComponent } from '../delivery-config-card/delivery-config-card.component';

/** Form shape bound to the branch create/edit dialog */
interface BranchFormValue {
  name: string;
  locationName: string;
  hasKitchen: boolean;
  hasTables: boolean;
}

/**
 * Back Office branch management screen.
 *
 * Extracted from `AdminSettingsComponent` in FDD-016 so Managers (not only
 * Owners) can reach it via its own `/admin/branches` route. Inherits the
 * standard Back Office guards (`authGuard + roleGuard + adminShellGuard`)
 * declared in `admin.routes.ts`.
 *
 * Responsibilities:
 *   - List every branch for the current business.
 *   - Create / edit a branch (name, location, optional kitchen & tables flags).
 *   - Copy the matrix branch's catalog into another branch.
 *   - Configure third-party delivery platforms — gated behind
 *     `FeatureKey.DeliveryPlatforms` per matrix.
 */
@Component({
  selector: 'app-admin-branches',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    TableModule,
    TooltipModule,
    DeliveryConfigCardComponent,
  ],
  templateUrl: './admin-branches.component.html',
  styleUrl: './admin-branches.component.scss',
})
export class AdminBranchesComponent implements OnInit {

  //#region Injections

  private readonly authService = inject(AuthService);
  private readonly branchService = inject(BranchService);
  readonly deliveryConfigService = inject(BranchDeliveryConfigService);
  private readonly messageService = inject(MessageService);
  private readonly tenantContext = inject(TenantContextService);

  //#endregion

  //#region State

  readonly branches = signal<Branch[]>([]);
  readonly loadingBranches = signal(false);

  readonly showBranchDialog = signal(false);
  readonly savingBranch = signal(false);
  readonly editingBranch = signal<Branch | null>(null);

  /** Form bound to the branch dialog */
  branchForm: BranchFormValue = { name: '', locationName: '', hasKitchen: false, hasTables: false };

  /** Branch targeted for catalog copy */
  readonly copyTarget = signal<Branch | null>(null);
  readonly showCopyDialog = signal(false);
  readonly copyingCatalog = signal(false);

  /** Delivery platforms shown when a branch is being edited AND feature is unlocked */
  readonly deliveryPlatforms: readonly OrderSource[] = [
    OrderSource.UberEats,
    OrderSource.Rappi,
    OrderSource.DidiFood,
  ];

  //#endregion

  //#region Matrix-driven computeds

  /** Whether the "¿Tiene cocina?" toggle is relevant to the tenant's macro */
  readonly showKitchenToggle = computed(() => {
    const macro = this.authService.primaryMacroCategoryId();
    if (macro === null) return false;
    return macro === MacroCategoryType.FoodBeverage || macro === MacroCategoryType.QuickService;
  });

  /** Whether the "¿Tiene mesas?" toggle is relevant to the tenant's macro */
  readonly showTablesToggle = computed(() => {
    const macro = this.authService.primaryMacroCategoryId();
    return macro === MacroCategoryType.FoodBeverage;
  });

  /** Reveal delivery section only when editing + the feature is unlocked */
  readonly showDeliverySection = computed(() =>
    this.editingBranch() !== null
    && this.tenantContext.hasFeature(FeatureKey.DeliveryPlatforms),
  );

  //#endregion

  //#region Constructor

  constructor() {
    // Lazy-load delivery configs when a branch enters edit mode AND the
    // tenant has the feature. Avoids wasted calls for giros without delivery.
    effect(() => {
      const branch = this.editingBranch();
      if (branch && this.tenantContext.hasFeature(FeatureKey.DeliveryPlatforms)) {
        this.deliveryConfigService.loadConfigs(branch.id);
      }
    });
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.loadBranches();
  }

  //#endregion

  //#region Branch CRUD

  async loadBranches(): Promise<void> {
    this.loadingBranches.set(true);
    try {
      const branches = await this.branchService.getAll();
      this.branches.set(branches);
    } catch (error) {
      console.error('[AdminBranches] Failed to load branches:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las sucursales',
      });
    } finally {
      this.loadingBranches.set(false);
    }
  }

  openNewBranch(): void {
    this.editingBranch.set(null);
    this.branchForm = { name: '', locationName: '', hasKitchen: false, hasTables: false };
    this.showBranchDialog.set(true);
  }

  openEditBranch(branch: Branch): void {
    this.editingBranch.set(branch);
    this.branchForm = {
      name: branch.name,
      locationName: branch.locationName,
      hasKitchen: branch.hasKitchen ?? false,
      hasTables: branch.hasTables ?? false,
    };
    this.showBranchDialog.set(true);
  }

  /**
   * Persists the dialog form. Creates on absent `editingBranch`, updates
   * otherwise. On 402 the global interceptor handles the toast; we only
   * clear the local `savingBranch` flag.
   */
  async saveBranch(): Promise<void> {
    const { name, locationName, hasKitchen, hasTables } = this.branchForm;
    if (!name.trim() || !locationName.trim()) return;

    this.savingBranch.set(true);
    try {
      const editing = this.editingBranch();
      if (editing) {
        await this.branchService.update(editing.id, name.trim(), locationName.trim(), hasKitchen, hasTables);
        this.messageService.add({
          severity: 'success',
          summary: 'Sucursal',
          detail: 'Sucursal actualizada',
        });
      } else {
        await this.branchService.create(name.trim(), locationName.trim());
        this.messageService.add({
          severity: 'success',
          summary: 'Sucursal',
          detail: 'Sucursal creada',
        });
      }
      this.showBranchDialog.set(false);
      await this.loadBranches();
    } catch (error: unknown) {
      const status = this.readStatus(error);
      if (status !== 402) {
        console.error('[AdminBranches] Failed to save branch:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudo guardar la sucursal',
        });
      }
    } finally {
      this.savingBranch.set(false);
    }
  }

  //#endregion

  //#region Catalog Copy

  openCopyCatalog(branch: Branch): void {
    this.copyTarget.set(branch);
    this.showCopyDialog.set(true);
  }

  async confirmCopyCatalog(): Promise<void> {
    const target = this.copyTarget();
    const matrix = this.branches().find(b => b.isMatrix);
    if (!target || !matrix) return;

    this.copyingCatalog.set(true);
    try {
      await this.branchService.copyCatalog(target.id, matrix.id);
      this.messageService.add({
        severity: 'success',
        summary: 'Catálogo copiado',
        detail: `Catálogo copiado a ${target.name}`,
      });
      this.showCopyDialog.set(false);
      await this.loadBranches();
    } catch (error) {
      console.error('[AdminBranches] Failed to copy catalog:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo copiar el catálogo',
      });
    } finally {
      this.copyingCatalog.set(false);
    }
  }

  //#endregion

  //#region Delivery Config

  getDeliveryConfig(platform: OrderSource): BranchDeliveryConfig | null {
    return this.deliveryConfigService.configs().find(c => c.platform === platform) ?? null;
  }

  handleDeliveryConfigSave(request: UpsertDeliveryConfigRequest): void {
    const branchId = this.editingBranch()?.id;
    if (!branchId) return;
    this.deliveryConfigService.upsert(branchId, request).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Configuración guardada', life: 3000 });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al guardar configuración', life: 3000 });
      },
    });
  }

  handleDeliveryConfigDelete(platform: OrderSource): void {
    const branchId = this.editingBranch()?.id;
    if (!branchId) return;
    this.deliveryConfigService.delete(branchId, platform).subscribe({
      next: () => {
        this.messageService.add({ severity: 'info', summary: 'Configuración eliminada', life: 3000 });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error al eliminar', life: 3000 });
      },
    });
  }

  //#endregion

  //#region Helpers

  /** Safely extract HTTP status from an unknown error */
  private readStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const candidate = (error as { status?: unknown }).status;
    return typeof candidate === 'number' ? candidate : undefined;
  }

  //#endregion

}
