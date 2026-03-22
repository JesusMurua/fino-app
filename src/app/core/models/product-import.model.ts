/** A row parsed from the Excel import file */
export interface ProductImportRow {
  rowNumber: number;
  name: string;
  price: number;
  categoryName: string;
  isAvailable: boolean;
  isPopular: boolean;
}

/** A validation error for a specific row/field */
export interface ProductImportError {
  rowNumber: number;
  field: string;
  message: string;
}

/** Result of previewing an Excel file before import */
export interface ProductImportPreview {
  validRows: ProductImportRow[];
  errors: ProductImportError[];
  totalRows: number;
  hasErrors: boolean;
}

/** Result of executing a product import */
export interface ProductImportResult {
  importedCount: number;
  skippedCount: number;
  warnings: string[];
}
