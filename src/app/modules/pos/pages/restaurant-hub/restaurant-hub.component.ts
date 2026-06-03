import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';

import { NotificationToggleComponent } from '../../../../shared/components/notification-toggle/notification-toggle.component';
import { ShiftChipComponent } from '../../../../shared/components/shift-chip/shift-chip.component';
import { ShiftPanelComponent } from '../../components/shift-panel/shift-panel.component';
import { TablesComponent } from '../../../tables/tables.component';
import { ProductGridComponent } from '../../components/product-grid/product-grid.component';

/** Channels available in the restaurant hub */
type RestaurantChannel = 'tables' | 'takeout' | 'delivery';

/** Option shape for the channel switcher */
interface ChannelOption {
  label: string;
  value: RestaurantChannel;
  icon: string;
}

const CHANNEL_STORAGE_KEY = 'pos-restaurant-hub-channel';

/**
 * Omni-channel hub for Restaurant business type.
 *
 * Provides a single entry point at /pos that lets the cashier flip between
 * three concurrent channels: dine-in tables, takeout counter sales, and
 * delivery (third-party platform orders). The selected channel persists in
 * localStorage so a refresh keeps the operator on their current view.
 */
@Component({
  selector: 'app-restaurant-hub',
  standalone: true,
  imports: [
    FormsModule,
    SelectButtonModule,
    NotificationToggleComponent,
    ShiftChipComponent,
    ShiftPanelComponent,
    TablesComponent,
    ProductGridComponent,
  ],
  templateUrl: './restaurant-hub.component.html',
  styleUrl: './restaurant-hub.component.scss',
})
export class RestaurantHubComponent implements OnInit {

  //#region Properties

  /** Channel options shown in the SelectButton switcher */
  readonly channelOptions: ChannelOption[] = [
    { label: 'Mesas',      value: 'tables',   icon: 'pi pi-th-large' },
    { label: 'Para Llevar', value: 'takeout', icon: 'pi pi-shopping-bag' },
    { label: 'Delivery',   value: 'delivery', icon: 'pi pi-send' },
  ];

  /** Currently active channel */
  readonly activeChannel = signal<RestaurantChannel>('tables');

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    const stored = localStorage.getItem(CHANNEL_STORAGE_KEY) as RestaurantChannel | null;
    if (stored && this.channelOptions.some(o => o.value === stored)) {
      this.activeChannel.set(stored);
    }
  }

  //#endregion

  //#region Channel Switcher

  /**
   * Updates the active channel and persists the choice to localStorage.
   * @param channel Channel to activate
   */
  setChannel(channel: RestaurantChannel): void {
    if (!channel) return;
    this.activeChannel.set(channel);
    localStorage.setItem(CHANNEL_STORAGE_KEY, channel);
  }

  //#endregion

}
