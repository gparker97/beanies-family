/**
 * The boot overlay and the incident decision, both as tables over
 * `payloadErrorKind`. The two hand-written ladders they replaced had drifted
 * (three arms against four) under a comment claiming they matched, so a
 * `parse` failure showed "unreadable" inline and "your data may be damaged"
 * full-screen for the same error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fatal = vi.hoisted(() => ({ setFatal: vi.fn() }));
vi.mock('@/stores/fatalErrorStore', () => ({ useFatalErrorStore: () => fatal }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { reportError } from '@/utils/errorReporter';
import {
  CorruptPayloadError,
  PayloadTooLargeError,
  UnsupportedBeanpodVersionError,
  type PayloadErrorKind,
} from '@/types/sync';
import {
  surfacePayloadFatal,
  reportPayloadFailure,
  PAYLOAD_OVERLAY_KEY,
  PAYLOAD_IS_INCIDENT,
} from '../payloadFailureSurface';

const ALL_KINDS: readonly PayloadErrorKind[] = [
  'credential-stale',
  'needs-update',
  'unreadable',
  'too-large',
  'corrupt',
];
const ctx = { fileId: null, familyId: 'fam-1', source: 'boot' as const };

describe('payloadFailureSurface tables', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has a row in BOTH tables for every kind (table exhaustiveness)', () => {
    // A sixth kind fails the build in three places; this pins the runtime
    // shape too, so a `satisfies` weakened to a cast is still caught.
    expect(Object.keys(PAYLOAD_OVERLAY_KEY).sort()).toEqual([...ALL_KINDS].sort());
    expect(Object.keys(PAYLOAD_IS_INCIDENT).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('shows "update beanies" full-screen for a newer-version file, and pages nobody', () => {
    surfacePayloadFatal(new UnsupportedBeanpodVersionError('6.0', 'fam-1'), ctx);
    expect(fatal.setFatal).toHaveBeenCalledWith(
      'resumeSetup.podNewerVersion',
      expect.anything(),
      expect.objectContaining({ clearDataHelps: false })
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  it('still pages for a genuine torn read at the parse step (the incident signal is not lost)', () => {
    reportPayloadFailure(new CorruptPayloadError('torn', 'parse', 'fam-1'), ctx);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0]![0].severity).toBe('critical');
  });

  it('does not page for too-large or for a decrypt failure (the two former early returns)', () => {
    reportPayloadFailure(new PayloadTooLargeError('oom', 'load', 'fam-1', 1), ctx);
    reportPayloadFailure(new CorruptPayloadError('tag', 'decrypt', 'fam-1'), ctx);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('keeps the overlay and the inline key on the same discriminator', () => {
    // The point of the tables: one question, asked once.
    surfacePayloadFatal(new CorruptPayloadError('tag', 'decrypt', 'fam-1'), ctx);
    expect(fatal.setFatal).toHaveBeenLastCalledWith(
      'resumeSetup.podCredentialStale',
      expect.anything(),
      expect.anything()
    );
    surfacePayloadFatal(new PayloadTooLargeError('oom', 'load', 'fam-1', 1), ctx);
    expect(fatal.setFatal).toHaveBeenLastCalledWith(
      'resumeSetup.podTooLarge',
      expect.anything(),
      expect.anything()
    );
  });
});
