import { describe, it, expect } from 'vitest';
import { presentRefreshOutcome } from '../refreshOutcome';

describe('presentRefreshOutcome', () => {
  it('refreshed → success toast', () => {
    expect(presentRefreshOutcome('refreshed')).toEqual({
      toast: { type: 'success', key: 'header.refreshSuccess' },
    });
  });

  it('auth-failed → warning toast, never success (BackgroundSyncBar is silent on auth)', () => {
    expect(presentRefreshOutcome('auth-failed')).toEqual({
      toast: { type: 'warning', key: 'header.refreshAuthFailed' },
    });
  });

  it('network-failed → nothing (BackgroundSyncBar owns the toast, no double message)', () => {
    expect(presentRefreshOutcome('network-failed')).toEqual({});
  });

  it('decrypt-failed → nothing from the header (BackgroundSyncBar owns the toast)', () => {
    expect(presentRefreshOutcome('decrypt-failed')).toEqual({});
  });

  it('skipped-in-flight → nothing; a tap during a running sync must not claim success', () => {
    expect(presentRefreshOutcome('skipped-in-flight')).toEqual({});
  });

  it('no outcome maps to a success toast except a genuine refresh', () => {
    const outcomes = [
      'auth-failed',
      'network-failed',
      'decrypt-failed',
      'skipped-in-flight',
    ] as const;
    for (const o of outcomes) {
      expect(presentRefreshOutcome(o).toast?.type).not.toBe('success');
    }
  });
});

describe('skipped-unopenable', () => {
  it('toasts, because nothing else will', () => {
    // The other silent outcomes are silent because `BackgroundSyncBar` toasts
    // for them. This one returns before anything sets `backgroundSyncError`, so
    // a silent no-op would leave the user tapping Refresh and getting nothing.
    expect(presentRefreshOutcome('skipped-unopenable')).toEqual({
      toast: { type: 'warning', key: 'header.refreshUnopenable' },
    });
  });
});
