/**
 * RecoverySettings owns the Replace-the-last-kit state (tracker #99), because the shared
 * kit flow serves the nag and the sign-out guard too and must not learn about replacement.
 *   - Replace: approve → mint → the OLD kit is invalidated only once the new one's
 *     confirmation is durable;
 *   - a not-durable confirmation leaves the old kit alone, says so, and records it;
 *   - a failed mint clears the pending replacement;
 *   - the pending id is cleared BEFORE the confirm await (a second `stored` cannot double
 *     retire).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

const h = vi.hoisted(() => ({
  generate: vi.fn(async () => {}),
  confirmStored: vi.fn(async () => true),
  flowError: { value: null as string | null },
  approveReplace: vi.fn(async () => true),
  invalidateKit: vi.fn(async () => true),
  toastKitInvalidateOutcome: vi.fn(),
  invalidateRecoveryKit: vi.fn(async () => ({
    invalidated: true,
    save: 'saved',
    liveRemaining: 1,
  })),
  emitKitInvalidateOutcome: vi.fn(),
  confirm: vi.fn(async () => true),
  pulse: vi.fn(),
  recoveryKits: [] as unknown[],
  liveRecoveryKitCount: 1,
}));

vi.mock('@/composables/useConfirm', () => ({ confirm: h.confirm, alert: vi.fn() }));
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ pulse: h.pulse }),
}));

vi.mock('@/composables/useRecoveryKitFlow', () => ({
  useRecoveryKitFlow: () => ({
    kitCode: ref(''),
    kitId: ref(''),
    showKit: ref(false),
    isGenerating: ref(false),
    isConfirming: ref(false),
    unsynced: ref(false),
    error: h.flowError,
    generate: h.generate,
    confirmStored: h.confirmStored,
    retrySync: vi.fn(),
  }),
}));
vi.mock('@/composables/useRecoveryKitActions', () => ({
  approveReplace: h.approveReplace,
  invalidateKit: h.invalidateKit,
  toastKitInvalidateOutcome: h.toastKitInvalidateOutcome,
}));
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canManagePod: ref(true) }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    invalidateRecoveryKit: h.invalidateRecoveryKit,
    setRecoveryPassphrase: vi.fn(),
  }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    envelope: { recoveryPassphrase: undefined },
    get recoveryKits() {
      return h.recoveryKits;
    },
    get liveRecoveryKitCount() {
      return h.liveRecoveryKitCount;
    },
  }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitKitInvalidateOutcome: h.emitKitInvalidateOutcome,
}));

import RecoverySettings from '@/components/settings/RecoverySettings.vue';

const stubs = {
  BaseCard: { template: '<div><slot /></div>' },
  BaseButton: { template: '<button><slot /></button>' },
  BaseInput: { template: '<input />' },
  RecoveryKitDisplay: {
    name: 'RecoveryKitDisplay',
    props: ['open'],
    emits: ['stored'],
    template: '<div data-kit-display="1" />',
  },
  RecoveryKitsModal: {
    name: 'RecoveryKitsModal',
    props: ['open', 'kits', 'canManage'],
    emits: ['close', 'create', 'invalidate', 'replace'],
    template: '<div data-kits-modal="1" :data-open="String(open)" />',
  },
};

const oldKit = { kitId: 'old00001', status: 'live' as const, createdAt: '2026-01-01T00:00:00Z' };

function mountSettings() {
  return mount(RecoverySettings, { global: { stubs } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.flowError.value = null;
  h.recoveryKits = [oldKit];
  h.liveRecoveryKitCount = 1;
  h.approveReplace.mockResolvedValue(true);
  h.confirm.mockResolvedValue(true);
  h.confirmStored.mockResolvedValue(true);
  vi.useRealTimers();
  h.invalidateRecoveryKit.mockResolvedValue({ invalidated: true, save: 'saved', liveRemaining: 1 });
});

describe('RecoverySettings — Replace the last kit', () => {
  it('approve → mint → durable confirm → the OLD kit is invalidated with kind replace', async () => {
    const w = mountSettings();
    const modal = w.findComponent({ name: 'RecoveryKitsModal' });
    await modal.vm.$emit('replace', oldKit);
    await flushPromises();
    expect(h.approveReplace).toHaveBeenCalledWith(oldKit);
    expect(h.generate).toHaveBeenCalledTimes(1);
    // The list closes before the kit modal opens (both are base-layer modals).
    expect(modal.attributes('data-open')).toBe('false');

    await w.findComponent({ name: 'RecoveryKitDisplay' }).vm.$emit('stored', 'saved');
    await flushPromises();
    expect(h.confirmStored).toHaveBeenCalledWith('saved');
    expect(h.invalidateRecoveryKit).toHaveBeenCalledWith('old00001', { kind: 'replace' });
    expect(h.toastKitInvalidateOutcome).toHaveBeenCalledWith({
      invalidated: true,
      save: 'saved',
      liveRemaining: 1,
    });
  });

  it('a not-durable confirmation leaves the old kit valid, says so, and records it', async () => {
    h.confirmStored.mockResolvedValueOnce(false);
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('replace', oldKit);
    await flushPromises();
    await w.findComponent({ name: 'RecoveryKitDisplay' }).vm.$emit('stored', 'saved');
    await flushPromises();
    expect(h.invalidateRecoveryKit).not.toHaveBeenCalled();
    expect(h.emitKitInvalidateOutcome).toHaveBeenCalledWith({
      outcome: 'refused',
      kind: 'replace',
      errorCode: 'confirm_not_synced',
    });
    expect(w.text()).toContain('recovery.kitReplaceNotSynced');
  });

  it('a declined approval never mints', async () => {
    h.approveReplace.mockResolvedValueOnce(false);
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('replace', oldKit);
    await flushPromises();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('a failed mint clears the pending replacement, so a later stored event retires nothing', async () => {
    h.generate.mockImplementationOnce(async () => {
      h.flowError.value = 'recovery.podNotOpen';
    });
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('replace', oldKit);
    await flushPromises();
    h.flowError.value = null;
    await w.findComponent({ name: 'RecoveryKitDisplay' }).vm.$emit('stored', 'saved');
    await flushPromises();
    expect(h.invalidateRecoveryKit).not.toHaveBeenCalled();
  });

  it('a second stored event during a slow invalidation cannot retire the old kit twice', async () => {
    let release!: () => void;
    h.confirmStored.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (release = () => resolve(true)))
    );
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('replace', oldKit);
    await flushPromises();
    const display = w.findComponent({ name: 'RecoveryKitDisplay' });
    void display.vm.$emit('stored', 'saved');
    void display.vm.$emit('stored', 'saved');
    release();
    await flushPromises();
    expect(h.invalidateRecoveryKit).toHaveBeenCalledTimes(1);
  });

  it('Replace never shows the create confirm (it has its own)', async () => {
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('replace', oldKit);
    await flushPromises();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('a plain create from the list closes the list and mints without a pending replacement', async () => {
    const w = mountSettings();
    const modal = w.findComponent({ name: 'RecoveryKitsModal' });
    await modal.vm.$emit('create');
    await flushPromises();
    expect(h.generate).toHaveBeenCalledTimes(1);
    await w.findComponent({ name: 'RecoveryKitDisplay' }).vm.$emit('stored', 'acknowledged');
    await flushPromises();
    expect(h.invalidateRecoveryKit).not.toHaveBeenCalled();
  });

  it('invalidate from the list delegates to the actions composable', async () => {
    h.recoveryKits = [oldKit, { ...oldKit, kitId: 'new00002' }];
    h.liveRecoveryKitCount = 2;
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('invalidate', oldKit);
    await flushPromises();
    expect(h.invalidateKit).toHaveBeenCalledWith(oldKit);
  });
});

describe('RecoverySettings — create confirm and the empty-state pulse', () => {
  it('create asks first, leading with how many kits are live, and mints only on yes', async () => {
    h.recoveryKits = [oldKit, { ...oldKit, kitId: 'new00002' }];
    h.liveRecoveryKitCount = 2;
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('create');
    await flushPromises();
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'recovery.kitCreateTitle',
        message: 'recovery.kitCreateBody',
        detail: 'recovery.kitCreateHaveMany',
        detailTone: 'caution',
        variant: 'info',
      })
    );
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('declining the confirm mints nothing', async () => {
    h.confirm.mockResolvedValueOnce(false);
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('create');
    await flushPromises();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('with no live kit the detail is encouragement, not caution', async () => {
    h.recoveryKits = [];
    h.liveRecoveryKitCount = 0;
    const w = mountSettings();
    await w.findComponent({ name: 'RecoveryKitsModal' }).vm.$emit('create');
    await flushPromises();
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'recovery.kitCreateHaveNone', detailTone: undefined })
    );
  });

  it('pulses the create button on open when no kit is live, and only then', async () => {
    vi.useFakeTimers();
    h.recoveryKits = [];
    h.liveRecoveryKitCount = 0;
    mountSettings();
    await flushPromises();
    vi.advanceTimersByTime(400);
    expect(h.pulse).toHaveBeenCalledTimes(1);
    expect(h.pulse).toHaveBeenCalledWith(expect.any(HTMLElement), 'attention-pulse-twice');

    h.pulse.mockClear();
    h.recoveryKits = [oldKit];
    h.liveRecoveryKitCount = 1;
    mountSettings();
    await flushPromises();
    vi.advanceTimersByTime(400);
    expect(h.pulse).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
