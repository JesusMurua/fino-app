/** Physical zone types within a venue */
export enum ZoneType {
  Salon = 'Salon',
  BarSeats = 'BarSeats',
  Other = 'Other',
}

/** A named zone/area within a branch */
export interface Zone {
  id: number;
  branchId: number;
  name: string;
  type: ZoneType;
  sortOrder: number;
  isActive: boolean;
}

/** Enriched table status — derived from backend displayStatus */
export enum TableStatus {
  Free = 'Free',
  WithOrder = 'WithOrder',
  InKitchen = 'InKitchen',
  Ready = 'Ready',
  WaitingBill = 'WaitingBill',
  Paid = 'Paid',
  Reserved = 'Reserved',
}

/** DTO returned by GET /api/table/status — pre-computed by backend */
export interface TableStatusDto {
  tableId: number;
  tableName: string;
  zoneId?: number;
  zoneName?: string;
  displayStatus: string;
  orderTotalCents?: number;
  guestName?: string;
  reservationTime?: string;
  orderId?: string;
}

/**
 * Maps the backend displayStatus string to the frontend TableStatus enum.
 * Falls back to Free for unknown values.
 */
export function mapDisplayStatus(s: string): TableStatus {
  switch (s) {
    case 'Free':        return TableStatus.Free;
    case 'WithOrder':   return TableStatus.WithOrder;
    case 'InKitchen':   return TableStatus.InKitchen;
    case 'Ready':       return TableStatus.Ready;
    case 'WaitingBill': return TableStatus.WaitingBill;
    case 'Paid':        return TableStatus.Paid;
    case 'Reserved':    return TableStatus.Reserved;
    default:            return TableStatus.Free;
  }
}
