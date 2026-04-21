/**
 * Promise-based dose-log confirmation dialog.
 *
 * Mirrors `useConfirm`'s module-level-singleton architecture: one dialog
 * is mounted globally in `App.vue` (see `DoseLogConfirmModal.vue`), and
 * any caller anywhere can await `requestDoseConfirm(medication)` to
 * pop it up and receive the user's chosen administeredOn timestamp —
 * or `undefined` when they cancel.
 *
 * The modal is richer than a generic confirm: it surfaces today's dose
 * log for the medication so users see recent activity before logging
 * another, and it exposes an editable date/time so a dose that was
 * given earlier but forgotten can still be recorded retroactively.
 * Future dates/times are not selectable.
 */
import { ref } from 'vue';
import type { Medication, ISODateTimeString } from '@/types/models';

interface DoseConfirmState {
  open: boolean;
  medication: Medication | null;
  resolve: ((value: ISODateTimeString | undefined) => void) | null;
}

const state = ref<DoseConfirmState>({
  open: false,
  medication: null,
  resolve: null,
});

/**
 * Open the dose-log confirm modal for `medication`. Resolves with the
 * chosen `administeredOn` (ISO 8601 datetime, local time for the user's
 * device) when the user confirms, or `undefined` when they cancel.
 *
 * If another dose-confirm is already open, the new request immediately
 * resolves with `undefined` — we never stack multiple dialogs of the
 * same kind on top of each other.
 */
export function requestDoseConfirm(medication: Medication): Promise<ISODateTimeString | undefined> {
  if (state.value.open) {
    console.warn('[useDoseConfirm] refusing to stack — dialog already open');
    return Promise.resolve(undefined);
  }
  return new Promise<ISODateTimeString | undefined>((resolve) => {
    state.value = { open: true, medication, resolve };
  });
}

/**
 * Composable used by `DoseLogConfirmModal.vue`. Consumers outside the
 * renderer should call `requestDoseConfirm()` above instead.
 */
export function useDoseConfirm() {
  function handleConfirm(administeredOn: ISODateTimeString) {
    state.value.resolve?.(administeredOn);
    state.value = { open: false, medication: null, resolve: null };
  }

  function handleCancel() {
    state.value.resolve?.(undefined);
    state.value = { open: false, medication: null, resolve: null };
  }

  return { state, handleConfirm, handleCancel };
}
