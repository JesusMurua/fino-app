import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabViewModule } from 'primeng/tabview';

import { InventoryItemsTabComponent } from './items/inventory-items-tab.component';

/**
 * Shell component for the Inventory module.
 * Manages tab navigation and deferred rendering of tab content.
 */
@Component({
  selector: 'app-admin-inventory-shell',
  standalone: true,
  imports: [TabViewModule, InventoryItemsTabComponent],
  template: `
    <div class="flex flex-column gap-5 p-4">

      <!-- Header -->
      <h1 class="text-900 text-2xl font-semibold m-0">Inventory</h1>

      <!-- Tabs -->
      <p-tabView
        [activeIndex]="activeTab()"
        (activeIndexChange)="onTabChange($event)"
      >

        <!-- Tab 0: Items -->
        <p-tabPanel header="Items">
          <app-inventory-items-tab />
        </p-tabPanel>

        <!-- Tab 1: Suppliers (Phase 3) -->
        <p-tabPanel header="Suppliers">
          <div class="flex flex-column align-items-center gap-3 py-8">
            <i class="pi pi-truck text-4xl text-300"></i>
            <span class="text-500 text-lg">Suppliers management — coming in Phase 3.</span>
          </div>
        </p-tabPanel>

        <!-- Tab 2: Stock Receipts (Phase 4) -->
        <p-tabPanel header="Receipts">
          <div class="flex flex-column align-items-center gap-3 py-8">
            <i class="pi pi-inbox text-4xl text-300"></i>
            <span class="text-500 text-lg">Stock receipts — coming in Phase 4.</span>
          </div>
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
      if (parsed >= 0 && parsed <= 2) {
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
