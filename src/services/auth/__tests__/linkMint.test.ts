/**
 * `linkMint` — the hint invariant, the `m=` suppression, and the step-up gate.
 *
 * These are not ordinary coverage. Each one pins a decision that is invisible when wrong:
 *
 *  - A hint taken from the wrong field still produces a working-looking link. It just
 *    pre-selects a Google account that cannot read the file, which is indistinguishable from
 *    "the chooser is broken" from the outside.
 *  - A `m=` param on a device link is read by nothing, so nothing fails; it merely leaks an
 *    internal identifier into a URL people paste into chat.
 *  - A gate that fires inside pod creation or the join flow WITHHOLDS the link on the one
 *    screen that hands it over, and fails closed. That defect was caught in review rather than
 *    by a test, which is exactly why it has one now.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';

// ⚠️ A REAL `CryptoKey`, not a stub. The crypto is NOT mocked here on purpose — these tests
// assert what lands on the wire, and the URL is built from a genuinely wrapped package. A `{}`
// placeholder gets as far as `crypto.subtle.wrapKey` and fails there with a type error that
// says nothing about the behaviour under test.
const syncMocks = vi.hoisted(() => ({
  familyKey: null as unknown,
  envelope: { familyId: 'fam-1', keyId: 'k1' } as unknown,
  storageProviderType: 'google_drive' as string | null,
  fileName: 'family.beanpod' as string | undefined,
  driveFileId: 'drive-1' as string | undefined,
  memberLinkCreatedAt: vi.fn(() => undefined),
  setMemberLinkWrap: vi.fn(async () => true),
  addInvitePackage: vi.fn(async () => true),
}));

/**
 * `list` plus a `throwOnRead` flag, rather than a mutable `members` array.
 *
 * The first version of this file poisoned the shared mock: the "roster read blows up" case
 * replaced `members` with a getter-only property, and when its assertion failed the restore
 * line never ran — so every later test in the file died in `beforeEach` with a misleading
 * "has only a getter". A flag the getter consults cannot leak that way.
 */
const familyMocks = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
  throwOnRead: false,
}));

// The rest parameter is required, not cosmetic: the delegating mock below spreads its args
// in, and TypeScript rejects a spread into a signature that declares none.
const reauthMocks = vi.hoisted(() => ({
  requireReauth: vi.fn(async (..._args: unknown[]) => true),
}));

vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => syncMocks }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      if (familyMocks.throwOnRead) throw new Error('pinia not active');
      return familyMocks.list;
    },
  }),
}));
// ⚠️ DELEGATED, NOT CAPTURED. `requireReauth: reauthMocks.requireReauth` binds the function
// that existed at mock time, so a test reassigning the property afterwards changes nothing and
// the gate-declined case silently passes through as "proved".
vi.mock('@/composables/useReauth', () => ({
  requireReauth: (...args: unknown[]) => reauthMocks.requireReauth(...args),
}));

import { mintDeviceLink, mintMagicLink } from '@/services/auth/linkMint';

/** A member whose contact email and Google account deliberately DIFFER. */
const WITH_ACCOUNT = {
  id: 'm-1',
  name: 'Greg',
  email: 'contact-only@example.com',
  googleAccountEmail: 'real-account@example.com',
};

/** The trap case: a contact email present, no Google account bound yet. */
const CONTACT_ONLY = {
  id: 'm-2',
  name: 'Mary',
  email: 'mary-contact@example.com',
};

function paramsOf(link: string): URLSearchParams {
  return new URL(link).searchParams;
}

function decodeHint(link: string): string | null {
  const raw = paramsOf(link).get('hint');
  return raw === null ? null : atob(raw);
}

beforeAll(async () => {
  syncMocks.familyKey = await generateFamilyKey();
});

beforeEach(() => {
  familyMocks.list = [WITH_ACCOUNT, CONTACT_ONLY];
  familyMocks.throwOnRead = false;
  reauthMocks.requireReauth = vi.fn(async (..._args: unknown[]) => true);
  syncMocks.setMemberLinkWrap = vi.fn(async () => true);
  syncMocks.addInvitePackage = vi.fn(async () => true);
});

describe('the hint invariant', () => {
  it('uses googleAccountEmail, for both kinds of link', async () => {
    const magic = await mintMagicLink({ memberId: 'm-1' });
    const device = await mintDeviceLink({ hintMemberId: 'm-1' });

    expect('link' in magic && decodeHint(magic.link)).toBe('real-account@example.com');
    expect('link' in device && decodeHint(device.link)).toBe('real-account@example.com');
    expect('hint' in magic && magic.hint).toBe('ok');
  });

  it('NEVER falls back to the contact email', async () => {
    // ⚠️ THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL MISTAKE. `email` is documented as an
    // address "not required to match any specific external account", so hinting it would
    // pre-select an account that may not exist or may not have access. No hint at all is the
    // correct outcome, and it is strictly better than a wrong one.
    const result = await mintMagicLink({ memberId: 'm-2' });
    expect('link' in result && paramsOf(result.link).has('hint')).toBe(false);
    expect('link' in result && result.link).not.toContain('mary-contact');
    expect('hint' in result && result.hint).toBe('no-account');
  });

  it('reports an unresolvable member without refusing the mint', async () => {
    familyMocks.list = [];
    const result = await mintMagicLink({ memberId: 'ghost' });
    expect('link' in result).toBe(true);
    expect('hint' in result && result.hint).toBe('unknown-member');
  });

  it('degrades rather than throwing when the roster read blows up', async () => {
    familyMocks.throwOnRead = true;
    const result = await mintMagicLink({ memberId: 'm-1' });
    expect('link' in result).toBe(true);
    expect('hint' in result && result.hint).toBe('unknown-member');
  });
});

describe('what goes on the wire', () => {
  it('a device link carries lk=1 and NO m=', async () => {
    // `buildInviteLink` writes `m=` for any `memberId` it is handed, but `parseInviteLink`
    // reads it only under `ml=1`. On a device link it would be a param nothing reads, while
    // still shipping an internal id in a pasteable URL.
    const result = await mintDeviceLink({ hintMemberId: 'm-1' });
    expect('link' in result).toBe(true);
    if (!('link' in result)) return;
    const p = paramsOf(result.link);
    expect(p.get('lk')).toBe('1');
    expect(p.has('m')).toBe(false);
  });

  it('a magic link carries ml=1 AND m=, because it is unusable without it', async () => {
    const result = await mintMagicLink({ memberId: 'm-1' });
    expect('link' in result).toBe(true);
    if (!('link' in result)) return;
    const p = paramsOf(result.link);
    expect(p.get('ml')).toBe('1');
    expect(p.get('m')).toBe('m-1');
  });
});

describe('the step-up gate', () => {
  it('defaults to ON for both mints', async () => {
    await mintMagicLink({ memberId: 'm-1' });
    expect(reauthMocks.requireReauth).toHaveBeenCalledTimes(1);

    reauthMocks.requireReauth = vi.fn(async (..._args: unknown[]) => true);
    await mintDeviceLink({ hintMemberId: 'm-1' });
    expect(reauthMocks.requireReauth).toHaveBeenCalledTimes(1);
  });

  it('withholds the link when the gate is declined', async () => {
    reauthMocks.requireReauth = vi.fn(async (..._args: unknown[]) => false);
    const result = await mintMagicLink({ memberId: 'm-1' });
    expect(result).toEqual({ errorKey: 'signInCode.notProved', errorCode: 'gate_declined' });
    expect(syncMocks.setMemberLinkWrap).not.toHaveBeenCalled();
  });

  it('NEVER prompts for not-applicable — the creation and join flows', async () => {
    // ⚠️ THE REGRESSION THIS EXISTS FOR. A default-on gate at those two sites would stack a PIN
    // pad over a modal the user cannot close, and fail closed where the member is unresolved —
    // withholding the link from the only screen that ever shows it.
    await mintMagicLink({ memberId: 'm-1', gate: 'not-applicable' });
    await mintDeviceLink({ hintMemberId: 'm-1', gate: 'not-applicable' });
    expect(reauthMocks.requireReauth).not.toHaveBeenCalled();
  });

  it('does not prompt when the host already proved', async () => {
    await mintDeviceLink({ hintMemberId: 'm-1', gate: 'already-proved' });
    expect(reauthMocks.requireReauth).not.toHaveBeenCalled();
  });

  it('runs the gate AFTER the pod guards, so a closed pod never asks for a PIN', async () => {
    const saved = syncMocks.familyKey;
    syncMocks.familyKey = null;
    const result = await mintMagicLink({ memberId: 'm-1' });
    expect(result).toEqual({ errorKey: 'recovery.podNotOpen', errorCode: 'no_family_key' });
    expect(reauthMocks.requireReauth).not.toHaveBeenCalled();
    syncMocks.familyKey = saved;
  });
});

describe('publish failures still withhold the link', () => {
  it('a magic link whose wrap never landed is not handed out', async () => {
    syncMocks.setMemberLinkWrap = vi.fn(async () => false);
    const result = await mintMagicLink({ memberId: 'm-1' });
    expect(result).toEqual({ errorKey: 'magicLink.mintFailed', errorCode: 'publish-failed' });
  });

  it('a device link whose wrap never landed is not handed out', async () => {
    syncMocks.addInvitePackage = vi.fn(async () => false);
    const result = await mintDeviceLink({ hintMemberId: 'm-1' });
    expect(result).toEqual({ errorKey: 'deviceLink.publishFailed', errorCode: 'publish-failed' });
  });
});
