import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/**
 * Selects the whole content of an `<input>` when it receives focus so the
 * next keystroke overwrites the existing value. Eliminates the friction of
 * manually deleting a pre-filled "$0.00" (or any previous amount) before
 * typing.
 *
 * Listens to `focusin` rather than `focus` because PrimeNG wrappers such as
 * `p-inputNumber` do not forward the native `focus` event on their host;
 * `focusin` bubbles through the shadow-less wrapper and lets us locate the
 * real `<input>` that actually received focus.
 *
 * Usage:
 *   <input posSelectOnFocus />
 *   <p-inputNumber posSelectOnFocus ... />
 */
@Directive({
  selector: '[posSelectOnFocus]',
  standalone: true,
})
export class SelectOnFocusDirective {

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  @HostListener('focusin', ['$event'])
  onFocusIn(event: FocusEvent): void {
    const target = this.resolveInput(event.target);
    if (!target) return;

    // Defer to the next tick so PrimeNG's own focus handler (which may
    // reposition the caret for currency formatting) runs first. Otherwise
    // the selection we set here is immediately overwritten.
    queueMicrotask(() => target.select());
  }

  /**
   * Returns the underlying `<input>` that received focus. Falls back to
   * looking inside the host when the event target is the PrimeNG wrapper.
   */
  private resolveInput(target: EventTarget | null): HTMLInputElement | null {
    if (target instanceof HTMLInputElement) return target;
    const inner = this.host.nativeElement.querySelector<HTMLInputElement>('input');
    return inner ?? null;
  }

}
