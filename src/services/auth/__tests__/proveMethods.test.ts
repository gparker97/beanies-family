import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PasskeyRegistration } from '@/types/models';
import type { ProveContext } from '@/services/auth/proveMethods';

const resolveDeviceKeys = vi.fn<() => Promise<PasskeyRegistration[]>>();
vi.mock('@/services/auth/passkeyService', () => ({
  resolveDeviceKeys: (...args: unknown[]) =>
    (resolveDeviceKeys as unknown as (...a: unknown[]) => Promise<PasskeyRegistration[]>)(...args),
}));
const isNative = vi.fn(() => false);
vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => isNative(),
}));
const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));
const getPinUnlockRecord = vi.fn(async () => undefined);
const removePinUnlock = vi.fn(async () => {});
vi.mock('@/services/auth/deviceUnlock', () => ({
  getPinUnlockRecord: (...args: unknown[]) =>
    (getPinUnlockRecord as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
  removePinUnlock: (...args: unknown[]) =>
    (removePinUnlock as unknown as (...a: unknown[]) => Promise<void>)(...args),
}));
const emitProveMethodsResolved = vi.fn();
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitProveMethodsResolved: (...args: unknown[]) => emitProveMethodsResolved(...args),
}));

import { resolveProveMethods } from '@/services/auth/proveMethods';

function reg(memberId: string): PasskeyRegistration {
  return {
    credentialId: `cred-${memberId}`,
    memberId,
    familyId: 'fam-1',
    publicKey: '',
    prfSupported: false,
    mechanism: 'native-keystore',
    label: 'Face ID',
    createdAt: '2026-01-01',
  };
}

function ctx(overrides: Partial<ProveContext> = {}): ProveContext {
  return {
    familyId: 'fam-1',
    memberId: 'm-1',
    podOpen: false,
    hasCredential: true,
    hasPin: null,
    hasPassword: null,
    envelopeHasPasswordWraps: null,
    rosterSource: 'roster',
    ...overrides,
  };
}

describe('resolveProveMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDeviceKeys.mockResolvedValue([]);
    isNative.mockReturnValue(false);
  });

  it('offers biometric first when this member has a key on this NATIVE device', async () => {
    isNative.mockReturnValue(true);
    resolveDeviceKeys.mockResolvedValue([reg('m-1'), reg('m-2')]);
    const methods = await resolveProveMethods(ctx());
    expect(methods.map((m) => m.kind)).toEqual(['biometric', 'password', 'recovery']);
    expect(methods[0]).toMatchObject({ registration: { memberId: 'm-1' } });
  });

  it("does NOT offer biometric for a sibling's key", async () => {
    isNative.mockReturnValue(true);
    resolveDeviceKeys.mockResolvedValue([reg('m-2')]);
    const methods = await resolveProveMethods(ctx());
    expect(methods.map((m) => m.kind)).toEqual(['password', 'recovery']);
  });

  it('withholds biometric on WEB even for an own registration, reporting prfWithheld', async () => {
    // Phase 4: the web WebAuthn+PRF path is retired — a lingering web registration
    // never surfaces as a method, only as the prf_withheld straggler signal.
    resolveDeviceKeys.mockResolvedValue([reg('m-1')]);
    const methods = await resolveProveMethods(ctx());
    expect(methods.map((m) => m.kind)).toEqual(['password', 'recovery']);
    expect(emitProveMethodsResolved).toHaveBeenCalledWith(
      expect.objectContaining({ prfWithheld: true })
    );
  });

  it('offers tap-through only for a credential-less member on an OPEN pod', async () => {
    const open = await resolveProveMethods(ctx({ podOpen: true, hasCredential: false }));
    expect(open.map((m) => m.kind)).toEqual(['tap-through', 'password', 'recovery']);

    const closed = await resolveProveMethods(ctx({ podOpen: false, hasCredential: false }));
    expect(closed.map((m) => m.kind)).toEqual(['password', 'recovery']);
  });

  it('treats UNKNOWN credential state as credentialed — never taps through on null', async () => {
    const methods = await resolveProveMethods(ctx({ podOpen: true, hasCredential: null }));
    expect(methods.map((m) => m.kind)).toEqual(['password', 'recovery']);
  });

  it('a throwing probe degrades its method away, reports, and never blanks the screen', async () => {
    isNative.mockReturnValue(true);
    resolveDeviceKeys.mockRejectedValue(new Error('registry broken'));
    const methods = await resolveProveMethods(ctx({ podOpen: true, hasCredential: false }));
    // biometric degraded away; tap-through, password, and the terminal survive
    expect(methods.map((m) => m.kind)).toEqual(['tap-through', 'password', 'recovery']);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'login-flow', severity: 'warning' })
    );
    expect(emitProveMethodsResolved).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'Error' })
    );
  });

  it('never returns an empty list — recovery is the unconditional terminal', async () => {
    isNative.mockReturnValue(true);
    resolveDeviceKeys.mockRejectedValue(new Error('boom'));
    getPinUnlockRecord.mockRejectedValue(new Error('boom') as never);
    // Suppress password too so ONLY the terminal is left standing.
    const methods = await resolveProveMethods(ctx({ hasPassword: false }));
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.at(-1)).toEqual({ kind: 'recovery' });
    expect(methods.map((m) => m.kind)).toEqual(['recovery']);
    getPinUnlockRecord.mockResolvedValue(undefined);
  });

  it('offers PIN when a device wrap exists (cold), and doc-only PIN only on an open pod', async () => {
    getPinUnlockRecord.mockResolvedValueOnce({ id: 'fam-1:m-1' } as never);
    const cold = await resolveProveMethods(ctx());
    expect(cold.map((m) => m.kind)).toEqual(['pin', 'password', 'recovery']);
    expect(cold[0]).toMatchObject({ hasDeviceWrap: true });

    // Warm doc-side PIN: offered without a device wrap — and password is suppressed,
    // because a PIN is verifiably usable instead (Phase 4 conditional probe).
    const openDocPin = await resolveProveMethods(ctx({ podOpen: true, hasPin: true }));
    expect(openDocPin.map((m) => m.kind)).toEqual(['pin', 'recovery']);
    expect(openDocPin[0]).toMatchObject({ hasDeviceWrap: false });

    // Doc-only PIN is NEVER offered cold (nothing to verify against, nothing to unwrap).
    const coldDocPin = await resolveProveMethods(ctx({ podOpen: false, hasPin: true }));
    expect(coldDocPin.map((m) => m.kind)).toEqual(['password', 'recovery']);
  });

  it('self-heals a stale PIN wrap when the OPEN doc has no pinHash (review F9)', async () => {
    getPinUnlockRecord.mockResolvedValueOnce({ id: 'fam-1:m-1' } as never);
    const methods = await resolveProveMethods(
      ctx({ podOpen: true, hasPin: false, hasCredential: false })
    );
    expect(methods.map((m) => m.kind)).toEqual(['tap-through', 'password', 'recovery']);
    expect(removePinUnlock).toHaveBeenCalledWith('fam-1', 'm-1');
  });

  describe('password as a conditional probe (Phase 4)', () => {
    it('suppresses password for a warm member with a doc-side PIN', async () => {
      const methods = await resolveProveMethods(ctx({ podOpen: true, hasPin: true }));
      expect(methods.map((m) => m.kind)).not.toContain('password');
      expect(methods.map((m) => m.kind)).toEqual(['pin', 'recovery']);
    });

    it('suppresses password COLD against a kit-born envelope (no password wraps)', async () => {
      const methods = await resolveProveMethods(
        ctx({ podOpen: false, envelopeHasPasswordWraps: false })
      );
      expect(methods.map((m) => m.kind)).toEqual(['recovery']);
    });

    it('offers password COLD when both hasPassword and envelope wraps are unknown', async () => {
      const methods = await resolveProveMethods(
        ctx({ podOpen: false, hasPassword: null, envelopeHasPasswordWraps: null })
      );
      expect(methods.map((m) => m.kind)).toEqual(['password', 'recovery']);
    });

    it('suppresses password when the member verifiably has none', async () => {
      const methods = await resolveProveMethods(ctx({ hasPassword: false }));
      expect(methods.map((m) => m.kind)).toEqual(['recovery']);
    });
  });

  it('emits prove_methods_resolved with the ordered kinds, roster source, and prfWithheld', async () => {
    isNative.mockReturnValue(true);
    resolveDeviceKeys.mockResolvedValue([reg('m-1')]);
    await resolveProveMethods(ctx({ rosterSource: 'credential-records' }));
    expect(emitProveMethodsResolved).toHaveBeenCalledWith({
      methods: ['biometric', 'password', 'recovery'],
      rosterSource: 'credential-records',
      errorCode: undefined,
      prfWithheld: false,
    });
  });
});
