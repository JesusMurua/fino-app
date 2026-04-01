import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { OrderSource } from '../../../core/enums';

interface ChipConfig {
  label: string;
  letter: string;
  icon?: string;
  bgClass: string;
}

@Component({
  selector: 'app-platform-chip',
  standalone: true,
  imports: [NgClass],
  templateUrl: './platform-chip.component.html',
  styleUrl: './platform-chip.component.scss',
})
export class PlatformChipComponent {

  readonly source = input.required<OrderSource>();
  readonly size = input<'sm' | 'md'>('md');

  private readonly configs: Record<string, ChipConfig> = {
    [OrderSource.Direct]:   { label: 'Directo',    letter: '',  icon: 'pi-home',  bgClass: 'chip--direct' },
    [OrderSource.UberEats]: { label: 'Uber Eats',  letter: 'U', icon: undefined,  bgClass: 'chip--uber' },
    [OrderSource.Rappi]:    { label: 'Rappi',       letter: 'R', icon: undefined,  bgClass: 'chip--rappi' },
    [OrderSource.DidiFood]: { label: 'Didi Food',   letter: 'D', icon: undefined,  bgClass: 'chip--didi' },
  };

  readonly cfg = computed(() =>
    this.configs[this.source()] ?? this.configs[OrderSource.Direct],
  );
}
