/**
 * The join flow's ONE mapper from a blocker to a join code. It owns the
 * `instanceof` and the `keyMayBeWrong` guard so neither call site
 * (`asJoinDecryptError`, `doPickAndLoad`) re-derives them.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({}) }));
vi.mock('@/services/google/googleAuth', () => ({ getGoogleAccountEmail: () => null }));

import { joinCodeForBlocker } from '../useJoinFlow';
import {
  CorruptPayloadError,
  PayloadTooLargeError,
  UnsupportedBeanpodVersionError,
} from '@/types/sync';
import { lineageBlockError } from '@/services/sync/podLineage';

describe('joinCodeForBlocker', () => {
  it('maps a newer-version file to FILE_NEWER_VERSION', () => {
    expect(joinCodeForBlocker(new UnsupportedBeanpodVersionError('6.0'))).toBe(
      'FILE_NEWER_VERSION'
    );
  });
  it('keeps the existing too-large and corrupt mappings', () => {
    expect(joinCodeForBlocker(new PayloadTooLargeError('oom', 'load', null, 1))).toBe(
      'FILE_TOO_LARGE'
    );
    expect(joinCodeForBlocker(new CorruptPayloadError('bad', 'materialize', null))).toBe(
      'FILE_CORRUPT'
    );
  });
  it('returns null for a decrypt-step failure (the rotated-key signature a new link fixes)', () => {
    expect(joinCodeForBlocker(new CorruptPayloadError('tag', 'decrypt', null))).toBeNull();
  });
  it('returns null for a lineage block, which carries its own copy', () => {
    expect(joinCodeForBlocker(lineageBlockError('conflict'))).toBeNull();
  });
  it('returns null when there is no blocker at all', () => {
    expect(joinCodeForBlocker(undefined)).toBeNull();
  });
});
