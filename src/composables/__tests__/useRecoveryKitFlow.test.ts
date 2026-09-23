/**
 * useRecoveryKitFlow — generate → show → confirm-stored for a NEW recovery kit
 * (2026-09-23), shared by Settings, the kit nag and the sign-out kit guard.
 *   - `confirmStored` returns whether the confirmation reached the family file; the
 *     sign-out guard continues only when it did.
 *   - `retrySync` re-pushes; it must NEVER mint another kit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createRecoveryKit: vi.fn(),
  markRecoveryKitConfirmed: vi.fn(async () => {}),
  syncNowBounded: vi.fn(async () => true),
  emitKitConfirmNotSynced: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ createRecoveryKit: h.createRecoveryKit }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ markRecoveryKitConfirmed: h.markRecoveryKitConfirmed }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ syncNowBounded: h.syncNowBounded }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitKitConfirmNotSynced: h.emitKitConfirmNotSynced,
}));

import { useRecoveryKitFlow } from '@/composables/useRecoveryKitFlow';

beforeEach(() => {
  vi.clearAllMocks();
  h.createRecoveryKit.mockResolvedValue({ success: true, kitId: 'k1', code: 'AAAA-BBBB' });
  h.syncNowBounded.mockResolvedValue(true);
});

describe('useRecoveryKitFlow', () => {
  it('generate shows the new kit', async () => {
    const flow = useRecoveryKitFlow();
    await flow.generate();
    expect(flow.showKit.value).toBe(true);
    expect(flow.kitCode.value).toBe('AAAA-BBBB');
    expect(flow.kitId.value).toBe('k1');
    expect(flow.isGenerating.value).toBe(false);
  });

  it('a failed generate sets `error` and shows nothing', async () => {
    h.createRecoveryKit.mockResolvedValueOnce({ success: false, error: 'pod not open' });
    const flow = useRecoveryKitFlow();
    await flow.generate();
    expect(flow.error.value).toBe('pod not open');
    expect(flow.showKit.value).toBe(false);
  });

  it('confirmStored stamps `via`, drops the code, and returns true when the push landed', async () => {
    const flow = useRecoveryKitFlow();
    await flow.generate();
    const durable = await flow.confirmStored('saved');
    expect(durable).toBe(true);
    expect(h.markRecoveryKitConfirmed).toHaveBeenCalledWith('saved');
    expect(flow.kitCode.value).toBe('');
    expect(flow.showKit.value).toBe(false);
    expect(flow.unsynced.value).toBe(false);
  });

  it('isConfirming is true for the whole of confirmStored (no double-mint window)', async () => {
    let resolvePush: (v: boolean) => void = () => {};
    h.syncNowBounded.mockImplementationOnce(() => new Promise((r) => (resolvePush = r)));
    const flow = useRecoveryKitFlow();
    const pending = flow.confirmStored('acknowledged');
    await Promise.resolve();
    expect(flow.isConfirming.value).toBe(true);
    resolvePush(true);
    await pending;
    expect(flow.isConfirming.value).toBe(false);
  });

  it('a push that did not land returns false, sets `unsynced` + `error`, and is reported', async () => {
    h.syncNowBounded.mockResolvedValueOnce(false);
    const flow = useRecoveryKitFlow();
    expect(await flow.confirmStored('saved')).toBe(false);
    expect(flow.unsynced.value).toBe(true);
    expect(flow.error.value).toBe('recovery.kitNotSynced');
    expect(h.emitKitConfirmNotSynced).toHaveBeenCalledTimes(1);
  });

  it('retrySync re-pushes WITHOUT minting another kit, and clears the error on success', async () => {
    h.syncNowBounded.mockResolvedValueOnce(false);
    const flow = useRecoveryKitFlow();
    await flow.generate();
    await flow.confirmStored('saved');
    h.createRecoveryKit.mockClear();

    expect(await flow.retrySync()).toBe(true);
    expect(h.createRecoveryKit).not.toHaveBeenCalled();
    expect(flow.unsynced.value).toBe(false);
    expect(flow.error.value).toBeNull();
  });

  it('a later generate clears a stale error and `unsynced` first', async () => {
    h.syncNowBounded.mockResolvedValueOnce(false);
    const flow = useRecoveryKitFlow();
    await flow.confirmStored('acknowledged');
    expect(flow.unsynced.value).toBe(true);
    await flow.generate();
    expect(flow.unsynced.value).toBe(false);
    expect(flow.error.value).toBeNull();
  });
});
