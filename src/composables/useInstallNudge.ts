/**
 * One-time "install the app" nudge for iOS Safari users who haven't added
 * beanies to their home screen. Installed (standalone) PWAs are exempt from
 * iOS Safari's ITP storage eviction, which is the dominant cause of "I keep
 * getting asked to reconnect to Google Drive" on iPhone — so installing is the
 * real fix and this nudge points the user at it.
 *
 * Deliberately ONE-TIME (no cadence/cap/rotation, unlike `useCommunityNudge`):
 * it shows once in the bell and, after any action, never returns. Mirrors the
 * community-nudge per-member-localStorage I/O idiom; the gate is a single line.
 *
 * State (per member, per device):
 *   - status:  'pending' (show) | 'dismissed' (Not now / Show me how) | 'installed'
 *   - shownAt: epoch ms of first surfacing — stable `occurredAt` for the row
 */
import { computed } from 'vue';
import { isIosSafariNotInstalled, isStandalone } from '@/services/sync/capabilities';
import { openExternal } from '@/utils/openExternal';
import { MARKETING_URL } from '@/utils/marketing';
import { reportError } from '@/utils/errorReporter';
import { createPerMemberStore } from '@/composables/perMemberStore';

type InstallNudgeStatus = 'pending' | 'dismissed' | 'installed';

interface InstallNudgeState {
  schemaVersion: 1;
  status: InstallNudgeStatus;
  shownAt: number | null;
}

const SCHEMA_VERSION = 1 as const;
const HELP_URL = `${MARKETING_URL}/help/getting-started/install-as-app`;

function emptyState(): InstallNudgeState {
  return { schemaVersion: SCHEMA_VERSION, status: 'pending', shownAt: null };
}

// ── Module singleton store (per member, swapped on member change) ─────────────
const store = createPerMemberStore<InstallNudgeState>({
  prefix: 'bean-install-nudge',
  label: 'useInstallNudge',
  saveSurface: 'install-nudge-save',
  saveMessage: 'localStorage write failed for install-nudge',
  empty: emptyState,
  clearOnSignOut: true,
  fromParsed: (parsed) => {
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION
    ) {
      const obj = parsed as Record<string, unknown>;
      const status = obj.status;
      return {
        state: {
          schemaVersion: SCHEMA_VERSION,
          status:
            status === 'dismissed' || status === 'installed' || status === 'pending'
              ? status
              : 'pending',
          shownAt: typeof obj.shownAt === 'number' ? obj.shownAt : null,
        },
      };
    }
    return { state: emptyState() };
  },
});

const state = store.state;

export function useInstallNudge() {
  store.useMemberSync();

  function commit(next: InstallNudgeState): void {
    state.value = next;
    store.save(next);
  }

  /**
   * The active nudge projection consumed by the notifications deriver: non-null
   * only when status is 'pending', we're on iOS Safari (not installed), and it
   * has been surfaced (shownAt set by `ensureNudgeIssued`).
   */
  const nudge = computed<{ shownAt: number } | null>(() => {
    if (state.value.status !== 'pending') return null;
    if (state.value.shownAt === null) return null;
    if (!isIosSafariNotInstalled()) return null;
    return { shownAt: state.value.shownAt };
  });

  /**
   * Self-cancel + first-surface. Called by `useNotifications` on session-ready +
   * day-roll (the same seam the community nudge uses). Wrapped so a fault can
   * never break the notifications daemon.
   */
  function ensureNudgeIssued(): void {
    try {
      if (!store.memberId()) return;
      // Installed since last time → retire the nudge for good.
      if (isStandalone()) {
        if (state.value.status === 'pending') commit({ ...state.value, status: 'installed' });
        return;
      }
      if (state.value.status !== 'pending') return;
      if (!isIosSafariNotInstalled()) return;
      if (state.value.shownAt === null) {
        commit({ ...state.value, shownAt: Date.now() });
        // Shown by us, not clicked by them — see plausible.d.ts.
        window.plausible?.('install_nudge_shown', { interactive: false });
      }
    } catch (err) {
      reportError({
        surface: 'install-nudge-issuance',
        message: 'install-nudge ensureNudgeIssued threw',
        error: err,
        severity: 'error',
      });
    }
  }

  /** "Show me how" — open the install guide and retire the nudge (info delivered). */
  function showHow(): void {
    openExternal(HELP_URL);
    commit({ ...state.value, status: 'dismissed' });
    window.plausible?.('install_nudge_dismissed', { props: { action: 'show_how' } });
  }

  /** "Not now" — retire the nudge (one-time). */
  function dismiss(): void {
    commit({ ...state.value, status: 'dismissed' });
    window.plausible?.('install_nudge_dismissed', { props: { action: 'not_now' } });
  }

  /** "Already installed" — retire the nudge. */
  function markInstalled(): void {
    commit({ ...state.value, status: 'installed' });
    window.plausible?.('install_nudge_dismissed', { props: { action: 'already_installed' } });
  }

  return { nudge, ensureNudgeIssued, showHow, dismiss, markInstalled };
}
