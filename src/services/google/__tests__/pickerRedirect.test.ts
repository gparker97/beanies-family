import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  stashPickerSelection,
  consumePickerRedirectResult,
  PICKER_EVENTS,
} from '../pickerRedirect';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent }));
vi.mock('@/utils/platformLabel', () => ({
  platformContext: () => ({ os: 'ios', detail: 'iphone app' }),
}));

const KEY = 'beanies_redirect_auth_code:picker';

function actions(): string[] {
  return logEvent.mock.calls.map((c) => c[0]?.context?.action);
}

describe('pickerRedirect — the system-browser picker stash', () => {
  beforeEach(() => {
    sessionStorage.clear();
    logEvent.mockClear();
    vi.useRealTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('round-trips a selection, and clears the key so it cannot be consumed twice', () => {
    expect(stashPickerSelection('FILE_A', 'web')).toBe(true);

    expect(consumePickerRedirectResult()).toEqual({
      kind: 'picked',
      fileId: 'FILE_A',
      fileName: '',
    });
    // Read-and-clear: a re-render must not replay the same selection.
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(consumePickerRedirectResult()).toBeNull();
  });

  it('takes the FIRST id when Google returns a comma-separated list', () => {
    stashPickerSelection('FILE_A,FILE_B', 'web');
    expect(consumePickerRedirectResult()).toMatchObject({ kind: 'picked', fileId: 'FILE_A' });
  });

  /**
   * ⚠️ THE BUG THIS PREVENTS IS A SILENT ONE. A cancel returns no ids, and treating that as
   * "nothing happened" is exactly the conflation the `'redirecting'` result kind was introduced
   * to stop: the user acts, the app does nothing, and no telemetry records it.
   */
  it('reports a cancel when the picker returned no ids, and says so out loud', () => {
    stashPickerSelection(null, 'web');
    expect(consumePickerRedirectResult()).toEqual({ kind: 'cancelled' });
    expect(actions()).toContain(PICKER_EVENTS.cancelled);
  });

  it('treats an empty ids string the same as none', () => {
    stashPickerSelection('', 'web');
    expect(consumePickerRedirectResult()).toEqual({ kind: 'cancelled' });
  });

  /**
   * ⚠️ WITHOUT THE EXPIRY A SELECTION CAN BE CONSUMED BY THE WRONG PICK. The join flow often
   * completes via the direct read on return, leaving the stash unread; a later `pick()` in the
   * same tab would then swallow it and load a file the user did not just choose.
   */
  it('discards a stash older than five minutes, and clears it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T10:00:00Z'));
    stashPickerSelection('FILE_A', 'web');
    vi.setSystemTime(new Date('2026-09-18T10:05:01Z'));

    expect(consumePickerRedirectResult()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(actions()).toContain(PICKER_EVENTS.expired);
  });

  it('keeps a stash that is still inside the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T10:00:00Z'));
    stashPickerSelection('FILE_A', 'web');
    vi.setSystemTime(new Date('2026-09-18T10:04:59Z'));
    expect(consumePickerRedirectResult()).toMatchObject({ kind: 'picked' });
  });

  it('discards an unparseable stash with a warning rather than throwing into the auth chain', () => {
    sessionStorage.setItem(KEY, 'not json');
    expect(consumePickerRedirectResult()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(actions()).toContain(PICKER_EVENTS.unreadable);
  });

  it('discards a stash whose shape is wrong, even though it is valid JSON', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ ids: 123 }));
    expect(consumePickerRedirectResult()).toBeNull();
    expect(actions()).toContain(PICKER_EVENTS.unreadable);
  });

  /**
   * Storage throws in private mode and hardened browsers. A dropped selection there would strand
   * the joiner on a screen that looks like nothing happened, so the caller must be able to SEE
   * the failure and report it.
   */
  it('returns false instead of throwing when storage refuses the write', () => {
    // Spy on the INSTANCE: this environment's `sessionStorage` does not route through a
    // patchable `Storage.prototype`, so a prototype spy silently does nothing.
    const spy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(stashPickerSelection('FILE_A', 'web')).toBe(false);
    expect(actions()).toContain(PICKER_EVENTS.stashFailed);
    spy.mockRestore();
  });

  it('survives storage that refuses the read', () => {
    const spy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(consumePickerRedirectResult()).toBeNull();
    expect(actions()).toContain(PICKER_EVENTS.unreadable);
    spy.mockRestore();
  });

  it('nothing waiting is not an event — it is the ordinary case', () => {
    expect(consumePickerRedirectResult()).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ THE TRANSPORT IS THE POINT OF PHASE 0. A single `returned` action cannot tell a Safari/PWA
 * return (through `/oauth/callback`) from an installed-app return (through `appUrlOpen`), which is
 * exactly the (a)-versus-(b) split this whole spike exists to establish. If someone collapses
 * these back into one action, this fails.
 */
describe('pickerRedirect — the return transport is recorded', () => {
  beforeEach(() => {
    sessionStorage.clear();
    logEvent.mockClear();
  });

  it('records a web return distinctly from a native one', () => {
    stashPickerSelection('FILE_A', 'web');
    expect(actions()).toContain(PICKER_EVENTS.returnedWeb);

    logEvent.mockClear();
    stashPickerSelection('FILE_A', 'native');
    expect(actions()).toContain(PICKER_EVENTS.returnedNative);
    expect(PICKER_EVENTS.returnedWeb).not.toBe(PICKER_EVENTS.returnedNative);
  });
});
