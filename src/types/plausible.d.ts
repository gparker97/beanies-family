/**
 * Plausible analytics — the script defines a global queue stub shaped as
 * a callable plus `q` and `init` properties, used by both the real script
 * and our pre-load shim in `src/services/analytics/plausible.ts`.
 */
interface PlausibleQueue {
  (event: string, options?: { props?: Record<string, string> }): void;
  q?: unknown[];
  init?: (i: object) => void;
  o?: object;
}

interface Window {
  plausible?: PlausibleQueue;
}
