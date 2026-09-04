/**
 * The remote-blocked latch, tested against the REAL module.
 *
 * Every other test of this mechanism mocks `syncService` wholesale, so they
 * assert that the store calls a `vi.fn()` and nothing about the behaviour —
 * which is how the latch shipped twice in a state where it could never fire.
 * These drive the real functions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CorruptPayloadError, PayloadTooLargeError } from '@/types/sync';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const { isRemoteUnreadable, noteRemoteUnreadable, retryAfterRemoteBlock, reset } =
  await import('@/services/sync/syncService');
const { reportError } = await import('@/utils/errorReporter');

const corrupt = (step: 'decrypt' | 'load' | 'materialize' = 'load') =>
  new CorruptPayloadError('bad', step, 'fam-1', 1000);

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe('noteRemoteUnreadable', () => {
  it('latches a genuinely unreadable remote', () => {
    noteRemoteUnreadable(corrupt('load'));
    expect(isRemoteUnreadable()).toBeInstanceOf(CorruptPayloadError);
  });

  it('does NOT latch a failure a credential could fix', () => {
    // A peer rotating the family key is routine. Latching it would refuse every
    // save for the session and stop polling, while the re-prompt that fixes it
    // sits unreachable behind the latch.
    noteRemoteUnreadable(corrupt('decrypt'));
    expect(isRemoteUnreadable()).toBeNull();
  });

  it('still REPORTS the credential case — quietly, not silently', () => {
    // It was a bare `return`, which took the last emitter away: `docClient` is
    // quiet for this class too, so "the pod would not decrypt" became
    // unmeasurable fleet-wide. Only `critical` pages; `warning` still reaches
    // CloudWatch.
    noteRemoteUnreadable(corrupt('decrypt'));
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', surface: 'pod-load-failure' })
    );
  });

  it('reports once per (class, step), not once per latch', () => {
    // Keyed on the class alone, a first failure consumed the flag and a LATER
    // failure at a different step — a different failure mode, and the field a
    // triager reads first — reported nothing for the rest of the session.
    noteRemoteUnreadable(corrupt('load'));
    noteRemoteUnreadable(corrupt('load'));
    expect(reportError).toHaveBeenCalledTimes(1);
    noteRemoteUnreadable(corrupt('materialize'));
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it('stays quiet for the device class, which docClient already owns', () => {
    noteRemoteUnreadable(new PayloadTooLargeError('oom', 'materialize', 'fam-1', 1000));
    expect(isRemoteUnreadable()).toBeInstanceOf(PayloadTooLargeError);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('retryAfterRemoteBlock', () => {
  it('gives the breaker a half-open attempt', () => {
    // Without this the latch is WRITE-ONLY: both automatic clear sites sit
    // behind the head guards that consult it, so a transient allocation failure
    // disabled reads, saves and polling for the whole session with no exit but
    // sign-out.
    noteRemoteUnreadable(new PayloadTooLargeError('oom', 'materialize', 'fam-1', 1000));
    expect(isRemoteUnreadable()).not.toBeNull();

    retryAfterRemoteBlock();

    expect(isRemoteUnreadable()).toBeNull();
  });

  it('clears the report throttle too, so a repeat failure is visible again', () => {
    noteRemoteUnreadable(corrupt('load'));
    expect(reportError).toHaveBeenCalledTimes(1);
    retryAfterRemoteBlock();
    noteRemoteUnreadable(corrupt('load'));
    expect(reportError).toHaveBeenCalledTimes(2);
  });
});
