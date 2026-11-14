/**
 * flightStatusStore (#143): run → check → apply → a second run writes nothing; the store's own
 * date move is not a refetch; the gate (plan + switch) makes no request; failures back off;
 * at most four fetches per run, soonest first; revert → Conflict → "Use the airline's";
 * sign-out halts, then deletes; the cache hydrates a new session; no flight data is logged.
 *
 * The real cache runs against happy-dom's localStorage, the real utils decide everything; only
 * the Lambda call, the vacation store's write and the platform composables are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive, ref } from 'vue';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';
import type { FlightLeg } from '@/types/flightStatus';
import { makeFlight, makeLeg, t } from '@/utils/flightStatus/__tests__/fixtures';
import { DEV_DAILY_FETCH_CAP, takeDevFetchTokens } from '@/services/flightStatus/devFetchBudget';

const NOW = Date.parse('2026-12-12T09:00:00Z');
const MIN = 60_000;
/** Past the per-flight floor: the moved flight leaves more than 24 h out (the 6 h interval). */
const LATER = 6 * 60 * MIN + MIN;

const h = vi.hoisted(() => ({
  logEvent: vi.fn(),
  fetchFlightLegs: vi.fn(),
  subscribeAlert: vi.fn(),
  unsubscribeAlert: vi.fn(),
  /** pushRegistration: null = web (the default: Phase 1 exactly). */
  platform: null as 'ios' | 'android' | null,
  ensurePushToken: vi.fn(),
  reportPushTokenFailure: vi.fn(),
  tokenChanged: null as (() => void) | null,
  poll: null as (() => unknown) | null,
  writeResult: 'saved' as 'saved' | 'missing' | 'failed',
}));

vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/flightStatus/flightStatusApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/flightStatus/flightStatusApi')>()),
  fetchFlightLegs: h.fetchFlightLegs,
  subscribeAlert: h.subscribeAlert,
  unsubscribeAlert: h.unsubscribeAlert,
}));
vi.mock('@/services/native/pushRegistration', async () => {
  const { ref: vueRef } = await import('vue');
  return {
    pushToken: vueRef<string | null>(null),
    pushPlatform: () => h.platform,
    ensurePushToken: h.ensurePushToken,
    reportPushTokenFailure: h.reportPushTokenFailure,
    onTokenChanged: (cb: () => void) => {
      h.tokenChanged = cb;
      return () => {};
    },
  };
});
vi.mock('@/services/automerge/docService', async () => {
  const { ref: vueRef } = await import('vue');
  return { docVersion: vueRef(0), isDocLoaded: () => true };
});
const online = ref(true);
vi.mock('@/composables/useOnline', () => ({ useOnline: () => ({ isOnline: online }) }));
const lastVisibleAt = ref(0);
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ lastVisibleAt }) }));
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: (cb: () => unknown) => {
    h.poll = cb;
    return { stop: () => {} };
  },
}));
/** The travel page's edit permission (`usePermissions().canEditActivities`). */
const canEdit = ref(true);
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canEditActivities: canEdit }),
}));
const familyContext = reactive({ activeFamilyId: 'fam-1' as string | null });
vi.mock('@/stores/familyContextStore', () => ({ useFamilyContextStore: () => familyContext }));
const settings = reactive({
  settings: {},
  liveFlightChecksEnabled: true,
  liveFlightChangeAlerts: true,
  resolveHomeTimeZoneNow: () => ({ zone: 'Asia/Singapore', source: 'stored' }),
});
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));
/** 2027-01-15: an unexpired alert token at NOW. */
const ALERT_TOKEN = 'v1.1800000000.c2lnbmF0dXJl';
const entitlement = reactive({
  enforces: false,
  state: 'trial' as string | null,
  plan: null as string | null,
  flightAlertToken: ALERT_TOKEN as string | null,
});
vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => entitlement }));
const translation = reactive({ currentLanguage: 'en' as const, t });
vi.mock('@/stores/translationStore', () => ({ useTranslationStore: () => translation }));
const family = reactive({
  currentMember: { id: 'mum', name: 'Mum', role: 'owner', ageGroup: 'adult' } as object | null,
});
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));

const vacationsState = reactive({ vacations: [] as FamilyVacation[] });
const updateSegment = vi.fn(async (vacationId: string, segmentId: string, patch: object) => {
  if (h.writeResult !== 'saved') return h.writeResult;
  const v = vacationsState.vacations.find((x) => x.id === vacationId)!;
  v.travelSegments = v.travelSegments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s));
  return 'saved' as const;
});
vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () =>
    reactive({
      get vacations() {
        return vacationsState.vacations;
      },
      get upcomingVacations() {
        return vacationsState.vacations;
      },
      updateSegment,
    }),
}));

import { STORAGE_KEYS } from '@/constants/storageKeys';
import { FlightStatusApiError } from '@/services/flightStatus/flightStatusApi';
import { readFlightStatusCache } from '@/services/flightStatus/flightStatusCache';
import { pushToken as osPushToken } from '@/services/native/pushRegistration';
import { CHANGE_NOTICE_DELAY_MS, liveNoticeId } from '@/utils/notifications/travel';
import { revisionOf, tupleFromLeg } from '@/utils/flightStatus/schedule';
import { MAX_FETCHES_PER_RUN, useFlightStatusStore } from '../flightStatusStore';

/** The airline moved SQ318 to 18:30 from Terminal 3. */
const moved = makeLeg({
  dep: {
    scheduledLocal: '2026-12-13 18:30+08:00',
    scheduledUtc: '2026-12-13 10:30Z',
    terminal: '3',
  },
});
/** ...and to the next day. */
const nextDay = makeLeg({
  dep: { scheduledLocal: '2026-12-14 17:00+08:00', scheduledUtc: '2026-12-14 09:00Z' },
  arr: { scheduledLocal: '2026-12-14 23:10+00:00', scheduledUtc: '2026-12-14 23:10Z' },
});

function trip(segments: VacationTravelSegment[]): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'London',
    assigneeIds: ['mum'],
    travelSegments: segments,
    accommodations: [],
    transportation: [],
    ideas: [],
  } as unknown as FamilyVacation;
}

const answer = (legs: FlightLeg[]) => ({
  legs,
  fetchedAt: new Date(NOW).toISOString(),
  cached: false,
});
const segment = (id = 'seg-1') =>
  vacationsState.vacations[0]!.travelSegments.find((s) => s.id === id)!;
const events = (message: string) =>
  h.logEvent.mock.calls.map((c) => c[0]).filter((e) => e.message === message);

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('VITE_FLIGHT_STATUS_URL', 'https://api.example.test/flight-status');
  vi.stubEnv('VITE_FLIGHT_STATUS_API_KEY', 'k');
  // Vitest runs as a dev build; the suite models production, where the dev fetch budget is
  // not in play (its own test below turns it back on).
  vi.stubEnv('DEV', false);
  localStorage.clear();
  setActivePinia(createPinia());
  h.logEvent.mockReset();
  h.fetchFlightLegs.mockReset();
  h.writeResult = 'saved';
  updateSegment.mockClear();
  online.value = true;
  canEdit.value = true;
  family.currentMember = { id: 'mum', name: 'Mum', role: 'owner', ageGroup: 'adult' };
  familyContext.activeFamilyId = 'fam-1';
  settings.liveFlightChecksEnabled = true;
  Object.assign(entitlement, {
    enforces: false,
    state: 'trial',
    plan: null,
    flightAlertToken: ALERT_TOKEN,
  });
  settings.liveFlightChangeAlerts = true;
  h.platform = null;
  osPushToken.value = null;
  h.tokenChanged = null;
  h.subscribeAlert.mockReset();
  h.subscribeAlert.mockResolvedValue({ provider: 'ready' });
  h.unsubscribeAlert.mockReset();
  h.unsubscribeAlert.mockResolvedValue(undefined);
  h.ensurePushToken.mockReset();
  h.ensurePushToken.mockResolvedValue('tok-1');
  h.reportPushTokenFailure.mockReset();
  vacationsState.vacations = [trip([makeFlight()])];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('run → check → apply', () => {
  it('a matching flight is verified and nothing is written', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.fetchFlightLegs).toHaveBeenCalledWith(
      expect.objectContaining({ flight: 'SQ318', date: '2026-12-13' })
    );
    expect(updateSegment).not.toHaveBeenCalled();
    expect(store.verificationFor('seg-1')?.state).toBe('verified');
    expect(store.lastCheckedAt).toBe(NOW);
  });

  it('an airline change is applied once; a second run neither fetches nor writes', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(segment()).toMatchObject({ departureTime: '18:30', terminal: '3' });
    expect(store.verificationFor('seg-1')?.state).toBe('changed');
    expect(events('flight change applied')[0]?.context).toEqual({
      action: 'applied',
      flight_state: 'changed',
      flight_fields: 'departureTime,terminal',
    });

    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(updateSegment).toHaveBeenCalledTimes(1);

    // Past the interval it asks again, and the same answer still writes nothing.
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(updateSegment).toHaveBeenCalledTimes(1);
  });

  it("the store's own date move is not a refetch (freshness is by time)", async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([nextDay]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(segment().departureDate).toBe('2026-12-14');
    await store.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(events('flight check run').at(-1)?.context.detail).toBe('fresh=1');
  });

  it('a cancellation flips the segment to pending', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({ status: 'Canceled' })]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(segment()).toMatchObject({
      status: 'pending',
      liveCancelledAt: new Date(NOW).toISOString(),
    });
    expect(store.verificationFor('seg-1')?.state).toBe('cancelled');
    expect(events('flight change applied')[0]?.context.flight_state).toBe('cancelled');
  });

  it('re-booked after a cancellation stays booked on the next run', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({ status: 'Canceled' })]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(updateSegment).toHaveBeenCalledTimes(1);
    // A family member re-books by hand while the airline still says Canceled.
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({ ...s, status: 'booked' as const }));
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(segment().status).toBe('booked');
    expect(store.verificationFor('seg-1')).toMatchObject({
      state: 'conflict',
      live: { status: 'Canceled' },
    });
  });

  it('no legs is no_coverage; an ambiguous answer is no_match; nothing is written', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({
      state: 'unavailable',
      reason: 'no_coverage',
    });

    vacationsState.vacations = [
      trip([
        makeFlight({ id: 'seg-2', departureAirport: 'Somewhere', arrivalAirport: 'Elsewhere' }),
      ]),
    ];
    h.fetchFlightLegs.mockResolvedValue(
      answer([
        makeLeg({}),
        makeLeg({ dep: { iata: 'KUL', scheduledLocal: '2026-12-13 20:00+08:00' } }),
      ])
    );
    await store.run('segment-changed');
    expect(store.verificationFor('seg-2')).toMatchObject({
      state: 'unavailable',
      reason: 'no_match',
    });
    expect(events('flight check done').at(-1)?.context.flight_match).toBe('none');
    expect(updateSegment).not.toHaveBeenCalled();
  });

  it('a failed write is logged with its status and retried on the next due run', async () => {
    h.writeResult = 'failed';
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(events('flight change apply failed')[0]?.context).toEqual({
      action: 'apply_failed',
      save_status: 'failed',
    });
    expect(store.checks['seg-1']).toBeDefined();
    // Not a Conflict the family caused: the airline's change, honestly not in the plan yet.
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: false });
    h.writeResult = 'saved';
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(segment().departureTime).toBe('18:30');
  });
});

describe('a check only answers the segment it still fits (flight AND day)', () => {
  it('a hand edit to another day drops the check: the next run fetches the new day', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')?.state).toBe('verified');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({
      ...s,
      departureDate: '2026-12-14',
      arrivalDate: '2026-12-14',
    }));
    // The old day's answer says nothing about the new day: never a Conflict from it.
    expect(store.verificationFor('seg-1')?.state).toBe('unavailable');
    expect(store.verificationFor('seg-1')?.provider).toBeUndefined();
    await store.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(h.fetchFlightLegs.mock.calls[1]![0]).toMatchObject({ date: '2026-12-14' });
  });

  it('"Use the airline\'s" refuses a stale answer, and says so', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({ ...s, departureDate: '2026-12-20' }));
    updateSegment.mockClear();
    expect((await store.takeAirline('seg-1')).result).toBe('missing');
    expect(updateSegment).not.toHaveBeenCalled();
    expect(events('flight airline refused')[0]?.context).toEqual({
      action: 'take_airline',
      detail: 'stale',
    });
  });
});

describe('writes need the edit permission', () => {
  it('a member who may not edit trips fetches and derives, and never writes', async () => {
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(updateSegment).not.toHaveBeenCalled();
    expect(segment().departureTime).toBe('17:00');
    expect(store.verificationFor('seg-1')).toMatchObject({
      state: 'changed',
      applied: false,
      was: { departureTime: '17:00' },
      provider: { departureTime: '18:30' },
    });
    expect(events('flight change apply failed')).toHaveLength(0);

    // The next due run sees the same answer and still writes nothing, logging the skip once.
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(updateSegment).not.toHaveBeenCalled();
    expect(events('flight change not written')).toHaveLength(1);
    expect(events('flight change not written')[0]?.context).toEqual({
      action: 'apply_skipped',
      detail: 'no_permission',
      flight_state: 'changed',
    });
  });

  it('a refused write is retried from the cache once permission arrives: no provider call', async () => {
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(updateSegment).not.toHaveBeenCalled();
    canEdit.value = true;
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(segment().departureTime).toBe('18:30');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: true });
    expect(events('flight change write retried')[0]?.context).toEqual({
      action: 'apply_retry',
      count: 1,
      notif_skipped: 0,
    });
    // Written: the next run owes nothing.
    await store.run('tick');
    expect(updateSegment).toHaveBeenCalledTimes(1);
  });

  it('"Put it back" over a recorded change is refused without permission', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(updateSegment).toHaveBeenCalledTimes(1);
    canEdit.value = false;
    expect(await store.revert('seg-1')).toBe('failed');
    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(events('flight change not written').at(-1)?.context).toEqual({
      action: 'apply_skipped',
      detail: 'no_permission',
      kind: 'revert',
    });
  });

  it('a cancellation, "Put it back" and "Use the airline\'s" are refused too', async () => {
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({ status: 'Canceled' })]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(segment().status).toBe('booked');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'cancelled', applied: false });
    // Nothing to put back on a cancellation (no `liveWas`): a no-op, not a refused write.
    expect(await store.revert('seg-1')).toBe('missing');
    expect((await store.takeAirline('seg-1')).result).toBe('failed');
    expect(updateSegment).not.toHaveBeenCalled();
  });
});

describe('the gate', () => {
  it('unentitled on an enforced answer: no request, refused logged once, Not checked live', async () => {
    Object.assign(entitlement, { enforces: true, state: 'read_only', plan: null });
    const store = useFlightStatusStore();
    await store.run('open');
    await store.run('tick');
    expect(h.fetchFlightLegs).not.toHaveBeenCalled();
    expect(events('flight check refused')).toHaveLength(1);
    expect(events('flight check refused')[0]?.context).toEqual({
      action: 'refused',
      detail: 'unentitled',
    });
    expect(store.verificationFor('seg-1')).toMatchObject({
      state: 'unavailable',
      reason: 'unentitled',
    });
    expect(store.isEnabled).toBe(false);
  });

  it.each([
    [{ enforces: false, state: 'read_only', plan: null }, true],
    [{ enforces: true, state: 'trial', plan: null }, true],
    [{ enforces: true, state: 'beta', plan: null }, true],
    [{ enforces: true, state: 'active', plan: 'full' }, true],
    [{ enforces: true, state: 'active', plan: 'basic' }, false],
    [{ enforces: true, state: null, plan: null }, false],
  ])('entitlement %o → entitled %s', (answerState, want) => {
    Object.assign(entitlement, answerState);
    expect(useFlightStatusStore().isEntitled).toBe(want);
  });

  it('the switch off: no request; alerts follow both switches', async () => {
    settings.liveFlightChecksEnabled = false;
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.fetchFlightLegs).not.toHaveBeenCalled();
    expect(store.alertsEnabled).toBe(false);
    settings.liveFlightChecksEnabled = true;
    settings.liveFlightChangeAlerts = false;
    expect(store.alertsEnabled).toBe(false);
    settings.liveFlightChangeAlerts = true;
    expect(store.alertsEnabled).toBe(true);
  });

  it('not configured: no request, logged once', async () => {
    vi.stubEnv('VITE_FLIGHT_STATUS_URL', '');
    const store = useFlightStatusStore();
    await store.run('open');
    await store.run('tick');
    expect(h.fetchFlightLegs).not.toHaveBeenCalled();
    expect(events('flight check not configured')).toHaveLength(1);
  });
});

describe('failures and fairness', () => {
  it('a failure backs off on the ladder and is counted', async () => {
    h.fetchFlightLegs.mockRejectedValue(new FlightStatusApiError('http_5xx', 'down', 503));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.failures['seg-1']).toEqual({ code: 'http_5xx', count: 1, until: NOW + 5 * MIN });
    expect(events('flight check failed')[0]?.context).toEqual({
      action: 'check_failed',
      error_code: 'http_5xx',
      http_status: 503,
      consecutive_failures: 1,
    });
    expect(store.verificationFor('seg-1')).toMatchObject({
      state: 'unavailable',
      reason: 'failed',
    });
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 5 * MIN);
    await store.run('tick');
    expect(store.failures['seg-1']?.count).toBe(2);
  });

  it('a rate limit waits the hour; success clears the failure', async () => {
    h.fetchFlightLegs.mockRejectedValueOnce(new FlightStatusApiError('rate_limited', 'slow', 429));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.failures['seg-1']?.until).toBe(NOW + 60 * MIN);
    vi.setSystemTime(NOW + 60 * MIN);
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    await store.run('tick');
    expect(store.failures['seg-1']).toBeUndefined();
  });

  it(`at most ${MAX_FETCHES_PER_RUN} fetches per run, soonest departure first`, async () => {
    const days = [
      '2026-12-15',
      '2026-12-13',
      '2026-12-14',
      '2026-12-13',
      '2026-12-14',
      '2026-12-13',
    ];
    vacationsState.vacations = [
      trip(
        days.map((d, i) => makeFlight({ id: `s${i}`, departureDate: d, departureTime: `0${i}:00` }))
      ),
    ];
    h.fetchFlightLegs.mockResolvedValue(answer([]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(MAX_FETCHES_PER_RUN);
    const dates = h.fetchFlightLegs.mock.calls.map((c) => c[0].date);
    expect(dates).toEqual(['2026-12-13', '2026-12-13', '2026-12-13', '2026-12-14']);
    expect(events('flight check run')[0]?.context.detail).toBe('over_cap=2');
  });

  it(`a dev build spends at most ${DEV_DAILY_FETCH_CAP} provider fetches a day, then skips`, async () => {
    vi.stubEnv('DEV', true);
    // Twelve flights, all due: three runs fetch 4 + 4 + 2, the fourth fetches nothing.
    vacationsState.vacations = [
      trip(
        Array.from({ length: 12 }, (_, i) =>
          makeFlight({ id: `s${i}`, departureDate: '2026-12-13', departureTime: `${10 + i}:00` })
        )
      ),
    ];
    h.fetchFlightLegs.mockResolvedValue(answer([]));
    const store = useFlightStatusStore();
    for (let i = 0; i < 4; i++) await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(DEV_DAILY_FETCH_CAP);
    const runs = events('flight check run').map((e) => e.context.detail);
    expect(runs[2]).toContain('dev_cap=2');
    expect(runs[3]).toContain('dev_cap=2');
    // Said once per day, on the console as well as the firehose.
    expect(events('flight check dev budget spent')).toHaveLength(1);
    expect(events('flight check dev budget spent')[0]?.context).toEqual({
      action: 'refused',
      detail: 'dev_cap',
      count: DEV_DAILY_FETCH_CAP,
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('provider fetches for today')
    );

    // The next UTC day starts fresh: the 10 checked flights are stale too, so a full batch goes.
    vi.setSystemTime(Date.parse('2026-12-13T00:00:01Z'));
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(DEV_DAILY_FETCH_CAP + MAX_FETCHES_PER_RUN);
  });
});

describe('the entry check (a flight far outside its window)', () => {
  const DAY = 24 * 60 * MIN;
  const FAR = '2027-06-10';
  const far = (over: Partial<VacationTravelSegment> = {}) =>
    makeFlight({ departureDate: FAR, arrivalDate: FAR, ...over });
  const farLeg = (terminal = '2') =>
    makeLeg({
      dep: { scheduledLocal: `${FAR} 17:00+08:00`, scheduledUtc: `${FAR} 09:00Z`, terminal },
      arr: { scheduledLocal: `${FAR} 23:10+00:00`, scheduledUtc: `${FAR} 23:10Z` },
    });
  const stamps = () => readFlightStatusCache('fam-1')?.entryChecked ?? {};

  beforeEach(() => {
    vacationsState.vacations = [trip([far()])];
  });

  it('fetches once on the first run and stamps; a later run, even after the check is pruned, does not', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg()]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(stamps()['seg-1']).toBe('SQ318|2027-06-10|SIN|LHR');
    expect(events('flight entry check')[0]?.context).toEqual({
      action: 'entry_check',
      kind: 'segment-changed',
      count: 1,
    });
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    // 8 days on the 7-day check is pruned; the stamp still holds the flight back.
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    expect(store.checks['seg-1']).toBeUndefined();
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(events('flight entry check')).toHaveLength(1);
  });

  it('a changed number, date or airport is a new question and fetches again', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    const edits: Array<Partial<VacationTravelSegment>> = [
      { flightNumber: 'SQ319' },
      { flightNumber: 'SQ319', departureDate: '2027-06-11' },
      { flightNumber: 'SQ319', departureDate: '2027-06-11', departureAirport: 'Hong Kong (HKG)' },
      {
        flightNumber: 'SQ319',
        departureDate: '2027-06-11',
        departureAirport: 'Hong Kong (HKG)',
        arrivalAirport: 'Gatwick (LGW)',
      },
    ];
    let calls = 1;
    for (const edit of edits) {
      vacationsState.vacations = [trip([far(edit)])];
      await store.run('segment-changed');
      expect(h.fetchFlightLegs).toHaveBeenCalledTimes(++calls);
    }
  });

  it('a failed entry fetch is stamped and not re-asked after its backoff', async () => {
    h.fetchFlightLegs.mockRejectedValue(new FlightStatusApiError('http_5xx', 'down', 503));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(stamps()['seg-1']).toBeDefined();
    vi.setSystemTime(NOW + 2 * 60 * MIN);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
  });

  it('a flight cut by over_cap is not stamped, and goes on the next run', async () => {
    vacationsState.vacations = [
      trip(Array.from({ length: 6 }, (_, i) => far({ id: `s${i}`, departureTime: `0${i}:00` }))),
    ];
    h.fetchFlightLegs.mockResolvedValue(answer([]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(Object.keys(stamps())).toHaveLength(MAX_FETCHES_PER_RUN);
    expect(events('flight entry check')[0]?.context.count).toBe(MAX_FETCHES_PER_RUN);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(6);
    expect(Object.keys(stamps())).toHaveLength(6);
  });

  it('a flight cut by dev_cap is not stamped either', async () => {
    vi.stubEnv('DEV', true);
    takeDevFetchTokens(DEV_DAILY_FETCH_CAP - 2, NOW);
    vacationsState.vacations = [
      trip(Array.from({ length: 4 }, (_, i) => far({ id: `s${i}`, departureTime: `0${i}:00` }))),
    ];
    h.fetchFlightLegs.mockResolvedValue(answer([]));
    await useFlightStatusStore().run('open');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(events('flight check run')[0]?.context.detail).toContain('dev_cap=2');
    expect(Object.keys(stamps()).sort()).toEqual(['s0', 's1']);
    expect(events('flight entry check')[0]?.context.count).toBe(2);
  });

  it('a far-out change whose write failed is retried from the cache next run: no provider call', async () => {
    h.writeResult = 'failed';
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg('3')]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(updateSegment).toHaveBeenCalledTimes(1);
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: false });
    h.writeResult = 'saved';
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(events('flight check run').at(-1)?.context.detail).toBe('out_of_window=1');
    expect(updateSegment).toHaveBeenCalledTimes(2);
    expect(segment().terminal).toBe('3');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: true });
    expect(events('flight change write retried')[0]?.context).toEqual({
      action: 'apply_retry',
      count: 1,
      notif_skipped: 0,
    });
  });

  it('a corrected airport drops the old answer: a failed re-ask does not keep "Couldn\'t find this flight"', async () => {
    vacationsState.vacations = [trip([far({ departureAirport: 'Hong Kong (HKG)' })])];
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg()]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(store.verificationFor('seg-1')).toMatchObject({
      state: 'unavailable',
      reason: 'no_match',
    });
    vacationsState.vacations = [trip([far()])];
    h.fetchFlightLegs.mockRejectedValue(new FlightStatusApiError('http_5xx', 'down', 503));
    await store.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(store.checks['seg-1']).toBeUndefined();
    expect(readFlightStatusCache('fam-1')?.checks['seg-1']).toBeUndefined();
    expect(store.verificationFor('seg-1')).toMatchObject({
      state: 'unavailable',
      reason: 'before_window',
    });
  });

  it('an in-window flight is not an entry check', async () => {
    vacationsState.vacations = [trip([makeFlight()])];
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    await useFlightStatusStore().run('open');
    expect(events('flight entry check')).toHaveLength(0);
    expect(stamps()).toEqual({});
  });

  it('a far-out change stays dismissed across a prune 8 days later', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg('3')]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed' });
    const id = liveNoticeId('seg-1', segment('seg-1'))!;
    store.noticeFirstSeen(id, 'seg-1');
    expect(store.dismissNotice('seg-1')).toBe(true);
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);
    expect(readFlightStatusCache('fam-1')?.dismissed[id]).toBeDefined();
    expect(readFlightStatusCache('fam-1')?.noticed[id]).toBeDefined();
  });

  it('a far-out written cancellation keeps its dismissal and notice stamp across the prune', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([{ ...farLeg(), status: 'Canceled' }]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'cancelled', applied: true });
    const bellId = liveNoticeId('seg-1', segment('seg-1'))!;
    store.noticeFirstSeen(bellId, 'seg-1');
    expect(store.dismissNotice('seg-1')).toBe(true);
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);
    expect(readFlightStatusCache('fam-1')?.noticed[bellId]).toBeDefined();
  });

  it('synced live fields with no notice left do not hold notice state past the floor', async () => {
    // This device does not check (switch off): the synced fields alone decide.
    settings.liveFlightChecksEnabled = false;
    const at = new Date(NOW).toISOString();
    vacationsState.vacations = [
      trip([
        far({
          departureTime: '18:30',
          liveRevision: 'rev-far',
          liveAppliedAt: at,
          liveWas: { departureTime: '17:00', at },
        }),
      ]),
    ];
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed' });
    const id = liveNoticeId('seg-1', segment('seg-1'))!;
    store.noticeFirstSeen(id, 'seg-1');
    expect(store.dismissNotice('seg-1')).toBe(true);
    // Put back by hand on another device: the plan matches `liveWas` again, so there is no
    // notice, while the synced live fields (and so the bell id) stay.
    segment('seg-1').departureTime = '17:00';
    expect(store.verificationFor('seg-1')?.state).toBe('unavailable');
    expect(liveNoticeId('seg-1', segment('seg-1'))).toBe(id);
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    const cached = readFlightStatusCache('fam-1')!;
    expect(cached.dismissed[id]).toBeUndefined();
    expect(cached.noticed[id]).toBeUndefined();
  });

  it('registers no flight alert for a flight outside its window (Phase 2 untouched)', async () => {
    h.platform = 'ios';
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg()]));
    await useFlightStatusStore().run('open');
    expect(h.subscribeAlert).not.toHaveBeenCalled();
  });
});

describe('option C: unresolved far-out answers', () => {
  const DAY = 24 * 60 * MIN;
  const FAR = '2027-06-10';
  const far = (over: Partial<VacationTravelSegment> = {}) =>
    makeFlight({ departureDate: FAR, arrivalDate: FAR, ...over });
  const farLeg = (terminal = '2') =>
    makeLeg({
      dep: { scheduledLocal: `${FAR} 17:00+08:00`, scheduledUtc: `${FAR} 09:00Z`, terminal },
      arr: { scheduledLocal: `${FAR} 23:10+00:00`, scheduledUtc: `${FAR} 23:10Z` },
    });

  beforeEach(() => {
    vacationsState.vacations = [trip([far()])];
  });

  it('an unresolved answer that ages out releases its stamp and is asked once more, same run', async () => {
    h.writeResult = 'failed';
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg('3')]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(events('flight entry stamp released')[0]?.context).toEqual({
      action: 'entry_released',
      count: 1,
    });
  });

  it('a "no such flight" answer is released too; a verified one is never asked again', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({ number: 'SQ 999' })]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(store.verificationFor('seg-1')).toMatchObject({ reason: 'no_match' });
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);

    h.fetchFlightLegs.mockReset();
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg('2')]));
    setActivePinia(createPinia());
    localStorage.clear();
    const other = useFlightStatusStore();
    vi.setSystemTime(NOW);
    await other.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 8 * DAY);
    await other.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
  });

  it('an out-of-window owed write backs off 5, 10 minutes, then retries and clears on success', async () => {
    h.writeResult = 'failed';
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg('3')]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(updateSegment).toHaveBeenCalledTimes(1);

    await store.run('tick'); // first owed retry: fails, backs off 5 min
    expect(updateSegment).toHaveBeenCalledTimes(2);

    expect(events('flight change write retried')).toHaveLength(1);
    expect(events('flight change write retried')[0]).toMatchObject({
      level: 'info',
      context: { action: 'apply_retry', count: 1, notif_skipped: 0 },
    });

    vi.setSystemTime(NOW + 1 * MIN);
    await store.run('tick');
    expect(updateSegment).toHaveBeenCalledTimes(2);
    // Everything owed is waiting out its backoff: the deferral still shows, at debug.
    expect(events('flight change write retried')).toHaveLength(2);
    expect(events('flight change write retried')[1]).toMatchObject({
      level: 'debug',
      context: { action: 'apply_retry', count: 0, notif_skipped: 1 },
    });

    vi.setSystemTime(NOW + 6 * MIN);
    await store.run('tick'); // due: fails again, backs off 10 min
    expect(updateSegment).toHaveBeenCalledTimes(3);
    vi.setSystemTime(NOW + 12 * MIN);
    await store.run('tick');
    expect(updateSegment).toHaveBeenCalledTimes(3);

    h.writeResult = 'saved';
    vi.setSystemTime(NOW + 17 * MIN);
    await store.run('tick');
    expect(updateSegment).toHaveBeenCalledTimes(4);
    expect(segment().terminal).toBe('3');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
  });
});

describe('option C: who may resolve, and the retry event', () => {
  const DAY = 24 * 60 * MIN;
  const FAR = '2027-06-10';
  const farLeg = makeLeg({
    dep: { scheduledLocal: `${FAR} 17:00+08:00`, scheduledUtc: `${FAR} 09:00Z`, terminal: '3' },
    arr: { scheduledLocal: `${FAR} 23:10+00:00`, scheduledUtc: `${FAR} 23:10Z` },
  });

  it('a change a view-only device may not write keeps its stamp: not asked again', async () => {
    vacationsState.vacations = [trip([makeFlight({ departureDate: FAR, arrivalDate: FAR })])];
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(events('flight entry stamp released')).toHaveLength(0);
  });

  it('an editor whose member has not resolved yet at prune is not stranded: the stamp is released', async () => {
    vacationsState.vacations = [trip([makeFlight({ departureDate: FAR, arrivalDate: FAR })])];
    // Before the member resolves, the edit permission reads false on an editor's device too.
    canEdit.value = false;
    family.currentMember = null;
    h.fetchFlightLegs.mockResolvedValue(answer([farLeg]));
    const store = useFlightStatusStore();
    await store.run('segment-changed');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 8 * DAY);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(events('flight entry stamp released')).toHaveLength(1);
  });

  it('a retry run that defers some owed writes counts them in notif_skipped', async () => {
    vacationsState.vacations = [
      trip([makeFlight(), makeFlight({ id: 'seg-2', departureDate: FAR, arrivalDate: FAR })]),
    ];
    h.writeResult = 'failed';
    h.fetchFlightLegs.mockImplementation(async ({ date }: { date: string }) =>
      answer([date === FAR ? farLeg : moved])
    );
    const store = useFlightStatusStore();
    await store.run('open');
    await store.run('tick'); // both owed and retried; the far one backs off 5 min
    vi.setSystemTime(NOW + 1 * MIN);
    await store.run('tick');
    expect(events('flight change write retried').at(-1)).toMatchObject({
      level: 'info',
      context: { action: 'apply_retry', count: 1, notif_skipped: 1 },
    });
    expect(events('flight change write retried').at(-1)?.context).toEqual({
      action: 'apply_retry',
      count: 1,
      notif_skipped: 1,
    });
  });
});

describe('revert and take the airline', () => {
  it('"Put it back" is a Conflict; "Use the airline\'s" is changed again', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(await store.revert('seg-1')).toBe('saved');
    expect(segment()).toMatchObject({ departureTime: '17:00', terminal: 'Terminal 2' });
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    expect(events('flight change reverted')).toHaveLength(1);
    expect(events('flight change reverted')[0]?.context).toEqual({
      action: 'reverted',
      detail: 'revert',
    });

    // A later run must not undo the family's choice.
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(segment().departureTime).toBe('17:00');
    expect(events('flight conflict shown')).toHaveLength(1);

    expect((await store.takeAirline('seg-1')).result).toBe('saved');
    expect(segment().departureTime).toBe('18:30');
    expect(store.verificationFor('seg-1')?.state).toBe('changed');
    expect(events('flight airline taken')[0]?.context.action).toBe('take_airline');
  });

  it('put back → take, twice: ONE notes line, and liveAppliedAt never restamped', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    const appliedNotes = segment().notes;
    const appliedAt = segment().liveAppliedAt;
    expect(appliedNotes?.match(/Changed on/g)).toHaveLength(1);
    for (let i = 0; i < 2; i++) {
      vi.setSystemTime(NOW + LATER * (i + 1));
      expect(await store.revert('seg-1')).toBe('saved');
      expect((await store.takeAirline('seg-1')).result).toBe('saved');
    }
    expect(segment().notes).toBe(appliedNotes);
    expect(segment().liveAppliedAt).toBe(appliedAt);
    expect(store.verificationFor('seg-1')?.state).toBe('changed');
  });

  it('"Put it back" with nothing recorded to restore writes nothing and says so', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(await store.revert('seg-1')).toBe('missing');
    expect(updateSegment).not.toHaveBeenCalled();
    expect(events('flight change reverted')).toHaveLength(0);
    expect(events('flight revert skipped')[0]?.context).toEqual({
      action: 'revert_skipped',
      detail: 'no_was',
    });
  });

  it('take the airline without a cached leg is missing', async () => {
    expect((await useFlightStatusStore().takeAirline('seg-1')).result).toBe('missing');
  });
});

describe('one-step conflict resolution (take the airline, then Undo)', () => {
  /** The airline moved the flight, the plan took it, then the family edited the time by hand. */
  async function handEditConflict() {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({ ...s, departureTime: '19:00' }));
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    return store;
  }

  it('take folds the notice it would raise; Undo gives the family values and the visible Conflict back', async () => {
    const store = await handEditConflict();
    const { result, undo } = await store.takeAirline('seg-1');
    expect(result).toBe('saved');
    expect(segment().departureTime).toBe('18:30');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', dismissed: true });
    expect(events('flight notice dismissed').at(-1)?.context).toMatchObject({
      action: 'dismissed',
      detail: 'take_airline',
    });

    expect(await undo!()).toBe('saved');
    expect(segment().departureTime).toBe('19:00');
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();
    expect(events('flight notice reopened')).toHaveLength(1);
    expect(events('flight notice reopened')[0]?.context).toMatchObject({ detail: 'undo_take' });
    expect(events('flight change reverted').at(-1)?.context).toEqual({ action: 'undo_take' });
  });

  it('a failed Undo is logged as undo_failed, never as a Put it back failure', async () => {
    const store = await handEditConflict();
    const { undo } = await store.takeAirline('seg-1');
    h.writeResult = 'failed';
    expect(await undo!()).toBe('failed');
    expect(events('flight change apply failed').at(-1)?.context).toEqual({
      action: 'undo_failed',
      save_status: 'failed',
    });
    expect(events('flight notice reopened')).toHaveLength(0);
  });

  it('a cancel-Conflict taken on the provider path: Undo puts the status and the Conflict back', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({ status: 'Canceled' })]));
    const store = useFlightStatusStore();
    await store.run('open');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({ ...s, status: 'booked' as const }));
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    const { result, undo } = await store.takeAirline('seg-1');
    expect(result).toBe('saved');
    expect(segment().status).toBe('pending');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'cancelled', dismissed: true });
    expect(await undo!()).toBe('saved');
    expect(updateSegment.mock.calls.at(-1)?.[2]).toEqual({ status: 'booked' });
    expect(segment().status).toBe('booked');
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();
  });

  it('a Conflict the person had already folded stays folded after Undo, with no false reopen', async () => {
    const store = await handEditConflict();
    expect(store.dismissNotice('seg-1')).toBe(true);
    const { undo } = await store.takeAirline('seg-1');
    expect(await undo!()).toBe('saved');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'conflict', dismissed: true });
    expect(events('flight notice reopened')).toHaveLength(0);
  });

  it('"Got it" folds a Conflict on a flight whose revision was recorded with no announced change', async () => {
    vacationsState.vacations = [trip([makeFlight({ terminal: undefined })])];
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({ ...s, departureTime: '19:00' }));
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    expect(liveNoticeId('seg-1', segment())).toBeNull();
    expect(store.dismissNotice('seg-1')).toBe(true);
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'conflict', dismissed: true });
    expect(events('flight notice dismiss skipped')).toHaveLength(0);
    // The fold survives a prune (its key is a live notice id) and the chip reopens it.
    await store.run('tick');
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);
    expect(store.showNotice('seg-1')).toBe(true);
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();
  });

  it('taking the airline over a quiet-fill Conflict leaves no notice to fold, and Undo restores it open', async () => {
    vacationsState.vacations = [trip([makeFlight({ terminal: undefined })])];
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({ ...s, departureTime: '19:00' }));
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    const { result, undo } = await store.takeAirline('seg-1');
    expect(result).toBe('saved');
    expect(events('flight notice dismiss skipped')).toHaveLength(0);
    // The plan now agrees with the airline: no notice is left, so nothing is folded.
    expect(events('flight notice dismissed')).toHaveLength(0);
    expect(await undo!()).toBe('saved');
    expect(segment().departureTime).toBe('19:00');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'conflict' });
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();
  });

  it('a fold the person re-made during the toast is theirs: Undo leaves it, with no reopen', async () => {
    const store = await handEditConflict();
    const { undo } = await store.takeAirline('seg-1');
    // Same millisecond as the take's fold: ownership is by action, not by timestamp.
    expect(store.showNotice('seg-1')).toBe(true);
    expect(store.dismissNotice('seg-1')).toBe(true);
    expect(await undo!()).toBe('saved');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'conflict', dismissed: true });
    const undoReopens = events('flight notice reopened').filter(
      (e) => e.context.detail === 'undo_take'
    );
    expect(undoReopens).toHaveLength(0);
  });

  it('a take that records a newer airline revision is announced like any change: no Undo, no fold', async () => {
    // The change was not written (no permission), so the plan still holds the old values when
    // the person taps: the take records the airline's revision through planChange.
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: false });
    canEdit.value = true;
    const out = await store.takeAirline('seg-1');
    expect(out).toEqual({ result: 'saved' });
    expect(segment().liveRevision).toBeDefined();
    expect(segment().notes).toMatch(/Changed on/);
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: true });
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();
    expect(events('flight notice dismissed')).toHaveLength(0);
  });

  it('Undo of a take that moved the date writes the custom sortDate back with it', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([nextDay]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(segment().departureDate).toBe('2026-12-14');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map((s) => ({
      ...s,
      departureDate: '2026-12-13',
      sortDate: '2026-12-01',
    }));
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    const { undo } = await store.takeAirline('seg-1');
    expect(segment().departureDate).toBe('2026-12-14');
    expect(await undo!()).toBe('saved');
    // `updateSegment` only fills sortDate from departureDate when the patch names none.
    expect(updateSegment.mock.calls.at(-1)?.[2]).toMatchObject({
      departureDate: '2026-12-13',
      sortDate: '2026-12-01',
    });
  });

  it('Undo of a take that moved the date on a segment with no sortDate clears the one the move added', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([nextDay]));
    const store = useFlightStatusStore();
    await store.run('open');
    const v = vacationsState.vacations[0]!;
    v.travelSegments = v.travelSegments.map(({ sortDate: _s, ...s }) => ({
      ...s,
      departureDate: '2026-12-13',
    }));
    expect('sortDate' in segment()).toBe(false);
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    const { undo } = await store.takeAirline('seg-1');
    expect(await undo!()).toBe('saved');
    const patch = updateSegment.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(patch).toMatchObject({ departureDate: '2026-12-13' });
    // Present and undefined: `updateSegment` keeps it (no re-derive) and the write clears it.
    expect('sortDate' in patch).toBe(true);
    expect(patch.sortDate).toBeUndefined();
  });

  it('a failed take has no Undo and folds nothing', async () => {
    const store = await handEditConflict();
    h.writeResult = 'failed';
    const out = await store.takeAirline('seg-1');
    expect(out).toEqual({ result: 'failed' });
    expect(events('flight notice dismissed')).toHaveLength(0);
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
  });
});

describe('"Got it" on this device', () => {
  it('folds the notice for the current revision, survives a new session, and the chip reopens it', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed' });
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();

    expect(store.dismissNotice('seg-1')).toBe(true);
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);
    expect(events('flight notice dismissed')[0]?.context).toEqual({
      action: 'dismissed',
      flight_state: 'changed',
    });
    // Device state only: nothing more was written to the pod.
    expect(updateSegment).toHaveBeenCalledTimes(1);

    setActivePinia(createPinia());
    const fresh = useFlightStatusStore();
    expect(fresh.verificationFor('seg-1')?.dismissed).toBe(true);

    expect(fresh.showNotice('seg-1')).toBe(true);
    expect(fresh.verificationFor('seg-1')?.dismissed).toBeUndefined();
    expect(events('flight notice reopened')).toHaveLength(1);
  });

  it('a new airline revision is a new, undismissed notice', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    store.dismissNotice('seg-1');
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);

    vi.setSystemTime(NOW + LATER);
    h.fetchFlightLegs.mockResolvedValue(answer([nextDay]));
    await store.run('tick');
    expect(updateSegment).toHaveBeenCalledTimes(2);
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed' });
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();
  });

  it('an airline change not in the plan (no permission) can be dismissed, and stays dismissed', async () => {
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: false });
    expect(store.dismissNotice('seg-1')).toBe(true);
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);
    expect(events('flight notice dismiss skipped')).toHaveLength(0);
    // The next due run brings the same answer: still folded, and in a new session too.
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);
    setActivePinia(createPinia());
    expect(useFlightStatusStore().verificationFor('seg-1')?.dismissed).toBe(true);
  });

  it('a new airline revision reopens a dismissed change that is not in the plan', async () => {
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.dismissNotice('seg-1')).toBe(true);
    vi.setSystemTime(NOW + LATER);
    h.fetchFlightLegs.mockResolvedValue(answer([nextDay]));
    await store.run('tick');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'changed', applied: false });
    expect(store.verificationFor('seg-1')?.dismissed).toBeUndefined();
  });

  it('a cancellation dismissed before its write lands stays dismissed once written', async () => {
    canEdit.value = false;
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({ status: 'Canceled' })]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'cancelled', applied: false });
    expect(store.dismissNotice('seg-1')).toBe(true);
    // The member gains the edit permission; the next run writes the cancellation.
    canEdit.value = true;
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(segment().liveCancelledAt).toBeDefined();
    expect(store.verificationFor('seg-1')).toMatchObject({ state: 'cancelled', applied: true });
    expect(store.verificationFor('seg-1')?.dismissed).toBe(true);
  });

  it("a finished flight's notice state drops at the first prune a week on", async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    const id = liveNoticeId('seg-1', segment())!;
    store.noticeFirstSeen(id, 'seg-1');
    expect(store.dismissNotice('seg-1')).toBe(true);
    // The flight landed on the 13th; the segment (and its notice id) is still in the trip.
    vi.setSystemTime(NOW + 8 * 24 * 60 * MIN);
    await store.run('tick');
    expect(liveNoticeId('seg-1', segment())).toBe(id);
    const cached = readFlightStatusCache('fam-1')!;
    expect(cached.dismissed[id]).toBeUndefined();
    expect(cached.noticed[id]).toBeUndefined();
  });

  it('a flight with nothing to tell has nothing to dismiss, and says so', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.dismissNotice('seg-1')).toBe(false);
    expect(events('flight notice dismiss skipped')[0]?.context).toEqual({
      action: 'dismiss_skipped',
      detail: 'no_notice',
    });
  });
});

describe('cache and sign-out', () => {
  it('a new session hydrates the checks from the device cache', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    await useFlightStatusStore().run('open');
    expect(readFlightStatusCache('fam-1')?.checks['seg-1']).toBeDefined();
    setActivePinia(createPinia());
    const fresh = useFlightStatusStore();
    expect(fresh.verificationFor('seg-1')?.state).toBe('verified');
    await fresh.run('open');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
  });

  it('haltForSignOut aborts, drops a late answer, and deletes the cache', async () => {
    let resolve!: (v: unknown) => void;
    h.fetchFlightLegs.mockImplementation(() => new Promise((r) => (resolve = r)));
    const store = useFlightStatusStore();
    const running = store.request('open');
    await settle();
    const halting = store.haltForSignOut();
    resolve(answer([moved]));
    await halting;
    await running;
    expect(updateSegment).not.toHaveBeenCalled();
    expect(store.checks).toEqual({});
    expect(localStorage.getItem(STORAGE_KEYS.FLIGHT_STATUS)).toBeNull();
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
  });
});

describe('"Check now" (a manual check)', () => {
  it('asks again once the last answer is five minutes old, and says fresh before that', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + 4 * MIN);
    expect(store.checkNow(['seg-1'])).toBe('fresh');
    await settle();
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + 5 * MIN);
    expect(store.checkNow(['seg-1'])).toBe('started');
    await settle();
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
    expect(store.verificationFor('seg-1')?.checkedAt).toBe(NOW + 5 * MIN);
    expect(events('flight check run').at(-1)?.context.kind).toBe('manual');
    expect(events('flight manual check').map((e) => e.context)).toEqual([
      { action: 'manual_check', kind: 'manual', count: 0, detail: 'fresh:fresh' },
      { action: 'manual_check', kind: 'manual', count: 1, detail: 'started' },
    ]);

    // The tap lowered the floor for that run only: a tick right after asks nothing.
    await store.run('tick');
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(2);
  });

  it('starts nothing offline or for an unknown flight, and names the reason', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    vi.setSystemTime(NOW + 10 * MIN);
    online.value = false;
    expect(store.checkNow(['seg-1', 'gone'])).toBe('not_due');
    await settle();
    expect(h.fetchFlightLegs).toHaveBeenCalledTimes(1);
    expect(events('flight manual check').at(-1)?.context.detail).toBe('not_due:offline');
    online.value = true;
  });
});

describe('triggers', () => {
  it('setup asks once on open, is idempotent, and the poll and online ask again', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([]));
    const store = useFlightStatusStore();
    store.setup();
    store.setup();
    await settle();
    expect(events('flight check run').map((e) => e.context.kind)).toEqual(['open']);
    await h.poll!();
    online.value = false;
    await settle();
    online.value = true;
    await settle();
    expect(events('flight check run').map((e) => e.context.kind)).toEqual([
      'open',
      'tick',
      'online',
    ]);
  });
});

describe('privacy', () => {
  it('no flight number, date, time or airport is ever logged', async () => {
    h.fetchFlightLegs.mockResolvedValueOnce(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    await store.revert('seg-1');
    h.fetchFlightLegs.mockRejectedValue(new FlightStatusApiError('http_5xx', 'down', 503));
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    const logged = JSON.stringify(h.logEvent.mock.calls.map((c) => c[0].context));
    for (const leak of ['SQ', '318', '2026-', '18:30', '17:00', 'SIN', 'LHR', 'Terminal']) {
      expect(logged).not.toContain(leak);
    }
  });
});

describe('flight alerts (Phase 2): the reconcile', () => {
  const LEG_REV = revisionOf(tupleFromLeg(makeLeg({})));
  const body = (over: object = {}) => ({
    flight: 'SQ318',
    date: '2026-12-13',
    dep: 'SIN',
    arr: 'LHR',
    rev: LEG_REV,
    platform: 'ios',
    lang: 'en',
    token: 'tok-1',
    alert: ALERT_TOKEN,
    ...over,
  });

  beforeEach(() => {
    h.platform = 'ios';
  });

  it('web registers nothing and never asks for a token', async () => {
    h.platform = null;
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    await useFlightStatusStore().run('open');
    expect(h.ensurePushToken).not.toHaveBeenCalled();
    expect(h.subscribeAlert).not.toHaveBeenCalled();
  });

  it('acquires a push token first, then registers the matched flight in the same run', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.ensurePushToken).toHaveBeenCalledTimes(1);
    expect(h.ensurePushToken.mock.invocationCallOrder[0]!).toBeLessThan(
      h.subscribeAlert.mock.invocationCallOrder[0]!
    );
    expect(h.subscribeAlert).toHaveBeenCalledWith(body());
    expect(store.alerts['seg-1']).toEqual({
      flight: 'SQ318',
      date: '2026-12-13',
      dep: 'SIN',
      arr: 'LHR',
      rev: LEG_REV,
      confirmed: true,
    });
    expect(readFlightStatusCache('fam-1')).toMatchObject({
      pushToken: 'tok-1',
      alerts: { 'seg-1': { rev: LEG_REV } },
    });
    expect(events('alert reconcile')[0]?.context).toEqual({
      action: 'alert_reconcile',
      count: 1,
      notif_skipped: 0,
      detail: 'sub=1,reconfirm=0,unsub=0,over_cap=0',
    });
    expect(events('alert subscribed')[0]?.context).toEqual({
      action: 'alert_subscribed',
      os: 'ios',
      detail: 'ready',
    });

    // Nothing changed: the next run makes no call and logs no reconcile.
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(h.subscribeAlert).toHaveBeenCalledTimes(1);
    expect(events('alert reconcile')).toHaveLength(1);
  });

  it('an unreadable (unknown) answer logs alert_subscribed at warn; ready and pending stay info', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.subscribeAlert.mockResolvedValueOnce({ provider: 'unknown' });
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.alerts['seg-1']?.confirmed).toBe(false);
    const logged = events('alert subscribed')[0];
    expect(logged?.level).toBe('warn');
    expect(logged?.context).toMatchObject({ action: 'alert_subscribed', detail: 'unknown' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('alerts.mjs'));
    warn.mockRestore();
  });

  it('an unknown answer still logs the drift warning when the family switched mid-call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.subscribeAlert.mockImplementationOnce(async () => {
      familyContext.activeFamilyId = 'fam-2';
      return { provider: 'unknown' };
    });
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    const logged = events('alert subscribed')[0];
    expect(logged?.level).toBe('warn');
    expect(logged?.context).toMatchObject({ detail: 'unknown' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('alerts.mjs'));
    expect(store.alerts['seg-1']).toBeUndefined();
    familyContext.activeFamilyId = 'fam-1';
    warn.mockRestore();
  });

  it('a pending answer is recorded unconfirmed, re-asked next run, and a ready answer settles it', async () => {
    h.subscribeAlert.mockResolvedValueOnce({ provider: 'pending' });
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.alerts['seg-1']?.confirmed).toBe(false);
    expect(events('alert subscribed')[0]?.context).toMatchObject({ detail: 'pending' });
    expect(events('alert subscribed')[0]?.level).toBe('info');

    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(h.subscribeAlert).toHaveBeenCalledTimes(2);
    expect(h.subscribeAlert).toHaveBeenLastCalledWith(body());
    expect(events('alert reconcile')[1]?.context?.detail).toBe(
      'sub=1,reconfirm=1,unsub=0,over_cap=0'
    );
    expect(store.alerts['seg-1']?.confirmed).toBe(true);

    vi.setSystemTime(NOW + 2 * LATER);
    await store.run('tick');
    expect(h.subscribeAlert).toHaveBeenCalledTimes(2);
  });

  it('no token (no permission, an OS refusal) registers nothing this run', async () => {
    h.ensurePushToken.mockResolvedValue(null);
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(h.subscribeAlert).not.toHaveBeenCalled();
    expect(store.alerts).toEqual({});
  });

  it('a token that does not come within the wait is reported as a timeout', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    h.ensurePushToken.mockReturnValue(new Promise(() => {}));
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const running = useFlightStatusStore().run('open');
    await vi.advanceTimersByTimeAsync(5_000);
    await running;
    expect(h.reportPushTokenFailure).toHaveBeenCalledWith('timeout');
    expect(h.subscribeAlert).not.toHaveBeenCalled();
  });

  it('nothing desired (alerts off): no token is requested and no call is made', async () => {
    settings.liveFlightChangeAlerts = false;
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    await useFlightStatusStore().run('open');
    expect(h.ensurePushToken).not.toHaveBeenCalled();
    expect(h.subscribeAlert).not.toHaveBeenCalled();
  });

  it('a flight no longer desired is unsubscribed under its token and forgotten', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    settings.liveFlightChangeAlerts = false;
    await store.run('tick');
    expect(h.unsubscribeAlert).toHaveBeenCalledWith({
      flight: 'SQ318',
      date: '2026-12-13',
      token: 'tok-1',
    });
    expect(store.alerts).toEqual({});
    expect(events('alert unsubscribed')[0]?.context).toEqual({
      action: 'alert_unsubscribed',
      os: 'ios',
    });
  });

  it('a rotated push token re-subscribes under the new one and unsubscribes the old', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    store.setup();
    await settle();
    expect(h.subscribeAlert).toHaveBeenCalledTimes(1);
    osPushToken.value = 'tok-2';
    h.tokenChanged!();
    await settle();
    expect(events('flight check run').map((e) => e.context.kind)).toContain('push-token');
    expect(h.unsubscribeAlert).toHaveBeenCalledWith({
      flight: 'SQ318',
      date: '2026-12-13',
      token: 'tok-1',
    });
    expect(h.subscribeAlert).toHaveBeenLastCalledWith(body({ token: 'tok-2' }));
    expect(readFlightStatusCache('fam-1')?.pushToken).toBe('tok-2');
    expect(store.alerts['seg-1']).toBeDefined();
  });

  it('a rejected alert token is logged, never offered again this session, and its flights leave', async () => {
    h.subscribeAlert.mockRejectedValue(
      new FlightStatusApiError(
        'http_4xx',
        'flight-status/subscribe answered HTTP 401',
        401,
        'alert_token_rejected'
      )
    );
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(events('alert subscribe failed')[0]?.context).toEqual({
      action: 'alert_subscribe_failed',
      error_code: 'alert_token_rejected',
      http_status: 401,
      os: 'ios',
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('alert_token_rejected'));
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(h.subscribeAlert).toHaveBeenCalledTimes(1);
    // A different token from the registry is offered again.
    entitlement.flightAlertToken = 'v1.1800003600.bmV3';
    await store.run('tick');
    expect(h.subscribeAlert).toHaveBeenCalledTimes(2);
  });

  it('a store fault (503) records nothing and the next run retries', async () => {
    h.subscribeAlert.mockRejectedValueOnce(
      new FlightStatusApiError('http_5xx', 'down', 503, 'alerts_unavailable')
    );
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(store.alerts).toEqual({});
    await store.run('tick');
    expect(store.alerts['seg-1']).toBeDefined();
  });

  it('a new session hydrates the registrations and the token (snapshot / restore round trip)', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    await useFlightStatusStore().run('open');
    setActivePinia(createPinia());
    const fresh = useFlightStatusStore();
    await fresh.run('tick');
    expect(fresh.alerts['seg-1']?.rev).toBe(LEG_REV);
    expect(h.subscribeAlert).toHaveBeenCalledTimes(1);
  });

  it('sign-out unsubscribes every registration first, logs it, then deletes the cache', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    await store.haltForSignOut();
    expect(h.unsubscribeAlert).toHaveBeenCalledWith({
      flight: 'SQ318',
      date: '2026-12-13',
      token: 'tok-1',
    });
    expect(events('alert unsubscribe on sign-out')[0]?.context).toEqual({
      action: 'alert_unsubscribe_signout',
      count: 1,
      detail: 'ok=1,failed=0,timed_out=false',
    });
    expect(store.alerts).toEqual({});
    expect(localStorage.getItem(STORAGE_KEYS.FLIGHT_STATUS)).toBeNull();
  });

  it('logs no flight number, date, airport or token', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open');
    await store.haltForSignOut();
    const logged = JSON.stringify(h.logEvent.mock.calls.map((c) => c[0].context));
    for (const leak of ['SQ', '318', '2026-', 'SIN', 'LHR', 'tok-1', ALERT_TOKEN]) {
      expect(logged).not.toContain(leak);
    }
  });
});

describe('flight alerts (Phase 2): one notice per revision', () => {
  const MOVED_REV = revisionOf(tupleFromLeg(moved));
  const noticeId = () => liveNoticeId('seg-1', segment())!;
  /** The reminder builder's own rule: a notice fires only when fireAt is still ahead. */
  const fires = (stamp: number) => stamp + CHANGE_NOTICE_DELAY_MS > Date.now();

  beforeEach(() => {
    h.platform = 'ios';
  });

  /** Another device applied the airline's change; it reaches this device by sync. */
  function syncChangeIn(): void {
    const seg = segment();
    Object.assign(seg, {
      departureTime: '18:30',
      terminal: '3',
      liveRevision: MOVED_REV,
      liveWas: { departureTime: '17:00', terminal: 'Terminal 2', at: new Date(NOW).toISOString() },
      liveAppliedAt: new Date(NOW).toISOString(),
    });
  }

  it('a registration with the old rev pre-dates the stamp: no local notice, logged', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    canEdit.value = false;
    const store = useFlightStatusStore();
    await store.run('open'); // registered with the old revision
    syncChangeIn();
    const stamp = store.noticeFirstSeen(noticeId(), 'seg-1');
    expect(fires(stamp)).toBe(false);
    expect(events('notice suppressed')[0]?.context).toEqual({
      action: 'notice_suppressed',
      detail: 'push_registered',
    });
    // First-call-only: a later call returns the same stamp.
    expect(store.noticeFirstSeen(noticeId(), 'seg-1')).toBe(stamp);
  });

  it('an unconfirmed registration with the old rev never mutes the local notice', async () => {
    h.subscribeAlert.mockResolvedValue({ provider: 'pending' });
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    canEdit.value = false;
    const store = useFlightStatusStore();
    await store.run('open');
    syncChangeIn();
    expect(fires(store.noticeFirstSeen(noticeId(), 'seg-1'))).toBe(true);
    expect(events('notice suppressed')).toEqual([]);
  });

  it('no registration: the local notice fires', async () => {
    const store = useFlightStatusStore();
    syncChangeIn();
    expect(fires(store.noticeFirstSeen(noticeId(), 'seg-1'))).toBe(true);
    expect(events('notice suppressed')).toEqual([]);
  });

  it('the same run that applied it registers it: no push was owed, the local notice fires once', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(segment().liveRevision).toBe(MOVED_REV);
    expect(store.alerts['seg-1']?.rev).toBe(MOVED_REV);
    expect(fires(store.noticeFirstSeen(noticeId(), 'seg-1'))).toBe(true);
  });

  it('a registration moving to the new rev stamps the unstamped notice covered first', async () => {
    h.fetchFlightLegs.mockResolvedValueOnce(answer([makeLeg({})]));
    const store = useFlightStatusStore();
    await store.run('open'); // registered: old rev
    // The airline moved it; this device applies it and re-registers in the same run.
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(store.alerts['seg-1']?.rev).toBe(MOVED_REV);
    // The stamp was taken while the old registration was still held: covered.
    expect(fires(store.noticeFirstSeen(noticeId(), 'seg-1'))).toBe(false);
  });

  it('a covered stamp stays covered after the registration catches up', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([makeLeg({})]));
    canEdit.value = false;
    const store = useFlightStatusStore();
    await store.run('open');
    syncChangeIn();
    const stamp = store.noticeFirstSeen(noticeId(), 'seg-1');
    vi.setSystemTime(NOW + LATER);
    await store.run('tick'); // re-registers with the synced revision
    expect(store.alerts['seg-1']?.rev).toBe(MOVED_REV);
    expect(store.noticeFirstSeen(noticeId(), 'seg-1')).toBe(stamp);
    expect(fires(stamp)).toBe(false);
  });
});

describe('deepLinkFor (a push tap)', () => {
  it('the trip holding the flight, within a day of the pushed date; null when none', () => {
    const store = useFlightStatusStore();
    expect(store.deepLinkFor('SQ318', '2026-12-13')).toEqual({
      path: '/travel',
      query: { vacation: 'vac-1' },
    });
    expect(store.deepLinkFor('SQ318', '2026-12-12')).not.toBeNull();
    expect(store.deepLinkFor('SQ318', '2026-12-20')).toBeNull();
    expect(store.deepLinkFor('SQ999', '2026-12-13')).toBeNull();
  });
});

describe('trackUrlFor: the FlightAware link around the day of travel', () => {
  // makeFlight() leaves 2026-12-13 17:00 Singapore (09:00Z): NOW is exactly 24 h before.
  it('links from 24 h before departure', () => {
    const store = useFlightStatusStore();
    expect(store.trackUrlFor('seg-1')).toBe('https://www.flightaware.com/live/flight/SQ318');
  });

  it('plain text a minute before the window opens (the store clock is the input)', () => {
    vi.setSystemTime(NOW - MIN);
    const store = useFlightStatusStore();
    expect(store.trackUrlFor('seg-1')).toBeNull();
  });

  it('does not depend on the live-check switch or plan, and is null for an unknown segment', () => {
    settings.liveFlightChecksEnabled = false;
    Object.assign(entitlement, { enforces: true, state: 'expired' });
    const store = useFlightStatusStore();
    expect(store.trackUrlFor('seg-1')).not.toBeNull();
    expect(store.trackUrlFor('nope')).toBeNull();
  });
});
