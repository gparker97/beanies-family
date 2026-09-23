/**
 * authPrompts — the data-driven post-sign-in prompt sequencer (Phase 4).
 * Proves the priority order, the per-prompt eligibility rules (incl. the
 * kid-exclusion and the spoof-proof kit confirmed-signal), and the
 * never-throws degradation contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNative: vi.fn(() => false),
  resolveDeviceKeys: vi.fn(async () => [] as { memberId: string }[]),
  canOfferBiometric: vi.fn(async () => true),
  reportError: vi.fn(),
}));

vi.mock('@/services/sync/capabilities', () => ({ isNative: mocks.isNative }));
vi.mock('@/services/auth/passkeyService', () => ({
  resolveDeviceKeys: mocks.resolveDeviceKeys,
  canOfferBiometric: mocks.canOfferBiometric,
  // familyStore's roster watcher calls this; an absent export on the double is a
  // TypeError inside a void-ed watcher, i.e. an unhandled rejection.
  reconcileDeviceKeysWithRoster: vi.fn(async () => {}),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: mocks.reportError }));

import {
  resolveAuthPrompt,
  hasKitConfirmedSignal,
  hasColdOpenCredential,
  isUnpreemptable,
  needsKitGuardBeforeSignOut,
  type AuthPromptContext,
} from '@/services/auth/authPrompts';
import type { FamilyMember, Settings } from '@/types/models';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1',
    name: 'Pat',
    email: 'p@x.io',
    role: 'owner',
    color: '#000',
    requiresPassword: false,
    canManagePod: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  } as FamilyMember;
}

function ctx(overrides: Partial<AuthPromptContext> = {}): AuthPromptContext {
  return {
    familyId: 'fam1',
    memberId: 'm1',
    member: member(),
    owner: member(),
    envelope: null,
    settings: null,
    // Trust ANSWERED by default so the pin/kit/biometric ordering tests keep their
    // meaning now that `trust` is first (2026-09-23). The trust tests override it.
    flags: {
      isPinPromptDismissed: () => false,
      kitPromptDismissed: false,
      trustedDevicePromptShown: true,
      isTrustedDevice: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isNative.mockReturnValue(false);
  mocks.resolveDeviceKeys.mockResolvedValue([]);
  mocks.canOfferBiometric.mockResolvedValue(true);
});

describe('hasKitConfirmedSignal', () => {
  it('true on the doc-side timestamp', () => {
    expect(
      hasKitConfirmedSignal(ctx({ settings: { recoveryKitConfirmedAt: '2026-08-28' } as Settings }))
    ).toBe(true);
  });

  it('true for a legacy family: kit entries + owner holds a real password', () => {
    expect(
      hasKitConfirmedSignal(
        ctx({
          envelope: { recoveryKeys: { k1: {} } } as unknown as BeanpodFileV4,
          owner: member({ passwordHash: 'salt:hash' }),
        })
      )
    ).toBe(true);
  });

  it('false for a kit-BORN family that never confirmed (owner is password-free) — the spoof-proof rule', () => {
    // Old clients can add MEMBER wraps to a kit-born envelope via classic invites,
    // but can never alter the OWNER's credential — so kit presence alone must not
    // count as confirmation when the owner has no password.
    expect(
      hasKitConfirmedSignal(
        ctx({
          envelope: { recoveryKeys: { k1: {} } } as unknown as BeanpodFileV4,
          owner: member({ passwordHash: '' }),
        })
      )
    ).toBe(false);
  });

  it('false with no kit and no timestamp', () => {
    expect(hasKitConfirmedSignal(ctx())).toBe(false);
  });
});

describe('resolveAuthPrompt — priority + eligibility', () => {
  it('pin wins for a legacy member (passwordHash, no pinHash)', async () => {
    expect(await resolveAuthPrompt(ctx({ member: member({ passwordHash: 'salt:hash' }) }))).toBe(
      'pin'
    );
  });

  it('pin is per-member dismissed — a dismissal falls through to the next prompt', async () => {
    const id = await resolveAuthPrompt(
      ctx({
        member: member({ passwordHash: 'salt:hash' }),
        flags: {
          isPinPromptDismissed: (f, m) => f === 'fam1' && m === 'm1',
          kitPromptDismissed: true,
          trustedDevicePromptShown: true,
          isTrustedDevice: false,
        },
      })
    );
    expect(id).toBeNull();
  });

  it('never nags a credential-less kid for a PIN (parent-initiated only)', async () => {
    const id = await resolveAuthPrompt(
      ctx({
        member: member({ passwordHash: '' }),
        owner: member({ passwordHash: '' }),
        flags: {
          isPinPromptDismissed: () => false,
          kitPromptDismissed: true,
          trustedDevicePromptShown: true,
          isTrustedDevice: false,
        },
      })
    );
    expect(id).not.toBe('pin');
  });

  it('never PIN-nags a member who already has a PIN', async () => {
    const id = await resolveAuthPrompt(
      ctx({
        member: member({ passwordHash: 'salt:hash', pinHash: 'salt:pin' }),
        flags: {
          isPinPromptDismissed: () => false,
          kitPromptDismissed: true,
          trustedDevicePromptShown: true,
          isTrustedDevice: false,
        },
      })
    );
    expect(id).toBeNull();
  });

  it('kit fires for a pod manager when the confirmed-signal is missing', async () => {
    const id = await resolveAuthPrompt(
      ctx({ member: member({ pinHash: 'salt:pin', canManagePod: true }) })
    );
    expect(id).toBe('kit');
  });

  it('kit never nags a non-manager', async () => {
    const id = await resolveAuthPrompt(
      ctx({
        member: member({ pinHash: 'salt:pin', canManagePod: false }),
        flags: {
          isPinPromptDismissed: () => false,
          kitPromptDismissed: false,
          trustedDevicePromptShown: true,
          isTrustedDevice: false,
        },
      })
    );
    expect(id).not.toBe('kit');
  });

  it('native-biometric fires only on native, for a member without their own key', async () => {
    mocks.isNative.mockReturnValue(true);
    const base = ctx({
      member: member({ pinHash: 'salt:pin' }),
      settings: { recoveryKitConfirmedAt: 'x' } as Settings,
      flags: {
        isPinPromptDismissed: () => false,
        kitPromptDismissed: false,
        trustedDevicePromptShown: true,
        isTrustedDevice: false,
      },
    });
    expect(await resolveAuthPrompt(base)).toBe('native-biometric');
    // ...but never when the member already has a key on this device.
    mocks.resolveDeviceKeys.mockResolvedValue([{ memberId: 'm1' }]);
    expect(await resolveAuthPrompt(base)).toBeNull();
  });

  const unanswered = {
    isPinPromptDismissed: () => false,
    kitPromptDismissed: false,
    trustedDevicePromptShown: false,
    isTrustedDevice: false,
  };

  it('trust comes FIRST on an untrusted, unanswered device — ahead of pin, kit and biometric', async () => {
    mocks.isNative.mockReturnValue(true);
    // This member is eligible for pin (legacy password, no PIN) AND kit (manager, no
    // confirmed-signal) AND native-biometric — trust must still win ("always ask").
    const id = await resolveAuthPrompt(
      ctx({ member: member({ passwordHash: 'salt:hash' }), flags: unanswered })
    );
    expect(id).toBe('trust');
  });

  it('trust is not asked on a trusted device, or once the question was answered', async () => {
    const quiet = {
      member: member({ pinHash: 'salt:pin' }),
      settings: { recoveryKitConfirmedAt: 'x' } as Settings,
    };
    expect(
      await resolveAuthPrompt(ctx({ ...quiet, flags: { ...unanswered, isTrustedDevice: true } }))
    ).toBeNull();
    expect(
      await resolveAuthPrompt(
        ctx({ ...quiet, flags: { ...unanswered, trustedDevicePromptShown: true } })
      )
    ).toBeNull();
  });

  it('only trust may bypass the one-interruption slot', () => {
    expect(isUnpreemptable('trust')).toBe(true);
    expect(isUnpreemptable('pin')).toBe(false);
    expect(isUnpreemptable('kit')).toBe(false);
    expect(isUnpreemptable('native-biometric')).toBe(false);
  });

  it('a throwing descriptor degrades that prompt away, reports, and the chain continues', async () => {
    mocks.isNative.mockReturnValue(true);
    mocks.resolveDeviceKeys.mockRejectedValue(new Error('registry broken'));
    const id = await resolveAuthPrompt(
      ctx({
        member: member({ pinHash: 'salt:pin' }),
        settings: { recoveryKitConfirmedAt: 'x' } as Settings,
      })
    );
    // native-biometric threw and degraded away; trust is answered in the fixture, so
    // nothing else is eligible — the chain finished instead of throwing.
    expect(id).toBeNull();
    expect(mocks.reportError).toHaveBeenCalled();
  });
});

describe('hasColdOpenCredential', () => {
  it('a password wrap or a family passphrase in the envelope opens the pod without a kit', () => {
    const withWrap = {
      wrappedKeys: { m1: { wrapped: 'w', salt: 's' } },
    } as unknown as BeanpodFileV4;
    const withPassphrase = {
      wrappedKeys: {},
      recoveryPassphrase: { salt: 's' },
    } as unknown as BeanpodFileV4;
    expect(hasColdOpenCredential({ envelope: withWrap })).toBe(true);
    expect(hasColdOpenCredential({ envelope: withPassphrase })).toBe(true);
  });

  it('a kit-born envelope (no wraps, no passphrase) or no envelope at all has none', () => {
    const kitBorn = { wrappedKeys: {}, recoveryKeys: { k1: {} } } as unknown as BeanpodFileV4;
    expect(hasColdOpenCredential({ envelope: kitBorn })).toBe(false);
    expect(hasColdOpenCredential({ envelope: null })).toBe(false);
  });
});

describe('needsKitGuardBeforeSignOut — truth table', () => {
  const kitBornEnvelope = { wrappedKeys: {} } as unknown as BeanpodFileV4;
  const passwordEraEnvelope = {
    wrappedKeys: { m1: { wrapped: 'w', salt: 's' } },
  } as unknown as BeanpodFileV4;
  const passphraseEnvelope = {
    wrappedKeys: {},
    recoveryPassphrase: { salt: 's' },
  } as unknown as BeanpodFileV4;
  type GuardCase = {
    name: string;
    dropsKeyMaterial: boolean;
    manager: boolean;
    isDemo: boolean;
    envelope: BeanpodFileV4 | null;
    settings: Settings | null;
    expected: boolean;
  };
  const base = {
    dropsKeyMaterial: true,
    manager: true,
    isDemo: false,
    envelope: kitBornEnvelope,
    settings: { recoveryKitConfirmedVia: 'acknowledged' } as Settings,
  };
  const cases: GuardCase[] = [
    { name: 'ticked-only kit, key-dropping sign-out, manager: guard', ...base, expected: true },
    {
      name: 'saved kit: no guard',
      ...base,
      settings: { recoveryKitConfirmedVia: 'saved' } as Settings,
      expected: false,
    },
    {
      name: 'sign-out keeps key material (trusted keep-data): no guard',
      ...base,
      dropsKeyMaterial: false,
      expected: false,
    },
    { name: 'non-manager: no guard', ...base, manager: false, expected: false },
    { name: 'App Review demo: no guard', ...base, isDemo: true, expected: false },
    {
      name: 'family has a recovery passphrase: no guard',
      ...base,
      envelope: passphraseEnvelope,
      expected: false,
    },
    {
      name: 'legacy kit-born (confirmed before `via`): guard',
      ...base,
      settings: { recoveryKitConfirmedAt: 'x' } as Settings,
      expected: true,
    },
    {
      name: 'legacy password-era (password wraps in the envelope): no guard (Q2)',
      ...base,
      settings: { recoveryKitConfirmedAt: 'x' } as Settings,
      envelope: passwordEraEnvelope,
      expected: false,
    },
    {
      name: 'password-era family that later ticked past a NEW kit: no guard (password opens cold)',
      ...base,
      envelope: passwordEraEnvelope,
      expected: false,
    },
    {
      name: 'settings and envelope not loaded: guard (safe direction)',
      ...base,
      settings: null,
      envelope: null,
      expected: true,
    },
  ];
  it.each(cases)('$name', (c) => {
    expect(
      needsKitGuardBeforeSignOut({
        member: member({ canManagePod: c.manager }),
        owner: member({ passwordHash: '' }),
        settings: c.settings,
        envelope: c.envelope,
        dropsKeyMaterial: c.dropsKeyMaterial,
        isDemo: c.isDemo,
      })
    ).toBe(c.expected);
  });
});
