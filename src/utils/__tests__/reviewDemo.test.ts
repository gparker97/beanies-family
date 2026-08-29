/**
 * REVIEW-DEMO gate matrix.
 *
 * The whole security model of demo mode is "the gate is closed unless someone
 * deliberately armed this build, and it closes itself again on the expiry date".
 * These tests are that model. Every case asserts FAIL CLOSED — a malformed or
 * missing value must never leave the bypass open.
 *
 * The env is baked at module load (`EXPIRES_AT` is a module const), so every
 * case stubs env then `vi.resetModules()` + re-imports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Real SHA-256 hex of `input` — never hand-copy a digest into a test. */
async function hashOf(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const FUTURE = '2099-01-01';
const PAST = '2000-01-01';

async function loadWith(env: {
  demo?: string;
  hash?: string;
  expires?: string;
}): Promise<typeof import('@/utils/reviewDemo')> {
  vi.stubEnv('VITE_REVIEW_DEMO', env.demo ?? '');
  vi.stubEnv('VITE_REVIEW_DEMO_CODE_HASH', env.hash ?? '');
  vi.stubEnv('VITE_REVIEW_DEMO_EXPIRES', env.expires ?? '');
  vi.resetModules();
  return import('@/utils/reviewDemo');
}

describe('reviewDemo — arming matrix', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is closed when nothing is set (dev, web, self-host)', async () => {
    const m = await loadWith({});
    expect(m.isReviewDemoAvailable()).toBe(false);
    expect(await m.validateReviewDemoCode('anything')).toBe(false);
    // 20s: first dynamic import pays one-off init cost under full-suite contention —
    // the recurring pass-in-isolation flake (see TravelPlansPage.smoke.test.ts).
  }, 20_000);

  it('is closed when armed but no hash is configured', async () => {
    const m = await loadWith({ demo: 'true', expires: FUTURE });
    expect(m.isReviewDemoAvailable()).toBe(false);
  });

  it('is closed when a hash is configured but the switch is off', async () => {
    const m = await loadWith({ hash: await hashOf('let-me-in'), expires: FUTURE });
    expect(m.isReviewDemoAvailable()).toBe(false);
    // Even the correct code is refused — polarity check: gate off means DENY
    // here, unlike the invite gate where off means allow.
    expect(await m.validateReviewDemoCode('let-me-in')).toBe(false);
  });

  it('only the exact string "true" arms it', async () => {
    for (const value of ['TRUE', '1', 'yes', 'false', ' true ']) {
      const m = await loadWith({ demo: value, hash: await hashOf('x'), expires: FUTURE });
      // " true " is accepted (flagOn trims); the rest must not arm.
      expect(m.isReviewDemoAvailable()).toBe(value.trim().toLowerCase() === 'true');
    }
  });

  it('is open, and accepts the correct code, when fully armed and unexpired', async () => {
    const m = await loadWith({ demo: 'true', hash: await hashOf('let-me-in'), expires: FUTURE });
    expect(m.isReviewDemoAvailable()).toBe(true);
    expect(await m.validateReviewDemoCode('let-me-in')).toBe(true);
    expect(await m.validateReviewDemoCode('  LET-ME-IN ')).toBe(true);
    expect(await m.validateReviewDemoCode('wrong')).toBe(false);
  });
});

describe('reviewDemo — expiry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is closed once the expiry has passed', async () => {
    const m = await loadWith({ demo: 'true', hash: await hashOf('let-me-in'), expires: PAST });
    expect(m.isReviewDemoAvailable()).toBe(false);
    expect(await m.validateReviewDemoCode('let-me-in')).toBe(false);
  });

  it('fails CLOSED on an unparseable expiry', async () => {
    const m = await loadWith({ demo: 'true', hash: await hashOf('x'), expires: 'not-a-date' });
    expect(m.isReviewDemoAvailable()).toBe(false);
  });

  it('fails CLOSED on a missing expiry', async () => {
    const m = await loadWith({ demo: 'true', hash: await hashOf('x') });
    expect(m.isReviewDemoAvailable()).toBe(false);
  });

  // The expiry is UTC midnight, i.e. the FIRST DEAD instant. Getting this
  // backwards silently costs a day of review window.
  it('treats the expiry date as UTC midnight — the first dead instant', async () => {
    const m = await loadWith({ demo: 'true', hash: await hashOf('x'), expires: '2026-11-01' });

    vi.setSystemTime(new Date('2026-10-31T23:59:59Z'));
    expect(m.isReviewDemoAvailable()).toBe(true);

    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    expect(m.isReviewDemoAvailable()).toBe(false);

    vi.useRealTimers();
  });

  it('parses the expiry ONCE at load, not per call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await loadWith({ demo: 'true', hash: await hashOf('x'), expires: 'garbage' });

    const parseWarnings = () =>
      warn.mock.calls.filter((c) => String(c[0]).includes('[safeDate]')).length;
    const afterLoad = parseWarnings();

    for (let i = 0; i < 10; i++) m.isReviewDemoAvailable();

    expect(afterLoad).toBe(1);
    expect(parseWarnings()).toBe(1);
  });

  // parseIsoDateSafely is SILENT for empty input, so without this warning an
  // armed-but-expiry-less release build would be dead with zero signal.
  it('warns loudly when ARMED but the expiry is unset', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadWith({ demo: 'true', hash: await hashOf('x') });

    expect(
      warn.mock.calls.some(
        (c) => String(c[0]).includes('[reviewDemo]') && String(c[0]).includes('ARMED')
      )
    ).toBe(true);
  });

  it('does NOT warn when the gate is simply un-armed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadWith({});
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[reviewDemo]'))).toBe(false);
  });
});

describe('reviewDemo — session flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('marks and clears the demo session', async () => {
    const m = await loadWith({});
    expect(m.isDemoSession.value).toBe(false);
    m.markDemoSession();
    expect(m.isDemoSession.value).toBe(true);
    m.clearDemoSession();
    expect(m.isDemoSession.value).toBe(false);
  });

  // A reload keeps the reviewer in the SAME demo pod (createNewFile writes a
  // local cache + cached key), so a memory-only flag would drop the banner while
  // the synthetic data stayed on screen.
  it('survives a reload — a re-imported module still reports the demo session', async () => {
    const first = await loadWith({});
    first.markDemoSession();

    const reloaded = await loadWith({}); // fresh module, same sessionStorage
    expect(reloaded.isDemoSession.value).toBe(true);
  });

  it('does not survive being cleared', async () => {
    const first = await loadWith({});
    first.markDemoSession();
    first.clearDemoSession();

    const reloaded = await loadWith({});
    expect(reloaded.isDemoSession.value).toBe(false);
  });

  it('falls back to "not a demo" when sessionStorage throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    try {
      const m = await loadWith({});
      expect(m.isDemoSession.value).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('memoryProvider production guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws in a production build when demo mode is not available', async () => {
    vi.stubEnv('DEV', false);
    await loadWith({});
    const { createMemoryProvider } = await import('@/services/sync/providers/memoryProvider');
    expect(() => createMemoryProvider()).toThrow(/never run for a real family/);
  });

  it('throws in a production build when demo mode has EXPIRED', async () => {
    vi.stubEnv('DEV', false);
    await loadWith({ demo: 'true', hash: await hashOf('x'), expires: PAST });
    const { createMemoryProvider } = await import('@/services/sync/providers/memoryProvider');
    expect(() => createMemoryProvider()).toThrow(/never run for a real family/);
  });

  it('is allowed in a production build while demo mode is armed and live', async () => {
    vi.stubEnv('DEV', false);
    await loadWith({ demo: 'true', hash: await hashOf('x'), expires: FUTURE });
    const { createMemoryProvider } = await import('@/services/sync/providers/memoryProvider');
    expect(() => createMemoryProvider('beanies-demo.beanpod')).not.toThrow();
  });
});
