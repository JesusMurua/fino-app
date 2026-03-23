import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ToastModule } from 'primeng/toast';

import { CreateUserRequest, UpdateUserRequest, UserDto, UserRole } from '../../../../core/models';
import { UserService } from '../../../../core/services/user.service';

const BRANCH_ID = 1;

/** Role option for the dropdown */
interface RoleOption {
  label: string;
  value: UserRole;
  icon: string;
  color: string;
}

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DialogModule,
    DropdownModule,
    InputSwitchModule,
    InputTextModule,
    PasswordModule,
    ToastModule,
  ],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
  providers: [MessageService],
})
export class AdminUsersComponent implements OnInit {

  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly fb = inject(FormBuilder);

  //#region Properties

  readonly users = signal<UserDto[]>([]);
  readonly loading = signal(false);
  readonly showDialog = signal(false);
  readonly editingUser = signal<UserDto | null>(null);
  readonly savingUser = signal(false);

  readonly activeUsers = computed(() => this.users().filter(u => u.isActive));
  readonly inactiveUsers = computed(() => this.users().filter(u => !u.isActive));

  readonly roleOptions: RoleOption[] = [
    { label: 'Dueño',   value: 'Owner',   icon: '👑', color: '#7C3AED' },
    { label: 'Gerente',  value: 'Manager', icon: '🏢', color: '#7C3AED' },
    { label: 'Cajero',   value: 'Cashier', icon: '💳', color: '#2563EB' },
    { label: 'Mesero',   value: 'Waiter',  icon: '🍽️', color: '#16A34A' },
    { label: 'Cocina',   value: 'Kitchen', icon: '👨‍🍳', color: '#D97706' },
  ];

  readonly userForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    role: ['Cashier', Validators.required],
    pin: [''],
    email: [''],
    password: [''],
    isActive: [true],
  });

  /** Track role changes for conditional fields */
  readonly selectedRole = signal<UserRole>('Cashier');

  readonly usesPin = computed(() =>
    ['Cashier', 'Kitchen', 'Waiter'].includes(this.selectedRole())
  );

  readonly usesEmail = computed(() =>
    ['Owner', 'Manager'].includes(this.selectedRole())
  );

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.loadUsers();
    this.userForm.get('role')!.valueChanges.subscribe((role: UserRole) => {
      this.selectedRole.set(role);
    });
  }

  //#endregion

  //#region Data Loading

  /** Loads all users for the branch */
  async loadUsers(): Promise<void> {
    this.loading.set(true);
    try {
      const users = await this.userService.getUsers(BRANCH_ID);
      this.users.set(users);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al cargar usuarios', life: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  //#endregion

  //#region Dialog

  /** Opens dialog to create new user */
  openNewDialog(): void {
    this.editingUser.set(null);
    this.userForm.reset({ name: '', role: 'Cashier', pin: '', email: '', password: '', isActive: true });
    this.selectedRole.set('Cashier');
    this.showDialog.set(true);
  }

  /** Opens dialog to edit existing user */
  openEditDialog(user: UserDto): void {
    this.editingUser.set(user);
    this.userForm.patchValue({
      name: user.name,
      role: user.role,
      pin: '',
      email: user.email ?? '',
      password: '',
      isActive: user.isActive,
    });
    this.selectedRole.set(user.role);
    this.showDialog.set(true);
  }

  //#endregion

  //#region CRUD

  /** Saves user (create or update) */
  async saveUser(): Promise<void> {
    if (this.userForm.invalid) return;
    this.savingUser.set(true);

    const { name, role, pin, email, password, isActive } = this.userForm.value;

    try {
      if (this.editingUser()) {
        const req: UpdateUserRequest = {
          name: name.trim(),
          role,
          isActive,
          pin: pin || undefined,
          password: password || undefined,
        };
        await this.userService.updateUser(this.editingUser()!.id, req);
        this.messageService.add({ severity: 'success', summary: 'Usuario actualizado', life: 3000 });
      } else {
        const req: CreateUserRequest = {
          name: name.trim(),
          role,
          branchId: BRANCH_ID,
          pin: pin || undefined,
          email: email || undefined,
          password: password || undefined,
        };
        await this.userService.createUser(BRANCH_ID, req);
        this.messageService.add({ severity: 'success', summary: 'Usuario creado', life: 3000 });
      }

      this.showDialog.set(false);
      await this.loadUsers();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al guardar usuario', life: 3000 });
    } finally {
      this.savingUser.set(false);
    }
  }

  /** Toggles user active status */
  async onToggleUser(user: UserDto): Promise<void> {
    try {
      const isActive = await this.userService.toggleUser(user.id);
      this.messageService.add({
        severity: 'success',
        summary: isActive ? 'Usuario activado' : 'Usuario desactivado',
        life: 3000,
      });
      await this.loadUsers();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error al cambiar estado', life: 3000 });
    }
  }

  //#endregion

  //#region Helpers

  /** Returns color for a user role (accepts role enum or roleName string) */
  getRoleColor(role: string): string {
    return this.roleOptions.find(r => r.value === role || r.label === role)?.color ?? '#6B7280';
  }

  /** Returns label for a user role */
  getRoleLabel(role: UserRole): string {
    return this.roleOptions.find(r => r.value === role)?.label ?? role;
  }

  /** Returns the initial letter of a name */
  getInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  //#endregion
}
