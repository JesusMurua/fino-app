import { Component, EventEmitter, Input, Output, computed } from '@angular/core';

import { Order } from '../../core/models';
import { OrderSource } from '../../core/enums';
import { PlatformChipComponent } from '../../shared/components/platform-chip/platform-chip.component';

@Component({
  selector: 'app-kitchen-order-card',
  standalone: true,
  imports: [PlatformChipComponent],
  templateUrl: './kitchen-order-card.component.html',
  styleUrl: './kitchen-order-card.component.scss',
})
export class KitchenOrderCardComponent {

  //#region Inputs
  @Input({ required: true }) order!: Order;
  @Input({ required: true }) now!: Date;
  @Input() isFading = false;
  //#endregion

  //#region Outputs
  @Output() markDone = new EventEmitter<string>();
  //#endregion

  readonly OrderSource = OrderSource;

  //#region Computed

  /** Elapsed time in seconds since order was created */
  get elapsedSeconds(): number {
    return Math.floor((this.now.getTime() - new Date(this.order.createdAt).getTime()) / 1000);
  }

  /** Formatted elapsed time as "M:SS" */
  get elapsedFormatted(): string {
    const totalSec = Math.max(0, this.elapsedSeconds);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  /** True when order has been waiting 10+ minutes */
  get isOverdue(): boolean {
    return this.elapsedSeconds >= 600;
  }

  //#endregion

  //#region Actions

  onDone(): void {
    this.markDone.emit(this.order.id);
  }

  //#endregion

}
