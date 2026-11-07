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
import { DEV_DAILY_FETCH_CAP } from '@/services/flightStatus/devFetchBudget';

const NOW = Date.parse('2026-12-12T09:00:00Z');
const MIN = 60_000;
/** Past the per-flight floor: the moved flight leaves more than 24 h out (the 6 h interval). */
const LATER = 6 * 60 * MIN + MIN;

const h = vi.hoisted(() => ({
  logEvent: vi.fn(),
  fetchFlightLegs: vi.fn(),
  poll: null as (() => unknown) | null,
  writeResult: 'saved' as 'saved' | 'missing' | 'failed',
}));

vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/flightStatus/flightStatusApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/flightStatus/flightStatusApi')>()),
  fetchFlightLegs: h.fetchFlightLegs,
}));
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
const entitlement = reactive({
  enforces: false,
  state: 'trial' as string | null,
  plan: null as string | null,
});
vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => entitlement }));
const translation = reactive({ currentLanguage: 'en' as const, t });
vi.mock('@/stores/translationStore', () => ({ useTranslationStore: () => translation }));

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
  familyContext.activeFamilyId = 'fam-1';
  settings.liveFlightChecksEnabled = true;
  Object.assign(entitlement, { enforces: false, state: 'trial', plan: null });
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
    expect(await store.takeAirline('seg-1')).toBe('missing');
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
    expect(await store.takeAirline('seg-1')).toBe('failed');
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

describe('revert and take the airline', () => {
  it('"Put it back" is a Conflict; "Use the airline\'s" is changed again', async () => {
    h.fetchFlightLegs.mockResolvedValue(answer([moved]));
    const store = useFlightStatusStore();
    await store.run('open');
    expect(await store.revert('seg-1')).toBe('saved');
    expect(segment()).toMatchObject({ departureTime: '17:00', terminal: 'Terminal 2' });
    expect(store.verificationFor('seg-1')?.state).toBe('conflict');
    expect(events('flight change reverted')).toHaveLength(1);

    // A later run must not undo the family's choice.
    vi.setSystemTime(NOW + LATER);
    await store.run('tick');
    expect(segment().departureTime).toBe('17:00');
    expect(events('flight conflict shown')).toHaveLength(1);

    expect(await store.takeAirline('seg-1')).toBe('saved');
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
      expect(await store.takeAirline('seg-1')).toBe('saved');
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
    expect(await useFlightStatusStore().takeAirline('seg-1')).toBe('missing');
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
