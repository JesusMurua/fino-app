/**
 * Broadcast payload for `OnWeightUpdated` event emitted by `BridgeHub`.
 *
 * Sent to clients in the `bridge-branch-{branchId}` group whenever a scale
 * physically connected to a POS device produces a stable reading. The
 * `deviceUuid` discriminates between scales when a branch has multiple POS
 * terminals — consumers MUST filter by their own device UUID to avoid
 * cross-talk.
 */
export interface WeightPayloadDto {
  /** UUID of the POS device whose scale produced the reading. */
  deviceUuid: string;

  /**
   * Raw bytes from the scale protocol as ASCII string.
   * Common protocols:
   *   - Toledo: `'P+ 02.345  '` (12 bytes, kg, fixed width)
   *   - Epson/Star: `'ST,GS,+00.500kg\r\n'` (16 bytes, kg, terminated)
   *   - ASCII Generic: `'0.500'` (variable length, unit implicit kg)
   * Consumer must parse to a `number` and validate.
   */
  rawWeightData: string;
}
