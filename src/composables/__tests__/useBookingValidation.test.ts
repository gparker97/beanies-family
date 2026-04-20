import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed } from 'vue';
import {
  useBookingValidation,
  type BookingValidationRules,
} from '@/composables/useBookingValidation';
import type { VacationSegmentStatus } from '@/types/models';

type TestField = 'airline' | 'flightNumber' | 'departureAirport' | 'arrivalAirport';

describe('useBookingValidation', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function makeRules(
    airline: () => boolean = () => true,
    flightNumber: () => boolean = () => true,
    departureAirport: () => boolean = () => true,
    arrivalAirport: () => boolean = () => true
  ) {
    return computed<BookingValidationRules<TestField>>(() => ({
      alwaysRequired: {
        departureAirport,
        arrivalAirport,
      },
      requiredWhenBooked: {
        airline,
        flightNumber,
      },
    }));
  }

  describe('missing — status=pending', () => {
    it('flags only always-required fields when status is pending', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const rules = makeRules(
        () => false, // airline missing — but not required while pending
        () => false, // flightNumber missing — same
        () => false, // departureAirport missing — always required
        () => true
      );
      const v = useBookingValidation(status, rules);
      expect(v.missing.value).toEqual(new Set(['departureAirport']));
    });

    it('returns empty when all always-required fields are present', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const rules = makeRules(
        () => false, // booking-contingent missing — fine while pending
        () => false
      );
      const v = useBookingValidation(status, rules);
      expect(v.missing.value.size).toBe(0);
      expect(v.canSave.value).toBe(true);
    });
  });

  describe('missing — status=booked', () => {
    it('flags both always-required and booking-contingent fields when booked', () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules(
        () => false, // airline missing
        () => true, // flightNumber present
        () => false, // departureAirport missing
        () => true
      );
      const v = useBookingValidation(status, rules);
      expect(v.missing.value).toEqual(new Set(['airline', 'departureAirport']));
      expect(v.canSave.value).toBe(false);
    });

    it('canSave true when booked + all required fields present', () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules();
      const v = useBookingValidation(status, rules);
      expect(v.missing.value.size).toBe(0);
      expect(v.canSave.value).toBe(true);
    });
  });

  describe('isRequired', () => {
    it('returns true for always-required fields regardless of status', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const rules = makeRules();
      const v = useBookingValidation(status, rules);
      expect(v.isRequired('departureAirport')).toBe(true);
      expect(v.isRequired('arrivalAirport')).toBe(true);
    });

    it('returns false for booking-contingent fields when pending', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const rules = makeRules();
      const v = useBookingValidation(status, rules);
      expect(v.isRequired('airline')).toBe(false);
      expect(v.isRequired('flightNumber')).toBe(false);
    });

    it('returns true for booking-contingent fields when booked', () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules();
      const v = useBookingValidation(status, rules);
      expect(v.isRequired('airline')).toBe(true);
      expect(v.isRequired('flightNumber')).toBe(true);
    });

    it('flips live when status changes', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const rules = makeRules();
      const v = useBookingValidation(status, rules);
      expect(v.isRequired('airline')).toBe(false);
      status.value = 'booked';
      expect(v.isRequired('airline')).toBe(true);
    });
  });

  describe('showError — deferred until attempted save', () => {
    it('is false for every field before the first save attempt', () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules(
        () => false,
        () => false,
        () => false,
        () => false
      );
      const v = useBookingValidation(status, rules);
      expect(v.showError('airline')).toBe(false);
      expect(v.showError('departureAirport')).toBe(false);
      expect(v.hasAttemptedSave.value).toBe(false);
    });

    it('is true for missing fields after attemptSave is called', async () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules(
        () => false,
        () => true,
        () => true,
        () => true
      );
      const v = useBookingValidation(status, rules);

      const onValid = vi.fn();
      await v.attemptSave(onValid);

      expect(v.hasAttemptedSave.value).toBe(true);
      expect(v.showError('airline')).toBe(true);
      expect(v.showError('flightNumber')).toBe(false);
    });
  });

  describe('attemptSave', () => {
    it('invokes the callback when canSave is true', async () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules();
      const v = useBookingValidation(status, rules);

      const onValid = vi.fn().mockResolvedValue('result');
      const result = await v.attemptSave(onValid);

      expect(onValid).toHaveBeenCalledOnce();
      expect(result).toBe('result');
    });

    it('skips the callback when canSave is false', async () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules(() => false);
      const v = useBookingValidation(status, rules);

      const onValid = vi.fn();
      const result = await v.attemptSave(onValid);

      expect(onValid).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('flips hasAttemptedSave even when invalid (so errors show)', async () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules(() => false);
      const v = useBookingValidation(status, rules);

      await v.attemptSave(() => undefined);

      expect(v.hasAttemptedSave.value).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears hasAttemptedSave so error state is quiet again', async () => {
      const status = ref<VacationSegmentStatus>('booked');
      const rules = makeRules(() => false);
      const v = useBookingValidation(status, rules);

      await v.attemptSave(() => undefined);
      expect(v.showError('airline')).toBe(true);

      v.reset();
      expect(v.hasAttemptedSave.value).toBe(false);
      expect(v.showError('airline')).toBe(false);
    });
  });

  describe('error handling — never silent', () => {
    it('treats a throwing predicate as missing and logs with field name', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const rules = computed<BookingValidationRules<TestField>>(() => ({
        alwaysRequired: {
          departureAirport: () => {
            throw new Error('boom');
          },
        },
        requiredWhenBooked: {},
      }));

      const v = useBookingValidation(status, rules);

      expect(v.missing.value.has('departureAirport')).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useBookingValidation] rule "departureAirport" threw:',
        expect.any(Error)
      );
    });

    it('continues evaluating remaining rules after one throws', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const rules = computed<BookingValidationRules<TestField>>(() => ({
        alwaysRequired: {
          departureAirport: () => {
            throw new Error('boom');
          },
          arrivalAirport: () => false,
        },
        requiredWhenBooked: {},
      }));

      const v = useBookingValidation(status, rules);

      expect(v.missing.value).toEqual(new Set(['departureAirport', 'arrivalAirport']));
    });
  });

  describe('dynamic rules (per-segment-type variants)', () => {
    it('re-derives missing when rules shape changes', () => {
      const status = ref<VacationSegmentStatus>('pending');
      const ruleKind = ref<'flight' | 'cruise'>('flight');

      const rules = computed<BookingValidationRules<TestField | 'cruiseLine'>>(() =>
        ruleKind.value === 'flight'
          ? {
              alwaysRequired: { departureAirport: () => false },
              requiredWhenBooked: {},
            }
          : {
              alwaysRequired: { cruiseLine: () => false } as Partial<
                Record<TestField | 'cruiseLine', () => boolean>
              >,
              requiredWhenBooked: {},
            }
      );

      const v = useBookingValidation<TestField | 'cruiseLine'>(status, rules);
      expect(v.missing.value).toEqual(new Set(['departureAirport']));

      ruleKind.value = 'cruise';
      expect(v.missing.value).toEqual(new Set(['cruiseLine']));
    });
  });
});
