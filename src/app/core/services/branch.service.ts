import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';

/** Full branch record returned by the API */
import { BranchDeliveryConfig } from '../models/branch-delivery-config.model';

export interface Branch {
  id: number;
  name: string;
  locationName: string;
  /** Full street address — distinct from `locationName` (a short zone/area label) */
  address?: string;
  /** Contact phone for the branch */
  phone?: string;
  isMatrix: boolean;
  hasKitchen?: boolean;
  hasTables?: boolean;
  hasDelivery?: boolean;
  deliveryConfigs?: BranchDeliveryConfig[];
}

/** Mutable fields accepted by POST /branch and PUT /branch/:id */
export interface BranchPayload {
  name: string;
  locationName: string;
  address?: string;
  phone?: string;
  hasKitchen?: boolean;
  hasTables?: boolean;
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
   * @param payload Branch fields to create
   * @returns The newly created branch
   */
  async create(payload: BranchPayload): Promise<Branch> {
    return firstValueFrom(
      this.api.post<Branch>('/branch', payload),
    );
  }

  /**
   * Updates an existing branch.
   * @param id Branch ID to update
   * @param payload Branch fields to overwrite
   * @returns The updated branch
   */
  async update(id: number, payload: BranchPayload): Promise<Branch> {
    return firstValueFrom(
      this.api.put<Branch>(`/branch/${id}`, payload),
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
