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
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: mocks.reportError }));

import {
  resolveAuthPrompt,
  hasKitConfirmedSignal,
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
    flags: {
      isPinPromptDismissed: () => false,
      kitPromptDismissed: false,
      trustedDevicePromptShown: false,
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
      },
    });
    expect(await resolveAuthPrompt(base)).toBe('native-biometric');
    // ...but never when the member already has a key on this device.
    mocks.resolveDeviceKeys.mockResolvedValue([{ memberId: 'm1' }]);
    expect(await resolveAuthPrompt(base)).toBeNull();
  });

  it('trust is the terminal prompt', async () => {
    const id = await resolveAuthPrompt(
      ctx({
        member: member({ pinHash: 'salt:pin' }),
        settings: { recoveryKitConfirmedAt: 'x' } as Settings,
      })
    );
    expect(id).toBe('trust');
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
    expect(id).toBe('trust');
    expect(mocks.reportError).toHaveBeenCalled();
  });
});
