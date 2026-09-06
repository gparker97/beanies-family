import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '@/constants/appVersion';
import { createBeanpodV4, reEncryptEnvelope, parseBeanpodV4 } from '../fileSync';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

/**
 * #44 writer-version stamp: every write path must record which app version wrote
 * the file, and legacy files (written before this shipped) must still parse.
 */
describe('fileSync — writerVersion stamp (#44)', () => {
  it('createBeanpodV4 stamps writerVersion = APP_VERSION', () => {
    const json = createBeanpodV4('fam-1', 'Test', 'ciphertext', null, {});
    const parsed = JSON.parse(json) as BeanpodFileV4;
    expect(parsed.writerVersion).toBe(APP_VERSION);
  });

  it('reEncryptEnvelope re-stamps writerVersion = APP_VERSION even when the input lacks it', () => {
    // A legacy envelope with NO writerVersion (pre-2026-07-13 file).
    const legacy = {
      version: '4.0',
      familyId: 'fam-1',
      familyName: 'Test',
      keyId: 'k1',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: 'old',
    } as unknown as BeanpodFileV4;
    expect(legacy.writerVersion).toBeUndefined();

    const json = reEncryptEnvelope(legacy, 'newCiphertext', null);
    const updated = JSON.parse(json) as BeanpodFileV4;
    expect(updated.writerVersion).toBe(APP_VERSION); // re-stamped, not stale/absent
    expect(updated.encryptedPayload).toBe('newCiphertext');
  });

  it('reEncryptEnvelope overrides a stale writerVersion with the current one', () => {
    const stale = {
      version: '4.0',
      familyId: 'fam-1',
      familyName: 'Test',
      keyId: 'k1',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: 'old',
      writerVersion: '0.0.1-ancient',
    } as unknown as BeanpodFileV4;

    const updated = JSON.parse(reEncryptEnvelope(stale, 'x', null)) as BeanpodFileV4;
    expect(updated.writerVersion).toBe(APP_VERSION);
  });

  it('parseBeanpodV4 accepts a legacy envelope with no writerVersion (forward-compatible)', () => {
    const legacyJson = JSON.stringify({
      version: '4.0',
      familyId: 'fam-1',
      familyName: 'Test',
      keyId: 'k1',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: 'old',
    });
    const parsed = parseBeanpodV4(legacyJson);
    expect(parsed.familyId).toBe('fam-1');
    expect(parsed.writerVersion).toBeUndefined();
  });
});
