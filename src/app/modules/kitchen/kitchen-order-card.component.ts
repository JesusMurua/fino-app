import { Component, EventEmitter, Input, Output } from '@angular/core';

import { PrintJobDto, PrintJobItem } from '../../core/models';

@Component({
  selector: 'app-kitchen-order-card',
  standalone: true,
  imports: [],
  templateUrl: './kitchen-order-card.component.html',
  styleUrl: './kitchen-order-card.component.scss',
})
export class KitchenOrderCardComponent {

  //#region Inputs

  @Input({ required: true }) job!: PrintJobDto;
  @Input({ required: true }) now!: Date;
  @Input() isFading = false;

  //#endregion

  //#region Outputs

  @Output() markDone = new EventEmitter<string>();

  //#endregion

  //#region Computed

  /** Items parsed from the job's JSON structuredContent */
  get parsedItems(): PrintJobItem[] {
    try {
      return JSON.parse(this.job.structuredContent) as PrintJobItem[];
    } catch {
      return [];
    }
  }

  /** Elapsed time in seconds since the job was created */
  get elapsedSeconds(): number {
    return Math.floor((this.now.getTime() - new Date(this.job.createdAt).getTime()) / 1000);
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
    this.markDone.emit(this.job.id);
  }

  //#endregion

}
