import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { DeliveryOrderDto } from '../../../../core/models';
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

  //#endregion

  constructor() {
    // Set platform accent color as CSS variable on host element
    effect(() => {
      const color = this.getPlatformColor(this.order().orderSource);
      this.el.nativeElement.style.setProperty('--dlv-platform-color', color);
    });
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
