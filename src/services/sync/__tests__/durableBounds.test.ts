import { describe, expect, it } from 'vitest';
import { DRIVE_REQUEST_TIMEOUT_MS } from '@/services/google/driveService';
import {
  MAX_ATTEMPTS,
  TRANSIENT_RETRIES,
  earliestQueuedTimeoutMs,
} from '@/services/sync/providers/googleDriveProvider';
import {
  CREDENTIAL_PUBLISH_TIMEOUT_MS,
  DURABLE_ROTATION_SAVE_TIMEOUT_MS,
  POST_AUTH_SAVE_TIMEOUT_MS,
} from '@/stores/syncStore';

/**
 * The DURABLE-BOUND INVARIANT (googleDriveProvider `TRANSIENT_RETRIES`): a queued client
 * timeout returns `false`, which `syncNowDurable` reads as "nothing reached Drive", so every
 * durable bound must fire BEFORE the earliest a queued timeout can come back. Previously a
 * comment in one file about constants in another; now a build-time check (#127 round 2).
 */
describe('durable-save bounds vs the earliest queued timeout (#127)', () => {
  it("derives 22 s from today's constants (3 instant failures + one 15 s timeout)", () => {
    expect(TRANSIENT_RETRIES).toEqual({ timeout: 1, server: 3, network: 3 });
    expect(MAX_ATTEMPTS).toBe(4);
    expect(DRIVE_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(earliestQueuedTimeoutMs(DRIVE_REQUEST_TIMEOUT_MS)).toBe(22_000);
  });

  it('every durable bound is shorter than the earliest queued timeout', () => {
    const earliest = earliestQueuedTimeoutMs(DRIVE_REQUEST_TIMEOUT_MS);
    for (const bound of [
      POST_AUTH_SAVE_TIMEOUT_MS,
      DURABLE_ROTATION_SAVE_TIMEOUT_MS,
      CREDENTIAL_PUBLISH_TIMEOUT_MS,
    ]) {
      expect(bound).toBeLessThan(earliest);
    }
  });
});
