import { Component, OnDestroy, OnInit, computed, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { Order } from '../../../../core/models';
import { DeliveryStatus, OrderSource } from '../../../../core/enums';
import { PlatformChipComponent } from '../../../../shared/components/platform-chip/platform-chip.component';

@Component({
  selector: 'app-delivery-order-card',
  standalone: true,
  imports: [DatePipe, PlatformChipComponent],
  templateUrl: './delivery-order-card.component.html',
  styleUrl: './delivery-order-card.component.scss',
})
export class DeliveryOrderCardComponent implements OnInit, OnDestroy {

  //#region Inputs & Outputs

  readonly order = input.required<Order>();

  readonly accept = output<string>();
  readonly reject = output<string>();
  readonly markReady = output<string>();
  readonly markPickedUp = output<string>();

  //#endregion

  /** Expose enums for template */
  readonly DeliveryStatus = DeliveryStatus;
  readonly OrderSource = OrderSource;

  readonly now = signal(new Date());
  private timerId: ReturnType<typeof setInterval> | null = null;

  //#region Computed

  readonly elapsedSeconds = computed(() => {
    const created = new Date(this.order().createdAt);
    return Math.floor((this.now().getTime() - created.getTime()) / 1000);
  });

  readonly elapsedFormatted = computed(() => {
    const totalSec = Math.max(0, this.elapsedSeconds());
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  });

  readonly isUrgent = computed(() => this.elapsedSeconds() >= 300);
  readonly isCritical = computed(() => this.elapsedSeconds() >= 600);

  readonly borderColor = computed(() => {
    switch (this.order().orderSource) {
      case OrderSource.UberEats: return '#06C167';
      case OrderSource.Rappi:    return '#FF441B';
      case OrderSource.DidiFood: return '#FF6B00';
      default:                   return '#16A34A';
    }
  });

  //#endregion

  ngOnInit(): void {
    this.timerId = setInterval(() => this.now.set(new Date()), 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId !== null) clearInterval(this.timerId);
  }
}
