import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  PRINTER_CONNECTION_TYPE_OPTIONS,
  PrinterConnectionType,
  PrinterDestination,
  PrinterDestinationForm,
} from '../../../../../core/models';
import { PrinterDestinationService } from '../../../../../core/services/printer-destination.service';

@Component({
  selector: 'app-admin-printer-settings',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    DropdownModule,
    InputSwitchModule,
    InputTextModule,
    TableModule,
    ToastModule,
    TooltipModule,
  ],
  templateUrl: './admin-printer-settings.component.html',
  styleUrl: './admin-printer-settings.component.scss',
  providers: [ConfirmationService, MessageService],
})
export class AdminPrinterSettingsComponent implements OnInit {

  //#region Injections

  readonly printerService        = inject(PrinterDestinationService);
  private readonly confirmSvc    = inject(ConfirmationService);
  private readonly messageSvc    = inject(MessageService);

  //#endregion

  //#region Properties

  /** Options for the connection type dropdown */
  readonly connectionTypeOptions = PRINTER_CONNECTION_TYPE_OPTIONS;

  /** Destinations list delegated to service signal */
  readonly destinations = computed(() => this.printerService.destinations());

  /** Dialog state */
  readonly dialogVisible = signal<boolean>(false);
  readonly editingDest   = signal<PrinterDestination | null>(null);
  readonly isSaving      = signal<boolean>(false);

  /** Form for create / edit dialog */
  form: PrinterDestinationForm = this.emptyForm();

  //#endregion

  //#region Lifecycle

  async ngOnInit(): Promise<void> {
    await this.printerService.loadFromLocal();
  }

  //#endregion

  //#region Dialog Methods

  /** Opens the dialog to create a new printer destination */
  openCreate(): void {
    this.editingDest.set(null);
    this.form = this.emptyForm();
    this.dialogVisible.set(true);
  }

  /**
   * Opens the dialog pre-filled with an existing destination's data.
   * @param dest Destination to edit
   */
  openEdit(dest: PrinterDestination): void {
    this.editingDest.set(dest);
    this.form = {
      name:           dest.name,
      connectionType: dest.connectionType,
      address:        dest.address ?? '',
      isActive:       dest.isActive,
    };
    this.dialogVisible.set(true);
  }

  closeDialog(): void {
    this.dialogVisible.set(false);
  }

  //#endregion

  //#region CRUD Methods

  /** Saves the form — creates or updates depending on editingDest state */
  async save(): Promise<void> {
    if (!this.form.name.trim()) return;

    this.isSaving.set(true);
    try {
      const editing = this.editingDest();
      if (editing) {
        await this.printerService.update(editing.id, {
          name:           this.form.name.trim(),
          connectionType: this.form.connectionType,
          address:        this.form.address.trim() || undefined,
          isActive:       this.form.isActive,
        });
      } else {
        await this.printerService.create(this.form);
      }
      this.dialogVisible.set(false);
    } finally {
      this.isSaving.set(false);
    }
  }

  /**
   * Confirms and deletes a printer destination.
   * Shows a toast error if the destination is referenced by products.
   * @param dest Destination to delete
   */
  confirmDelete(dest: PrinterDestination): void {
    this.confirmSvc.confirm({
      message:     `¿Eliminar el destino "${dest.name}"?`,
      header:      'Confirmar eliminación',
      icon:        'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      accept:      async () => {
        try {
          await this.printerService.delete(dest.id);
        } catch (e: any) {
          this.messageSvc.add({
            severity: 'error',
            summary:  'No se puede eliminar',
            detail:   e?.message ?? 'Error al eliminar el destino.',
            life:     6000,
          });
        }
      },
    });
  }

  /**
   * Toggles the isActive flag for a destination inline from the table.
   * @param dest Destination to toggle
   */
  async toggleActive(dest: PrinterDestination): Promise<void> {
    await this.printerService.update(dest.id, { isActive: !dest.isActive });
  }

  /**
   * Sets a destination as the default for customer receipt tickets.
   * Clears the default flag on all other destinations.
   * @param dest Destination to set as default
   */
  async setDefault(dest: PrinterDestination): Promise<void> {
    await this.printerService.setDefault(dest.id);
  }

  //#endregion

  //#region Helpers

  /**
   * Returns the human-readable label for a connection type.
   * @param type PrinterConnectionType value
   */
  connectionTypeLabel(type: PrinterConnectionType): string {
    return this.connectionTypeOptions.find(o => o.value === type)?.label ?? type;
  }

  /** True when the current form connection type requires an address (IP:port) */
  showAddressField(): boolean {
    return this.form.connectionType !== 'none';
  }

  private emptyForm(): PrinterDestinationForm {
    return { name: '', connectionType: 'none', address: '', isActive: true };
  }

  //#endregion

}
