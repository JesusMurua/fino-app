import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';

/** Full branch record returned by the API */
export interface Branch {
  id: number;
  name: string;
  locationName: string;
  isMatrix: boolean;
}

/**
 * Manages branch CRUD operations via the backend API.
 *
 * All endpoints require an authenticated Owner token —
 * the API reads the business context from the JWT.
 */
@Injectable({ providedIn: 'root' })
export class BranchService {

  private readonly api = inject(ApiService);

  /**
   * Retrieves all branches for the current business.
   * @returns List of branches
   */
  async getAll(): Promise<Branch[]> {
    return firstValueFrom(
      this.api.get<Branch[]>('/branch'),
    );
  }

  /**
   * Creates a new branch.
   * @param name Display name for the branch
   * @param locationName Physical location description
   * @returns The newly created branch
   */
  async create(name: string, locationName: string): Promise<Branch> {
    return firstValueFrom(
      this.api.post<Branch>('/branch', { name, locationName }),
    );
  }

  /**
   * Updates an existing branch.
   * @param id Branch ID to update
   * @param name Updated display name
   * @param locationName Updated physical location
   * @returns The updated branch
   */
  async update(id: number, name: string, locationName: string): Promise<Branch> {
    return firstValueFrom(
      this.api.put<Branch>(`/branch/${id}`, { name, locationName }),
    );
  }

  /**
   * Copies the full catalog (categories + products) from a source branch.
   * @param targetBranchId Branch to copy the catalog into
   * @param sourceBranchId Branch to copy the catalog from (typically the matrix)
   */
  async copyCatalog(targetBranchId: number, sourceBranchId: number): Promise<void> {
    await firstValueFrom(
      this.api.post(`/branch/${targetBranchId}/copy-catalog`, { sourceBranchId }),
    );
  }
}
