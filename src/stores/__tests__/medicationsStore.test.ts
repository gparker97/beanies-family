import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Medication, MedicationLogEntry } from '@/types/models';

// Mock both repositories — store state is what we're asserting on.
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

import { useMedicationsStore } from '../medicationsStore';
import * as medicationRepo from '@/services/automerge/repositories/medicationRepository';
import * as medicationLogRepo from '@/services/automerge/repositories/medicationLogRepository';

// Helpers
function med(overrides: Partial<Medication> = {}): Medication {
  return {
    id: `med-${Math.random().toString(36).slice(2, 8)}`,
    memberId: 'member-1',
    name: 'Paracetamol',
    dose: '500mg',
    frequency: '3x daily',
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    ...overrides,
  };
}

function log(overrides: Partial<MedicationLogEntry> = {}): MedicationLogEntry {
  return {
    id: `log-${Math.random().toString(36).slice(2, 8)}`,
    medicationId: 'med-1',
    administeredOn: '2026-04-21T10:30:00.000Z',
    administeredBy: 'member-1',
    createdAt: '2026-04-21',
    updatedAt: '2026-04-21',
    ...overrides,
  };
}

describe('medicationsStore — log CRUD', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('createMedicationLog appends to state on success', async () => {
    const store = useMedicationsStore();
    const created = log({ id: 'log-new' });
    vi.mocked(medicationLogRepo.createMedicationLog).mockResolvedValue(created);

    const result = await store.createMedicationLog({
      medicationId: 'med-1',
      administeredOn: '2026-04-21T10:30:00.000Z',
      administeredBy: 'member-1',
    });

    expect(result).toEqual(created);
    expect(store.medicationLogs).toContainEqual(created);
  });

  it('createMedicationLog returns null and does NOT append on repo error', async () => {
    const store = useMedicationsStore();
    vi.mocked(medicationLogRepo.createMedicationLog).mockRejectedValue(
      new Error('CRDT write failed')
    );

    const result = await store.createMedicationLog({
      medicationId: 'med-1',
      administeredOn: '2026-04-21T10:30:00.000Z',
      administeredBy: 'member-1',
    });

    expect(result).toBeNull();
    expect(store.medicationLogs).toHaveLength(0);
    expect(store.error).toBe('CRDT write failed');
  });

  it('deleteMedicationLog removes from state and returns true', async () => {
    const store = useMedicationsStore();
    store.medicationLogs.push(log({ id: 'log-a' }), log({ id: 'log-b' }));
    vi.mocked(medicationLogRepo.deleteMedicationLog).mockResolvedValue(true);

    const ok = await store.deleteMedicationLog('log-a');

    expect(ok).toBe(true);
    expect(store.medicationLogs.map((l) => l.id)).toEqual(['log-b']);
  });

  it('deleteMedicationLog returns false when repo says no-op', async () => {
    const store = useMedicationsStore();
    store.medicationLogs.push(log({ id: 'log-a' }));
    vi.mocked(medicationLogRepo.deleteMedicationLog).mockResolvedValue(false);

    const ok = await store.deleteMedicationLog('log-missing');

    expect(ok).toBe(false);
    expect(store.medicationLogs).toHaveLength(1);
  });
});

describe('medicationsStore — logsForMedication', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('filters by medicationId and sorts descending by administeredOn', () => {
    const store = useMedicationsStore();
    store.medicationLogs.push(
      log({ id: 'l1', medicationId: 'med-1', administeredOn: '2026-04-20T08:00:00.000Z' }),
      log({ id: 'l2', medicationId: 'med-1', administeredOn: '2026-04-21T10:30:00.000Z' }),
      log({ id: 'l3', medicationId: 'med-2', administeredOn: '2026-04-21T11:00:00.000Z' }),
      log({ id: 'l4', medicationId: 'med-1', administeredOn: '2026-04-19T14:00:00.000Z' })
    );

    const result = store.logsForMedication('med-1').value;
    expect(result.map((l) => l.id)).toEqual(['l2', 'l1', 'l4']);
  });

  it('returns an empty array when the medication has no logs', () => {
    const store = useMedicationsStore();
    store.medicationLogs.push(log({ medicationId: 'med-other' }));
    expect(store.logsForMedication('med-1').value).toEqual([]);
  });
});

describe('medicationsStore — lastDoseAt', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('returns null when no logs exist', () => {
    const store = useMedicationsStore();
    expect(store.lastDoseAt('med-1')).toBeNull();
  });

  it('returns the single log timestamp when exactly one log exists', () => {
    const store = useMedicationsStore();
    store.medicationLogs.push(
      log({ medicationId: 'med-1', administeredOn: '2026-04-21T09:00:00.000Z' })
    );
    expect(store.lastDoseAt('med-1')).toBe('2026-04-21T09:00:00.000Z');
  });

  it('returns the most recent timestamp across multiple logs', () => {
    const store = useMedicationsStore();
    store.medicationLogs.push(
      log({ medicationId: 'med-1', administeredOn: '2026-04-19T09:00:00.000Z' }),
      log({ medicationId: 'med-1', administeredOn: '2026-04-21T22:15:00.000Z' }),
      log({ medicationId: 'med-1', administeredOn: '2026-04-20T14:00:00.000Z' })
    );
    expect(store.lastDoseAt('med-1')).toBe('2026-04-21T22:15:00.000Z');
  });

  it('ignores logs for other medications', () => {
    const store = useMedicationsStore();
    store.medicationLogs.push(
      log({ medicationId: 'med-other', administeredOn: '2026-04-21T23:59:00.000Z' }),
      log({ medicationId: 'med-1', administeredOn: '2026-04-20T08:00:00.000Z' })
    );
    expect(store.lastDoseAt('med-1')).toBe('2026-04-20T08:00:00.000Z');
  });
});

describe('medicationsStore — dosesToday (timezone-sensitive)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts a dose whose administeredOn maps to today in LOCAL time', () => {
    // Freeze "now" to 2026-04-21 12:00 in the machine's local tz
    vi.setSystemTime(new Date(2026, 3, 21, 12, 0, 0));
    const store = useMedicationsStore();
    // Use local constructor so the stored timestamp is unambiguously "today local"
    const todayAt8 = new Date(2026, 3, 21, 8, 0, 0).toISOString();
    store.medicationLogs.push(log({ medicationId: 'med-1', administeredOn: todayAt8 }));

    expect(store.dosesToday('med-1')).toBe(1);
  });

  it('does NOT count a dose logged at 23:59 yesterday local when we check at 00:01 today local', () => {
    // "now" is 2026-04-21 00:01 local
    vi.setSystemTime(new Date(2026, 3, 21, 0, 1, 0));
    const store = useMedicationsStore();
    // Dose at 2026-04-20 23:59 local — yesterday
    const yesterdayLate = new Date(2026, 3, 20, 23, 59, 0).toISOString();
    store.medicationLogs.push(log({ medicationId: 'med-1', administeredOn: yesterdayLate }));

    expect(store.dosesToday('med-1')).toBe(0);
  });

  it('counts a dose logged at 00:00 today local when we check the same second', () => {
    vi.setSystemTime(new Date(2026, 3, 21, 0, 0, 0));
    const store = useMedicationsStore();
    const midnight = new Date(2026, 3, 21, 0, 0, 0).toISOString();
    store.medicationLogs.push(log({ medicationId: 'med-1', administeredOn: midnight }));

    expect(store.dosesToday('med-1')).toBe(1);
  });

  it('counts multiple doses within the same local day', () => {
    vi.setSystemTime(new Date(2026, 3, 21, 15, 0, 0));
    const store = useMedicationsStore();
    store.medicationLogs.push(
      log({ medicationId: 'med-1', administeredOn: new Date(2026, 3, 21, 8, 0).toISOString() }),
      log({ medicationId: 'med-1', administeredOn: new Date(2026, 3, 21, 13, 0).toISOString() }),
      log({ medicationId: 'med-1', administeredOn: new Date(2026, 3, 21, 14, 30).toISOString() })
    );
    expect(store.dosesToday('med-1')).toBe(3);
  });

  it('does not count logs from a different medication', () => {
    vi.setSystemTime(new Date(2026, 3, 21, 12, 0, 0));
    const store = useMedicationsStore();
    store.medicationLogs.push(
      log({ medicationId: 'med-other', administeredOn: new Date(2026, 3, 21, 9, 0).toISOString() })
    );
    expect(store.dosesToday('med-1')).toBe(0);
  });
});

describe('medicationsStore — deleteMedication cascade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('removes the medication AND all its log entries from state', async () => {
    const store = useMedicationsStore();
    store.medications.push(med({ id: 'med-1' }), med({ id: 'med-2' }));
    store.medicationLogs.push(
      log({ id: 'l1', medicationId: 'med-1' }),
      log({ id: 'l2', medicationId: 'med-1' }),
      log({ id: 'l3', medicationId: 'med-2' })
    );

    await store.deleteMedication('med-1');

    expect(store.medications.map((m) => m.id)).toEqual(['med-2']);
    expect(store.medicationLogs.map((l) => l.id)).toEqual(['l3']);
    expect(medicationRepo.deleteMedicationCascade).toHaveBeenCalledWith('med-1');
  });

  it('is a no-op on state when the repo cascade throws (wrapAsync captures error)', async () => {
    const store = useMedicationsStore();
    store.medications.push(med({ id: 'med-1' }));
    store.medicationLogs.push(log({ medicationId: 'med-1' }));
    vi.mocked(medicationRepo.deleteMedicationCascade).mockRejectedValueOnce(
      new Error('CRDT error')
    );

    await store.deleteMedication('med-1');

    expect(store.medications).toHaveLength(1);
    expect(store.medicationLogs).toHaveLength(1);
    expect(store.error).toBe('CRDT error');
  });
});

describe('medicationsStore — loadMedications', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loads medications AND medication logs in parallel', async () => {
    const store = useMedicationsStore();
    vi.mocked(medicationRepo.getAllMedications).mockResolvedValueOnce([med({ id: 'm1' })]);
    vi.mocked(medicationLogRepo.getAllMedicationLogs).mockResolvedValueOnce([log({ id: 'l1' })]);

    await store.loadMedications();

    expect(store.medications.map((m) => m.id)).toEqual(['m1']);
    expect(store.medicationLogs.map((l) => l.id)).toEqual(['l1']);
  });
});
