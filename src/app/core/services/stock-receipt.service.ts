import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CreateStockReceiptRequest, StockReceipt } from '../models';

@Injectable({ providedIn: 'root' })
export class StockReceiptService {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/stock-receipt`;

  /**
   * Fetches stock receipts with optional filters
   * @param supplierId Filter by supplier
   * @param from ISO date string — start of range
   * @param to ISO date string — end of range
   */
  getAll(supplierId?: number, from?: string, to?: string): Observable<StockReceipt[]> {
    let params = new HttpParams();
    if (supplierId) params = params.set('supplierId', supplierId);
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<StockReceipt[]>(this.baseUrl, { params });
  }

  /** Fetches a single stock receipt with its items */
  getById(id: number): Observable<StockReceipt> {
    return this.http.get<StockReceipt>(`${this.baseUrl}/${id}`);
  }

  /** Creates a new stock receipt */
  create(data: CreateStockReceiptRequest): Observable<StockReceipt> {
    return this.http.post<StockReceipt>(this.baseUrl, data);
  }
}
