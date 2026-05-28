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
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { changeDoc, docVersion, getDoc, isDocLoaded } from '@/services/automerge/docService';
import { getAllReleaseNotes, getReleaseNote, isSpotlightRelease } from '@/content/release-notes';
import {
  getAllAnnouncements,
  getAnnouncement,
  isAutoOpenAnnouncement,
} from '@/content/announcements';
import { reportError } from '@/utils/errorReporter';
import {
  deriveNotifications,
  markAllReadIn,
  markReadIn,
  markUnreadIn,
  pruneReadState,
  type DeriveInput,
  type NotificationOccurrence,
} from '@/utils/notifications';
import type { AppNotification } from '@/types/notifications';

const WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/** Distinct {year, month} pairs spanning [start, end] inclusive (≤2 for 30 days). */
function distinctMonths(start: Date, end: Date): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    out.push({ year: cur.getFullYear(), month: cur.getMonth() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export const useNotificationsStore = defineStore('notifications', () => {
  const todoStore = useTodoStore();
  const activityStore = useActivityStore();
  const familyStore = useFamilyStore();

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

    const readState = isDocLoaded() ? (getDoc().notificationReads?.[currentMember.id] ?? {}) : {};

    // One pass over the distinct months spanning the window (≤2), over the
    // UNFILTERED activeActivities, so duty-only occurrences survive and we never
    // re-expand the same month per-day (the deriver re-checks the trigger window).
    const end = now.value;
    const start = new Date(end.getTime() - WINDOW_DAYS * MS_PER_DAY);
    const occurrencesByDate: Record<string, NotificationOccurrence[]> = {};
    for (const { year, month } of distinctMonths(start, end)) {
      for (const occ of activityStore.activeActivitiesForMonth(year, month)) {
        (occurrencesByDate[occ.date] ??= []).push(occ);
      }
    }

    return {
      todos: todoStore.todos,
      members: familyStore.members,
      currentMember,
      releaseNotes: getAllReleaseNotes(),
      announcements: getAllAnnouncements(),
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
        return false;
      }) ?? null
  );

  // ── Read-state mutations (the ONLY writers of notificationReads) ────────────
  // The pure reducer computes the target slice (its tested semantics); we then
  // apply the diff PER KEY so concurrent reads on the member's other devices
  // merge cleanly in Automerge (replacing the whole slice object would conflict).
  function applyReducer(
    label: string,
    reduce: (slice: Record<string, string>) => Record<string, string>
  ): void {
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
      changeDoc((doc) => {
        if (!doc.notificationReads) doc.notificationReads = {};
        if (!doc.notificationReads[member.id]) doc.notificationReads[member.id] = {};
        const slice = doc.notificationReads[member.id];
        const next = reduce({ ...slice });
        for (const key of Object.keys(slice)) {
          if (next[key] === undefined) delete slice[key];
        }
        for (const [key, value] of Object.entries(next)) {
          if (slice[key] !== value) slice[key] = value;
        }
      }, `notifications: ${label}`);
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
    applyReducer('markRead', (slice) => markReadIn(slice, id, nowIso()));
  }
  function markUnread(id: string): void {
    applyReducer('markUnread', (slice) => markUnreadIn(slice, id));
  }
  function markAllRead(): void {
    const ids = notifications.value.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    applyReducer('markAllRead', (slice) => markAllReadIn(slice, ids, nowIso()));
  }
  function pruneReads(): void {
    const keep = notifications.value.map((n) => n.id);
    applyReducer('pruneReads', (slice) => pruneReadState(slice, keep));
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
