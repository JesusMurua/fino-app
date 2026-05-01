import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { TableModule } from 'primeng/table';
import { CreateUserRequest, UpdateUserRequest, UserDto } from '../../../../core/models';
import { UserRoleId, USER_ROLE_LABELS } from '../../../../core/enums';
import { AuthService } from '../../../../core/services/auth.service';
import { Branch, BranchService } from '../../../../core/services/branch.service';
import { UserService } from '../../../../core/services/user.service';

/** Role option for the dropdown */
interface RoleOption {
  label: string;
  value: UserRoleId;
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
    TableModule,
  ],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent implements OnInit {

  private readonly userService = inject(UserService);
  private readonly branchService = inject(BranchService);
  private readonly messageService = inject(MessageService);
  private readonly fb = inject(FormBuilder);
  readonly authService = inject(AuthService);

  //#region Properties

  readonly users = signal<UserDto[]>([]);
  readonly loading = signal(false);
  readonly showDialog = signal(false);
  readonly editingUser = signal<UserDto | null>(null);
  readonly savingUser = signal(false);

  readonly activeUsers = computed(() => this.users().filter(u => u.isActive));
  readonly inactiveUsers = computed(() => this.users().filter(u => !u.isActive));

  readonly roleOptions: RoleOption[] = [
    { label: 'Dueño',   value: UserRoleId.Owner,   icon: '👑', color: '#7C3AED' },
    { label: 'Gerente', value: UserRoleId.Manager, icon: '🏢', color: '#7C3AED' },
    { label: 'Cajero',  value: UserRoleId.Cashier, icon: '💳', color: '#2563EB' },
    { label: 'Mesero',  value: UserRoleId.Waiter,  icon: '🍽️', color: '#16A34A' },
    { label: 'Host',    value: UserRoleId.Host,    icon: '🛎️', color: '#0891B2' },
  ];

  readonly userForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    roleId: [UserRoleId.Cashier, Validators.required],
    pin: [''],
    email: [''],
    password: [''],
    isActive: [true],
  });

  /** Track role changes for conditional fields */
  readonly selectedRole = signal<UserRoleId>(UserRoleId.Cashier);

  readonly usesPin = computed(() =>
    [UserRoleId.Cashier, UserRoleId.Waiter, UserRoleId.Host].includes(this.selectedRole())
  );

  readonly usesEmail = computed(() =>
    [UserRoleId.Owner, UserRoleId.Manager].includes(this.selectedRole())
  );

  /** Whether the logged-in user is Owner (can assign branches) */
  readonly isOwner = computed(() => this.authService.currentUser()?.roleId === UserRoleId.Owner);

  /** All branches available for assignment */
  readonly availableBranches = signal<Branch[]>([]);

  /** Branch IDs assigned to the user being edited */
  readonly selectedBranchIds = signal<number[]>([]);

  /** Default branch for the user being edited */
  defaultBranchId = signal<number>(0);

  //#endregion

  //#region Constructor

  constructor() {
    effect(() => {
      const branchId = this.authService.activeBranchId();
      if (branchId) this.loadUsers();
    }, { allowSignalWrites: true });
  }

  //#endregion

  //#region Lifecycle

  ngOnInit(): void {
    this.userForm.get('roleId')!.valueChanges.subscribe((roleId: UserRoleId) => {
      this.selectedRole.set(roleId);
    });
  }

  //#endregion

  //#region Data Loading

  /** Loads all users for the branch */
  async loadUsers(): Promise<void> {
    this.loading.set(true);
    try {
      const users = await this.userService.getUsers(this.authService.branchId);
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
    this.userForm.reset({ name: '', roleId: UserRoleId.Cashier, pin: '', email: '', password: '', isActive: true });
    this.selectedRole.set(UserRoleId.Cashier);
    this.selectedBranchIds.set([]);
    this.defaultBranchId.set(0);
    this.showDialog.set(true);
  }

  /**
   * Opens dialog to edit existing user.
   * If the current user is Owner, also loads available branches
   * and the user's assigned branches.
   * @param user User to edit
   */
  async openEditDialog(user: UserDto): Promise<void> {
    this.editingUser.set(user);
    const roleId = this.resolveRoleId(user);
    this.userForm.patchValue({
      name: user.name,
      roleId,
      pin: '',
      email: user.email ?? '',
      password: '',
      isActive: user.isActive,
    });
    this.selectedRole.set(roleId);
    this.selectedBranchIds.set([]);
    this.defaultBranchId.set(0);
    this.showDialog.set(true);

    if (this.isOwner()) {
      await this.loadUserBranches(user.id);
    }
  }

  /**
   * Loads available branches and the user's assigned branches.
   * If the user has no assignments, preselects the matrix branch.
   * @param userId User ID to fetch branch assignments for
   */
  private async loadUserBranches(userId: number): Promise<void> {
    try {
      const [branches, assignment] = await Promise.all([
        this.branchService.getAll(),
        this.userService.getUserBranches(userId),
      ]);
      this.availableBranches.set(branches);

      if (assignment.branchIds.length > 0) {
        this.selectedBranchIds.set(assignment.branchIds);
        this.defaultBranchId.set(assignment.defaultBranchId);
      } else {
        const matrix = branches.find(b => b.isMatrix);
        this.selectedBranchIds.set(matrix ? [matrix.id] : []);
        this.defaultBranchId.set(matrix?.id ?? 0);
      }
    } catch (error) {
      console.error('[AdminUsers] Failed to load user branches:', error);
    }
  }

  //#endregion

  //#region CRUD

  /** Saves user (create or update) */
  async saveUser(): Promise<void> {
    if (this.userForm.invalid) return;
    this.savingUser.set(true);

    const { name, roleId: formRoleId, pin, email, password, isActive } = this.userForm.value;
    const roleId: UserRoleId = formRoleId as UserRoleId;

    try {
      if (this.editingUser()) {
        const userId = this.editingUser()!.id;
        const req: UpdateUserRequest = {
          name: name.trim(),
          roleId,
          isActive,
          pin: pin || undefined,
          password: password || undefined,
        };
        await this.userService.updateUser(userId, req);

        // Save branch assignments if Owner and branches were selected
        if (this.isOwner() && this.selectedBranchIds().length > 0) {
          const ids = this.selectedBranchIds();
          const defId = this.defaultBranchId() || ids[0];
          await this.userService.assignBranches(userId, ids, defId);
        }

        this.messageService.add({ severity: 'success', summary: 'Usuario actualizado', life: 3000 });
      } else {
        const req: CreateUserRequest = {
          name: name.trim(),
          roleId,
          branchId: this.authService.branchId,
          pin: pin || undefined,
          email: email || undefined,
          password: password || undefined,
        };
        await this.userService.createUser(this.authService.branchId, req);
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

  /** Returns color for a user role (accepts roleId or roleName string) */
  getRoleColor(roleId: UserRoleId | string): string {
    if (typeof roleId === 'number') {
      return this.roleOptions.find(r => r.value === roleId)?.color ?? '#6B7280';
    }
    return this.roleOptions.find(r => r.label === roleId)?.color ?? '#6B7280';
  }

  /** Returns label for a user role */
  getRoleLabel(roleId: UserRoleId): string {
    return this.roleOptions.find(r => r.value === roleId)?.label ?? USER_ROLE_LABELS[roleId] ?? String(roleId);
  }

  /** Returns the initial letter of a name */
  getInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  /**
   * Resolves the UserRole enum value from a UserDto.
   * The API may return role as a numeric enum or roleName in Spanish.
   * This method tries role first, then falls back to mapping roleName.
   * @param user User DTO from the API
   */
  /**
   * Resolves the UserRoleId from a UserDto.
   * The API returns roleId as a numeric enum. Fallback uses roleName.
   * @param user User DTO from the API
   */
  private resolveRoleId(user: UserDto): UserRoleId {
    // Primary: roleId is already a valid numeric enum
    if (user.roleId in UserRoleId) return user.roleId;
    // Fallback: match roleName against label (Spanish)
    const match = this.roleOptions.find(r => r.label === user.roleName);
    return match?.value ?? UserRoleId.Cashier;
  }

  /** Returns whether a branch is assigned to the user being edited */
  isBranchSelected(branchId: number): boolean {
    return this.selectedBranchIds().includes(branchId);
  }

  /**
   * Toggles a branch assignment on the user being edited.
   * If the branch was the default and gets unchecked, the default
   * moves to the first remaining selected branch.
   * @param branchId Branch to toggle
   */
  toggleBranch(branchId: number): void {
    const current = this.selectedBranchIds();
    if (current.includes(branchId)) {
      const next = current.filter(id => id !== branchId);
      this.selectedBranchIds.set(next);
      if (this.defaultBranchId() === branchId) {
        this.defaultBranchId.set(next[0] ?? 0);
      }
    } else {
      const next = [...current, branchId];
      this.selectedBranchIds.set(next);
      if (next.length === 1) {
        this.defaultBranchId.set(branchId);
      }
    }
  }

  /**
   * Sets a branch as the user's default branch.
   * Only allowed when the branch is already assigned.
   * @param branchId Branch to set as default
   */
  setDefaultBranch(branchId: number): void {
    if (this.selectedBranchIds().includes(branchId)) {
      this.defaultBranchId.set(branchId);
    }
  }

  //#endregion
}
