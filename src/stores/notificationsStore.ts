/**
 * In-app notifications orchestrator (MVO).
 *
 * Sole owner of: the reactive derive-clock `now` (advanced ONLY by `tick()`,
 * called only by the poll in `useNotifications`), the drawer state machine, and
 * all writes to `FamilyDocument.notificationReads`. Notifications themselves are
 * derived (pure `deriveNotifications`) — nothing is stored but read-state.
 *
 * `snapshot` is pure assembly (gathers data + a single month-bucketed occurrence
 * pass over the UNFILTERED `activeActivities`); `notifications` is the lone
 * guarded derive. Splitting them keeps each single-responsibility + testable.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { claimInterruption } from '@/composables/useSessionInterruption';
import { useTodoStore } from '@/stores/todoStore';
import { useListStore } from '@/stores/listStore';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBeanTips } from '@/composables/useBeanTips';
import { useCommunityNudge } from '@/composables/useCommunityNudge';
import { useInstallNudge } from '@/composables/useInstallNudge';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import { getById as projectionGetById } from '@/services/automerge/projection';
import { mutate } from '@/services/automerge/worker/docClient';
import { getAllReleaseNotes, getReleaseNote, isSpotlightRelease } from '@/content/release-notes';
import {
  getAllAnnouncements,
  getAnnouncement,
  isAutoOpenAnnouncement,
} from '@/content/announcements';
import { TIPS_BY_ID } from '@/content/tips';
import { isFlagEnabled } from '@/config/flags';
import { reportError } from '@/utils/errorReporter';
import {
  deriveNotifications,
  markAllReadIn,
  markReadIn,
  markUnreadIn,
  pruneReadState,
  type DeriveInput,
} from '@/utils/notifications';
import type { AppNotification } from '@/types/notifications';
import { assembleOccurrencesByDate } from '@/utils/occurrenceAssembly';

const WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export const useNotificationsStore = defineStore('notifications', () => {
  const todoStore = useTodoStore();
  const listStore = useListStore();
  const activityStore = useActivityStore();
  const familyStore = useFamilyStore();
  const settingsStore = useSettingsStore();
  const calendarSyncStore = useCalendarSyncStore();
  // Bound ONCE at store-setup scope (mirrors the other store bindings above);
  // the snapshot reads `issuedTips.value` on each recompute — no re-instantiation.
  const beanTips = useBeanTips();
  const communityNudge = useCommunityNudge();
  const installNudge = useInstallNudge();

  // ── Derive-clock — advanced ONLY by tick() (the poll). Nothing else writes it.
  const now = ref<Date>(new Date());
  function tick(): void {
    now.value = new Date();
  }

  // ── Drawer state (mutated ONLY by the actions below) ────────────────────────
  const isOpen = ref(false);
  const view = ref<'list' | 'detail'>('list');
  const selectedId = ref<string | null>(null);
  let autoOpenedThisSession = false;

  // ── snapshot: pure assembly (reactive to data, docVersion, now) ─────────────
  const snapshot = computed<DeriveInput | null>(() => {
    void docVersion.value; // re-derive after read-state mutations (raw changeDoc)
    const currentMember = familyStore.currentMember;
    if (!currentMember) return null;

    const readState = isDocLoaded()
      ? ((projectionGetById('notificationReads', currentMember.id) ?? {}) as Record<string, string>)
      : {};

    // One pass over the distinct months spanning the window (≤2), over the
    // UNFILTERED activeActivities, so duty-only occurrences survive and we never
    // re-expand the same month per-day (the deriver re-checks the trigger window).
    // Shared assembly with the OS forward scheduler (occurrenceAssembly.ts).
    const end = now.value;
    const start = new Date(end.getTime() - WINDOW_DAYS * MS_PER_DAY);
    const occurrencesByDate = assembleOccurrencesByDate(
      activityStore.activeActivitiesForMonth,
      start,
      end
    );

    return {
      todos: todoStore.todos,
      // Makes the Settings → Reminders to-do lead real on every platform (it
      // used to be a hardcoded 30 that no control could change).
      todoLeadMinutes: settingsStore.todoReminderLead,
      activityLeadDefault: settingsStore.activityReminderLead,
      // Gate the list-completed notification on the same flag as the rest of
      // Beanie Lists. `loadLists()` runs ungated in the central load, so a
      // flag-OFF device can hold synced lists; feeding [] keeps the pure deriver
      // from emitting a bell that would dead-end at the flag-blocked /lists route.
      lists: isFlagEnabled('familyLists') ? listStore.lists : [],
      members: familyStore.members,
      currentMember,
      releaseNotes: getAllReleaseNotes(),
      announcements: getAllAnnouncements(),
      issuedTips: beanTips.issuedTips.value,
      tipsById: TIPS_BY_ID,
      activeNudge: communityNudge.activeNudge.value,
      installNudge: installNudge.nudge.value,
      // Minimal projection for the calendar-reconnect bell entry (deriver only
      // reads id/email/status/timestamps). Empty until a calendar is connected.
      calendarConnections: calendarSyncStore.connections.map((c) => ({
        id: c.id,
        accountEmail: c.accountEmail,
        status: c.status,
        lastReconciledAt: c.lastReconciledAt,
        updatedAt: c.updatedAt,
      })),
      readState,
      windowDays: WINDOW_DAYS,
      occurrencesByDate,
    };
  });

  // ── notifications: the single guarded derive ────────────────────────────────
  const notifications = computed<AppNotification[]>(() => {
    const snap = snapshot.value;
    if (!snap) return [];
    try {
      return deriveNotifications(snap, now.value);
    } catch (err) {
      reportError({
        surface: 'notifications-derive',
        message: 'deriveNotifications threw — bell suppressed for this tick',
        error: err,
        severity: 'error',
      });
      return [];
    }
  });

  const unreadCount = computed(() => notifications.value.reduce((n, x) => n + (x.read ? 0 : 1), 0));
  const hasUnread = computed(() => unreadCount.value > 0);
  const selected = computed(
    () => notifications.value.find((n) => n.id === selectedId.value) ?? null
  );
  // Auto-open the newest unread item that opts in: a SPOTLIGHT (significant)
  // what's-new release OR an auto-open announcement. Minor per-deploy notes
  // ("fixes & improvements") just badge the bell — they don't interrupt.
  // Notifications sort newest-first, so a fresh announcement outranks an older
  // release.
  const latestUnseenAutoOpen = computed(
    () =>
      notifications.value.find((n) => {
        if (n.read || !n.sourceId) return false;
        if (n.kind === 'whats-new') {
          const rel = getReleaseNote(n.sourceId);
          return rel ? isSpotlightRelease(rel) : false;
        }
        if (n.kind === 'announcement') {
          const ann = getAnnouncement(n.sourceId);
          return ann ? isAutoOpenAnnouncement(ann) : false;
        }
        // Community nudge: no content-registry lookup needed — the auto-open
        // policy was already decided at issuance (decideIssue) and the deriver
        // projects the active nudge 1:1, so any unread nudge is one we chose to
        // surface. The session latch + openTo→markRead make it open at most once.
        if (n.kind === 'communityNudge') return true;
        return false;
      }) ?? null
  );

  // ── Read-state mutations (the ONLY writers of notificationReads) ────────────
  // The pure reducer computes the target slice (its tested semantics); we then
  // apply the diff PER KEY so concurrent reads on the member's other devices
  // merge cleanly in Automerge (replacing the whole slice object would conflict).
  async function applyReducer(
    label: string,
    reduce: (slice: Record<string, string>) => Record<string, string>
  ): Promise<void> {
    const member = familyStore.currentMember;
    if (!isDocLoaded() || !member) {
      reportError({
        surface: `notifications-${label}`,
        message: `${label}: no loaded doc or current member — read-state unchanged`,
        severity: 'warning',
      });
      return;
    }
    try {
      // Compute the per-key diff on main from the projected slice, then patch the
      // member sub-map (createIfMissing) — applying per key (not replacing the
      // whole slice) keeps concurrent reads on other devices merging cleanly.
      const slice = (projectionGetById('notificationReads', member.id) ?? {}) as Record<
        string,
        string
      >;
      const next = reduce({ ...slice });
      const patch: Record<string, unknown> = {};
      const deleteKeys: string[] = [];
      for (const key of Object.keys(slice)) if (next[key] === undefined) deleteKeys.push(key);
      for (const [key, value] of Object.entries(next)) if (slice[key] !== value) patch[key] = value;
      if (Object.keys(patch).length === 0 && deleteKeys.length === 0) return; // no-op
      await mutate(
        {
          op: 'patch',
          collection: 'notificationReads',
          id: member.id,
          patch,
          deleteKeys,
          onMissing: 'create',
        },
        { quiet: true }
      );
    } catch (err) {
      reportError({
        surface: `notifications-${label}`,
        message: `${label} failed to write read-state`,
        error: err,
        severity: 'error',
      });
    }
  }

  const nowIso = (): string => new Date().toISOString();

  function markRead(id: string): void {
    void applyReducer('markRead', (slice) => markReadIn(slice, id, nowIso()));
  }
  function markUnread(id: string): void {
    void applyReducer('markUnread', (slice) => markUnreadIn(slice, id));
  }
  function markAllRead(): void {
    const ids = notifications.value.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    void applyReducer('markAllRead', (slice) => markAllReadIn(slice, ids, nowIso()));
  }
  function pruneReads(): void {
    const keep = notifications.value.map((n) => n.id);
    void applyReducer('pruneReads', (slice) => pruneReadState(slice, keep));
  }

  // ── Drawer actions (the only mutators of isOpen/view/selectedId) ────────────
  function open(): void {
    view.value = 'list';
    selectedId.value = null;
    isOpen.value = true;
  }
  function close(): void {
    isOpen.value = false;
    view.value = 'list';
    selectedId.value = null;
  }
  function openTo(id: string): void {
    selectedId.value = id;
    view.value = 'detail';
    isOpen.value = true;
    markRead(id);
  }
  /** Platform-back / Escape: pop detail→list, else close. */
  function back(): void {
    if (view.value === 'detail') {
      view.value = 'list';
      selectedId.value = null;
    } else {
      close();
    }
  }
  /**
   * Login auto-open — idempotent via the session latch; no-op unless there's an
   * unseen auto-open item (a spotlight release or an auto-open announcement).
   */
  function openToLatestAutoOpen(): void {
    if (autoOpenedThisSession) return;
    const latest = latestUnseenAutoOpen.value;
    if (!latest) return;
    // #45: one auto-interruption per session — claim only once we know there IS
    // something to show. If another surface won this load, yield: leave the item
    // unread in the bell (no latch, no markRead) so nothing is lost.
    if (!claimInterruption('notifications')) return;
    autoOpenedThisSession = true;
    openTo(latest.id);
  }

  return {
    now,
    tick,
    isOpen,
    view,
    selectedId,
    selected,
    notifications,
    unreadCount,
    hasUnread,
    latestUnseenAutoOpen,
    markRead,
    markUnread,
    markAllRead,
    pruneReads,
    open,
    close,
    openTo,
    back,
    openToLatestAutoOpen,
  };
});
