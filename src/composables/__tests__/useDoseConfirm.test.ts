import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestDoseConfirm, useDoseConfirm } from '../useDoseConfirm';
import type { Medication } from '@/types/models';

function med(id = 'med-1'): Medication {
  return {
    id,
    memberId: 'member-1',
    name: 'Paracetamol',
    dose: '500mg',
    frequency: '3x daily',
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
  };
}

describe('useDoseConfirm', () => {
  beforeEach(() => {
    // Reset the module-level singleton by cancelling any pending dialog
    const { state, handleCancel } = useDoseConfirm();
    if (state.value.open) handleCancel();
  });

  it('requestDoseConfirm opens the dialog and resolves with the chosen timestamp on confirm', async () => {
    const { state, handleConfirm } = useDoseConfirm();
    const promise = requestDoseConfirm(med());

    expect(state.value.open).toBe(true);
    expect(state.value.medication?.id).toBe('med-1');

    const ts = '2026-04-21T14:03:00.000Z';
    handleConfirm(ts);

    await expect(promise).resolves.toBe(ts);
    expect(state.value.open).toBe(false);
    expect(state.value.medication).toBeNull();
  });

  it('resolves with undefined when the user cancels', async () => {
    const { state, handleCancel } = useDoseConfirm();
    const promise = requestDoseConfirm(med());

    expect(state.value.open).toBe(true);
    handleCancel();

    await expect(promise).resolves.toBeUndefined();
    expect(state.value.open).toBe(false);
  });

  it('refuses to stack — a second request while open resolves with undefined immediately', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handleConfirm } = useDoseConfirm();

    const first = requestDoseConfirm(med('med-A'));
    const second = requestDoseConfirm(med('med-B'));

    await expect(second).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalled();

    // First is still pending — resolve it to prove it was unaffected
    handleConfirm('2026-04-21T10:00:00.000Z');
    await expect(first).resolves.toBe('2026-04-21T10:00:00.000Z');

    consoleWarn.mockRestore();
  });
});
