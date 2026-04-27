import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabViewModule } from 'primeng/tabview';

import { InventoryItemsTabComponent } from './items/inventory-items-tab.component';
import { InventoryLedgerTabComponent } from './ledger/inventory-ledger-tab.component';
import { StockReceiptsTabComponent } from './receipts/stock-receipts-tab.component';
import { SuppliersTabComponent } from './suppliers/suppliers-tab.component';

/**
 * Shell component for the Inventory module.
 * Manages tab navigation and deferred rendering of tab content.
 */
@Component({
  selector: 'app-admin-inventory-shell',
  standalone: true,
  imports: [TabViewModule, InventoryItemsTabComponent, InventoryLedgerTabComponent, StockReceiptsTabComponent, SuppliersTabComponent],
  template: `
    <div class="layout-wide">

      <div class="page-header">
        <div class="page-header__info">
          <h1 class="page-header__title">Inventario</h1>
        </div>
      </div>

      <p-tabView
        [activeIndex]="activeTab()"
        (activeIndexChange)="onTabChange($event)"
      >

        <!-- Tab 0: Artículos -->
        <p-tabPanel header="Artículos">
          <app-inventory-items-tab />
        </p-tabPanel>

        <!-- Tab 1: Proveedores -->
        <p-tabPanel header="Proveedores">
          <app-suppliers-tab />
        </p-tabPanel>

        <!-- Tab 2: Recepciones -->
        <p-tabPanel header="Recepciones">
          <app-stock-receipts-tab />
        </p-tabPanel>

        <!-- Tab 3: Movimientos (Global Ledger) -->
        <p-tabPanel header="Movimientos">
          <app-inventory-ledger-tab />
        </p-tabPanel>

      </p-tabView>

    </div>
  `,
})
export class AdminInventoryShellComponent implements OnInit {

  //#region Injections

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  //#endregion

  //#region State

  /** Active tab index synced with ?tab= query param */
  readonly activeTab = signal(0);

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam !== null) {
      const parsed = parseInt(tabParam, 10);
      if (parsed >= 0 && parsed <= 3) {
        this.activeTab.set(parsed);
      }
    }
  }

  //#endregion

  //#region Tab Navigation

  /** Updates the active tab signal and syncs to query params */
  onTabChange(index: number): void {
    this.activeTab.set(index);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: index },
      replaceUrl: true,
    });
  }

  //#endregion
}
