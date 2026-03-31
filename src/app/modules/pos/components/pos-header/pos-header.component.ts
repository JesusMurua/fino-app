import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import { AppConfig, DEFAULT_APP_CONFIG, DEFAULT_DEVICE_CONFIG, DeviceConfig, InventoryItem, Product, UserRole } from '../../../../core/models';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfigService } from '../../../../core/services/config.service';
import { InventoryService } from '../../../../core/services/inventory.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ProductService } from '../../../../core/services/product.service';
import { PwaService } from '../../../../core/services/pwa.service';
import { SyncService } from '../../../../core/services/sync.service';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-pos-header',
  standalone: true,
  imports: [RouterModule, FormsModule, DialogModule, DropdownModule, InputNumberModule, InputTextModule, TooltipModule],
  templateUrl: './pos-header.component.html',
  styleUrl: './pos-header.component.scss',
})
export class PosHeaderComponent implements OnInit, OnDestroy {

  readonly isOnline     = signal(true);
  readonly config       = signal<AppConfig>({ ...DEFAULT_APP_CONFIG });
  readonly deviceConfig = signal<DeviceConfig>({ ...DEFAULT_DEVICE_CONFIG });

  /** Show orders button based on posExperience and role */
  readonly showOrdersButton = computed(() => {
    const experience = this.configService.posExperience();
    const role = this.authService.currentUser()?.role;
    const isRestaurantOrCounter = experience === 'Restaurant' || experience === 'Counter';
    return isRestaurantOrCounter &&
      (role === 'Cashier' || role === 'Owner' || role === 'Manager');
  });
  /** Show tables button only if business has tables and role allows */
  readonly showTablesButton = computed(() =>
    this.configService.hasTables() &&
    (this.authService.currentUser()?.role === 'Cashier' ||
     this.authService.currentUser()?.role === 'Owner' ||
     this.authService.currentUser()?.role === 'Manager')
  );
  /** Show stock receive button only for Owner and Manager */
  readonly showStockButton: boolean;

  /** Role enum to Spanish display label */
  private readonly roleLabels: Record<UserRole, string> = {
    Owner: 'Dueño', Manager: 'Gerente', Cashier: 'Cajero',
    Waiter: 'Mesero', Kitchen: 'Cocina', Kiosk: 'Kiosko', Host: 'Hostess',
  };

  /** Active branch display name — falls back to locationName from config */
  readonly branchName = computed(() => {
    const user = this.authService.currentUser();
    const id = this.authService.activeBranchId();
    return user?.branches?.find(b => b.id === id)?.name
      ?? this.config().locationName;
  });

  /** Current user display name */
  readonly userName = computed(() =>
    this.authService.currentUser()?.name ?? '',
  );

  /** Current user role in Spanish */
  readonly userRoleLabel = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role ? (this.roleLabels[role] ?? role) : '';
  });

  // ---- Stock receive dialog ----
  readonly showStockDialog = signal(false);
  readonly stockItems = signal<{ label: string; value: string }[]>([]);
  selectedStockItem: string | null = null;
  stockQuantity = 1;
  stockReason = '';

  private readonly inventoryService = inject(InventoryService);
  private readonly notificationService = inject(NotificationService);
  private readonly productService = inject(ProductService);
  private readonly messageService = inject(MessageService);
  private readonly http = inject(HttpClient);
  readonly pwaService = inject(PwaService);
  readonly syncService = inject(SyncService);

  private readonly onOnline  = (): void => this.isOnline.set(true);
  private readonly onOffline = (): void => this.isOnline.set(false);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    const role = this.authService.currentUser()?.role;
    this.showStockButton = role === 'Owner' || role === 'Manager';
    // Business config — reactive
    this.configService.config$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.config.set(cfg));

    // Device config — reactive (mode, deviceName)
    this.configService.deviceConfig$
      .pipe(takeUntilDestroyed())
      .subscribe(cfg => this.deviceConfig.set(cfg));
  }

  async ngOnInit(): Promise<void> {
    this.isOnline.set(navigator.onLine);
    window.addEventListener('online',  this.onOnline);
    window.addEventListener('offline', this.onOffline);

    await this.configService.load(); // triggers config$ emission
  }

  ngOnDestroy(): void {
    window.removeEventListener('online',  this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }

  /** Navigates to the tables view */
  openTables(): void {
    this.router.navigate(['/tables']);
  }

  /** Navigates to the orders list */
  openOrders(): void {
    this.router.navigate(['/orders']);
  }

  /** Navigates to the PIN screen to access the back office */
  openAdmin(): void {
    this.router.navigate(['/pin']);
  }

  /** Opens the stock receive dialog with combined inventory + product options */
  async openStockDialog(): Promise<void> {
    await this.inventoryService.loadFromApi();
    const invItems = this.inventoryService.items()
      .map(i => ({ label: `${i.name} (insumo)`, value: `inv:${i.id}` }));
    const prodItems = this.productService.products()
      .filter(p => p.trackStock)
      .map(p => ({ label: `${p.name} (producto)`, value: `prod:${p.id}` }));
    this.stockItems.set([...invItems, ...prodItems]);
    this.selectedStockItem = null;
    this.stockQuantity = 1;
    this.stockReason = '';
    this.showStockDialog.set(true);
  }

  /** Requests notification permission and updates the PwaService signal */
  async enableNotifications(): Promise<void> {
    await this.notificationService.requestPermission();
    this.pwaService.notificationStatus.set(Notification.permission);
  }

  /** Registers stock entry for selected item */
  async confirmStockReceive(): Promise<void> {
    if (!this.selectedStockItem || this.stockQuantity <= 0) return;

    const [type, idStr] = this.selectedStockItem.split(':');
    const id = Number(idStr);
    const reason = this.stockReason.trim() || undefined;

    try {
      if (type === 'inv') {
        await this.inventoryService.addMovement(id, 'in', this.stockQuantity, reason);
      } else {
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/products/${id}/stock`, {
            type: 'in', quantity: this.stockQuantity, reason,
          })
        );
      }
      this.messageService.add({ severity: 'success', summary: 'Entrada registrada', life: 3000 });
      this.showStockDialog.set(false);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al registrar entrada', life: 3000 });
    }
  }

}
