import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MessageService } from 'primeng/api';
import { DropdownModule } from 'primeng/dropdown';
import { TooltipModule } from 'primeng/tooltip';

import { AuthService } from '../../core/services/auth.service';
import { InventoryService } from '../../core/services/inventory.service';
import { NotificationService } from '../../core/services/notification.service';
import { ProductService } from '../../core/services/product.service';
import { TrialBannerComponent } from '../../shared/components/trial-banner/trial-banner.component';

const SIDEBAR_KEY = 'admin_sidebar_collapsed';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    FormsModule, DropdownModule, TooltipModule,
    TrialBannerComponent,
  ],
  templateUrl: './admin-shell.component.html',
  styleUrl: './admin-shell.component.scss',
})
export class AdminShellComponent implements OnInit {

  private readonly inventoryService = inject(InventoryService);
  private readonly notificationService = inject(NotificationService);
  private readonly productService = inject(ProductService);
  private readonly messageService = inject(MessageService);
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  /** Whether the sidebar is collapsed (icon-only mode) */
  readonly isCollapsed = signal(false);

  /** True while a branch switch is in progress */
  readonly isSwitchingBranch = signal(false);

  /** Selected branch ID for the dropdown — synced from activeBranchId on init */
  selectedBranchId = 0;

  /** Whether the current user can switch branches */
  readonly canSwitchBranch = computed(() => {
    const role = this.authService.currentUser()?.role;
    return (role === 'Owner' || role === 'Manager')
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

  /** Navigation items for the sidebar */
  readonly navItems = [
    { path: 'dashboard',  icon: 'pi-chart-bar',  label: 'Dashboard' },
    { path: 'products',   icon: 'pi-list',        label: 'Catálogo' },
    { path: 'reports',    icon: 'pi-chart-line',  label: 'Reportes' },
    { path: 'tables',     icon: 'pi-table',       label: 'Mesas' },
    { path: 'inventory',  icon: 'pi-box',         label: 'Inventario', badge: true },
    { path: 'promotions', icon: 'pi-tag',         label: 'Promociones' },
    { path: 'users',      icon: 'pi-users',       label: 'Usuarios' },
    { path: 'cash',       icon: 'pi-wallet',      label: 'Caja' },
    { path: 'settings',   icon: 'pi-cog',         label: 'Configuración' },
  ];

  async ngOnInit(): Promise<void> {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved === 'true') this.isCollapsed.set(true);

    this.selectedBranchId = this.authService.activeBranchId();
    await this.inventoryService.loadFromApi();
  }

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
}
