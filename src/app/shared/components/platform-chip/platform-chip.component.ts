import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { OrderSource } from '../../../core/enums';

interface ChipConfig {
  label: string;
  letter: string;
  icon?: string;
  bgClass: string;
  textClass: string;
}

@Component({
  selector: 'app-platform-chip',
  standalone: true,
  imports: [NgClass],
  templateUrl: './platform-chip.component.html',
  styleUrl: './platform-chip.component.scss',
})
export class PlatformChipComponent {

  @Input({ required: true }) source!: OrderSource;
  @Input() size: 'sm' | 'md' = 'md';

  private readonly configs: Record<string, ChipConfig> = {
    [OrderSource.Direct]:   { label: 'Directo',   letter: '',  icon: 'pi-home',  bgClass: 'chip--direct',   textClass: '' },
    [OrderSource.UberEats]: { label: 'Uber Eats',  letter: 'U', icon: undefined, bgClass: 'chip--uber',     textClass: '' },
    [OrderSource.Rappi]:    { label: 'Rappi',      letter: 'R', icon: undefined, bgClass: 'chip--rappi',    textClass: '' },
    [OrderSource.DidiFood]: { label: 'Didi Food',  letter: 'D', icon: undefined, bgClass: 'chip--didi',     textClass: '' },
  };

  get cfg(): ChipConfig {
    return this.configs[this.source] ?? this.configs[OrderSource.Direct];
  }
}
