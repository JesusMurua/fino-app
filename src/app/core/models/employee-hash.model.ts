import { UserRoleId } from '../enums';

/**
 * A locally-cached credential record for offline PIN authentication.
 * Stored in Dexie and synced from the backend when online.
 *
 * The pinHash is a hex-encoded SHA-256 digest of the 4-digit PIN.
 * PINs are NEVER stored in plaintext.
 */
export interface EmployeeHash {
  /** Backend user ID */
  userId: number;
  /** Branch this credential belongs to */
  branchId: number;
  /** Employee display name */
  name: string;
  /** Numeric role FK — use UserRoleId enum */
  roleId: UserRoleId;
  /** SHA-256 hex digest of the 4-digit PIN */
  pinHash: string;
}

/**
 * Computes the SHA-256 hex digest of a plaintext string.
 * Uses the Web Crypto API (available in all modern browsers and Service Workers).
 * @param plain The plaintext to hash (e.g. a 4-digit PIN)
 * @returns Lowercase hex string of the SHA-256 digest
 */
export async function sha256Hex(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
