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
import { computed, ref, watch } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { isIosSafariNotInstalled, isStandalone } from '@/services/sync/capabilities';
import { openExternal } from '@/utils/openExternal';
import { MARKETING_URL } from '@/utils/marketing';
import { reportError } from '@/utils/errorReporter';

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

function storageKey(memberId: string): string {
  return `bean-install-nudge-${memberId}`;
}

function loadState(memberId: string): InstallNudgeState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(memberId));
  } catch (err) {
    console.warn('[useInstallNudge] localStorage read failed — using empty state', err);
    return emptyState();
  }
  if (!raw) return emptyState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('[useInstallNudge] localStorage parse failed — resetting', err);
    return emptyState();
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION
  ) {
    const obj = parsed as Record<string, unknown>;
    const status = obj.status;
    return {
      schemaVersion: SCHEMA_VERSION,
      status:
        status === 'dismissed' || status === 'installed' || status === 'pending'
          ? status
          : 'pending',
      shownAt: typeof obj.shownAt === 'number' ? obj.shownAt : null,
    };
  }
  return emptyState();
}

function saveState(memberId: string, next: InstallNudgeState): void {
  try {
    localStorage.setItem(storageKey(memberId), JSON.stringify(next));
  } catch (err) {
    console.warn('[useInstallNudge] localStorage write failed', err);
    reportError({
      surface: 'install-nudge-save',
      message: 'localStorage write failed for install-nudge',
      error: err,
      severity: 'warning',
    });
  }
}

// ── Module singleton state (per member, swapped on member change) ─────────────
const state = ref<InstallNudgeState>(emptyState());
let currentMemberId = '';

export function useInstallNudge() {
  const familyStore = useFamilyStore();

  watch(
    () => familyStore.currentMemberId,
    (id) => {
      if (!id) {
        // Sign-out → clear the module singleton so a prior member's nudge state
        // never leaks into the next session before a new member id arrives.
        currentMemberId = '';
        state.value = emptyState();
        return;
      }
      if (id !== currentMemberId) {
        currentMemberId = id;
        state.value = loadState(id);
      }
    },
    { immediate: true }
  );

  function commit(next: InstallNudgeState): void {
    state.value = next;
    saveState(currentMemberId, next);
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
      if (!currentMemberId) return;
      // Installed since last time → retire the nudge for good.
      if (isStandalone()) {
        if (state.value.status === 'pending') commit({ ...state.value, status: 'installed' });
        return;
      }
      if (state.value.status !== 'pending') return;
      if (!isIosSafariNotInstalled()) return;
      if (state.value.shownAt === null) {
        commit({ ...state.value, shownAt: Date.now() });
        window.plausible?.('install_nudge_shown');
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
