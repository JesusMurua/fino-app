import { UserRole } from './auth.model';

/** User data returned by the API */
export interface UserDto {
  id: number;
  name: string;
  email?: string;
  role: UserRole;
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
  role: UserRole;
  branchId?: number;
  pin?: string;
  email?: string;
  password?: string;
}

/** Payload for updating an existing user */
export interface UpdateUserRequest {
  name: string;
  role: UserRole;
  isActive: boolean;
  pin?: string;
  password?: string;
}
