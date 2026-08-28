import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PasskeyRegistration } from '@/types/models';
import type { ProveContext } from '@/services/auth/proveMethods';

const resolveDeviceKeys = vi.fn<() => Promise<PasskeyRegistration[]>>();
vi.mock('@/services/auth/passkeyService', () => ({
  resolveDeviceKeys: (...args: unknown[]) =>
    (resolveDeviceKeys as unknown as (...a: unknown[]) => Promise<PasskeyRegistration[]>)(...args),
}));
const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));
const getPinUnlockRecord = vi.fn(async () => undefined);
vi.mock('@/services/auth/deviceUnlock', () => ({
  getPinUnlockRecord: (...args: unknown[]) =>
    (getPinUnlockRecord as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
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
    rosterSource: 'roster',
    ...overrides,
  };
}

describe('resolveProveMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDeviceKeys.mockResolvedValue([]);
  });

  it('offers biometric first when this member has a key on this device', async () => {
    resolveDeviceKeys.mockResolvedValue([reg('m-1'), reg('m-2')]);
    const methods = await resolveProveMethods(ctx());
    expect(methods.map((m) => m.kind)).toEqual(['biometric', 'password']);
    expect(methods[0]).toMatchObject({ registration: { memberId: 'm-1' } });
  });

  it("does NOT offer biometric for a sibling's key", async () => {
    resolveDeviceKeys.mockResolvedValue([reg('m-2')]);
    const methods = await resolveProveMethods(ctx());
    expect(methods.map((m) => m.kind)).toEqual(['password']);
  });

  it('offers tap-through only for a credential-less member on an OPEN pod', async () => {
    const open = await resolveProveMethods(ctx({ podOpen: true, hasCredential: false }));
    expect(open.map((m) => m.kind)).toEqual(['tap-through', 'password']);

    const closed = await resolveProveMethods(ctx({ podOpen: false, hasCredential: false }));
    expect(closed.map((m) => m.kind)).toEqual(['password']);
  });

  it('treats UNKNOWN credential state as credentialed — never taps through on null', async () => {
    const methods = await resolveProveMethods(ctx({ podOpen: true, hasCredential: null }));
    expect(methods.map((m) => m.kind)).toEqual(['password']);
  });

  it('a throwing probe degrades its method away, reports, and never blanks the screen', async () => {
    resolveDeviceKeys.mockRejectedValue(new Error('registry broken'));
    const methods = await resolveProveMethods(ctx({ podOpen: true, hasCredential: false }));
    // biometric degraded away; tap-through and the terminal survive
    expect(methods.map((m) => m.kind)).toEqual(['tap-through', 'password']);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'login-flow', severity: 'warning' })
    );
    expect(emitProveMethodsResolved).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'Error' })
    );
  });

  it('never returns an empty list — password is the unconditional terminal', async () => {
    resolveDeviceKeys.mockRejectedValue(new Error('boom'));
    const methods = await resolveProveMethods(ctx());
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.at(-1)).toEqual({ kind: 'password' });
  });

  it('offers PIN when a device wrap exists (cold), and doc-only PIN only on an open pod', async () => {
    getPinUnlockRecord.mockResolvedValueOnce({ id: 'fam-1:m-1' } as never);
    const cold = await resolveProveMethods(ctx());
    expect(cold.map((m) => m.kind)).toEqual(['pin', 'password']);
    expect(cold[0]).toMatchObject({ hasDeviceWrap: true });

    const openDocPin = await resolveProveMethods(ctx({ podOpen: true, hasPin: true }));
    expect(openDocPin.map((m) => m.kind)).toEqual(['pin', 'password']);
    expect(openDocPin[0]).toMatchObject({ hasDeviceWrap: false });

    // Doc-only PIN is NEVER offered cold (nothing to verify against, nothing to unwrap).
    const coldDocPin = await resolveProveMethods(ctx({ podOpen: false, hasPin: true }));
    expect(coldDocPin.map((m) => m.kind)).toEqual(['password']);
  });

  it('emits prove_methods_resolved with the ordered kinds and roster source', async () => {
    resolveDeviceKeys.mockResolvedValue([reg('m-1')]);
    await resolveProveMethods(ctx({ rosterSource: 'credential-records' }));
    expect(emitProveMethodsResolved).toHaveBeenCalledWith({
      methods: ['biometric', 'password'],
      rosterSource: 'credential-records',
      errorCode: undefined,
    });
  });
});
