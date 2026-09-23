/**
 * The approver's sheet (#97) — the step-up now happens INSIDE it (2026-09-23): approving
 * shows the PIN/biometric step in place of the compare panel, never a second modal on top.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const h = vi.hoisted(() => ({
  publish: vi.fn(async () => 'saved' as string),
  report: vi.fn(),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    familyKey: {},
    deviceApprovalCreatedAt: () => null,
    publishDeviceApprovalWrap: h.publish,
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMemberId: 'm1', currentMember: { id: 'm1', pinHash: 'h' } }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyName: 'Test' }),
}));
vi.mock('@/services/crypto/deviceApproval', () => ({
  readApprovalRequest: vi.fn(async () => ({ fingerprint: 'ABC123' })),
  wrapForApproval: vi.fn(async () => ({ salt: 's', wrapped: 'w' })),
  APPROVAL_EXPIRY_MS: 60_000,
}));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({ emitDeviceApprovalOutcome: vi.fn() }));
vi.mock('@/composables/useReauth', () => ({
  canStepUp: () => true,
  reportReauthOutcome: h.report,
}));
vi.mock('@/composables/useIsTouchPrimary', () => ({ useIsTouchPrimary: () => false }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import DeviceApprovalSheet from '../DeviceApprovalSheet.vue';

const ProveStub = {
  template:
    '<div data-testid="prove"><button data-testid="ok" @click="$emit(\'verified\')" /><button data-testid="no" @click="$emit(\'cancelled\')" /></div>',
};

function mountIt() {
  return mount(DeviceApprovalSheet, {
    props: { open: true, publicKey: 'pk', delivery: 'warm' },
    global: { stubs: { Teleport: true, BeanieIcon: true, ReauthChallenge: ProveStub } },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  h.publish.mockResolvedValue('saved');
});

describe('DeviceApprovalSheet — one sheet, start to finish', () => {
  it('approving shows the step-up IN the sheet, then publishes and says so', async () => {
    const w = mountIt();
    await flushPromises();
    expect(w.text()).toContain('deviceApproval.compareHint');

    await w.get('[data-testid="approval-approve"]').trigger('click');
    await flushPromises();
    // The step-up replaced the compare panel — one dialog, not two.
    expect(w.find('[data-testid="prove"]').exists()).toBe(true);
    expect(w.findAll('[role="dialog"]')).toHaveLength(1);
    expect(h.publish).not.toHaveBeenCalled();

    await w.get('[data-testid="ok"]').trigger('click');
    await flushPromises();
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledWith(true, undefined);
    expect(w.find('[data-testid="approval-done"]').exists()).toBe(true);
    expect(w.text()).toContain('deviceApproval.doneBody');
  });

  it('a declined step-up publishes nothing and returns to the code', async () => {
    const w = mountIt();
    await flushPromises();
    await w.get('[data-testid="approval-approve"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="no"]').trigger('click');
    await flushPromises();
    expect(h.publish).not.toHaveBeenCalled();
    expect(w.find('[data-testid="approval-approve"]').exists()).toBe(true);
    expect(w.text()).toContain('deviceApproval.pinRequired');
  });

  it('closing the sheet mid-step-up settles it and publishes nothing', async () => {
    const w = mountIt();
    await flushPromises();
    await w.get('[data-testid="approval-approve"]').trigger('click');
    await flushPromises();
    await w.setProps({ open: false });
    await flushPromises();
    expect(h.publish).not.toHaveBeenCalled();
    // The SHEET ended it, not the person: not counted as a reauth cancel (runApproval
    // reports it as a dismissed request instead).
    expect(h.report).not.toHaveBeenCalled();
  });

  it('a close during the step-up cancels the STEP-UP, never the request (the key survives)', async () => {
    const w = mountIt();
    await flushPromises();
    await w.get('[data-testid="approval-approve"]').trigger('click');
    await flushPromises();
    w.findComponent({ name: 'BaseModal' }).vm.$emit('close');
    await flushPromises();
    // Not emitted: App.vue would discard the key for good.
    expect(w.emitted('close')).toBeUndefined();
    expect(w.find('[data-testid="approval-approve"]').exists()).toBe(true);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('stays closable during the step-up, where nothing has been published', async () => {
    const w = mountIt();
    await flushPromises();
    await w.get('[data-testid="approval-approve"]').trigger('click');
    await flushPromises();
    expect(w.findComponent({ name: 'BaseModal' }).props('closable')).toBe(true);
  });
});
