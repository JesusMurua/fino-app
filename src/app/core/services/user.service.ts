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
      this.http.get<UserDto[]>(`${this.baseUrl}/user`)
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
        `${this.baseUrl}/user`,
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

  /**
   * Gets the branch assignments for a user.
   * API returns an array of { branchId, branchName, isDefault }.
   * This method normalizes it into { branchIds, defaultBranchId }.
   * @param userId User to query
   */
  async getUserBranches(userId: number): Promise<{ branchIds: number[]; defaultBranchId: number }> {
    type ApiBranchAssignment = { branchId: number; branchName: string; isDefault: boolean };
    const items = await firstValueFrom(
      this.http.get<ApiBranchAssignment[]>(`${this.baseUrl}/user/${userId}/branches`),
    );
    const branchIds = items.map(b => b.branchId);
    const defaultBranchId = items.find(b => b.isDefault)?.branchId ?? branchIds[0] ?? 0;
    return { branchIds, defaultBranchId };
  }

  /**
   * Assigns branches to a user and sets the default branch.
   * @param userId User to update
   * @param branchIds Array of branch IDs to assign
   * @param defaultBranchId The user's default branch
   */
  async assignBranches(
    userId: number,
    branchIds: number[],
    defaultBranchId: number,
  ): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.baseUrl}/user/${userId}/branches`, {
        branchIds,
        defaultBranchId,
      })
    );
  }

  //#endregion
}
