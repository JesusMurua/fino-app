import { Component, computed, EventEmitter, input, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import { ButtonModule } from 'primeng/button';

import { PrintJobDto, PrintJobItem } from '../../core/models';

@Component({
  selector: 'app-kitchen-order-card',
  standalone: true,
  imports: [NgClass, ButtonModule],
  templateUrl: './kitchen-order-card.component.html',
  styleUrl: './kitchen-order-card.component.scss',
})
export class KitchenOrderCardComponent {

  //#region Inputs

  /** The print job — signal input so `parsedItems` is memoized via computed(). */
  readonly job = input.required<PrintJobDto>();

  @Input({ required: true }) now!: Date;
  @Input() isFading = false;

  //#endregion

  //#region Outputs

  @Output() markDone = new EventEmitter<number>();
  @Output() onStart = new EventEmitter<number>();

  //#endregion

  //#region Derived

  /** Parsed once when `job` changes — not on every CD cycle */
  readonly parsedItems = computed<PrintJobItem[]>(() => {
    try {
      return JSON.parse(this.job().structuredContent) as PrintJobItem[];
    } catch {
      return [];
    }
  });

  /** Elapsed time in seconds since the job was created */
  get elapsedSeconds(): number {
    return Math.floor((this.now.getTime() - new Date(this.job().createdAt).getTime()) / 1000);
  }

  /** Formatted elapsed time as "M:SS" */
  get elapsedFormatted(): string {
    const totalSec = Math.max(0, this.elapsedSeconds);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  /** True when the job has been waiting 10+ minutes */
  get isOverdue(): boolean {
    return this.elapsedSeconds >= 600;
  }

  //#endregion

  //#region Actions

  onDone(): void {
    this.markDone.emit(this.job().id);
  }

  onPrepare(): void {
    this.onStart.emit(this.job().id);
  }

  //#endregion

}
