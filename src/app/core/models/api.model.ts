/**
 * Generic pagination wrapper used by every paginated list endpoint.
 *
 * The shape mirrors the backend's `PageData<T>` contract referenced in
 * `coding-standards.md` §Type Safety. Lives at the api-models layer so
 * any feature module can consume it without crossing domain
 * boundaries (e.g. `PageData<CustomerOrderRowDto>` or future
 * `PageData<EmployeeShift>`).
 */
export interface PageData<T> {
  /** The page slice of records. */
  data: T[];
  /** Total number of rows across all pages. */
  rowsCount: number;
  /** Total number of pages given the requested `pageSize`. */
  totalPages: number;
  /** 1-indexed page number that produced `data`. */
  currentPage: number;
}
