import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  ProductImportPreview,
  ProductImportResult,
  ProductImportRow,
} from '../models/product-import.model';

@Injectable({ providedIn: 'root' })
export class ProductImportService {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  //#region Public Methods

  /**
   * Downloads Excel template and triggers browser download
   */
  async downloadTemplate(): Promise<void> {
    const blob = await firstValueFrom(
      this.http.get(`${this.baseUrl}/products/import/template`, {
        responseType: 'blob',
      })
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-productos.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Sends Excel file to API for preview validation
   * @param file Excel file selected by user
   * @param branchId Branch to import to
   */
  async previewImport(
    file: File,
    branchId: number,
  ): Promise<ProductImportPreview> {
    const formData = new FormData();
    formData.append('file', file);

    return firstValueFrom(
      this.http.post<ProductImportPreview>(
        `${this.baseUrl}/products/import/preview`,
        formData,
      )
    );
  }

  /**
   * Executes import with validated rows
   * @param rows Validated rows from preview
   * @param branchId Branch to import to
   */
  async executeImport(
    rows: ProductImportRow[],
    branchId: number,
  ): Promise<ProductImportResult> {
    return firstValueFrom(
      this.http.post<ProductImportResult>(
        `${this.baseUrl}/products/import/execute`,
        rows,
      )
    );
  }

  //#endregion
}
