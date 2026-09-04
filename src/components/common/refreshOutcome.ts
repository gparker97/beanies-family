/**
 * View-side presentation for a manual "Refresh All Data" outcome. The store owns
 * classification + telemetry (it returns a `RefreshOutcome` and logs it); this
 * pure function maps that outcome to what the header shows — kept pure so it is
 * unit-testable without mounting AppHeader.
 *
 * Failure toasts for network/decrypt are owned by the globally-mounted
 * `BackgroundSyncBar` (it toasts on any non-auth `backgroundSyncError`), so this
 * only drives the success toast + the immediate reconnect surface for auth. That
 * avoids the double-toast + competing-reconnect-surface problems of duplicating
 * that machinery here.
 */
import type { RefreshOutcome } from '@/stores/syncStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

export type RefreshPresentation = {
  /** Toast to show, if any. */
  toast?: { type: 'success' | 'warning'; key: UIStringKey };
};

export function presentRefreshOutcome(outcome: RefreshOutcome): RefreshPresentation {
  switch (outcome) {
    case 'refreshed':
      return { toast: { type: 'success', key: 'header.refreshSuccess' } };
    // Auth: BackgroundSyncBar is deliberately silent on `auth-transient`, so the
    // tap would otherwise give nothing. Say what happened — but WITHOUT an action
    // button and WITHOUT raising the banner: the store's escalation owns that
    // surface, and pre-empting it trips its `showGoogleReconnect` guard and
    // silently suppresses the critical page.
    case 'auth-failed':
      return { toast: { type: 'warning', key: 'header.refreshAuthFailed' } };
    // The pod cannot be opened on this device, so the refresh was skipped
    // before any work. `BackgroundSyncBar` does NOT toast for it (nothing set
    // `backgroundSyncError` on this pass), so a silent no-op would leave the
    // user tapping Refresh and getting nothing at all.
    case 'skipped-unopenable':
      return { toast: { type: 'warning', key: 'header.refreshUnopenable' } };
    // network/decrypt      → BackgroundSyncBar already toasts.
    // skipped-in-flight    → a sync is running; never report a false "refreshed".
    case 'network-failed':
    case 'decrypt-failed':
    case 'skipped-in-flight':
      return {};
  }
}
