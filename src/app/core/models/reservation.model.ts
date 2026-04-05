/** Reservation lifecycle status — PascalCase to match backend enum */
export type ReservationStatus = 'Pending' | 'Confirmed' | 'Seated' | 'Cancelled' | 'NoShow';

/** A table reservation */
export interface Reservation {
  id: number;
  branchId: number;
  tableId: number | null;
  tableName: string | null;
  /** CRM customer linked to this reservation */
  customerId?: number;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  reservationDate: string;
  reservationTime: string;
  durationMinutes: number;
  status: ReservationStatus;
  notes: string | null;
  createdByUserId: number;
  updatedAt: string;
}

/** Payload for creating a reservation */
export interface CreateReservationDto {
  tableId: number | null;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  reservationDate: string;
  reservationTime: string;
  durationMinutes: number;
  notes: string | null;
}

/** Payload for updating a reservation */
export interface UpdateReservationDto {
  tableId: number | null;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  reservationDate: string;
  reservationTime: string;
  durationMinutes: number;
  notes: string | null;
}
