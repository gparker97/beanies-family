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
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

// The platform is the thing under test on the two cases below, so it is a
// knob rather than a fixed mock. `capabilities.ts` derives its answer from
// module-level constants, so it cannot be changed any other way.
const platform = vi.hoisted(() => ({ value: 'web' as 'web' | 'ios' | 'android' }));
vi.mock('@/services/sync/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/capabilities')>()),
  isNative: () => platform.value !== 'web',
  getPlatform: () => platform.value,
}));

import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { STORE_URL } from '@beanies/brand/nav';
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

/** One error per kind, so the platform cases can sweep the whole union. */
function errorFor(kind: PayloadErrorKind) {
  switch (kind) {
    case 'needs-update':
      return new UnsupportedBeanpodVersionError('6.0', 'fam-1');
    case 'too-large':
      return new PayloadTooLargeError('oom', 'load', 'fam-1', 1);
    case 'credential-stale':
      return new CorruptPayloadError('tag', 'decrypt', 'fam-1');
    case 'unreadable':
      return new CorruptPayloadError('bad', 'materialize', 'fam-1');
    case 'corrupt':
      return new CorruptPayloadError('torn', 'parse', 'fam-1');
  }
}

describe('payloadFailureSurface tables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.value = 'web';
  });

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

  it('gives a native block a way out, and the way out is the store listing', () => {
    // ⚠️ THE POINT OF THE WHOLE FEATURE. A person stopped by a file their build
    // cannot read has exactly one thing to do, and this is where it is put in
    // front of them.
    platform.value = 'ios';
    surfacePayloadFatal(new UnsupportedBeanpodVersionError('6.0', 'fam-1'), ctx);
    const opts = vi.mocked(fatal.setFatal).mock.calls[0]![2] as {
      action: { labelKey: string; url: string } | null;
    };
    expect(opts.action).toEqual({
      labelKey: 'appUpdate.openStore',
      url: STORE_URL.ios,
    });
    expect(vi.mocked(logEvent).mock.calls[0]![0]).toMatchObject({
      surface: 'app-update',
      level: 'warn',
      context: { action: 'blocked', os: 'ios' },
    });
  });

  it('sends an Android block to Play, not to the App Store', () => {
    platform.value = 'android';
    surfacePayloadFatal(new UnsupportedBeanpodVersionError('6.0', 'fam-1'), ctx);
    const opts = vi.mocked(fatal.setFatal).mock.calls[0]![2] as { action: { url: string } | null };
    expect(opts.action!.url).toBe(STORE_URL.android);
  });

  it.each(ALL_KINDS)('attaches NO action on web, for %s', (kind) => {
    // ⚠️ THE REGRESSION THAT KEEPS THE WEB OVERLAY UNCHANGED. The browser has
    // already updated itself through the service worker, so a store link there
    // is at best noise and at worst a dead end.
    platform.value = 'web';
    surfacePayloadFatal(errorFor(kind), ctx);
    const opts = vi.mocked(fatal.setFatal).mock.calls[0]![2] as { action?: unknown };
    expect(opts.action ?? null).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it.each(ALL_KINDS.filter((k) => k !== 'needs-update'))(
    'attaches NO action on native either, for %s',
    (kind) => {
      // Only a version refusal has a store link as its answer. A stale
      // credential or a torn file is not fixed by updating.
      platform.value = 'ios';
      surfacePayloadFatal(errorFor(kind), ctx);
      const opts = vi.mocked(fatal.setFatal).mock.calls[0]![2] as { action?: unknown };
      expect(opts.action ?? null).toBeNull();
    }
  );

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
