import { UserRoleId } from '../enums';

/** User data returned by the API */
export interface UserDto {
  id: number;
  name: string;
  email?: string;
  /** Numeric role FK — use UserRoleId enum */
  roleId: UserRoleId;
  roleName: string;
  branchId?: number;
  isActive: boolean;
  hasPin: boolean;
  hasEmail: boolean;
  createdAt: Date;
}

/** Payload for creating a new user */
export interface CreateUserRequest {
  name: string;
  /** Numeric role FK — use UserRoleId enum */
  roleId: UserRoleId;
  branchId?: number;
  pin?: string;
  email?: string;
  password?: string;
}

/** Payload for updating an existing user */
export interface UpdateUserRequest {
  name: string;
  /** Numeric role FK — use UserRoleId enum */
  roleId: UserRoleId;
  isActive: boolean;
  pin?: string;
  password?: string;
}
