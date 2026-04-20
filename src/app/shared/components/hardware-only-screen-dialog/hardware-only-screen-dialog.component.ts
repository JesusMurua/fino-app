import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

/** Hardware mode that triggered the block. */
export type HardwareOnlyMode = 'kitchen' | 'kiosk';

/**
 * Modal shown when a human tries to sign in with a PIN on a device
 * that is provisioned as a hardware-only shell (KDS or Kiosk).
 *
 * Contract (per FDD-013 §4.2.9):
 *   - Pure presentational — no state, no services.
 *   - Inputs drive visibility (`visible`) and copy (`mode`).
 *   - Outputs surface the user's choice back to the caller
 *     (`dismiss`, `reprovision`).
 *   - Dialog is non-dismissable by mask / ESC so the user must pick
 *     a recovery action.
 */
@Component({
  selector: 'app-hardware-only-screen-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogModule, ButtonModule],
  templateUrl: './hardware-only-screen-dialog.component.html',
  styleUrl: './hardware-only-screen-dialog.component.scss',
})
export class HardwareOnlyScreenDialogComponent {

  /** Whether the dialog is visible. Two-way binding friendly. */
  @Input() visible = false;

  /** Which hardware mode triggered the block — drives the copy. */
  @Input() mode: HardwareOnlyMode = 'kitchen';

  /** Emits when the user acknowledges the dialog and returns to PIN entry. */
  @Output() readonly dismiss = new EventEmitter<void>();

  /** Emits when the user asks to re-provision the device. */
  @Output() readonly reprovision = new EventEmitter<void>();

  /** Spanish title for the selected mode. */
  get title(): string {
    return this.mode === 'kiosk'
      ? 'Esta pantalla es un Kiosko'
      : 'Esta pantalla es de Cocina';
  }

  /** Spanish body copy for the selected mode. */
  get body(): string {
    return this.mode === 'kiosk'
      ? 'Este dispositivo está configurado como Kiosko. No se puede iniciar sesión con PIN aquí. Si necesitas usarlo como POS, re-vincúlalo desde Configuración.'
      : 'Este dispositivo está configurado como pantalla de cocina (KDS). No se puede iniciar sesión con PIN aquí. Si necesitas usarlo como POS, re-vincúlalo desde Configuración.';
  }

  onDismiss(): void {
    this.dismiss.emit();
  }

  onReprovision(): void {
    this.reprovision.emit();
  }

}
