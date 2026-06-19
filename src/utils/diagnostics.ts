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
  localStorage: boolean;
  sessionStorage: boolean;
}

/**
 * Probe a Web Storage area with a real write/read/delete round-trip.
 *
 * `typeof Storage` (or `'localStorage' in window`) is truthy even when access
 * THROWS — iOS Safari with blocked storage / quota exhaustion / certain
 * privacy modes expose the object but throw `SecurityError`/`QuotaExceededError`
 * on use, and even reading the `window.localStorage` *property* can throw. So a
 * behavioral probe is the only reliable signal. The area is therefore accessed
 * via `getArea()` INSIDE the try. Never throws; always cleans up its own key.
 *
 * This is the iPhone-onboarding blocker (2026-06-20): the old typeof-free
 * diagnostics reported `IDB: true / SW: true` and gave no hint that Web Storage
 * was the failing subsystem.
 */
function storageWorks(getArea: () => Storage): boolean {
  if (typeof window === 'undefined') return false;
  const probeKey = '__beanies_storage_probe__';
  try {
    const area = getArea();
    try {
      area.setItem(probeKey, '1');
      return area.getItem(probeKey) === '1';
    } finally {
      try {
        area.removeItem(probeKey);
      } catch {
        /* best-effort cleanup — the read result above is what we report */
      }
    }
  } catch (e) {
    console.warn('[diagnostics] storage probe failed', e);
    return false;
  }
}

export function getDeviceInfo(): DeviceInfo {
  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    wasm: typeof WebAssembly !== 'undefined',
    crypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
    indexedDb: typeof indexedDB !== 'undefined',
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    localStorage: storageWorks(() => window.localStorage),
    sessionStorage: storageWorks(() => window.sessionStorage),
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
    `LS: ${info.localStorage}`,
    `SS: ${info.sessionStorage}`,
  ].join('\n');
}

/**
 * Last `n` chars of a token / id (default 4), for diagnostic correlation
 * without leaking the full secret value. Returns null for null/undefined/
 * empty input. Strings shorter than `n` are returned as-is.
 *
 * Used by the Slack error reporter for `*_tail` context fields, by
 * `useJoinFlow.buildDiagnosticReport` for invite tokens / file IDs, and
 * anywhere we want a stable correlatable suffix without the full value.
 */
export function tail(s: string | null | undefined, n = 4): string | null {
  if (!s) return null;
  return s.length <= n ? s : `…${s.slice(-n)}`;
}
