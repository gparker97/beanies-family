import type { ComputedRef, Ref } from 'vue';
import type { VacationSegmentStatus } from '@/types/models';
import { useFormValidation, type FormRules } from '@/composables/useFormValidation';

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

export interface BookingValidationOptions {
  /** Telemetry `kind`: 'segment', 'accommodation' or 'transportation'. */
  formName?: string;
  /** The drawer's open state; validation resets itself on every open. */
  open?: () => boolean;
}

/**
 * Conditional-required validation for the vacation segment drawers (flights, cruises, cars,
 * trains, accommodations, transportation): a thin adapter over `useFormValidation`, which owns
 * the marking, the scroll to the first missing field, the toast and the telemetry.
 *
 * All it adds is the booking rule: `requiredWhenBooked` fields join the rule set only while the
 * segment is booked. So the asterisk lights up live as the status flips, and the orange ring
 * still waits for a Save attempt, never appearing on open.
 *
 * @example
 *   const rules = computed<BookingValidationRules<FlightField>>(() => ({
 *     alwaysRequired: { departureAirport: () => !!depAirport.value },
 *     requiredWhenBooked: { airline: () => !!airline.value },
 *   }));
 *   const v = useBookingValidation(status, rules, { formName: 'segment', open: () => props.open });
 *
 *   // <BeanieFormModal :save-ready="v.canSave.value" @save="handleSave">
 *   // <FormFieldGroup :label="…" v-bind="v.bind('airline')">
 *   // handleSave: await v.attemptSave(async () => { … });
 */
export function useBookingValidation<Field extends string = string>(
  status: Ref<VacationSegmentStatus>,
  rulesSource: ComputedRef<BookingValidationRules<Field>> | Ref<BookingValidationRules<Field>>,
  opts: BookingValidationOptions = {}
) {
  return useFormValidation<Field>(
    opts.formName ?? 'booking',
    (): FormRules<Field> => {
      const { alwaysRequired, requiredWhenBooked } = rulesSource.value;
      if (status.value !== 'booked') return alwaysRequired;
      // A field in BOTH sets must pass both predicates, as before the adapter: a plain spread
      // would silently drop the always-rule.
      const merged: FormRules<Field> = { ...alwaysRequired };
      for (const [field, booked] of Object.entries(requiredWhenBooked) as [
        Field,
        (() => boolean) | undefined,
      ][]) {
        const always = merged[field];
        merged[field] = always && booked ? () => always() && booked() : (booked ?? always);
      }
      return merged;
    },
    { open: opts.open }
  );
}
