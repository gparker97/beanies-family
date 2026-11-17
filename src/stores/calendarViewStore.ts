// View-only external calendars orchestrator (plan 2026-11-17, A4). READ-ONLY.
//
// MVO Orchestrator: the family's viewed calendars (doc collections
// `calendarViewAccounts` + `viewedCalendars`) -> CalendarClient (Google REST) ->
// an in-memory event cache the calendar surfaces read. Small on purpose: fetch,
// cache and CRUD. The pure half (normalization, window maths, error -> state,
// default color, dedupe) lives in `utils/calendar/externalEvents.ts`.
//
// Contract:
//  - Inert unless `isFlagEnabled('viewOnlyCalendars')`: no projection reads, no
//    timers, no Google reads, no doc writes. It IS instantiated with the flag off
//    (search, day extras, the widget snapshot, the briefing and the clash store read
//    it), and then every projection is empty and `isActive` is false.
//  - Events live ONLY in memory on this device. Never written to the family file,
//    never pushed to any calendar, never logged. Titles and locations of a busy-only
//    calendar are stripped in `normalizeViewEvents` BEFORE they enter the cache, by
//    the calendar's setting at COMMIT time, and stripped again by its CURRENT
//    setting in the `events` selector, which every output derives from.
//  - Beanies-origin events (pushed, adopted, imported) are dropped when a read
//    commits AND again in the `events` selector, against the id set of the
//    activities and event links as they are NOW (`beaniesIds`, recomputed only when
//    one of those two collections changes), so an event that becomes beanies-origin
//    after its read never shows twice.
//  - Exactly two fetch windows per viewed calendar: `standing` (yesterday to +35
//    days, for surfaces with no on-screen period) and `screen` (set by one page host
//    through `useExternalEvents().setScreenWindow`). Each is fetched on its own, so
//    paging a year ahead never reads everything in between.
//  - Per-device health is memory only, never written to the doc (#124: no unattended
//    doc writes). A transient failure keeps the last good events (`stale`); only
//    `unavailable` and `needs_reconnect` clear them.
//  - Only ever reads calendars listed in `viewedCalendars`: the grant can read every
//    calendar on the account, so the CLIENT (`listEventsForView`) refuses any other
//    (account, calendar) pair with a CalendarApiError of kind `invalid`.
//  - This store never imports the sync store, and the sync store never imports this
//    one. Shared data comes from the projection and pure utils; the guarded revoke is
//    `services/calendar/guardedRevoke.ts`.
//  - Reactive outputs are REASSIGNED (a shallowRef cache replaced per write), and the
//    event selectors (`events`, `briefingEvents`, `widgetEvents`) keep their previous
//    array when the content is unchanged, so a poll that brings nothing new triggers
//    no consumer (the widget publisher reloads every widget on each publish).
//
// READ / HEALTH STATE MACHINE. Invariants every transition below must keep:
//  R1. At most one read per (calendar, window) is current: the `InflightRead` in
//      `inflight` under its key, identified by object identity (a unique token).
//  R2. Only the current read may commit to its cache entry or clear its marker. A
//      read whose marker was replaced (a newer span) or removed (calendar or window
//      gone, reconnect, stop) commits nothing.
//  R3. A read also commits nothing when the store stopped since it began
//      (`generation`), its calendar is gone, or its account's refresh token is no
//      longer the one it read with; in that last case it marks the entry due and
//      schedules a read, so the new credential is read promptly.
//  R4. A detail-level change NEVER supersedes a read. The request does not depend
//      on it (stripping is client side), and a commit normalizes with the
//      calendar's CURRENT setting. Busy only re-strips the cache at once; details
//      marks the entries due, since stripped titles cannot come back without a read.
//  R5. `needs_reconnect` is decided from the latch of the account's CURRENT token
//      (a read whose token changed has already been dropped by R3).
//  R6. Sharing health (`unavailable`) belongs to the CALENDAR: one `CalendarHealth`
//      per calendar fed by every window's reads (`healthAfterRead`), so the windows
//      never disagree. While unavailable, every window's events are cleared and the
//      selectors show none of them.
//  R7. A client-side refusal (kind `invalid`: the pair is not viewed, or Google
//      rejected the request shape) is a programming error: reported, and it leaves
//      no cached entry, never a network `stale`.
//  R8. An entry's `eventsAt` / `complete` / `span` describe the read its `events`
//      came from, and only a successful read sets them: a failed read keeps the
//      previous ones with the previous events, and an entry whose events were
//      cleared (needs_reconnect, unavailable) claims nothing (`eventsAt: 0`,
//      `complete: false`). The `events` selector merges the two windows by
//      `mergeWindowEvents`: the fresher copy of an event wins, and a fresher
//      complete read that no longer returns an event inside its span is never
//      contradicted by a staler window. `markDue` and re-stripping touch none of
//      the three (they change `fetchedAt` and the event fields only).

import { defineStore } from 'pinia';
import { computed, shallowRef, watch } from 'vue';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import { collectionRef, list as projectionList } from '@/services/automerge/projection';
import { isFlagEnabled } from '@/config/flags';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { createChangeGate, type ChangeGate } from '@/services/telemetry/emitPolicy';
import * as perfTiming from '@/utils/perfTiming';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useFamilyStore } from '@/stores/familyStore';
import {
  usePollWhileVisible,
  type PollWhileVisibleHandle,
} from '@/composables/usePollWhileVisible';
import { getCalendarClient } from '@/services/calendar/clientInstance';
import {
  CalendarApiError,
  type CalendarSummary,
  type CalendarViewEvent,
} from '@/services/calendar/CalendarClient';
import {
  connectGoogleCalendar,
  startCalendarRedirectAuth,
  completeCalendarRedirectAuth,
  type CalendarAuthErrorCode,
  type CalendarConnectResult,
  type CalendarConnectRedirecting,
} from '@/services/calendar/calendarAuth';
import { shouldUseRedirectAuth } from '@/services/google/googleAuth';
import { logTokenLifecycle } from '@/services/google/googleRevoke';
import { pendingCredential } from '@/services/calendar/pendingCredential';
import { revokeCalendarGrantGuarded } from '@/services/calendar/guardedRevoke';
import { abandonPendingConsent, holdConsent } from '@/services/calendar/pendingConsent';
import { readCalendarUses } from '@/services/calendar/calendarUses';
import { calendarInUse } from '@/utils/calendar/connectEligibility';
import {
  createCalendarViewAccount,
  getCalendarViewAccountById,
  updateCalendarViewAccount,
  removeCalendarViewAccount,
  createViewedCalendar,
  getViewedCalendarById,
  updateViewedCalendar as updateViewedCalendarRecord,
  removeViewedCalendar as removeViewedCalendarRecord,
} from '@/services/automerge/repositories/calendarViewRepository';
import { runPooled } from '@/utils/calendar/runPooled';
import { hasCalendarListScope } from '@/utils/calendar/grantScopes';
import { MAX_INFLIGHT, VIEW_MIN_REFRESH_MS, VIEW_TTL_MS } from '@/utils/calendar/limits';
import { beaniesEventIds } from '@/utils/calendar/beaniesEventIds';
import { isPositivelyDifferentAccount, isSameKnownAccount } from '@/utils/calendar/grantGuard';
import { calendarReturnPath, parseCalendarResumeIntent } from '@/utils/calendar/resumeIntent';
import {
  compareExternalEvents,
  dedupeViewedCalendars,
  healthAfterRead,
  indexByDate,
  isBeaniesOrigin,
  isRefusal,
  isBusyOnlyCalendar,
  mergeWindowEvents,
  normalizeViewEvents,
  pickDefaultColor,
  rangeToIsoWindow,
  rangeToMsSpan,
  restripForCalendar,
  spanKeyOf,
  standingRange,
  worseState,
} from '@/utils/calendar/externalEvents';
import { localToday } from '@/utils/date';
import type { CalendarViewAccount, ViewedCalendar, ViewedCalendarAccessRole } from '@/types/models';
import type { ExternalEvent, ViewCalendarState, YmdRange } from '@/types/externalEvents';
import type { CalendarHealth, MsSpan } from '@/utils/calendar/externalEvents';

const FLAG = 'viewOnlyCalendars';
const SURFACE = 'calendar-view';
/** A window change waits this long, so rapid paging fetches only where it settles. */
const WINDOW_DEBOUNCE_MS = 300;
/** Once per session per signature: the gates below never emit a heartbeat. */
const ONCE_PER_CHANGE = Number.POSITIVE_INFINITY;

/** The two fetch windows. Fixed: nothing may add a third. */
export type ViewWindow = 'standing' | 'screen';
const WINDOWS: readonly ViewWindow[] = ['standing', 'screen'];

/** One calendar's read for one window. Memory only. */
interface CacheEntry {
  spanKey: string;
  events: ExternalEvent[];
  /** When this window was last read (success or failure); `0` = due. Drives the TTL only. */
  fetchedAt: number;
  /** When `events` were read from Google; `0` = they claim nothing (R8). */
  eventsAt: number;
  /** That read returned every event of its span (not truncated) (R8). */
  complete: boolean;
  /** The span `events` were read for (R8). */
  span: MsSpan;
  /** This window's own outcome. Never `unavailable`: that is the calendar's (R6). */
  state: ViewCalendarState;
}

/** The R8 fields of an entry whose events claim nothing (none read, or cleared). */
function claimsNothing(span: MsSpan): Pick<CacheEntry, 'eventsAt' | 'complete' | 'span'> {
  return { eventsAt: 0, complete: false, span };
}

/** The current read of one (calendar, window). Compared by identity (R1, R2). */
interface InflightRead {
  spanKey: string;
}

/**
 * The unhealthy states that clear events. The view layer raises a one-per-session
 * toast for each (`useCalendarViewHealthToast`); the store only reports them.
 */
export type UnhealthyState = Extract<ViewCalendarState, 'unavailable' | 'needs_reconnect'>;

function isUnhealthy(state: ViewCalendarState | null): state is UnhealthyState {
  return state === 'unavailable' || state === 'needs_reconnect';
}

// ── Typed results (actions never throw to the view) ─────────────────────────

/** A consent that did not produce a credential. `unexpected` = something threw. */
export interface ViewConnectFailure {
  status: 'failed';
  code: CalendarAuthErrorCode | 'no_account' | 'unexpected';
  message: string;
}

/** A fresh view consent: the credential waits in the pending slot (`pending`). */
export type ViewConnectResult =
  { status: 'pending' } | CalendarConnectRedirecting | ViewConnectFailure;

/** A view account reconnect. */
export type ViewReconnectResult =
  { status: 'reconnected' } | CalendarConnectRedirecting | ViewConnectFailure;

/** What a view redirect resume produced. */
export type ViewResumeResult = ViewConnectResult | ViewReconnectResult;

export type ListViewCalendarsResult =
  | { status: 'ok'; calendars: CalendarSummary[] }
  | { status: 'failed'; reason: 'no-pending' | 'no-account' | 'no-list-scope' | 'read-failed' };

export type AddViewedCalendarResult =
  | { status: 'added'; viewedCalendarId: string }
  | {
      status: 'failed';
      reason: 'not-enabled' | 'no-pending' | 'no-account' | 'already-added' | 'write-failed';
    };

/** The per-calendar settings a member may change after adding. */
export type ViewedCalendarSettingsPatch = Partial<
  Pick<ViewedCalendar, 'detailLevel' | 'color' | 'inBriefing' | 'inWidgets'>
>;

export type UpdateViewedCalendarResult =
  { status: 'updated' } | { status: 'failed'; reason: 'not-found' | 'busy-only' | 'write-failed' };

export type RemoveViewedCalendarResult =
  { status: 'removed' } | { status: 'failed'; reason: 'write-failed' };

/** What `addViewedCalendar` takes: a known view account, or the pending consent. */
export interface AddViewedCalendarInput {
  viewAccountId: string | 'pending';
  calendar: CalendarSummary;
}

// ── Pure helpers local to the store ─────────────────────────────────────────

const ACCESS_ROLES: readonly ViewedCalendarAccessRole[] = [
  'reader',
  'freeBusyReader',
  'writer',
  'owner',
];

/** Google's role string as the record's type. Absent or unknown is `reader` (can see events). */
function toAccessRole(role: string | undefined): ViewedCalendarAccessRole {
  return ACCESS_ROLES.find((r) => r === role) ?? 'reader';
}

/** Shallow equality of two records: every field, arrays compared element by element. */
function sameRecord(a: object, b: object): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) {
    const u = x[k];
    const v = y[k];
    if (u === v) continue;
    if (!Array.isArray(u) || !Array.isArray(v) || u.length !== v.length) return false;
    if (u.some((item, i) => item !== v[i])) return false;
  }
  return true;
}

/**
 * Keep the previous array when no field of any record changed (stable identity, so
 * a doc change elsewhere does not re-sort and re-index every event).
 *
 * ⚠️ Compares EVERY field, never `id` + `updatedAt` alone: after a concurrent merge
 * two devices' fields both survive while only one `updatedAt` does, so a timestamp
 * match can hide a `detailLevel: 'busy'` change (titles left showing) or a new
 * refresh token.
 */
function sameRecords<T extends object>(
  prev: readonly T[] | undefined,
  next: readonly T[]
): boolean {
  return !!prev && prev.length === next.length && prev.every((p, i) => sameRecord(p, next[i]!));
}

function cacheKey(viewedCalendarId: string, win: ViewWindow): string {
  return `${viewedCalendarId}|${win}`;
}

/** The fields whose change makes cached events wrong (detail stripping depends on them). */
function detailSignature(cal: Pick<ViewedCalendar, 'detailLevel' | 'accessRole'>): string {
  return `${cal.detailLevel}|${cal.accessRole}`;
}

const EMPTY: readonly ExternalEvent[] = Object.freeze([]);

export const useCalendarViewStore = defineStore('calendarView', () => {
  const t = (key: UIStringKey): string => useTranslationStore().t(key);

  // ── Projections (inert when the flag is off) ──────────────────────────────

  const accounts = computed<CalendarViewAccount[]>((prev) => {
    void docVersion.value;
    if (!isFlagEnabled(FLAG) || !isDocLoaded()) return prev && prev.length === 0 ? prev : [];
    const next = projectionList('calendarViewAccounts');
    return sameRecords(prev, next) ? prev! : next;
  });

  /** Every viewed-calendar record, duplicates included (the already-added check reads these). */
  const rawCalendars = computed<ViewedCalendar[]>((prev) => {
    void docVersion.value;
    if (!isFlagEnabled(FLAG) || !isDocLoaded()) return prev && prev.length === 0 ? prev : [];
    const next = projectionList('viewedCalendars');
    return sameRecords(prev, next) ? prev! : next;
  });

  /** One per Google calendar, earliest `createdAt` wins, in `createdAt` order. */
  const calendars = computed<ViewedCalendar[]>(() => dedupeViewedCalendars(rawCalendars.value));

  const accountsById = computed(() => new Map(accounts.value.map((a) => [a.id, a])));
  const calendarsById = computed(() => new Map(calendars.value.map((c) => [c.id, c])));

  /** The flag is on and at least one calendar is viewed. */
  const isActive = computed(() => isFlagEnabled(FLAG) && calendars.value.length > 0);

  // ── Ephemeral state (memory only; cleared in one place by stop()) ─────────

  const cache = shallowRef<ReadonlyMap<string, CacheEntry>>(new Map());
  /** cacheKey -> the current read (R1). A newer span replaces it. */
  const inflight = new Map<string, InflightRead>();
  /** viewedCalendarId -> sharing health (R6). Absent = healthy. */
  const health = shallowRef<ReadonlyMap<string, Readonly<CalendarHealth>>>(new Map());
  const screenWindow = shallowRef<YmdRange | null>(null);
  let screenOwner: symbol | null = null;
  /** True once the first standing fetch attempt has finished (success or failure). */
  const standingSettled = shallowRef(false);
  /** Bumped by stop(): a read that started before it must not write after it. */
  let generation = 0;

  let poll: PollWhileVisibleHandle | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  // Telemetry gates: one per (calendar, window), so a wall left open for days
  // reports transitions, not 288 identical outcomes a day.
  const outcomeGates = new Map<string, ChangeGate>();
  const failureGates = new Map<string, ChangeGate>();
  const dedupeGates = new Map<string, ChangeGate>();
  /** `${action}|${id}` already logged this session (unavailable, reconnect, truncated). */
  const loggedOnce = new Set<string>();
  /** Blank activity ids already reported by the beanies-origin set. */
  const invalidIdsReported = new Set<string>();

  function gate(map: Map<string, ChangeGate>, key: string, heartbeat?: number): ChangeGate {
    let g = map.get(key);
    if (!g) {
      g = createChangeGate(heartbeat);
      map.set(key, g);
    }
    return g;
  }

  function logOnce(key: string, emit: () => void): void {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    emit();
  }

  function putEntry(key: string, entry: CacheEntry): void {
    const next = new Map(cache.value);
    next.set(key, entry);
    cache.value = next;
  }

  /**
   * Drop matching entries AND supersede their reads (R2), including a first read that
   * has no entry yet: otherwise a window cleared mid-read would get an entry back.
   */
  function dropEntries(predicate: (key: string) => boolean): void {
    for (const key of [...inflight.keys()]) {
      if (predicate(key)) inflight.delete(key);
    }
    let changed = false;
    const next = new Map(cache.value);
    for (const key of next.keys()) {
      if (predicate(key)) {
        next.delete(key);
        changed = true;
      }
    }
    if (changed) cache.value = next;
  }

  function dropCalendarEntries(viewedCalendarId: string): void {
    dropEntries((key) => key.startsWith(`${viewedCalendarId}|`));
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * The beanies-origin ids right now (activities + every event link). Recomputed only
   * when the `activities` or `calendarEventLinks` collection changes (their own
   * projection refs, not the doc-wide `docVersion`), and lazily: nothing reads it
   * while the store is inactive. Keeps the previous set when the ids are the same,
   * so an activity's title edit does not re-run the `events` selector.
   */
  const beaniesIds = computed<ReadonlySet<string>>((prev) => {
    const next = beaniesEventIds(
      collectionRef('activities').value.keys(),
      collectionRef('calendarEventLinks').value.values() as Iterable<{ googleEventId: string }>,
      (activityId, error) => {
        if (invalidIdsReported.has(activityId)) return;
        invalidIdsReported.add(activityId);
        reportError({
          surface: SURFACE,
          message: '[calendarView] could not derive an event id for an activity; skipping it',
          error,
          severity: 'warning',
          context: { action: 'beanies-ids', activity_id: activityId },
        });
      }
    );
    if (prev && prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
    return next;
  });

  function windowRange(win: ViewWindow): YmdRange | null {
    return win === 'standing' ? standingRange(localToday()) : screenWindow.value;
  }

  /**
   * Is this read still the current one (R2, R3)? Returns the calendar and account to
   * commit with, or why not. Never consults the detail level (R4).
   */
  function currentFor(
    gen: number,
    key: string,
    read: InflightRead,
    viewedCalendarId: string,
    refreshToken: string
  ):
    | { status: 'current'; cal: ViewedCalendar; account: CalendarViewAccount }
    | { status: 'superseded' | 'credential-changed' } {
    if (gen !== generation || inflight.get(key) !== read) return { status: 'superseded' };
    const cal = calendarsById.value.get(viewedCalendarId);
    if (!cal) return { status: 'superseded' };
    const account = accountsById.value.get(cal.viewAccountId);
    if (!account) return { status: 'superseded' };
    if (account.refreshToken !== refreshToken) return { status: 'credential-changed' };
    return { status: 'current', cal, account };
  }

  /** Mark one entry due, so the next refresh reads it whatever its age. */
  function markDue(key: string): void {
    const entry = cache.value.get(key);
    if (entry && entry.fetchedAt !== 0) putEntry(key, { ...entry, fetchedAt: 0 });
  }

  /**
   * Record one read's effect on its calendar's sharing health (R6). On the turn to
   * unavailable, every window's events go (so nothing in memory outlives it) and it
   * is logged once.
   */
  function recordHealth(cal: ViewedCalendar, outcome: 'ok' | 'refused' | 'other'): void {
    const prev = health.value.get(cal.id);
    const next = healthAfterRead(prev, outcome, Date.now());
    if (next === prev || (!prev && !next.unavailable && next.refusals === 0)) return;
    const map = new Map(health.value);
    if (next.refusals === 0 && !next.unavailable) map.delete(cal.id);
    else map.set(cal.id, next);
    health.value = map;
    if (next.unavailable && !prev?.unavailable) {
      let changed = false;
      const entries = new Map(cache.value);
      for (const win of WINDOWS) {
        const key = cacheKey(cal.id, win);
        const entry = entries.get(key);
        if (entry && entry.events.length > 0) {
          entries.set(key, { ...entry, events: [], ...claimsNothing(entry.span) });
          changed = true;
        }
      }
      if (changed) cache.value = entries;
      markUnhealthy('unavailable', cal);
    } else if (prev?.unavailable && !next.unavailable) {
      // Shared again: the other window holds no events (cleared above), so read it now.
      for (const win of WINDOWS) markDue(cacheKey(cal.id, win));
      scheduleRefresh();
    }
  }

  function logOutcome(
    cal: ViewedCalendar,
    win: ViewWindow,
    detail: 'ok' | 'partial' | 'failed',
    count: number
  ): void {
    const kind = isBusyOnlyCalendar(cal) ? 'busy' : 'details';
    const signature = `${detail}|${kind}|${count === 0 ? 'empty' : 'some'}`;
    if (!gate(outcomeGates, cacheKey(cal.id, win), ONCE_PER_CHANGE)(signature)) return;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'view calendar fetch outcome',
      context: { action: 'fetch-outcome', detail, count, kind, stage: win },
    });
  }

  function markUnhealthy(state: UnhealthyState, cal: ViewedCalendar): void {
    if (state === 'unavailable') {
      logOnce(`calendar-unavailable|${cal.id}`, () =>
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'view calendar no longer readable (sharing stopped or calendar gone)',
          context: { action: 'calendar-unavailable' },
        })
      );
    } else {
      logOnce(`account-needs-reconnect|${cal.viewAccountId}`, () =>
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'view account needs a new sign-in',
          context: { action: 'account-needs-reconnect' },
        })
      );
    }
  }

  /**
   * Read one calendar for one window and commit the result (never throws). `refresh`
   * makes the read current (R1) when it QUEUES it, so a read still waiting for a pool
   * slot is not queued twice; one that is no longer current by the time it gets a
   * slot does not run.
   */
  async function fetchOne(
    viewedCalendarId: string,
    win: ViewWindow,
    range: YmdRange,
    read: InflightRead,
    beaniesIds: () => ReadonlySet<string>
  ): Promise<void> {
    const key = cacheKey(viewedCalendarId, win);
    if (inflight.get(key) !== read) return;
    const gen = generation;
    try {
      const cal = calendarsById.value.get(viewedCalendarId);
      if (!cal) return;
      const account = accountsById.value.get(cal.viewAccountId);
      const client = getCalendarClient();
      // The account was removed on another device, or its CURRENT refresh token is
      // latched dead (R5): say so, never leave it permanently `stale`.
      if (!account || client.hasPermanentAuthFailure(account.id, account.refreshToken)) {
        putEntry(key, {
          spanKey: read.spanKey,
          events: [],
          fetchedAt: Date.now(),
          ...claimsNothing(rangeToMsSpan(range)),
          state: 'needs_reconnect',
        });
        markUnhealthy('needs_reconnect', cal);
        logOutcome(cal, win, 'failed', 0);
        return;
      }
      await readAndCommit(client, account, cal, win, range, read, key, gen, beaniesIds);
    } finally {
      if (inflight.get(key) === read) inflight.delete(key);
    }
  }

  async function readAndCommit(
    client: ReturnType<typeof getCalendarClient>,
    account: CalendarViewAccount,
    started: ViewedCalendar,
    win: ViewWindow,
    range: YmdRange,
    read: InflightRead,
    key: string,
    gen: number,
    beaniesIds: () => ReadonlySet<string>
  ): Promise<void> {
    const startedAt = performance.now();
    let raw: Awaited<ReturnType<typeof client.listEventsForView>>;
    let failure: unknown = null;
    try {
      const { timeMinIso, timeMaxIso } = rangeToIsoWindow(range);
      raw = await client.listEventsForView(account.id, started.calendarId, timeMinIso, timeMaxIso);
      perfTiming.record('calendar-view-fetch', performance.now() - startedAt);
    } catch (e) {
      failure = e;
      raw = { events: [], truncated: false };
    }

    const live = currentFor(gen, key, read, started.id, account.refreshToken);
    if (live.status === 'credential-changed') {
      // R3: read with a token that is no longer the account's; read again with the new one.
      markDue(key);
      scheduleRefresh();
      return;
    }
    if (live.status !== 'current') return;
    const { cal } = live;

    if (failure !== null) {
      commitFailure(client, live.account, cal, win, read, key, range, failure);
      return;
    }

    try {
      commitSuccess(cal, win, read, key, range, raw, beaniesIds);
    } catch (e) {
      // Normalizing should never throw; if it does, it is a failed read like any other.
      commitFailure(client, live.account, cal, win, read, key, range, e);
    }
  }

  /** Commit a successful read that is still current. */
  function commitSuccess(
    cal: ViewedCalendar,
    win: ViewWindow,
    read: InflightRead,
    key: string,
    range: YmdRange,
    raw: { events: CalendarViewEvent[]; truncated: boolean },
    beaniesIds: () => ReadonlySet<string>
  ): void {
    // R4: stripped by the calendar's setting NOW, not when the read began.
    const { events, droppedAsBeanies, malformed } = normalizeViewEvents(
      raw.events,
      cal,
      beaniesIds()
    );
    // Health first: a recovery marks the calendar's entries due, and this window's own
    // entry is then replaced by the fresh one below rather than read twice.
    recordHealth(cal, 'ok');
    const now = Date.now();
    putEntry(key, {
      spanKey: read.spanKey,
      events,
      fetchedAt: now,
      eventsAt: now,
      complete: !raw.truncated,
      span: rangeToMsSpan(range),
      state: raw.truncated ? 'truncated' : 'ok',
    });
    logOutcome(cal, win, raw.truncated ? 'partial' : 'ok', events.length);
    if (raw.truncated) {
      logOnce(`truncated|${key}`, () =>
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'view calendar read hit the page cap; some events may be missing',
          context: { action: 'truncated', count: raw.events.length, stage: win },
        })
      );
    }
    if (droppedAsBeanies > 0 && gate(dedupeGates, key, ONCE_PER_CHANGE)(String(droppedAsBeanies))) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'view calendar events dropped as beanies-origin',
        context: { action: 'dedupe', count: droppedAsBeanies },
      });
    }
    if (malformed > 0) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'view calendar events without a usable start/end were skipped',
        context: { action: 'malformed-event', count: malformed },
      });
    }
  }

  /** Commit a failed read that is still current (R2, R3 already checked). */
  function commitFailure(
    client: ReturnType<typeof getCalendarClient>,
    account: CalendarViewAccount,
    cal: ViewedCalendar,
    win: ViewWindow,
    read: InflightRead,
    key: string,
    range: YmdRange,
    e: unknown
  ): void {
    const errorCode = e instanceof CalendarApiError ? e.kind : 'unknown';
    if (e instanceof CalendarApiError && e.kind === 'invalid') {
      // R7: the client refused the pair (not a viewed calendar of this account) or Google
      // rejected the request shape. A bug, not weather: no entry, no events, reported.
      dropEntries((k) => k === key);
      if (gate(failureGates, key)(`${errorCode}|refused`)) {
        reportError({
          surface: SURFACE,
          message: '[calendarView] view calendar read refused as invalid (a programming error)',
          error: e,
          severity: 'warning',
          context: { action: 'fetch-failed', error_code: errorCode, stage: win },
        });
      }
      logOutcome(cal, win, 'failed', 0);
      return;
    }
    const prev = cache.value.get(key);
    // R5: the latch of the account's CURRENT token (equal to the read's, by R3).
    const latched = client.hasPermanentAuthFailure(account.id, account.refreshToken);
    let state: ViewCalendarState;
    let events: ExternalEvent[];
    if (latched) {
      state = 'needs_reconnect';
      events = [];
    } else {
      recordHealth(cal, isRefusal(e) ? 'refused' : 'other');
      // A transient failure (and a refusal short of unavailable) keeps the last good
      // events; an unavailable calendar keeps none (R6), so a throttle never wipes a day.
      state = 'stale';
      events = health.value.get(cal.id)?.unavailable ? [] : (prev?.events ?? []);
    }
    // R8: kept events keep the claims of the read they came from; none claim nothing.
    const claims =
      events.length > 0 && prev
        ? { eventsAt: prev.eventsAt, complete: prev.complete, span: prev.span }
        : claimsNothing(rangeToMsSpan(range));
    putEntry(key, { spanKey: read.spanKey, events, fetchedAt: Date.now(), ...claims, state });
    const shown = calendarState(cal.id) ?? state;
    if (gate(failureGates, key)(`${errorCode}|${shown}`)) {
      reportError({
        surface: SURFACE,
        message: '[calendarView] view calendar read failed',
        error: e,
        severity: 'warning',
        context: {
          action: 'fetch-failed',
          error_code: errorCode,
          ...(e instanceof CalendarApiError && e.status !== undefined
            ? { http_status: e.status }
            : {}),
          stage: win,
        },
      });
    }
    if (latched) markUnhealthy('needs_reconnect', cal);
    logOutcome(cal, win, 'failed', events.length);
  }

  /**
   * Read every viewed calendar for every set window whose entry is missing, on a new
   * span, or older than `maxAgeMs` (default: the TTL). `force` reads regardless (a
   * member's own action). Reads run pooled, and the beanies-origin id set is built
   * once per batch, on the first read that needs it. Never throws.
   */
  async function refresh(opts: { force?: boolean; maxAgeMs?: number } = {}): Promise<void> {
    if (!isActive.value) return;
    const maxAge = opts.force ? 0 : (opts.maxAgeMs ?? VIEW_TTL_MS);
    const tasks: Array<() => Promise<void>> = [];
    let standingInBatch = false;
    const now = Date.now();
    // Read once per batch on the first commit that needs it (the computed caches it).
    const ids = (): ReadonlySet<string> => beaniesIds.value;
    for (const win of WINDOWS) {
      const range = windowRange(win);
      if (!range) continue;
      const spanKey = spanKeyOf(range);
      for (const cal of calendars.value) {
        const key = cacheKey(cal.id, win);
        if (inflight.get(key)?.spanKey === spanKey) continue;
        const entry = cache.value.get(key);
        if (entry && entry.spanKey === spanKey && now - entry.fetchedAt < maxAge) continue;
        if (win === 'standing') standingInBatch = true;
        // Current from queue time (R1): a second refresh while this waits for a slot
        // skips it, and a read of an older span still running is superseded.
        const read: InflightRead = { spanKey };
        inflight.set(key, read);
        tasks.push(() => fetchOne(cal.id, win, range, read, ids));
      }
    }
    if (tasks.length === 0) return;
    const gen = generation;
    await runPooled(tasks, MAX_INFLIGHT);
    if (gen !== generation) return;
    if (standingInBatch) standingSettled.value = true;
  }

  /** `refresh` for fire-and-forget callers (debounce, actions): a throw is reported, never lost. */
  async function safeRefresh(opts: Parameters<typeof refresh>[0] = {}): Promise<void> {
    try {
      await refresh(opts);
    } catch (e) {
      reportError({
        surface: SURFACE,
        message: '[calendarView] refresh failed unexpectedly',
        error: e,
        severity: 'warning',
        context: { action: 'refresh' },
      });
    }
  }

  function scheduleRefresh(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void safeRefresh();
    }, WINDOW_DEBOUNCE_MS);
  }

  // ── Selectors ───────────────────────────────────────────────────────────────

  /**
   * Every event of every healthy-enough calendar, its two windows merged by
   * `mergeWindowEvents` (R8: each event once, the fresher copy winning). THE output
   * boundary: every other selector, and through them search, the widgets, the
   * briefing and the clash nudge, derive from this. Keeps its previous array when
   * nothing changed (see the contract above).
   */
  const events = computed<readonly ExternalEvent[]>((prev) => {
    if (!isActive.value) return EMPTY;
    const ownIds = beaniesIds.value;
    const out: ExternalEvent[] = [];
    for (const cal of calendars.value) {
      // An orphaned calendar (its account removed elsewhere) shows nothing, and an
      // unavailable one shows nothing in ANY window (R6).
      if (!accountsById.value.has(cal.viewAccountId)) continue;
      if (health.value.get(cal.id)?.unavailable) continue;
      const windows = WINDOWS.flatMap((win) => cache.value.get(cacheKey(cal.id, win)) ?? []);
      for (const e of mergeWindowEvents(windows)) {
        // Beanies-origin by the CURRENT activities and links: an activity pushed from
        // another device, or an event imported since this read, never shows twice.
        if (isBeaniesOrigin(e, ownIds)) continue;
        // The calendar's CURRENT setting strips details here too, so a switch to
        // busy only hides titles at once, whatever the cache holds.
        const shown = restripForCalendar(e, cal);
        // Color and name are display-only and change without a refetch.
        out.push(
          shown.color === cal.color && shown.calendarName === cal.name
            ? shown
            : { ...shown, color: cal.color, calendarName: cal.name }
        );
      }
    }
    if (out.length === 0) return EMPTY;
    out.sort(compareExternalEvents);
    return sameRecords(prev, out) ? prev! : out;
  });

  const eventsByDate = computed<ReadonlyMap<string, ExternalEvent[]>>(() =>
    indexByDate(events.value)
  );

  function eventsForDate(ymd: string): readonly ExternalEvent[] {
    return eventsByDate.value.get(ymd) ?? EMPTY;
  }
  function timedForDate(ymd: string): readonly ExternalEvent[] {
    return eventsForDate(ymd).filter((e) => !e.allDay);
  }
  function allDayForDate(ymd: string): readonly ExternalEvent[] {
    return eventsForDate(ymd).filter((e) => e.allDay);
  }

  /** The events of calendars with a switch on; the previous array when the content is unchanged. */
  function switchedOn(
    prev: readonly ExternalEvent[] | undefined,
    on: (cal: ViewedCalendar) => boolean
  ): readonly ExternalEvent[] {
    const next = events.value.filter((e) => {
      const cal = calendarsById.value.get(e.viewedCalendarId);
      return cal !== undefined && on(cal);
    });
    if (next.length === 0) return EMPTY;
    return sameRecords(prev, next) ? prev! : next;
  }
  const briefingEvents = computed<readonly ExternalEvent[]>((prev) =>
    switchedOn(prev, (c) => c.inBriefing === true)
  );
  const widgetEvents = computed<readonly ExternalEvent[]>((prev) =>
    switchedOn(prev, (c) => c.inWidgets === true)
  );

  /** A calendar's per-device health (its sharing health, then the worst of its windows); `null` before its first read. */
  function calendarState(viewedCalendarId: string): ViewCalendarState | null {
    const cal =
      calendarsById.value.get(viewedCalendarId) ??
      rawCalendars.value.find((c) => c.id === viewedCalendarId);
    if (cal && !accountsById.value.has(cal.viewAccountId)) return 'needs_reconnect';
    let state: ViewCalendarState | null = health.value.get(viewedCalendarId)?.unavailable
      ? 'unavailable'
      : null;
    for (const win of WINDOWS) {
      state = worseState(state, cache.value.get(cacheKey(viewedCalendarId, win))?.state ?? null);
    }
    return state;
  }

  /**
   * The unhealthy kinds present across the viewed calendars right now. Reactive: it
   * reads the reassigned `cache` ref and the projections through `calendarState`.
   * The view layer watches it to raise its one-per-session toast; the store never
   * navigates and has no path to the router (the doc worker bundles this graph).
   */
  const unhealthyStates = computed<ReadonlySet<UnhealthyState>>(() => {
    const present = new Set<UnhealthyState>();
    for (const cal of calendars.value) {
      const state = calendarState(cal.id);
      if (isUnhealthy(state)) present.add(state);
    }
    return present;
  });

  // ── Windows ─────────────────────────────────────────────────────────────────

  /**
   * Set the on-screen window. Only page hosts call this (through
   * `useExternalEvents`). A call without an owner takes the window over (the newest
   * page host wins); the returned token is what later calls and `clearScreenWindow`
   * must pass.
   */
  function setScreenWindow(range: YmdRange, owner?: symbol): symbol {
    const token = owner && owner === screenOwner ? owner : Symbol('screen-window');
    screenOwner = token;
    const current = screenWindow.value;
    if (!current || spanKeyOf(current) !== spanKeyOf(range)) {
      screenWindow.value = { startYmd: range.startYmd, endYmd: range.endYmd };
    }
    return token;
  }

  /** Clear the on-screen window, but only for its current owner (a disposing page cannot clear its successor's). */
  function clearScreenWindow(owner: symbol): void {
    if (owner !== screenOwner) return;
    screenOwner = null;
    screenWindow.value = null;
    dropEntries((key) => key.endsWith('|screen'));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  function startPolling(): void {
    if (poll) return;
    // The interval tick finds every entry a TTL old and re-reads it; a return to the
    // app re-reads only what is older than VIEW_MIN_REFRESH_MS.
    poll = usePollWhileVisible(() => refresh({ maxAgeMs: VIEW_MIN_REFRESH_MS }), VIEW_TTL_MS, {
      fireImmediatelyOnVisible: true,
      surface: SURFACE,
    });
  }

  function stopPolling(): void {
    poll?.stop();
    poll = null;
    if (debounce) clearTimeout(debounce);
    debounce = null;
  }

  watch(
    isActive,
    (active) => {
      if (active) {
        startPolling();
        // One read on activation whatever the visibility: the poll waits for a visible
        // document, and a hidden start (a native background wake) would otherwise read
        // nothing. Debounced and deduped (fresh or queued reads are skipped), so with
        // the document visible the poll's immediate read is not doubled.
        scheduleRefresh();
      } else {
        stopPolling();
        if (cache.value.size > 0) cache.value = new Map();
        if (health.value.size > 0) health.value = new Map();
        inflight.clear();
      }
    },
    { immediate: true }
  );

  // Only a NEW window needs a read; clearing one (a page leaving, or stop()) must
  // never schedule a refresh.
  watch(screenWindow, (win) => {
    if (win && isActive.value) scheduleRefresh();
  });

  // A calendar added, removed, or switched between details and busy only (here or
  // by sync, merges included). A removed calendar's entries, reads and health go. A
  // switched one keeps its times, re-stripped for the new setting at once (so no
  // title outlives a switch to busy only, even when the refetch fails), and a switch
  // to details is marked due (R4). Reads in flight are left alone: they commit with
  // the setting current when they land. Color and name changes need no read.
  watch(
    () => calendars.value.map((c) => `${c.id}:${detailSignature(c)}`).join(','),
    (now, before) => {
      const keep = new Map(calendars.value.map((c) => [c.id, detailSignature(c)]));
      const previous = new Map(
        (before ?? '')
          .split(',')
          .filter(Boolean)
          .map((s) => {
            const at = s.indexOf(':');
            return [s.slice(0, at), s.slice(at + 1)] as const;
          })
      );
      dropEntries((key) => !keep.has(key.slice(0, key.lastIndexOf('|'))));
      if ([...health.value.keys()].some((id) => !keep.has(id))) {
        health.value = new Map([...health.value].filter(([id]) => keep.has(id)));
      }
      for (const cal of calendars.value) {
        if (previous.has(cal.id) && previous.get(cal.id) !== keep.get(cal.id)) {
          restripCalendarEntries(cal);
        }
      }
      if (now && isActive.value) scheduleRefresh();
    }
  );

  /**
   * Re-strip one calendar's cached events for its current setting (R4). Busy only: the
   * titles go now and nothing needs reading. Details: the cache holds stripped events
   * that cannot be un-stripped, so the entries are marked due. Never touches `inflight`.
   */
  function restripCalendarEntries(cal: ViewedCalendar): void {
    const due = !isBusyOnlyCalendar(cal);
    let changed = false;
    const next = new Map(cache.value);
    for (const win of WINDOWS) {
      const key = cacheKey(cal.id, win);
      const entry = next.get(key);
      if (!entry) continue;
      next.set(key, {
        ...entry,
        events: entry.events.map((e) => restripForCalendar(e, cal)),
        fetchedAt: due ? 0 : entry.fetchedAt,
      });
      changed = true;
    }
    if (changed) cache.value = next;
  }

  // ── Telemetry helpers for actions ───────────────────────────────────────────

  function logConsentOutcome(detail: string, stage?: 'popup' | 'redirect'): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'view calendar consent outcome',
      context: { action: 'consent-outcome', kind: 'view', detail, ...(stage ? { stage } : {}) },
    });
  }

  function viewedCount(): number {
    return isDocLoaded() ? projectionList('viewedCalendars').length : 0;
  }

  function logChange(action: 'add' | 'remove' | 'settings-change', detail?: string): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: `view calendar ${action}`,
      context: { action, count: viewedCount(), ...(detail ? { detail } : {}) },
    });
  }

  /** A member action whose record vanished (removed on another device, or signed out). */
  function logGone(action: string, detail: 'no-account' | 'not-found' | 'no-pending'): void {
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: `view calendar ${action}: its record is gone`,
      context: { action, detail },
    });
  }

  function reportActionFailure(action: string, e: unknown): void {
    reportError({
      surface: SURFACE,
      message: `[calendarView] ${action} failed`,
      error: e,
      severity: 'critical',
      context: { action, error_code: 'write_failed' },
    });
  }

  function unexpectedConsentFailure(stage: 'popup' | 'redirect', e: unknown): ViewConnectFailure {
    reportError({
      surface: SURFACE,
      message: '[calendarView] view consent failed unexpectedly',
      error: e,
      severity: 'warning',
      context: { action: 'consent-outcome', detail: 'unexpected', stage },
    });
    showToast(
      'error',
      t('calendarView.toast.connectFailed.title'),
      t('calendarView.toast.connectFailed.message'),
      { silent: true }
    );
    return { status: 'failed', code: 'unexpected', message: '' };
  }

  // ── Actions: connect (pending credential, nothing written) ─────────────────

  /** The pending VIEW consent, for the add step. Never the token. */
  const pendingViewConnect = computed<{ accountEmail: string | null } | null>(() => {
    const held = pendingCredential.peek();
    return held && held.kind === 'view' ? { accountEmail: held.accountEmail } : null;
  });

  /** A consent result into the pending slot (popup and redirect share this). */
  function acceptViewConsent(
    result: CalendarConnectResult,
    stage: 'popup' | 'redirect'
  ): ViewConnectResult {
    return holdConsent('view', result, stage, logConsentOutcome);
  }

  /**
   * Start a view-only consent. Popup: returns `pending` with the credential in the
   * pending slot. Redirect surfaces: hands off (`redirecting`) and the resume fills
   * the slot. Nothing is written to the family file either way.
   *
   * ⚠️ No `await` before `connectGoogleCalendar`: the popup must open inside the
   * tap's user activation.
   */
  async function beginViewConnect(loginHint?: string): Promise<ViewConnectResult> {
    if (!isFlagEnabled(FLAG)) {
      return { status: 'failed', code: 'not_configured', message: 'Feature is not enabled.' };
    }
    const stage = shouldUseRedirectAuth() ? 'redirect' : 'popup';
    try {
      // An earlier unconfirmed view consent: revoke it before minting another.
      abandonViewConnect();
      if (stage === 'redirect') {
        logConsentOutcome('redirecting', 'redirect');
        await startCalendarRedirectAuth(
          calendarReturnPath({ kind: 'view-connect' }),
          loginHint,
          'create',
          'view'
        );
        return { status: 'redirecting' };
      }
      const result = await connectGoogleCalendar({ loginHint, kind: 'view' });
      return acceptViewConsent(result, 'popup');
    } catch (e) {
      return unexpectedConsentFailure(stage, e);
    }
  }

  /** Apply a reconnect consent to an existing view account, in place. */
  async function applyViewReconnect(
    accountId: string,
    result: CalendarConnectResult,
    stage: 'popup' | 'redirect'
  ): Promise<ViewReconnectResult> {
    if (result.status === 'redirecting') return result;
    if (result.status !== 'connected') {
      logConsentOutcome(result.code, stage);
      return result;
    }
    const account = await getCalendarViewAccountById(accountId);
    if (!account) {
      logConsentOutcome('no-account', stage);
      return { status: 'failed', code: 'no_account', message: '' };
    }
    // `loginHint` is only a hint: never repoint the account at whoever consented.
    if (isPositivelyDifferentAccount(account.accountEmail, result.email)) {
      logConsentOutcome('account_mismatch', stage);
      return { status: 'failed', code: 'account_mismatch', message: account.accountEmail };
    }
    await updateCalendarViewAccount(accountId, {
      accountEmail: result.email ?? account.accountEmail,
      refreshToken: result.refreshToken,
      grantedScopes: result.grantedScopes,
    });
    logTokenLifecycle({ grant: 'calendar', op: 'mint', outcome: 'ok', trigger: 'reconnect' });
    // Clears this device's cached token and latch at once. Other devices recover by
    // themselves: the provider pins both to the refresh token, which sync replaces.
    getCalendarClient().invalidateConnection(accountId);
    for (const cal of rawCalendars.value) {
      if (cal.viewAccountId === accountId) dropCalendarEntries(cal.id);
    }
    logConsentOutcome('connected', stage);
    void safeRefresh({ force: true });
    return { status: 'reconnected' };
  }

  /**
   * Finish a view consent after a redirect round trip. Called by the App-level
   * resume for a `view` / `view:<accountId>` intent. `null` when no calendar code
   * was pending (a Drive redirect, or the member declined).
   */
  async function resumeViewRedirect(raw: string): Promise<ViewResumeResult | null> {
    if (!isFlagEnabled(FLAG)) return null;
    const intent = parseCalendarResumeIntent(raw);
    if (intent.kind !== 'view-connect' && intent.kind !== 'view-reconnect') return null;
    try {
      const result = await completeCalendarRedirectAuth('view');
      if (!result) return null;
      if (intent.kind === 'view-connect') return acceptViewConsent(result, 'redirect');
      return await applyViewReconnect(intent.accountId, result, 'redirect');
    } catch (e) {
      return unexpectedConsentFailure('redirect', e);
    }
  }

  /** The pending account's calendars for the add step. Never throws; never toasts (the add step does). */
  async function listPendingViewCalendars(): Promise<ListViewCalendarsResult> {
    const held = pendingCredential.peek();
    if (!held || held.kind !== 'view') {
      logGone('list-pending-calendars', 'no-pending');
      return { status: 'failed', reason: 'no-pending' };
    }
    return listWith(held.id, held.grantedScopes, 'list-pending-calendars');
  }

  /** A view account's calendars, for adding another calendar from it. Never throws. */
  async function listCalendarsForAccount(accountId: string): Promise<ListViewCalendarsResult> {
    const account = accountsById.value.get(accountId);
    if (!account) {
      logGone('list-account-calendars', 'no-account');
      return { status: 'failed', reason: 'no-account' };
    }
    return listWith(account.id, account.grantedScopes, 'list-account-calendars');
  }

  async function listWith(
    credentialId: string,
    grantedScopes: readonly string[],
    action: string
  ): Promise<ListViewCalendarsResult> {
    if (!hasCalendarListScope(grantedScopes)) {
      // Granular consent dropped the list scope: there is nothing to choose from.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'view calendar list: no calendar-list scope',
        context: { action, detail: 'no-scope' },
      });
      return { status: 'failed', reason: 'no-list-scope' };
    }
    try {
      const calendars = await getCalendarClient().listCalendars(credentialId);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'view calendar list read',
        context: { action, detail: 'ok', count: calendars.length },
      });
      return { status: 'ok', calendars };
    } catch (e) {
      reportError({
        surface: SURFACE,
        message: '[calendarView] listing calendars failed',
        error: e,
        severity: 'warning',
        context: {
          action,
          detail: 'failed',
          error_code: e instanceof CalendarApiError ? e.kind : 'unknown',
        },
      });
      // The add step toasts this with a retry (it knows what to retry); a store toast
      // here would show a second one without it.
      return { status: 'failed', reason: 'read-failed' };
    }
  }

  /**
   * Drop an unconfirmed view consent: clear the slot and revoke its token unless
   * something else on the same Google account would die with it. A no-op when no
   * view consent is pending, so every close path may call it.
   */
  function abandonViewConnect(): void {
    abandonPendingConsent('view', logConsentOutcome);
  }

  // ── Actions: CRUD ───────────────────────────────────────────────────────────

  /**
   * Add a calendar, view only. From the pending consent, the account record is
   * created on this first use (so an account with no calendar can never exist), or
   * an existing view account with the same email is reused (its token refreshed in
   * place) instead of creating a second. Defaults: details (busy only for a
   * free/busy calendar), the first unused palette color, both switches off.
   */
  async function addViewedCalendar(
    input: AddViewedCalendarInput
  ): Promise<AddViewedCalendarResult> {
    if (!isFlagEnabled(FLAG)) return { status: 'failed', reason: 'not-enabled' };
    const held = input.viewAccountId === 'pending' ? pendingCredential.peek() : null;
    // The add step disables these rows; this is the store's own guard, by the same
    // rule (`calendarInUse`) over the same records read fresh from the doc, so one
    // calendar is never both synced and viewed, or viewed twice.
    const accountEmail =
      input.viewAccountId === 'pending'
        ? held?.accountEmail
        : accountsById.value.get(input.viewAccountId)?.accountEmail;
    const use = calendarInUse(input.calendar.id, accountEmail, readCalendarUses());
    if (use !== null) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'view calendar add refused: already added',
        context: { action: 'add', detail: use === 'view' ? 'already-added' : 'already-synced' },
      });
      return { status: 'failed', reason: 'already-added' };
    }
    if (input.viewAccountId === 'pending' && (!held || held.kind !== 'view')) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'view calendar add without a pending consent',
        context: { action: 'add', detail: 'no-pending' },
      });
      return { status: 'failed', reason: 'no-pending' };
    }
    if (input.viewAccountId !== 'pending' && !accountsById.value.has(input.viewAccountId)) {
      logGone('add', 'no-account');
      return { status: 'failed', reason: 'no-account' };
    }

    const client = getCalendarClient();
    let createdAccountId: string | null = null;
    try {
      let accountId: string;
      if (held) {
        const existing = accounts.value.find((a) =>
          isSameKnownAccount(a.accountEmail, held.accountEmail)
        );
        if (existing) {
          await updateCalendarViewAccount(existing.id, {
            refreshToken: held.refreshToken,
            grantedScopes: held.grantedScopes,
          });
          client.invalidateConnection(existing.id);
          accountId = existing.id;
        } else {
          const created = await createCalendarViewAccount({
            provider: 'google',
            accountEmail: held.accountEmail ?? 'unknown',
            refreshToken: held.refreshToken,
            grantedScopes: held.grantedScopes,
            connectedBy: useFamilyStore().currentMemberId ?? undefined,
          });
          accountId = created.id;
          createdAccountId = created.id;
        }
      } else {
        accountId = input.viewAccountId;
      }

      const accessRole = toAccessRole(input.calendar.accessRole);
      const created = await createViewedCalendar({
        viewAccountId: accountId,
        calendarId: input.calendar.id,
        name: input.calendar.summary || input.calendar.id,
        accessRole,
        detailLevel: accessRole === 'freeBusyReader' ? 'busy' : 'details',
        color: pickDefaultColor(rawCalendars.value.map((c) => c.color)),
        inBriefing: false,
        inWidgets: false,
        addedBy: useFamilyStore().currentMemberId ?? undefined,
      });

      if (held && pendingCredential.peek()?.id === held.id) {
        pendingCredential.clear();
        client.invalidateConnection(held.id);
        logConsentOutcome('connected');
      }
      logChange('add');
      scheduleRefresh();
      return { status: 'added', viewedCalendarId: created.id };
    } catch (e) {
      // Never leave an account with no calendar behind.
      if (createdAccountId) {
        const orphan = createdAccountId;
        await removeCalendarViewAccount(orphan).catch((rollbackError: unknown) =>
          reportError({
            surface: SURFACE,
            message: '[calendarView] rolling back a new view account failed',
            error: rollbackError,
            severity: 'warning',
            context: { action: 'add', detail: 'rollback-failed' },
          })
        );
      }
      reportActionFailure('add', e);
      showToast(
        'error',
        t('calendarView.toast.saveFailed.title'),
        t('calendarView.toast.addFailed.message'),
        { silent: true }
      );
      return { status: 'failed', reason: 'write-failed' };
    }
  }

  /** Change a viewed calendar's settings. "Show details" is refused for a free/busy calendar. */
  async function updateViewedCalendar(
    id: string,
    patch: ViewedCalendarSettingsPatch
  ): Promise<UpdateViewedCalendarResult> {
    try {
      const cal = await getViewedCalendarById(id);
      if (!cal) {
        logGone('settings-change', 'not-found');
        showToast(
          'error',
          t('calendarView.toast.saveFailed.title'),
          t('calendarView.toast.calendarGone.message'),
          { silent: true }
        );
        return { status: 'failed', reason: 'not-found' };
      }
      if (patch.detailLevel === 'details' && cal.accessRole === 'freeBusyReader') {
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'view calendar settings change refused: free/busy calendar is busy only',
          context: { action: 'settings-change', detail: 'busy-only' },
        });
        return { status: 'failed', reason: 'busy-only' };
      }
      const changes: ViewedCalendarSettingsPatch = {};
      const fields = ['detailLevel', 'color', 'inBriefing', 'inWidgets'] as const;
      const changed = fields.filter((f) => patch[f] !== undefined && patch[f] !== cal[f]);
      if (changed.length === 0) return { status: 'updated' };
      for (const f of changed) Object.assign(changes, { [f]: patch[f] });
      await updateViewedCalendarRecord(id, changes);
      // A `detailLevel` change re-strips and refetches through the calendars watch,
      // the same path a change synced from another device takes.
      for (const f of changed) logChange('settings-change', f);
      return { status: 'updated' };
    } catch (e) {
      reportActionFailure('settings-change', e);
      showToast(
        'error',
        t('calendarView.toast.saveFailed.title'),
        t('calendarView.toast.updateFailed.message'),
        { silent: true }
      );
      return { status: 'failed', reason: 'write-failed' };
    }
  }

  /**
   * Stop viewing a calendar. Every record for the same Google calendar goes, not just
   * this one: the projection shows one per Google calendar (earliest wins), so
   * removing only the winner would make a hidden duplicate (two devices added it at
   * once, or it was reached through two accounts) take its place, and Disconnect
   * would seem to do nothing. Each account left with no calendar goes too, its token
   * revoked through the guard (skipped when Drive, a sync connection or another view
   * account shares the Google account).
   */
  async function removeViewedCalendar(id: string): Promise<RemoveViewedCalendarResult> {
    try {
      const cal = await getViewedCalendarById(id);
      if (!cal) return { status: 'removed' };
      const doomed = projectionList('viewedCalendars').filter(
        (c) => c.id === id || c.calendarId === cal.calendarId
      );
      for (const record of doomed) {
        await removeViewedCalendarRecord(record.id);
        dropCalendarEntries(record.id);
      }
      const affectedAccounts = new Set(doomed.map((c) => c.viewAccountId));
      for (const accountId of affectedAccounts) {
        const stillUsed = projectionList('viewedCalendars').some(
          (c) => c.viewAccountId === accountId
        );
        if (stillUsed) continue;
        const account = await getCalendarViewAccountById(accountId);
        if (!account) continue;
        await removeCalendarViewAccount(account.id);
        getCalendarClient().invalidateConnection(account.id);
        revokeCalendarGrantGuarded({
          refreshToken: account.refreshToken,
          accountEmail: account.accountEmail,
          trigger: 'disconnect',
          exceptId: account.id,
        });
      }
      logChange('remove');
      return { status: 'removed' };
    } catch (e) {
      reportActionFailure('remove', e);
      showToast(
        'error',
        t('calendarView.toast.saveFailed.title'),
        t('calendarView.toast.removeFailed.message'),
        { silent: true }
      );
      return { status: 'failed', reason: 'write-failed' };
    }
  }

  /**
   * Sign a view account in again (its token died, or the member asked). Writes the
   * new refresh token in place; never creates a second account. Revokes the old
   * token first (guarded), as the sync reconnect does, because a whole-grant revoke
   * after the consent would kill the new one.
   *
   * ⚠️ No `await` before `connectGoogleCalendar` (popup user activation).
   */
  async function reconnectViewAccount(accountId: string): Promise<ViewReconnectResult> {
    if (!isFlagEnabled(FLAG)) {
      return { status: 'failed', code: 'not_configured', message: 'Feature is not enabled.' };
    }
    const account = accountsById.value.get(accountId);
    if (!account) {
      logGone('reconnect', 'no-account');
      return { status: 'failed', code: 'no_account', message: '' };
    }
    const stage = shouldUseRedirectAuth() ? 'redirect' : 'popup';
    try {
      revokeCalendarGrantGuarded({
        refreshToken: account.refreshToken,
        accountEmail: account.accountEmail,
        trigger: 'reconnect',
        exceptId: accountId,
      });
      if (stage === 'redirect') {
        logConsentOutcome('redirecting', 'redirect');
        await startCalendarRedirectAuth(
          calendarReturnPath({ kind: 'view-reconnect', accountId }),
          account.accountEmail,
          'reconnect',
          'view'
        );
        return { status: 'redirecting' };
      }
      const result = await connectGoogleCalendar({ loginHint: account.accountEmail, kind: 'view' });
      return await applyViewReconnect(accountId, result, 'popup');
    } catch (e) {
      return unexpectedConsentFailure(stage, e);
    }
  }

  /** Tear down all ephemeral state on sign-out / family switch. Idle until `isActive` next turns on. */
  function stop(): void {
    generation++;
    stopPolling();
    cache.value = new Map();
    health.value = new Map();
    inflight.clear();
    screenWindow.value = null;
    screenOwner = null;
    standingSettled.value = false;
    outcomeGates.clear();
    failureGates.clear();
    dedupeGates.clear();
    loggedOnce.clear();
    invalidIdsReported.clear();
  }

  return {
    // projections
    accounts,
    calendars,
    isActive,
    pendingViewConnect,
    // events
    events,
    eventsByDate,
    eventsForDate,
    timedForDate,
    allDayForDate,
    briefingEvents,
    widgetEvents,
    calendarState,
    unhealthyStates,
    standingSettled,
    // windows (page hosts, through useExternalEvents)
    screenWindow,
    setScreenWindow,
    clearScreenWindow,
    refresh,
    // actions
    beginViewConnect,
    resumeViewRedirect,
    listPendingViewCalendars,
    listCalendarsForAccount,
    addViewedCalendar,
    abandonViewConnect,
    updateViewedCalendar,
    removeViewedCalendar,
    reconnectViewAccount,
    stop,
  };
});
