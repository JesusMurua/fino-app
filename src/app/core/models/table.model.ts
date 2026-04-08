import { TableStatus } from '../enums';

/** A physical table in the restaurant */
export interface RestaurantTable {
  id: number;
  branchId: number;
  name: string;
  capacity?: number;
  zoneId?: number;
  /** 1=Available, 2=Occupied, 3=Reserved, 4=Maintenance */
  tableStatusId: TableStatus;
  isActive: boolean;
  createdAt: Date;
  /** Populated from TableStatusDto when status !== free */
  orderId?: string;
}

/** Payload for updating table occupancy status */
export interface TableStatusUpdate {
  tableStatusId: TableStatus;
}
