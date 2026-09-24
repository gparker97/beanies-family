/**
 * `emitKitInvalidateOutcome` (tracker #99): the one field a lock-out report reads is
 * `detail: 'unobserved'`, and it must appear ONLY when the last-kit guard counted a
 * possibly stale envelope. Every store/component test mocks this emitter, so the mapping
 * is pinned here against the real `logEvent` payload.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('../logEvent', () => ({ logEvent }));

import { emitKitInvalidateOutcome } from '../loginFlowEvents';

beforeEach(() => vi.clearAllMocks());

describe('emitKitInvalidateOutcome', () => {
  it('a fresh count (observed) carries no detail; a stale one carries unobserved', () => {
    emitKitInvalidateOutcome({
      outcome: 'invalidated',
      kind: 'invalidate',
      liveRemaining: 2,
      observed: true,
    });
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'login-flow',
        message: 'kit_invalidate_outcome',
        context: { action: 'invalidated', kind: 'invalidate', count: 2 },
      })
    );

    emitKitInvalidateOutcome({
      outcome: 'invalidated',
      kind: 'replace',
      liveRemaining: 1,
      observed: false,
    });
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: { action: 'invalidated', kind: 'replace', count: 1, detail: 'unobserved' },
      })
    );
  });

  it('an omitted observed flag (refusals) carries no detail; refusals and save status are warn', () => {
    emitKitInvalidateOutcome({ outcome: 'refused', kind: 'invalidate', errorCode: 'last_kit' });
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: { action: 'refused', kind: 'invalidate', error_code: 'last_kit' },
      })
    );

    emitKitInvalidateOutcome({
      outcome: 'not_synced',
      kind: 'invalidate',
      saveStatus: 'timeout',
      liveRemaining: 3,
      observed: true,
    });
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: { action: 'not_synced', kind: 'invalidate', save_status: 'timeout', count: 3 },
      })
    );
  });
});
