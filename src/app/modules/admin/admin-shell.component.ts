import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import { FeatureKey, UserRoleId } from '../../core/enums';
import { AuthService } from '../../core/services/auth.service';
import { ConfigService } from '../../core/services/config.service';
import { InventoryService } from '../../core/services/inventory.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProductService } from '../../core/services/product.service';
import { TenantContextService } from '../../core/services/tenant-context.service';
import { AppFeatureDirective, AppFeatureMode } from '../../shared/directives/app-feature.directive';
import { TrialBannerComponent } from '../../shared/components/trial-banner/trial-banner.component';

const SIDEBAR_KEY = 'admin_sidebar_collapsed';

/**
 * Single nav item declaration. The template uses `*appFeature` with the
 * item's `feature` key to hide or lock the link reactively based on
 * `TenantContextService` state. Items without a `feature` are always visible.
 */
interface NavItem {
  path: string;
  icon: string;
  label: string;
  /** Feature key required to unlock this item. Omit for always-visible items. */
  feature?: FeatureKey;
  /** Shows the low-stock badge next to this item */
  badge?: boolean;
}

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    FormsModule, DropdownModule, ToastModule, TooltipModule,
    AppFeatureDirective,
    TrialBannerComponent,
  ],
  templateUrl: './admin-shell.component.html',
  styleUrl: './admin-shell.component.scss',
})
export class AdminShellComponent implements OnInit {

  //#region Injections

  private readonly configService = inject(ConfigService);
  private readonly inventoryService = inject(InventoryService);
  private readonly notificationService = inject(NotificationService);
  private readonly productService = inject(ProductService);
  private readonly messageService = inject(MessageService);
  private readonly tenantContext = inject(TenantContextService);
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  //#endregion

  //#region State

  /** Whether the sidebar is collapsed (icon-only mode) */
  readonly isCollapsed = signal(false);

  /** True while a branch switch is in progress */
  readonly isSwitchingBranch = signal(false);

  /** Selected branch ID for the dropdown — synced from activeBranchId on init */
  selectedBranchId = 0;

  /** Whether the current user can switch branches */
  readonly canSwitchBranch = computed(() => {
    const roleId = this.authService.currentUser()?.roleId;
    return (roleId === UserRoleId.Owner || roleId === UserRoleId.Manager)
      && this.authService.availableBranches().length > 1;
  });

  /** Display name of the currently active branch */
  readonly currentBranchName = computed(() => {
    const branches = this.authService.availableBranches();
    const id = this.authService.activeBranchId();
    return branches.find(b => b.id === id)?.name ?? '';
  });

  /** Number of inventory items below low-stock threshold */
  readonly lowStockCount = computed(() => this.inventoryService.lowStockItems().length);

  //#endregion

  //#region Navigation

  /**
   * Static nav item declaration. Each entry is a candidate link — whether
   * it renders is decided at template time by `*appFeature`, so the items
   * array itself is reactive only for the low-stock badge.
   */
  readonly navItems: readonly NavItem[] = [
    { path: 'dashboard',    icon: 'pi-chart-bar',  label: 'Dashboard' },
    { path: 'products',     icon: 'pi-list',       label: 'Catálogo' },
    { path: 'reports',      icon: 'pi-chart-line', label: 'Reportes',      feature: FeatureKey.AdvancedReports },
    { path: 'tables',       icon: 'pi-table',      label: 'Mesas',         feature: FeatureKey.TableMap },
    { path: 'inventory',    icon: 'pi-box',        label: 'Inventario',    feature: FeatureKey.RecipeInventory, badge: true },
    { path: 'recipes',      icon: 'pi-book',       label: 'Recetas',       feature: FeatureKey.RecipeInventory },
    { path: 'promotions',   icon: 'pi-tag',        label: 'Promociones',   feature: FeatureKey.LoyaltyCrm },
    { path: 'customers',    icon: 'pi-id-card',    label: 'Clientes',      feature: FeatureKey.CustomerBase },
    { path: 'users',        icon: 'pi-users',      label: 'Usuarios' },
    { path: 'devices',      icon: 'pi-tablet',     label: 'Dispositivos' },
    { path: 'registers',    icon: 'pi-wallet',     label: 'Cajas' },
    { path: 'invoicing',    icon: 'pi-receipt',    label: 'Facturación',   feature: FeatureKey.CfdiInvoicing },
    { path: 'reservations', icon: 'pi-calendar',   label: 'Reservaciones', feature: FeatureKey.TableMap },
    { path: 'settings',     icon: 'pi-cog',        label: 'Configuración' },
  ];

  /**
   * Resolves the directive mode for a nav item based on the current giro:
   *   - `lock` when the feature is applicable to this giro (user can upgrade)
   *   - `hide` when the feature is not applicable (never shown for this giro)
   *
   * Items without a feature are always visible; the template skips the
   * directive for them entirely.
   */
  modeFor(item: NavItem): AppFeatureMode {
    if (!item.feature) return 'lock';
    return this.tenantContext.isApplicableToGiro(item.feature) ? 'lock' : 'hide';
  }

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved === 'true') this.isCollapsed.set(true);

    this.selectedBranchId = this.authService.activeBranchId();

    // Ensure config is loaded (APP_INITIALIZER may have skipped if user wasn't authenticated yet)
    if (!this.configService.isLoaded()) {
      await this.configService.load();
    }

    await this.inventoryService.loadFromApi();
  }

  //#endregion

  //#region Actions

  /** Toggles sidebar collapsed state and persists to localStorage */
  toggleSidebar(): void {
    const next = !this.isCollapsed();
    this.isCollapsed.set(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
  }

  /**
   * Switches the active branch and reloads the product catalog.
   * switchBranch updates the JWT + activeBranchId signal, then
   * revalidateFromApi fetches products/categories for the new branch.
   * Components with effect() on activeBranchId reload their own data.
   * @param branchId Target branch ID to switch to
   */
  async changeBranch(branchId: number): Promise<void> {
    if (branchId === this.authService.activeBranchId()) return;
    this.isSwitchingBranch.set(true);
    try {
      await this.authService.switchBranch(branchId);

      // Reload catalog with the new branch's JWT
      try {
        await this.productService.revalidateFromApi();
      } catch (e) {
        console.warn('[AdminShell] Catalog reload failed:', e);
      }

      this.messageService.add({
        severity: 'success',
        summary: 'Sucursal',
        detail: `Cambiaste a ${this.currentBranchName()}`,
      });
    } catch (error) {
      console.error('[AdminShell] Branch switch failed:', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo cambiar de sucursal',
      });
    } finally {
      this.isSwitchingBranch.set(false);
    }
  }

  /** Navigates to the POS without logging out */
  goToPos(): void {
    this.router.navigate(['/pos']);
  }

  /** Logs out and returns to the PIN screen */
  logout(): void {
    this.notificationService.unsubscribe();
    this.authService.logout();
  }

  //#endregion

}
