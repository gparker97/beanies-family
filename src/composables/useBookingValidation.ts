import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { VacationSegmentStatus } from '@/types/models';

/**
 * Rules for a segment-like form: fields that must be filled always, and
 * fields that must be filled only when status === 'booked'.
 *
 * Each entry is a predicate `() => boolean` that returns true when the
 * field has a valid value. Predicates read reactive state (refs); they
 * are called inside the composable's computeds so changes re-fire
 * missing/canSave correctly.
 *
 * Using `Partial<Record<...>>` lets each caller include only the fields
 * relevant to its current segment-type variant without having to
 * provide stub predicates for other types.
 */
export interface BookingValidationRules<Field extends string = string> {
  alwaysRequired: Partial<Record<Field, () => boolean>>;
  requiredWhenBooked: Partial<Record<Field, () => boolean>>;
}

/**
 * Shared conditional-required validation for vacation segment modals
 * (flights, cruises, cars, trains, accommodations, transportation).
 *
 * Booking-contingent fields trigger the orange error ring only *after*
 * the user attempts to save. The asterisk (isRequired) lights up live
 * with status changes so the user can see what *will* be required when
 * they toggle to booked, without being yelled at on modal open.
 *
 * Rule predicates are wrapped in try/catch: if one throws, the field
 * is treated as missing (fail-safe, never silent) and logged with the
 * field name for debugging.
 *
 * @param status       Reactive segment status (booked | pending).
 * @param rulesSource  Computed returning the current rules shape. Use
 *                     a computed so rules can vary by segment type
 *                     within a single modal instance.
 *
 * @example
 *   type FlightField = 'airline' | 'flightNumber' | 'departureAirport' | ...;
 *   const rules = computed<BookingValidationRules<FlightField>>(() => ({
 *     alwaysRequired: {
 *       departureAirport: () => !!depAirport.value,
 *       arrivalAirport: () => !!arrAirport.value,
 *     },
 *     requiredWhenBooked: {
 *       airline: () => !!airline.value,
 *       flightNumber: () => !!flightNumber.value,
 *     },
 *   }));
 *   const v = useBookingValidation(status, rules);
 *
 *   // In template:
 *   //   :required="v.isRequired('airline')"
 *   //   :error="v.showError('airline')"
 *   //
 *   // In save handler:
 *   //   await v.attemptSave(async () => { ... });
 */
export function useBookingValidation<Field extends string = string>(
  status: Ref<VacationSegmentStatus>,
  rulesSource: ComputedRef<BookingValidationRules<Field>> | Ref<BookingValidationRules<Field>>
) {
  const hasAttemptedSave = ref(false);

  function evaluate(predicate: () => boolean, field: Field): boolean {
    try {
      return predicate();
    } catch (err) {
      console.error(`[useBookingValidation] rule "${field}" threw:`, err);
      return false; // fail-safe: treat as missing so UI flags it
    }
  }

  const missing = computed<Set<Field>>(() => {
    const rules = rulesSource.value;
    const out = new Set<Field>();

    for (const [field, predicate] of Object.entries(rules.alwaysRequired)) {
      if (!predicate) continue;
      if (!evaluate(predicate as () => boolean, field as Field)) {
        out.add(field as Field);
      }
    }

    if (status.value === 'booked') {
      for (const [field, predicate] of Object.entries(rules.requiredWhenBooked)) {
        if (!predicate) continue;
        if (!evaluate(predicate as () => boolean, field as Field)) {
          out.add(field as Field);
        }
      }
    }

    return out;
  });

  const canSave = computed(() => missing.value.size === 0);

  /** For `:required` prop binding on `FormFieldGroup`. Drives the asterisk. */
  function isRequired(field: Field): boolean {
    const rules = rulesSource.value;
    if (rules.alwaysRequired[field]) return true;
    return status.value === 'booked' && !!rules.requiredWhenBooked[field];
  }

  /** For `:error` prop binding on `FormFieldGroup`. Gated on attempted save. */
  function showError(field: Field): boolean {
    return hasAttemptedSave.value && missing.value.has(field);
  }

  /**
   * Wrap your save handler. Flips `hasAttemptedSave` so error rings light
   * up for any missing fields, then invokes `onValid` only if `canSave`
   * is true. Returns whatever `onValid` returns (supports async).
   */
  async function attemptSave<T>(onValid: () => T | Promise<T>): Promise<T | undefined> {
    hasAttemptedSave.value = true;
    if (!canSave.value) return undefined;
    return await onValid();
  }

  /** Reset validation — call from `useFormModal.onNew` when reopening. */
  function reset(): void {
    hasAttemptedSave.value = false;
  }

  return {
    hasAttemptedSave,
    missing,
    canSave,
    isRequired,
    showError,
    attemptSave,
    reset,
  };
}
