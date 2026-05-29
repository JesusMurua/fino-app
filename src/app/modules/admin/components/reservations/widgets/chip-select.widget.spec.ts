import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { FieldDescriptor } from 'src/app/shared/forms';

import { ChipGroup, ChipSelectComponent } from './chip-select.widget';

@Component({
  standalone: true,
  imports: [ChipSelectComponent],
  template: `
    <app-chip-select
      [descriptor]="descriptor"
      [control]="control"
      [formId]="'test-form'"
    />
  `,
})
class HostComponent {
  descriptor!: FieldDescriptor;
  control!: FormControl;
}

describe('ChipSelectWidget', () => {

  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  /**
   * Helper — builds a descriptor with a typed cast that mirrors the
   * runtime contract: custom widgets reinterpret descriptor.options.
   */
  function buildDescriptor(
    options: readonly ChipGroup[] | (() => readonly ChipGroup[]),
  ): FieldDescriptor {
    return {
      key: 'tableId',
      kind: 'chip-select',
      label: 'Mesa',
      defaultValue: null,
      options: options as unknown as readonly { label: string; value: unknown }[],
    };
  }

  it('renders all groups + chips from a static options array', () => {
    host.descriptor = buildDescriptor([
      { groupLabel: 'Patio',  chips: [{ label: 'M1', value: 1 }, { label: 'M2', value: 2 }] },
      { groupLabel: 'Salón',  chips: [{ label: 'M3', value: 3 }] },
    ]);
    host.control = new FormControl(null);
    fixture.detectChanges();

    const groupLabels = fixture.debugElement
      .queryAll(By.css('.chip-group__label'))
      .map(el => (el.nativeElement as HTMLElement).textContent?.trim());
    expect(groupLabels).toEqual(['Patio', 'Salón']);

    const chipLabels = fixture.debugElement
      .queryAll(By.css('.chip__label'))
      .map(el => (el.nativeElement as HTMLElement).textContent?.trim());
    expect(chipLabels).toEqual(['M1', 'M2', 'M3']);
  });

  it('click on a chip sets control.value AND marks the control touched', () => {
    host.descriptor = buildDescriptor([
      { groupLabel: 'G', chips: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] },
    ]);
    host.control = new FormControl(null);
    fixture.detectChanges();

    const chips = fixture.debugElement.queryAll(By.css('.chip'));
    (chips[1].nativeElement as HTMLElement).click();
    fixture.detectChanges();

    expect(host.control.value).toBe(2);
    expect(host.control.touched).toBe(true);
  });

  it('active chip carries aria-pressed="true"; others carry "false"', () => {
    host.descriptor = buildDescriptor([
      { groupLabel: 'G', chips: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] },
    ]);
    host.control = new FormControl(1);
    fixture.detectChanges();

    const chips = fixture.debugElement.queryAll(By.css('.chip'));
    expect(chips[0].attributes['aria-pressed']).toBe('true');
    expect(chips[1].attributes['aria-pressed']).toBe('false');
  });

  it('Space and Enter keys select the focused chip', () => {
    host.descriptor = buildDescriptor([
      { groupLabel: 'G', chips: [{ label: 'A', value: 10 }, { label: 'B', value: 20 }] },
    ]);
    host.control = new FormControl(null);
    fixture.detectChanges();

    const chips = fixture.debugElement.queryAll(By.css('.chip'));
    (chips[0].nativeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ' }),
    );
    fixture.detectChanges();
    expect(host.control.value).toBe(10);

    (chips[1].nativeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );
    fixture.detectChanges();
    expect(host.control.value).toBe(20);
  });

  it('Signal-based options update triggers re-render with new chips', () => {
    const opts: WritableSignal<readonly ChipGroup[]> = signal([
      { groupLabel: 'G', chips: [{ label: 'A', value: 1 }] },
    ]);
    host.descriptor = buildDescriptor(() => opts());
    host.control = new FormControl(null);
    fixture.detectChanges();

    let labels = fixture.debugElement.queryAll(By.css('.chip__label'))
      .map(el => (el.nativeElement as HTMLElement).textContent?.trim());
    expect(labels).toEqual(['A']);

    opts.set([
      { groupLabel: 'G', chips: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] },
    ]);
    fixture.detectChanges();
    labels = fixture.debugElement.queryAll(By.css('.chip__label'))
      .map(el => (el.nativeElement as HTMLElement).textContent?.trim());
    expect(labels).toEqual(['A', 'B']);
  });

  it('pre-existing control.value survives delayed options load (defensive)', () => {
    // Construct with options=[] initially, control already has value=99.
    const opts: WritableSignal<readonly ChipGroup[]> = signal([]);
    host.descriptor = buildDescriptor(() => opts());
    host.control = new FormControl(99);
    fixture.detectChanges();

    // No chips render yet — and control.value is NOT reset.
    expect(host.control.value).toBe(99);
    expect(fixture.debugElement.queryAll(By.css('.chip')).length).toBe(0);

    // Options arrive late — the chip with value=99 should now render
    // as selected (aria-pressed="true").
    opts.set([
      { groupLabel: 'G', chips: [{ label: 'X', value: 99 }] },
    ]);
    fixture.detectChanges();

    expect(host.control.value).toBe(99);
    const chip = fixture.debugElement.query(By.css('.chip'));
    expect(chip.attributes['aria-pressed']).toBe('true');
  });

});
