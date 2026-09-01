/**
 * The step-up gate (#80). The seal is a speed bump; this is the actual boundary, so its
 * failure modes matter more than its happy path — above all that it can never HANG, since
 * four call sites `await` it before a destructive action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const alertMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/composables/useConfirm', () => ({ alert: alertMock, confirm: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

import { requireReauth, useReauth } from '@/composables/useReauth';
import { useFamilyStore } from '@/stores/familyStore';
import type { FamilyMember } from '@/types/models';

const bean = {
  id: 'm1',
  name: 'Bean',
  email: 'b@e.c',
  gender: 'other',
  ageGroup: 'adult',
  role: 'member',
  color: '#000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as FamilyMember;

function seedMember() {
  const familyStore = useFamilyStore();
  familyStore.members = [bean];
  familyStore.currentMemberId = 'm1';
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  // Drain any gate left open by a previous case.
  const { state, handleCancelled } = useReauth();
  if (state.value.open) handleCancelled();
});

describe('useReauth', () => {
  it('resolves true when the challenge verifies', async () => {
    seedMember();
    const pending = requireReauth();
    useReauth().handleVerified();
    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when the user cancels', async () => {
    seedMember();
    const pending = requireReauth();
    useReauth().handleCancelled();
    await expect(pending).resolves.toBe(false);
  });

  it('resolves false — never hangs — when no member is resolved yet', async () => {
    const familyStore = useFamilyStore();
    familyStore.members = [];
    familyStore.currentMemberId = null;

    await expect(requireReauth()).resolves.toBe(false);
    // The user is told, and a developer is told why.
    expect(alertMock).toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'reauth-gate' })
    );
  });

  it('refuses a second concurrent gate rather than stacking two prompts', async () => {
    seedMember();
    const first = requireReauth();
    await expect(requireReauth()).resolves.toBe(false);
    useReauth().handleVerified();
    await expect(first).resolves.toBe(true);
  });
});
