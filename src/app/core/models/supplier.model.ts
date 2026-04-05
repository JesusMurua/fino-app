/** A supplier/vendor that provides inventory items */
export interface Supplier {
  id: number;
  branchId: number;
  name: string;
  contactName?: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Request body for creating a new supplier */
export interface CreateSupplierRequest {
  name: string;
  contactName?: string;
  phone?: string;
  notes?: string;
}

/** Request body for updating an existing supplier */
export interface UpdateSupplierRequest extends CreateSupplierRequest {
  isActive: boolean;
}
