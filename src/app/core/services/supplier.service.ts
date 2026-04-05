import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CreateSupplierRequest, Supplier, UpdateSupplierRequest } from '../models';

@Injectable({ providedIn: 'root' })
export class SupplierService {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/supplier`;

  /** Fetches all suppliers for the current branch */
  getAll(): Observable<Supplier[]> {
    return this.http.get<Supplier[]>(this.baseUrl);
  }

  /** Fetches a single supplier by ID */
  getById(id: number): Observable<Supplier> {
    return this.http.get<Supplier>(`${this.baseUrl}/${id}`);
  }

  /** Creates a new supplier */
  create(data: CreateSupplierRequest): Observable<Supplier> {
    return this.http.post<Supplier>(this.baseUrl, data);
  }

  /** Updates an existing supplier */
  update(id: number, data: UpdateSupplierRequest): Observable<Supplier> {
    return this.http.put<Supplier>(`${this.baseUrl}/${id}`, data);
  }

  /** Deletes a supplier by ID */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
