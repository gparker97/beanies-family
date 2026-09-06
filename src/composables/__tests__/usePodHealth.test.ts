import { describe, it, expect } from 'vitest';
import { DUE_BYTES } from '../usePodHealth';

/**
 * The behaviour of `usePodHealth` lives in `usePodHealth.dueSignal.test.ts`.
 *
 * This file used to test a local `decodedSizeOf` that measured
 * `envelope.encryptedPayload` — a field `replaceEnvelope` blanks on every write,
 * so the thing it measured was always empty and the byte half of the due check
 * could never fire. Three green tests over a helper nothing called. The size now
 * comes from `syncService.getLastPersistedBytes()`, and the helper is gone.
 */
describe('usePodHealth thresholds', () => {
  it('puts the threshold where an old tablet starts to struggle', () => {
    expect(DUE_BYTES).toBe(1_000_000);
  });
});
