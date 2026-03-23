import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CreateUserRequest, UpdateUserRequest, UserDto } from '../models';

@Injectable({ providedIn: 'root' })
export class UserService {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  //#region Public Methods

  /**
   * Gets all users for a branch
   */
  async getUsers(branchId: number): Promise<UserDto[]> {
    return firstValueFrom(
      this.http.get<UserDto[]>(`${this.baseUrl}/user?branchId=${branchId}`)
    );
  }

  /**
   * Creates a new user
   */
  async createUser(
    branchId: number,
    request: CreateUserRequest,
  ): Promise<{ id: number }> {
    return firstValueFrom(
      this.http.post<{ id: number }>(
        `${this.baseUrl}/user?branchId=${branchId}`,
        request,
      )
    );
  }

  /**
   * Updates an existing user
   */
  async updateUser(
    id: number,
    request: UpdateUserRequest,
  ): Promise<UserDto> {
    return firstValueFrom(
      this.http.put<UserDto>(`${this.baseUrl}/user/${id}`, request)
    );
  }

  /**
   * Toggles user active status
   */
  async toggleUser(id: number): Promise<boolean> {
    const result = await firstValueFrom(
      this.http.patch<{ isActive: boolean }>(`${this.baseUrl}/user/${id}/toggle`, {})
    );
    return result.isActive;
  }

  //#endregion
}
