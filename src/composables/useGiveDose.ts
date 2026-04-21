/**
 * Single orchestration primitive for "log a dose." Used from two call
 * sites: `MedicationViewModal`'s primary CTA and `BeanMedicationsTab`'s
 * handler for the `give-dose` emission from a `MedicationCard`.
 *
 * Flow:
 *   1. Guard: no currentMember → error toast + console.error + return
 *   2. Open the DoseLogConfirmModal via `requestDoseConfirm(med)`.
 *      The user reviews today's doses and picks a date/time (defaults
 *      to now; future values blocked). On cancel → undefined.
 *   3. Create log via medicationsStore with the chosen timestamp.
 *   4. Success toast with Undo action (6s duration) as a belt-and-
 *      braces safety net for a confirmed-but-wrong entry.
 *   5. Return the new log's id so the caller can animate it (pulse).
 *
 * Errors are surfaced at every step — nothing fails silently. Returns
 * `undefined` on any non-success path (failed guard, cancelled modal,
 * store error) so callers can bail without needing to inspect state.
 */
import { showToast } from '@/composables/useToast';
import { useFamilyStore } from '@/stores/familyStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { requestDoseConfirm } from '@/composables/useDoseConfirm';
import { useTranslation } from '@/composables/useTranslation';
import type { Medication } from '@/types/models';

export function useGiveDose() {
  const familyStore = useFamilyStore();
  const medicationsStore = useMedicationsStore();
  const { t } = useTranslation();

  /**
   * Log a dose of `med` administered by the current family member.
   * Returns the created log's id on success, `undefined` on any other
   * outcome (cancelled, no-current-member, repo error).
   */
  async function giveDose(med: Medication): Promise<string | undefined> {
    const me = familyStore.currentMember;
    if (!me) {
      console.error('[useGiveDose] no currentMember — refusing to log dose for', med.id);
      showToast(
        'error',
        t('medicationLog.errors.noCurrentMember'),
        t('medicationLog.errors.noCurrentMember.detail')
      );
      return undefined;
    }

    const administeredOn = await requestDoseConfirm(med);
    if (!administeredOn) return undefined;

    const created = await medicationsStore.createMedicationLog({
      medicationId: med.id,
      administeredOn,
      administeredBy: me.id,
      createdBy: me.id,
    });
    if (!created) {
      // wrapAsync in the store already surfaced an error toast + console.
      return undefined;
    }

    showToast('success', t('medicationLog.doseLogged'), `${me.name} · ${med.name}`, {
      actionLabel: t('medicationLog.undo'),
      actionFn: async () => {
        await medicationsStore.deleteMedicationLog(created.id);
      },
      durationMs: 6000,
    });

    return created.id;
  }

  return { giveDose };
}
