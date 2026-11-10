<script setup lang="ts">
/**
 * Live flight checks (#143): the one-sentence notice under a flight's "when" band.
 *
 *  - `changed`: the airline moved the flight and the plan has ALREADY been updated. Says what
 *    moved, what it was, who changed it and when, and offers one quiet "Put it back".
 *    With `applied: false` the plan has NOT been updated on this device (the write failed,
 *    or this member may not edit trips): the same sentence, "Your plan hasn't been updated
 *    on this device yet.", and no buttons, since there is nothing to put back.
 *  - `conflict`: the plan and the airline disagree (a hand edit after an apply, or "Put it
 *    back"). Shows both values; "Update with airline data" writes the airline's.
 *  - `cancelled`: the airline cancelled; the flight is pending. Red is earned here and only
 *    here. Practical, not alarmed, and no decision to make: the booking is still there for
 *    the call. Not yet recorded on this device (`applied: false`): the same not-updated-yet line.
 *
 * EVERY notice carries a quiet "Got it" that folds the block away on this device (`dismiss`;
 * the chip and the struck-out values stay, and the chip reopens it), the Conflict included:
 * folding it keeps the family's own values, which is a decision too (greg, 2026-11-10). A
 * notice with nothing written yet folds the same way; the chip still says what the airline
 * reported.
 *
 * Renders nothing for any other state. Presentational: the actions leave as emits and the page
 * owns permissions, the write and the toasts. Every sentence comes from `copy.ts` (the same
 * builders the bell and briefing use) or a `travel.live.*` key.
 */
import { computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import type { FlightVerification } from '@/types/flightStatus';
import type { FlightRef } from '@/composables/useVacationTimeline';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import {
  agoText,
  airlineName,
  cancelSentence,
  changeSentence,
  changedByLine,
  checkedAgo,
  conflictSentence,
} from '@/utils/flightStatus/copy';

const props = defineProps<{
  verification: FlightVerification;
  segment: FlightRef;
  /** The clock "checked 4 min ago" is measured against (`flightStatusStore.nowMs`). */
  nowMs: number;
}>();

const emit = defineEmits<{
  revert: [];
  'take-airline': [];
  /** "Got it": fold this block away on this device for the current revision. */
  dismiss: [];
}>();

const { t, currentLanguage } = useTranslation();
const lang = computed(() => currentLanguage?.value);

const airline = computed(() => airlineName(t, props.segment.airline));

/** When the airline's word last reached this device, else when the change was applied. */
const seenAtMs = computed<number | null>(() => {
  if (props.verification.checkedAt !== undefined) return props.verification.checkedAt;
  const applied = props.segment.liveAppliedAt ? Date.parse(props.segment.liveAppliedAt) : NaN;
  return Number.isNaN(applied) ? null : applied;
});

const view = computed<{
  tone: 'orange' | 'red';
  lead: string;
  /** "Your plan hasn't been updated on this device yet." ('' when it has). */
  note: string;
  meta: string;
  action: 'revert' | 'take-airline' | null;
  /** Offers "Got it". */
  dismissable: boolean;
} | null>(() => {
  const v = props.verification;
  const flight = props.segment.label;
  const note = v.applied === false ? t('travel.live.notWrittenYet') : '';
  switch (v.state) {
    case 'changed': {
      const was = v.was ?? {};
      if (v.applied === false) {
        // Not in the plan yet: the airline's values are the news, the plan's are the "was".
        return {
          tone: 'orange',
          lead: changeSentence(t, flight, v.provider ?? {}, was, lang.value, false),
          note,
          meta: v.checkedAt !== undefined ? checkedAgo(t, v.checkedAt, props.nowMs) : '',
          action: null,
          dismissable: true,
        };
      }
      const at = seenAtMs.value;
      return {
        tone: 'orange',
        lead: changeSentence(t, flight, v.mine ?? {}, was, lang.value),
        note: '',
        meta:
          at !== null
            ? changedByLine(t, was, airline.value, agoText(t, at, props.nowMs), lang.value)
            : '',
        action: 'revert',
        dismissable: true,
      };
    }
    case 'conflict': {
      const meta = v.checkedAt !== undefined ? checkedAgo(t, v.checkedAt, props.nowMs) : '';
      if (v.live?.status === 'Canceled') {
        // The family re-booked after the airline cancelled: their choice stands.
        return {
          tone: 'orange',
          lead: fillTemplate(t('travel.live.conflictCancelled'), {
            airline: airline.value,
            flight,
          }),
          note: '',
          meta,
          action: 'take-airline',
          dismissable: true,
        };
      }
      return {
        tone: 'orange',
        lead: conflictSentence(
          t,
          { mine: v.mine ?? {}, provider: v.provider ?? {}, airline: airline.value },
          lang.value
        ),
        note: '',
        meta,
        action: 'take-airline',
        dismissable: true,
      };
    }
    case 'cancelled': {
      const named = props.segment.airline ? airline.value : undefined;
      const lead = cancelSentence(
        t,
        { airline: named, flight, date: props.segment.departureDate },
        lang.value
      );
      const ref = props.segment.bookingReference?.trim();
      const still = ref ? fillTemplate(t('travel.live.bookingStillHere'), { ref }) : '';
      // Chinese sentences end on a full-width stop and are not space-separated.
      const sep = /[。！？]$/.test(lead) ? '' : ' ';
      return {
        tone: 'red',
        lead: still ? `${lead}${sep}${still}` : lead,
        note,
        meta: v.checkedAt !== undefined ? checkedAgo(t, v.checkedAt, props.nowMs) : '',
        action: null,
        dismissable: true,
      };
    }
    default:
      return null;
  }
});
</script>

<template>
  <div
    v-if="view"
    class="mb-3 rounded-2xl border-l-4 px-3.5 py-3"
    :class="
      view.tone === 'red'
        ? 'dark:border-danger-lift border-red-500 bg-[var(--tint-danger-10)]'
        : 'border-primary-500 dark:border-accent-lift bg-[var(--tint-orange-8)]'
    "
    :data-state="verification.state"
  >
    <p class="text-secondary-500 dark:text-ink text-sm leading-snug font-semibold">
      {{ view.lead }}
    </p>
    <p
      v-if="view.note"
      class="text-secondary-500 dark:text-ink-soft mt-1 text-sm"
      data-testid="flight-not-written"
    >
      {{ view.note }}
    </p>
    <p v-if="view.meta" class="text-secondary-400 dark:text-ink-faint mt-1 text-xs">
      {{ view.meta }}
    </p>
    <div v-if="view.action || view.dismissable" class="mt-2.5 flex flex-wrap gap-2">
      <BaseButton
        v-if="view.action === 'revert'"
        variant="outline"
        size="sm"
        data-testid="flight-put-back"
        @click="emit('revert')"
      >
        {{ t('flightChecks.action.putBack') }}
      </BaseButton>
      <BaseButton
        v-else-if="view.action === 'take-airline'"
        variant="outline"
        size="sm"
        data-testid="flight-use-airline"
        @click="emit('take-airline')"
      >
        {{ t('flightChecks.action.useAirline') }}
      </BaseButton>
      <BaseButton
        v-if="view.dismissable"
        variant="ghost"
        size="sm"
        data-testid="flight-got-it"
        @click="emit('dismiss')"
      >
        {{ t('flightChecks.action.gotIt') }}
      </BaseButton>
    </div>
  </div>
</template>
