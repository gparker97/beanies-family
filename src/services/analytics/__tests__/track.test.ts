import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { track, trackFeature, withAppInitiatedWrites } from '../plausible';
import { markDemoSession, clearDemoSession } from '@/utils/reviewDemo';

/**
 * The reporting seam itself (#71). Every event in the app goes through `track()`,
 * so the guarantees asserted here are the ones protecting bounce rate, the demo
 * pod, and adoption counts across all 27 call sites at once.
 */
describe('track()', () => {
  let plausible: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    plausible = vi.fn();
    (window as unknown as { plausible: unknown }).plausible = plausible;
    clearDemoSession();
  });

  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
    clearDemoSession();
  });

  it('sends interactive: false for app-fired events', () => {
    track('install_nudge_shown');
    expect(plausible).toHaveBeenCalledWith('install_nudge_shown', {
      props: { platform: 'web' },
      interactive: false,
    });
  });

  it('sends interactive: true for user-driven events', () => {
    track('signup');
    expect(plausible.mock.calls[0][1].interactive).toBe(true);
  });

  it('attaches platform centrally, and a call site cannot override it', () => {
    // `platform` is absent from the public prop-key type; if one ever leaked
    // through at runtime, the seam's value must still win.
    track('login', { props: { method: 'passkey', platform: 'ios' } as never });
    expect(plausible.mock.calls[0][1].props).toEqual({ method: 'passkey', platform: 'web' });
  });

  it('reports nothing at all during a store-review demo session', () => {
    markDemoSession();
    track('signup');
    track('family_deleted');
    expect(plausible).not.toHaveBeenCalled();
  });

  it('never throws into the user action it is reporting on', () => {
    plausible.mockImplementation(() => {
      throw new Error('adblocker mangled the global');
    });
    expect(() => track('signup')).not.toThrow();
  });

  it('is a silent no-op when analytics never loaded', () => {
    delete (window as unknown as { plausible?: unknown }).plausible;
    expect(() => track('signup')).not.toThrow();
  });
});

describe('trackFeature()', () => {
  let plausible: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    plausible = vi.fn();
    (window as unknown as { plausible: unknown }).plausible = plausible;
    clearDemoSession();
  });

  afterEach(() => {
    delete (window as unknown as { plausible?: unknown }).plausible;
  });

  it('passes the result through untouched and reports on success', () => {
    const created = { id: 'abc' };
    expect(trackFeature(created, 'transaction')).toBe(created);
    expect(plausible).toHaveBeenCalledWith('feature_used', {
      props: { feature: 'transaction', platform: 'web' },
      interactive: true,
    });
  });

  it('does not report a failed create', () => {
    expect(trackFeature(null, 'transaction')).toBeNull();
    trackFeature(undefined, 'budget');
    expect(plausible).not.toHaveBeenCalled();
  });

  it('suppresses writes the APP makes on the user behalf', async () => {
    // The regression guard for the boot-time paths: helpful-hint to-dos, the
    // loan-mirror account migration, the onboarding starter budget, and the
    // derived records a recurring-series edit writes. `feature_used` is
    // interactive, so an app-fired one would un-bounce a visitor who did nothing.
    await withAppInitiatedWrites(async () => {
      trackFeature({ id: 'machine-made' }, 'todo');
    });
    expect(plausible).not.toHaveBeenCalled();
  });

  it('resumes reporting after the suppressed scope ends, even if it threw', async () => {
    await expect(
      withAppInitiatedWrites(async () => {
        throw new Error('reconcile blew up');
      })
    ).rejects.toThrow('reconcile blew up');

    trackFeature({ id: 'user-made' }, 'todo');
    expect(plausible).toHaveBeenCalledOnce();
  });

  it('still reports non-adoption events inside a suppressed scope', async () => {
    // Narrower than `withAnalyticsSuppressed` on purpose: a genuine login during
    // a background reconcile is still real and must be reported.
    await withAppInitiatedWrites(async () => {
      track('login', { props: { method: 'password' } });
      trackFeature({ id: 'x' }, 'list');
    });
    expect(plausible).toHaveBeenCalledOnce();
    expect(plausible.mock.calls[0][0]).toBe('login');
  });
});
