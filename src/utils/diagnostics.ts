/**
 * Shared device diagnostics. Two consumers today:
 * - `App.vue` — renders `formatDeviceInfo()` in the init-error fallback.
 * - `useJoinFlow` — embeds `getDeviceInfo()` in the diagnostic JSON blob
 *   that users can copy and paste back to support.
 *
 * Keep `getDeviceInfo()` returning structured data (for programmatic use
 * in JSON blobs), and `formatDeviceInfo()` for human-readable display.
 * Both are SSR-safe — they tolerate missing `navigator`, `crypto`, etc.
 */

export interface DeviceInfo {
  userAgent: string;
  wasm: boolean;
  crypto: boolean;
  indexedDb: boolean;
  serviceWorker: boolean;
}

export function getDeviceInfo(): DeviceInfo {
  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    wasm: typeof WebAssembly !== 'undefined',
    crypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
    indexedDb: typeof indexedDB !== 'undefined',
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  };
}

/**
 * Human-readable, line-broken summary. Existing `App.vue` init-error
 * fallback consumes this.
 */
export function formatDeviceInfo(info: DeviceInfo = getDeviceInfo()): string {
  return [
    `UA: ${info.userAgent}`,
    `WASM: ${info.wasm}`,
    `Crypto: ${info.crypto}`,
    `IDB: ${info.indexedDb}`,
    `SW: ${info.serviceWorker}`,
  ].join('\n');
}
