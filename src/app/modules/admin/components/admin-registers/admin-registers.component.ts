import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { CashRegister } from '../../../../core/models';
import { FeatureKey } from '../../../../core/enums';
import { CashRegisterService } from '../../../../core/services/cash-register.service';
import { TenantContextService } from '../../../../core/services/tenant-context.service';

/** Shape of the register form used in create/edit dialog */
interface RegisterForm {
  name: string;
  isActive: boolean;
}

@Component({
  selector: 'app-admin-registers',
  standalone: true,
  imports: [
    FormsModule,
    DialogModule,
    InputSwitchModule,
    InputTextModule,
    TooltipModule,
  ],
  templateUrl: './admin-registers.component.html',
  styleUrl: './admin-registers.component.scss',
})
export class AdminRegistersComponent implements OnInit {

  //#region Injections

  private readonly cashRegisterService = inject(CashRegisterService);
  private readonly messageService = inject(MessageService);
  private readonly tenantContext = inject(TenantContextService);

  //#endregion

  //#region Properties

  readonly registers = signal<CashRegister[]>([]);
  readonly isLoading = signal(false);
  readonly showDialog = signal(false);
  readonly editingRegister = signal<CashRegister | null>(null);
  readonly isSaving = signal(false);
  readonly nameError = signal('');

  form: RegisterForm = this.emptyForm();

  /**
   * True when the user can add a NEW cash register.
   *   - Always true if the tenant has the MultiTill feature.
   *   - Otherwise true only when zero registers exist yet (every business
   *     needs to create their first one — that's Core, not Premium).
   */
  readonly canAddRegister = computed(() =>
    this.tenantContext.hasFeature(FeatureKey.MultiTill) || this.registers().length === 0,
  );

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.loadRegisters();
  }

  //#endregion

  //#region Data Loading

  async loadRegisters(): Promise<void> {
    this.isLoading.set(true);
    try {
      const data = await this.cashRegisterService.getRegisters();
      this.registers.set(data);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudieron cargar las cajas registradoras.',
        life: 5000,
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  //#endregion

  //#region Dialog Methods

  openCreateDialog(): void {
    this.editingRegister.set(null);
    this.form = this.emptyForm();
    this.nameError.set('');
    this.showDialog.set(true);
  }

  openEditDialog(register: CashRegister): void {
    this.editingRegister.set(register);
    this.form = { name: register.name, isActive: register.isActive };
    this.nameError.set('');
    this.showDialog.set(true);
  }

  async saveRegister(): Promise<void> {
    const name = this.form.name.trim();
    if (!name) {
      this.nameError.set('El nombre es obligatorio.');
      return;
    }
    this.nameError.set('');
    this.isSaving.set(true);

    try {
      const editing = this.editingRegister();
      if (editing) {
        await this.cashRegisterService.updateRegister(editing.id, {
          name,
          isActive: this.form.isActive,
        });
        this.messageService.add({
          severity: 'success',
          summary: 'Caja actualizada',
          detail: `"${name}" se actualizó correctamente.`,
          life: 3000,
        });
      } else {
        await this.cashRegisterService.createRegister(name, this.form.isActive);
        this.messageService.add({
          severity: 'success',
          summary: 'Caja creada',
          detail: `"${name}" se creó correctamente.`,
          life: 3000,
        });
      }
      this.showDialog.set(false);
      await this.loadRegisters();
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No se pudo guardar la caja. Verifica tu conexión.',
        life: 5000,
      });
    } finally {
      this.isSaving.set(false);
    }
  }

  //#endregion

  //#region Helpers

  private emptyForm(): RegisterForm {
    return { name: '', isActive: true };
  }

  //#endregion
}
