/**
 * Device-level configuration stored in localStorage.
 * Each physical device (tablet, POS terminal, kiosk screen) keeps its own
 * copy — changes here never affect other devices.
 *
 * Operating modes:
 *   counter — Counter service with order number display (fondas, taquerías)
 *   cashier — Quick cashier mode, no table selection
 *   kiosk   — Self-service touch screen; customer places their own order
 *   tables  — Table management with table selection
 *   waiter  — Waiter mode with table assignment
 *   kitchen — Kitchen display mode
 */
export interface DeviceConfig {
  mode: 'counter' | 'cashier' | 'kiosk' | 'tables' | 'waiter' | 'kitchen';
  /** Human-readable name for this device, e.g. "Caja 1" or "Kiosko Entrada" */
  deviceName: string;
}

/** localStorage key used to persist DeviceConfig */
export const DEVICE_CONFIG_KEY = 'pos-device-config';

/** Default device config applied on first launch */
export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  mode:       'counter',
  deviceName: 'Dispositivo principal',
};
