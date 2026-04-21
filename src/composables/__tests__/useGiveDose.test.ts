import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Medication, FamilyMember } from '@/types/models';

// Mock the dose-confirm composable + showToast so we can assert on
// invocations without mounting DOM.
vi.mock('@/composables/useDoseConfirm', () => ({
  requestDoseConfirm: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

// Repositories — useGiveDose → medicationsStore → repo
vi.mock('@/services/automerge/repositories/medicationRepository', () => ({
  getAllMedications: vi.fn().mockResolvedValue([]),
  createMedication: vi.fn(),
  updateMedication: vi.fn(),
  deleteMedication: vi.fn(),
  deleteMedicationCascade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/automerge/repositories/medicationLogRepository', () => ({
  getAllMedicationLogs: vi.fn().mockResolvedValue([]),
  createMedicationLog: vi.fn(),
  deleteMedicationLog: vi.fn(),
}));

// Translation: pass-through t() that returns the key.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useGiveDose } from '../useGiveDose';
import { useFamilyStore } from '@/stores/familyStore';
import { requestDoseConfirm } from '@/composables/useDoseConfirm';
import { showToast } from '@/composables/useToast';
import * as medicationLogRepo from '@/services/automerge/repositories/medicationLogRepository';

function med(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    memberId: 'member-1',
    name: 'Paracetamol',
    dose: '500mg',
    frequency: '3x daily',
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    ...overrides,
  };
}

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'member-1',
    name: 'Greg',
    email: 'greg@test.com',
    gender: 'male',
    ageGroup: 'adult',
    role: 'owner',
    color: '#F15D22',
    requiresPassword: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('useGiveDose', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('returns undefined and surfaces error toast when no currentMember is set', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { giveDose } = useGiveDose();

    const result = await giveDose(med());

    expect(result).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'medicationLog.errors.noCurrentMember',
      'medicationLog.errors.noCurrentMember.detail'
    );
    expect(consoleError).toHaveBeenCalled();
    expect(requestDoseConfirm).not.toHaveBeenCalled();
    expect(medicationLogRepo.createMedicationLog).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('opens the dose-confirm modal and creates the log with the chosen timestamp', async () => {
    const familyStore = useFamilyStore();
    familyStore.members.push(member());
    familyStore.currentMemberId = 'member-1';

    const chosenTimestamp = '2026-04-21T14:03:00.000Z';
    vi.mocked(requestDoseConfirm).mockResolvedValueOnce(chosenTimestamp);
    vi.mocked(medicationLogRepo.createMedicationLog).mockResolvedValueOnce({
      id: 'log-new',
      medicationId: 'med-1',
      administeredOn: chosenTimestamp,
      administeredBy: 'member-1',
      createdAt: '2026-04-21',
      updatedAt: '2026-04-21',
    });

    const { giveDose } = useGiveDose();
    const result = await giveDose(med());

    expect(requestDoseConfirm).toHaveBeenCalledOnce();
    expect(medicationLogRepo.createMedicationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        medicationId: 'med-1',
        administeredOn: chosenTimestamp,
        administeredBy: 'member-1',
      })
    );
    expect(result).toBe('log-new');
  });

  it('returns undefined and creates no log when the user cancels the dose-confirm modal', async () => {
    const familyStore = useFamilyStore();
    familyStore.members.push(member());
    familyStore.currentMemberId = 'member-1';

    vi.mocked(requestDoseConfirm).mockResolvedValueOnce(undefined);

    const { giveDose } = useGiveDose();
    const result = await giveDose(med());

    expect(result).toBeUndefined();
    expect(medicationLogRepo.createMedicationLog).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('returns undefined when the store create action fails (store surfaced its own error)', async () => {
    const familyStore = useFamilyStore();
    familyStore.members.push(member());
    familyStore.currentMemberId = 'member-1';

    vi.mocked(requestDoseConfirm).mockResolvedValueOnce('2026-04-21T10:00:00.000Z');
    vi.mocked(medicationLogRepo.createMedicationLog).mockRejectedValueOnce(new Error('CRDT fail'));

    const { giveDose } = useGiveDose();
    const result = await giveDose(med());

    expect(result).toBeUndefined();
    // Store's wrapAsync surfaces the error toast. useGiveDose must not
    // fire a `success` toast on top — assert no success-variant call.
    const successCalls = vi.mocked(showToast).mock.calls.filter((c) => c[0] === 'success');
    expect(successCalls).toHaveLength(0);
  });

  it('shows success toast with Undo action on success', async () => {
    const familyStore = useFamilyStore();
    familyStore.members.push(member());
    familyStore.currentMemberId = 'member-1';

    const ts = '2026-04-21T10:00:00.000Z';
    vi.mocked(requestDoseConfirm).mockResolvedValueOnce(ts);
    vi.mocked(medicationLogRepo.createMedicationLog).mockResolvedValueOnce({
      id: 'log-new',
      medicationId: 'med-1',
      administeredOn: ts,
      administeredBy: 'member-1',
      createdAt: '2026-04-21',
      updatedAt: '2026-04-21',
    });

    const { giveDose } = useGiveDose();
    await giveDose(med());

    expect(showToast).toHaveBeenCalledOnce();
    const [type, title, , options] = vi.mocked(showToast).mock.calls[0]!;
    expect(type).toBe('success');
    expect(title).toBe('medicationLog.doseLogged');
    expect(options?.actionLabel).toBe('medicationLog.undo');
    expect(options?.actionFn).toBeTypeOf('function');
    expect(options?.durationMs).toBe(6000);
  });
});
