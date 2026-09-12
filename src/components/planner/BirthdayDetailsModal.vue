<script setup lang="ts">
/**
 * The read-only drawer a family birthday opens.
 *
 * Mirrors `HolidayDetailsModal`: a birthday is DERIVED from the bean's profile,
 * not an activity somebody scheduled, so there is nothing stored here to edit or
 * delete. Rather than show controls that cannot work, the drawer says plainly
 * where the date comes from and offers the one action that IS real - opening
 * that bean's profile, which is where the birthday can actually be corrected.
 *
 * greg asked for the Nook's "7 sleeps away" phrasing here too. That is
 * deliberate reuse of a sentence a family already knows, not a coincidence, so
 * the countdown goes through the shared `sleepsUntil` and the same wording.
 */
import { computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import CelebrationConfetti from '@/components/ui/CelebrationConfetti.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDayLong } from '@/utils/date';
import { sleepsUntil } from '@/utils/calendarDay';
import { birthdayLabel, type BirthdayOccurrence } from '@/utils/birthdays';

const props = withDefaults(
  defineProps<{
    open: boolean;
    birthday: BirthdayOccurrence | null;
    /** Reactive today, so an open drawer does not go stale over midnight. */
    todayYmd: string;
    /**
     * Offer the "open their profile" link. TRUE in the app; FALSE on the beanie
     * wall, which is a locked kiosk with no member profiles to navigate to.
     *
     * ⚠️ A prop rather than always rendering it: the wall handled `open-profile`
     * by merely closing the drawer, so the button accepted a tap and discarded it.
     * An accepted-and-discarded control is the shape of a defect, not a feature.
     */
    canOpenProfile?: boolean;
  }>(),
  { canOpenProfile: true }
);

const emit = defineEmits<{ close: []; 'open-profile': [memberId: string] }>();

const { t } = useTranslation();

const title = computed(() => (props.birthday ? birthdayLabel(props.birthday, t) : ''));

const sleeps = computed(() =>
  props.birthday ? sleepsUntil(props.todayYmd, props.birthday.date) : 0
);

/**
 * "Today!", "Tomorrow", or "7 sleeps away".
 *
 * A PAST birthday (scrolling back through the year) gets the plain date instead
 * of "-30 sleeps away", which is the obvious thing to print and the wrong thing
 * to read.
 */
const countdown = computed(() => {
  if (!props.birthday) return '';
  if (sleeps.value === 0) return t('planner.birthday.today');
  if (sleeps.value === 1) return t('planner.birthday.tomorrow');
  if (sleeps.value < 0) return formatDayLong(props.birthday.date);
  return fillTemplate(t('planner.birthday.sleeps'), { count: String(sleeps.value) });
});

/** The age is shown here even when the chip's label has gone quiet past 21. */
const turns = computed(() =>
  props.birthday?.age === undefined
    ? ''
    : fillTemplate(t('planner.birthday.turns'), { age: String(props.birthday.age) })
);
</script>

<template>
  <BaseModal :open="open" size="sm" :title="title" @close="emit('close')">
    <div v-if="birthday" class="relative flex flex-col items-center gap-2 py-2 text-center">
      <!-- The same celebration the planner and the wall give a birthday
           ACTIVITY. A derived birthday is the same occasion; it would be odd for
           the one beanies works out itself to be the quiet one.

           ⚠️ The `activity-id` here is SYNTHETIC and, for a drawer, inert:
           `CelebrationConfetti` short-circuits with
           `variant === 'drawer' || claimConfetti(id)`, so a drawer never spends
           the once-per-session claim and rains on EVERY open by design (see its
           "A DRAWER NEVER CLAIMS" note). The id still carries the member and the
           date so that it cannot collide with a real activity's id if that ever
           stops being true. A past birthday gets no confetti at all: scrolling
           back through the year should not celebrate. -->
      <CelebrationConfetti
        v-if="sleeps >= 0"
        :activity-id="`birthday:${birthday.memberId}:${birthday.date}`"
        variant="drawer"
        density="card"
      />

      <span class="text-4xl" aria-hidden="true">🎂</span>

      <p class="font-outfit text-primary-500 dark:text-accent-lift text-lg font-extrabold">
        {{ countdown }}
      </p>

      <p v-if="turns" class="font-inter text-secondary-500 dark:text-ink text-sm font-semibold">
        {{ turns }}
      </p>

      <!-- Skipped when the countdown already IS the date. A past birthday shows
           its date instead of "-30 sleeps away", and printing it twice in a row
           reads as a rendering fault. -->
      <p v-if="sleeps >= 0" class="font-inter text-secondary-400 dark:text-ink-soft text-sm">
        {{ formatDayLong(birthday.date) }}
      </p>

      <p
        class="font-inter text-secondary-400 dark:text-ink-faint mt-1 max-w-[38ch] text-xs leading-relaxed"
      >
        {{ t('planner.birthday.source') }}
      </p>

      <button
        v-if="canOpenProfile"
        type="button"
        class="font-outfit text-primary-500 dark:text-accent-lift mt-1 text-sm font-semibold underline underline-offset-2"
        @click="emit('open-profile', birthday.memberId)"
      >
        {{ t('planner.birthday.openProfile') }}
      </button>
    </div>
  </BaseModal>
</template>
