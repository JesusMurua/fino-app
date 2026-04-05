/** A physical table in the restaurant */
export interface RestaurantTable {
  id: number;
  branchId: number;
  name: string;
  capacity?: number;
  zoneId?: number;
  status: 'available' | 'occupied';
  isActive: boolean;
  createdAt: Date;
  /** Populated from TableStatusDto when status !== free */
  orderId?: string;
}

/** Payload for updating table occupancy status */
export interface TableStatusUpdate {
  status: 'available' | 'occupied';
}
