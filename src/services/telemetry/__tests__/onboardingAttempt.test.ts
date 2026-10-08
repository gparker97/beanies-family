/**
 * #128: the pod-creation funnel orchestrator. `logEvent` and the log queue are REAL (the
 * `logEvent` export is wrapped in a spy that calls through), so the abandon test proves the
 * event is enriched with `create_attempt_id` and lands in the unload beacon, not merely that
 * a function was called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogRecord } from '../logEvent';

vi.mock('@/services/telemetry/logEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logEvent')>();
  return { ...actual, logEvent: vi.fn(actual.logEvent) };
});
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
// `enrichAndRedact` reads these; each read is independently guarded.
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: vi.fn(() => ({ members: [] })) }));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: vi.fn(() => ({ activeFamilyId: null, activeFamilyName: null })),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: vi.fn(() => ({
    storageProviderType: null,
    saveFailureLevel: 'none',
    driveFileNotFound: false,
  })),
}));

import { logEvent, __resetLogEventRateLimitForTesting } from '../logEvent';
import { __resetLogQueueForTesting } from '../logQueue';
import { reportError } from '@/utils/errorReporter';
import {
  beginCreateAttempt,
  endCreateAttempt,
  installOnboardingAttempt,
  trackOnboardingStep,
  trackStorageChoice,
  __resetOnboardingAttemptForTesting,
} from '../onboardingAttempt';
import {
  CREATE_ATTEMPT_MAX_AGE_MS,
  currentCreateAttempt,
  __resetCreateAttemptForTesting,
} from '@/utils/createAttemptState';

const KEY = 'beanies:create-attempt';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Logged = {
  level: string;
  surface: string;
  message: string;
  context?: Record<string, unknown>;
};

/** Every `onboarding` event `message`, in emit order. */
function onboarding(message?: string): Logged[] {
  return vi
    .mocked(logEvent)
    .mock.calls.map(([e]) => e as Logged)
    .filter((e) => e.surface === 'onboarding' && (!message || e.message === message));
}

// happy-dom's localStorage methods live on the instance and `vi.restoreAllMocks` does not undo a
// spy on them (the storedJson and attributionStash suites restore by hand too), so every storage
// spy goes through here.
const storageSpies: Array<{ mockRestore: () => void }> = [];
function refuse(method: 'getItem' | 'setItem' | 'removeItem', error: Error): void {
  storageSpies.push(
    vi.spyOn(localStorage, method).mockImplementation(() => {
      throw error;
    })
  );
}

function realUnload() {
  window.dispatchEvent(new Event('pagehide')); // persisted undefined → real unload
}

let beaconSpy: ReturnType<typeof vi.fn>;

async function beaconEvents(): Promise<LogRecord[]> {
  const blob = beaconSpy.mock.calls.at(-1)![1] as Blob;
  return (JSON.parse(await blob.text()) as { events: LogRecord[] }).events;
}

beforeEach(() => {
  localStorage.clear();
  __resetCreateAttemptForTesting();
  __resetOnboardingAttemptForTesting();
  __resetLogQueueForTesting();
  __resetLogEventRateLimitForTesting();
  vi.mocked(logEvent).mockClear();
  vi.mocked(reportError).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  beaconSpy = vi.fn(() => true);
  Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    value: beaconSpy,
    configurable: true,
    writable: true,
  });
  vi.stubEnv('VITE_BEANIES_LOG_INGEST_URL', 'https://api.test/logs');
  vi.stubEnv('VITE_BEANIES_LOG_INGEST_API_KEY', 'k');
});

afterEach(() => {
  storageSpies.splice(0).forEach((spy) => spy.mockRestore());
  __resetLogQueueForTesting();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('installOnboardingAttempt', () => {
  it('hydrates a live attempt so later events carry its id', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ id: 'live-id', startedAt: Date.now(), step: 'pin' })
    );
    installOnboardingAttempt();
    expect(currentCreateAttempt()?.id).toBe('live-id');
    expect(onboarding()).toEqual([]); // a live attempt is not news
  });

  it('logs attempt-expired with the stale step and the stale id, and opens nothing', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        id: 'stale-id',
        startedAt: Date.now() - CREATE_ATTEMPT_MAX_AGE_MS - 1000,
        step: 'members',
      })
    );
    installOnboardingAttempt();
    expect(currentCreateAttempt()).toBeNull();
    expect(onboarding('attempt-expired')).toEqual([
      expect.objectContaining({
        level: 'info',
        context: { detail: 'members', create_attempt_id: 'stale-id' },
      }),
    ]);
  });

  it('logs attempt-corrupt for an unreadable record', () => {
    localStorage.setItem(KEY, '{garbage');
    installOnboardingAttempt();
    expect(onboarding('attempt-corrupt')).toHaveLength(1);
    expect(currentCreateAttempt()).toBeNull();
  });

  it('is idempotent: a second call registers no second hook', async () => {
    installOnboardingAttempt();
    installOnboardingAttempt();
    beginCreateAttempt();
    trackOnboardingStep('about-you', 'shown');
    vi.mocked(logEvent).mockClear();
    realUnload();
    expect(onboarding('abandon')).toHaveLength(1);
  });
});

describe('beginCreateAttempt', () => {
  it('mints a UUID, persists { id, startedAt, step: welcome } and returns the id', () => {
    const id = beginCreateAttempt();
    expect(id).toMatch(UUID_RE);
    expect(currentCreateAttempt()).toEqual({ id, startedAt: expect.any(Number), step: 'welcome' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(currentCreateAttempt());
    expect(onboarding()).toEqual([]); // the gate's `submitted` is the caller's to log
  });

  it('a second tap ends the first attempt as superseded, under the first id, then opens a new one', async () => {
    const first = beginCreateAttempt();
    trackOnboardingStep('about-you', 'shown');
    const second = beginCreateAttempt();
    expect(second).not.toBe(first);
    expect(currentCreateAttempt()?.id).toBe(second);
    expect(onboarding('attempt-ended').map((e) => e.context)).toEqual([
      { action: 'superseded', detail: 'about-you' },
    ]);
    // What ships (the enriched record) names the FIRST attempt.
    realUnload();
    const ended = (await beaconEvents()).find((e) => e.message === 'attempt-ended');
    expect(ended?.create_attempt_id).toBe(first);
  });

  it('a refused write reports attempt-storage-failed at warning and keeps the id in memory', () => {
    const err = new Error('QuotaExceededError');
    refuse('setItem', err);
    const id = beginCreateAttempt();
    expect(currentCreateAttempt()?.id).toBe(id);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'onboarding',
        severity: 'warning',
        message: 'attempt-storage-failed',
        error: err,
        context: { action: 'storage-failed', stage: 'begin' },
      })
    );
  });
});

describe('trackOnboardingStep', () => {
  it('is a no-op when no attempt is open', () => {
    trackOnboardingStep('storage', 'shown');
    trackOnboardingStep('welcome', 'submitted');
    expect(onboarding()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('logs step { action, detail } and records the step on shown only', () => {
    beginCreateAttempt();
    trackOnboardingStep('about-you', 'shown');
    expect(currentCreateAttempt()?.step).toBe('about-you');
    expect(JSON.parse(localStorage.getItem(KEY)!).step).toBe('about-you');

    trackOnboardingStep('about-you', 'submitted');
    trackOnboardingStep('drive-consent', 'back', { error_code: 'cancelled' });
    expect(currentCreateAttempt()?.step).toBe('about-you');

    expect(onboarding('step').map((e) => e.context)).toEqual([
      { action: 'shown', detail: 'about-you' },
      { action: 'submitted', detail: 'about-you' },
      { action: 'back', detail: 'drive-consent', error_code: 'cancelled' },
    ]);
  });
});

describe('trackStorageChoice', () => {
  it('logs storage { action: chosen, detail }', () => {
    trackStorageChoice('local');
    expect(onboarding('storage')).toEqual([
      expect.objectContaining({ level: 'info', context: { action: 'chosen', detail: 'local' } }),
    ]);
  });
});

describe('endCreateAttempt', () => {
  it.each(['done', 'start-over', 'superseded'] as const)(
    '%s: logs attempt-ended with the last shown step, then clears the state',
    (reason) => {
      beginCreateAttempt();
      trackOnboardingStep('survey', 'shown');
      trackOnboardingStep('done', 'submitted');
      endCreateAttempt(reason);
      expect(onboarding('attempt-ended').map((e) => e.context)).toEqual([
        { action: reason, detail: 'survey' },
      ]);
      expect(currentCreateAttempt()).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    }
  );

  it('is a no-op when no attempt is open', () => {
    endCreateAttempt('superseded');
    expect(onboarding()).toEqual([]);
  });
});

describe('the pagehide abandon', () => {
  it('rides the unload beacon, enriched with create_attempt_id, after the earlier events', async () => {
    installOnboardingAttempt();
    const id = beginCreateAttempt();
    trackOnboardingStep('about-you', 'shown');
    realUnload();
    expect(beaconSpy).toHaveBeenCalledTimes(1);
    const events = await beaconEvents();
    const last = events.at(-1)!;
    expect(last).toMatchObject({
      surface: 'onboarding',
      message: 'abandon',
      action: 'pagehide',
      detail: 'about-you',
      create_attempt_id: id,
    });
    // Every event in the attempt carries the id, not just the abandon.
    expect(events.every((e) => e.create_attempt_id === id)).toBe(true);
  });

  it('logs nothing when no attempt is open', () => {
    installOnboardingAttempt();
    realUnload();
    expect(onboarding('abandon')).toEqual([]);
  });

  it.each(['drive-consent', 'done'] as const)(
    'logs nothing while the step is %s (the Drive redirect unloads by design)',
    (step) => {
      installOnboardingAttempt();
      beginCreateAttempt();
      trackOnboardingStep(step, 'shown');
      realUnload();
      expect(onboarding('abandon')).toEqual([]);
    }
  );

  it('logs nothing on a bfcache freeze', () => {
    installOnboardingAttempt();
    beginCreateAttempt();
    trackOnboardingStep('pin', 'shown');
    const e = new Event('pagehide');
    Object.defineProperty(e, 'persisted', { value: true });
    window.dispatchEvent(e);
    expect(onboarding('abandon')).toEqual([]);
  });
});
