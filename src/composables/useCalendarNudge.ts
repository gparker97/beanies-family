/**
 * One-time "connect Google Calendar" nudge shown on the activities page to
 * members who haven't linked a calendar yet. Now that Google Calendar sync is an
 * official feature (2026-07-03), this gently points people at it.
 *
 * Deliberately ONE-TIME (mirrors `useInstallNudge`): dismiss it and it never
 * returns; connecting a calendar retires it for everyone via the family-wide
 * `connections` gate. Reuses the shared per-member localStorage spine
 * (`createPerMemberStore`) — no hand-rolled storage.
 *
 * State (per member, per device): status 'pending' (show) | 'dismissed'.
 */
import { computed } from 'vue';
import { isFlagEnabled } from '@/config/flags';
import { isDocLoaded } from '@/services/automerge/docService';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { createPerMemberStore } from '@/composables/perMemberStore';

type CalendarNudgeStatus = 'pending' | 'dismissed';

interface CalendarNudgeState {
  schemaVersion: 1;
  status: CalendarNudgeStatus;
}

const SCHEMA_VERSION = 1 as const;

function emptyState(): CalendarNudgeState {
  return { schemaVersion: SCHEMA_VERSION, status: 'pending' };
}

const store = createPerMemberStore<CalendarNudgeState>({
  prefix: 'bean-calendar-nudge',
  label: 'useCalendarNudge',
  saveSurface: 'calendar-nudge-save',
  saveMessage: 'localStorage write failed for calendar-nudge',
  empty: emptyState,
  clearOnSignOut: true,
  fromParsed: (parsed) => {
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION
    ) {
      const status = (parsed as Record<string, unknown>).status;
      return {
        state: {
          schemaVersion: SCHEMA_VERSION,
          status: status === 'dismissed' ? 'dismissed' : 'pending',
        },
      };
    }
    return { state: emptyState() };
  },
});

const state = store.state;

export function useCalendarNudge() {
  store.useMemberSync();
  const syncStore = useCalendarSyncStore();

  /**
   * Show only when: the doc has loaded (avoids a cold-load flash for an
   * already-connected family, since `connections` is [] while unloaded), the
   * calendar feature is on (kill-switch), no calendar is connected yet, and it
   * hasn't been dismissed.
   */
  const showNudge = computed(
    () =>
      isDocLoaded() &&
      isFlagEnabled('googleCalendarSync') &&
      syncStore.connections.length === 0 &&
      state.value.status === 'pending'
  );

  /**
   * Retire the nudge (one-time). The status flips in memory immediately so the
   * banner hides regardless of the write; a localStorage failure is already
   * console.warn'd + reportError'd (warning) inside the store, and the only
   * consequence is the nudge returning after a reload — self-correcting and
   * non-destructive, so no rollback or toast is warranted.
   */
  function dismiss(): void {
    const next: CalendarNudgeState = { ...state.value, status: 'dismissed' };
    state.value = next;
    store.save(next);
  }

  return { showNudge, dismiss };
}
