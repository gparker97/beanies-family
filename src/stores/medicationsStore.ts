import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/medicationRepository';
import * as logRepo from '@/services/automerge/repositories/medicationLogRepository';
import { toDateInputValue } from '@/utils/date';
import type { Medication, MedicationLogEntry, CreateMedicationLogEntryInput } from '@/types/models';

/**
 * "Today" in the user's LOCAL timezone as a YYYY-MM-DD string.
 * Medication startDate/endDate are saved as local-date strings from
 * `<input type="date">`, so comparing against UTC would misclassify
 * medications near the timezone boundary (a med starting "today"
 * local reads as "future" in UTC east of the line, flipping the
 * active chip to Ended). Always compare local-to-local.
 *
 * The same helper powers `dosesToday` below — administration log
 * entries store full timestamps, so we extract the LOCAL date part
 * via `toDateInputValue(new Date(administeredOn))` before compare.
 */
function localToday(): string {
  return toDateInputValue(new Date());
}

/**
 * A medication is "active" when it's either ongoing or today is
 * within [startDate, endDate]. Undated medications are treated as
 * active. Exported so MedicationCard / BeanMedicationsTab share one
 * implementation — previously three drift-prone copies existed.
 */
export function isMedicationActive(m: Medication): boolean {
  if (m.ongoing) return true;
  const today = localToday();
  if (m.endDate && m.endDate < today) return false;
  if (m.startDate && m.startDate > today) return false;
  return true;
}

type CreateInput = Omit<Medication, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

export const useMedicationsStore = defineStore('medications', () => {
  const medications = ref<Medication[]>([]);
  const medicationLogs = ref<MedicationLogEntry[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function byMember(memberId: string) {
    return computed(() => medications.value.filter((m) => m.memberId === memberId));
  }

  /** Active medications (see isMedicationActive for the rule). */
  const active = computed(() => medications.value.filter(isMedicationActive));

  /**
   * All log entries for a medication, descending by administeredOn
   * (newest first). Mirrors `cookLogsByRecipe` sort pattern.
   */
  function logsForMedication(medicationId: string) {
    return computed(() =>
      medicationLogs.value
        .filter((l) => l.medicationId === medicationId)
        .sort((a, b) => b.administeredOn.localeCompare(a.administeredOn))
    );
  }

  /**
   * Count of log entries whose administeredOn is TODAY in the local
   * timezone. Drives the "Nth dose today" confirmation prompt before
   * creating a new log. Returns 0 for medications with no logs.
   */
  function dosesToday(medicationId: string): number {
    const today = localToday();
    let count = 0;
    for (const log of medicationLogs.value) {
      if (log.medicationId !== medicationId) continue;
      if (toDateInputValue(new Date(log.administeredOn)) === today) count++;
    }
    return count;
  }

  /**
   * Most-recent administeredOn timestamp for a medication, or null if
   * no logs exist. Caller formats via `timeAgo()` for display.
   */
  function lastDoseAt(medicationId: string): string | null {
    let latest: string | null = null;
    for (const log of medicationLogs.value) {
      if (log.medicationId !== medicationId) continue;
      if (!latest || log.administeredOn > latest) latest = log.administeredOn;
    }
    return latest;
  }

  async function loadMedications() {
    await wrapAsync(isLoading, error, async () => {
      const [meds, logs] = await Promise.all([
        repo.getAllMedications(),
        logRepo.getAllMedicationLogs(),
      ]);
      medications.value = meds;
      medicationLogs.value = logs;
    });
  }

  async function createMedication(input: CreateInput): Promise<Medication | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createMedication(input);
      medications.value = [...medications.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateMedication(id: string, input: UpdateInput): Promise<Medication | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateMedication(id, input);
      if (updated) {
        medications.value = medications.value.map((m) => (m.id === id ? updated : m));
      }
      return updated;
    });
    return result ?? null;
  }

  /**
   * Delete a medication AND cascade-delete all its administration log
   * entries in a single atomic CRDT change. Keeps the doc free of
   * orphan logs. Callers don't need to pre-delete logs.
   */
  async function deleteMedication(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteMedicationCascade(id);
      medications.value = medications.value.filter((m) => m.id !== id);
      medicationLogs.value = medicationLogs.value.filter((l) => l.medicationId !== id);
    });
  }

  async function createMedicationLog(
    input: CreateMedicationLogEntryInput
  ): Promise<MedicationLogEntry | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await logRepo.createMedicationLog(input);
      medicationLogs.value = [...medicationLogs.value, created];
      return created;
    });
    return result ?? null;
  }

  async function deleteMedicationLog(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const ok = await logRepo.deleteMedicationLog(id);
      if (ok) medicationLogs.value = medicationLogs.value.filter((l) => l.id !== id);
      return ok;
    });
    return result ?? false;
  }

  return {
    medications,
    medicationLogs,
    isLoading,
    error,
    byMember,
    active,
    logsForMedication,
    dosesToday,
    lastDoseAt,
    loadMedications,
    createMedication,
    updateMedication,
    deleteMedication,
    createMedicationLog,
    deleteMedicationLog,
  };
});
