import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

import { DeliveryOrderDto } from '../../../../core/models';
import { DeliveryStatus, OrderSource } from '../../../../core/enums';
import { formatMeasureUnit, isMeasureItem } from '../../../../core/utils/product.utils';
import { PlatformChipComponent } from '../../../../shared/components/platform-chip/platform-chip.component';

/** Default acceptance window when no estimatedPickupAt is provided (5 min) */
const DEFAULT_ACCEPTANCE_WINDOW_S = 300;

@Component({
  selector: 'app-delivery-order-card',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PlatformChipComponent],
  templateUrl: './delivery-order-card.component.html',
  styleUrl: './delivery-order-card.component.scss',
})
export class DeliveryOrderCardComponent implements OnInit, OnDestroy {

  private readonly el = inject(ElementRef);

  //#region Inputs & Outputs

  readonly order = input.required<DeliveryOrderDto>();

  readonly accept = output<string>();
  readonly reject = output<string>();
  readonly markReady = output<string>();
  readonly markPickedUp = output<string>();

  //#endregion

  /** Expose enums for template */
  readonly DeliveryStatus = DeliveryStatus;
  readonly OrderSource = OrderSource;

  /** Template predicate for measure-based items — drives kg/L/m vs piece display. */
  readonly isMeasureItem = isMeasureItem;

  /** Template helper for the dynamic unit suffix from the SAT code. */
  readonly formatMeasureUnit = formatMeasureUnit;

  readonly now = signal(new Date());
  private timerId: ReturnType<typeof setInterval> | null = null;

  //#region Computed — Timer

  /** Whether to show the timer (hide for terminal states) */
  readonly showTimer = computed(() => {
    const status = this.order().deliveryStatus;
    return status !== DeliveryStatus.PickedUp && status !== DeliveryStatus.Rejected;
  });

  /** True when status is PendingAcceptance (countdown mode) */
  private readonly isCountdown = computed(() =>
    this.order().deliveryStatus === DeliveryStatus.PendingAcceptance,
  );

  /** Seconds remaining (countdown) or elapsed (count-up) */
  readonly timerSeconds = computed(() => {
    const order = this.order();
    const nowMs = this.now().getTime();

    if (this.isCountdown()) {
      // Countdown mode: remaining until pickup or default window
      if (order.estimatedPickupAt) {
        const pickupMs = new Date(order.estimatedPickupAt).getTime();
        return Math.max(0, Math.floor((pickupMs - nowMs) / 1000));
      }
      const deadlineMs = new Date(order.createdAt).getTime() + DEFAULT_ACCEPTANCE_WINDOW_S * 1000;
      return Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
    }

    // Count-up mode: elapsed since creation
    const createdMs = new Date(order.createdAt).getTime();
    return Math.max(0, Math.floor((nowMs - createdMs) / 1000));
  });

  /** Formatted as M:SS */
  readonly timerFormatted = computed(() => {
    const totalSec = this.timerSeconds();
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  });

  readonly isUrgent = computed(() => {
    if (this.isCountdown()) return this.timerSeconds() <= 120 && this.timerSeconds() > 0;
    return this.timerSeconds() >= 300;
  });

  readonly isCritical = computed(() => {
    if (this.isCountdown()) return this.timerSeconds() === 0;
    return this.timerSeconds() >= 600;
  });

  //#endregion

  constructor() {
    // Set platform accent color as CSS variable on host element
    effect(() => {
      const color = this.getPlatformColor(this.order().orderSource);
      this.el.nativeElement.style.setProperty('--dlv-platform-color', color);
    });

    // Auto-reject when countdown hits zero
    effect(() => {
      if (
        this.order().deliveryStatus === DeliveryStatus.PendingAcceptance &&
        this.isCritical()
      ) {
        this.reject.emit(this.order().id);
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.timerId = setInterval(() => this.now.set(new Date()), 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId !== null) clearInterval(this.timerId);
  }

  private getPlatformColor(source: OrderSource): string {
    const map: Record<string, string> = {
      [OrderSource.UberEats]: '#06C167',
      [OrderSource.Rappi]:    '#FF441B',
      [OrderSource.DidiFood]: '#FF6B00',
      [OrderSource.Direct]:   '#16A34A',
    };
    return map[source] ?? '#16A34A';
  }
}
