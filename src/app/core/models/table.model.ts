/** A physical table in the restaurant */
export interface RestaurantTable {
  id: number;
  branchId: number;
  name: string;
  capacity?: number;
  status: 'available' | 'occupied';
  isActive: boolean;
  createdAt: Date;
}

/** Payload for updating table occupancy status */
export interface TableStatusUpdate {
  status: 'available' | 'occupied';
}
