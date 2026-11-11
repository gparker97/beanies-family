import { describe, it, expect, vi, afterEach } from 'vitest';

const signalNewerFileSeen = vi.hoisted(() => vi.fn());
vi.mock('@/utils/appUpdateSignals', () => ({ signalNewerFileSeen }));

import { parseBeanpodV4 } from '../fileSync';
import { UnsupportedBeanpodVersionError } from '@/types/sync';

/**
 * A file from a NEWER beanies tells the web updater this build may be stale
 * (`docs/plans/2026-11-11-web-stale-build-and-phone-browser-header.md`). Only a
 * newer version may signal: an older file is not fixed by updating, and a
 * malformed one is not a version question at all.
 */
function envelopeJson(version: unknown): string {
  return JSON.stringify({
    version,
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'ciphertext',
  });
}

describe('parseBeanpodV4 — newer-file signal', () => {
  afterEach(() => {
    signalNewerFileSeen.mockReset();
  });

  it('signals, then still throws the typed error, for a newer version', () => {
    expect(() => parseBeanpodV4(envelopeJson('99.0'))).toThrow(UnsupportedBeanpodVersionError);
    expect(signalNewerFileSeen).toHaveBeenCalledTimes(1);
  });

  it('signals for an unparseable version (treated as newer, the fail-safe answer)', () => {
    expect(() => parseBeanpodV4(envelopeJson('next'))).toThrow(UnsupportedBeanpodVersionError);
    expect(signalNewerFileSeen).toHaveBeenCalledTimes(1);
  });

  it('does NOT signal for an older version', () => {
    expect(() => parseBeanpodV4(envelopeJson('2.0'))).toThrow(UnsupportedBeanpodVersionError);
    expect(signalNewerFileSeen).not.toHaveBeenCalled();
  });

  it('does NOT signal for a malformed file', () => {
    expect(() => parseBeanpodV4('not json')).toThrow();
    expect(() => parseBeanpodV4(envelopeJson(undefined))).toThrow();
    expect(signalNewerFileSeen).not.toHaveBeenCalled();
  });

  it('does NOT signal for a version this build reads', () => {
    expect(parseBeanpodV4(envelopeJson('4.0')).familyId).toBe('fam-1');
    expect(signalNewerFileSeen).not.toHaveBeenCalled();
  });
});
