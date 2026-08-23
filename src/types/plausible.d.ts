/**
 * Plausible analytics — the script defines a global queue stub shaped as
 * a callable plus `q` and `init` properties, used by both the real script
 * and our pre-load shim in `src/services/analytics/plausible.ts`.
 */
interface PlausibleQueue {
  /**
   * `interactive: false` marks an event as NON-interactive, so it does not
   * count as engagement for bounce rate. Use it for anything the app fires by
   * itself (telemetry, auto-shown nudges) — otherwise a passive event makes
   * every session look engaged and collapses bounce rate toward 0%.
   */
  (event: string, options?: { props?: Record<string, string>; interactive?: boolean }): void;
  q?: unknown[];
  init?: (i: object) => void;
  o?: object;
}

interface Window {
  plausible?: PlausibleQueue;
}
