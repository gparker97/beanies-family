<script setup lang="ts">
/**
 * Birthday adapter over the generic `AllDayChip`, alongside `HolidayChip`.
 *
 * A family birthday is DERIVED from the member's date of birth (see
 * `utils/birthdays.ts`) and never stored, so this chip is a label rather than a
 * control: there is no activity behind it to open, edit or drag. A birthday
 * PARTY — with a time, a place and guests — is a normal activity the family
 * creates, and renders through `AllDayActivityChip` like anything else.
 *
 * Single-day by construction, so `isStart`/`isEnd` are both true and the span
 * props the generic chip needs are filled in here rather than by every caller.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { getOrdinalSuffix } from '@/utils/format';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import AllDayChip from '@/components/planner/AllDayChip.vue';

const props = defineProps<{ birthday: BirthdayOccurrence }>();

const { t } = useTranslation();

/**
 * "Joey's 7th birthday", or "Joey's birthday" when the birth YEAR is unknown —
 * `DateOfBirth.year` is optional and plenty of families record only the day and
 * month, so the label has to work without it.
 */
const label = computed(() =>
  props.birthday.age === undefined
    ? fillTemplate(t('planner.birthday.noAge'), { name: props.birthday.name })
    : fillTemplate(t('planner.birthday.withAge'), {
        name: props.birthday.name,
        age: getOrdinalSuffix(props.birthday.age),
      })
);
</script>

<template>
  <!--
    ⚠️ `--birthday-orange`, NOT the raw Heritage Orange the `birthday` activity
    category carries. #F15D22 measures 3.32:1 on a white month cell, which fails
    AA for a 12px chip; the token is a deepened orange in light mode and a
    lifted one in dark, so it reads as the same family and stays legible in both.
  -->
  <AllDayChip
    :title="label"
    color="var(--birthday-orange)"
    bg-color="var(--birthday-orange-tint)"
    leading-emoji="🎂"
    :is-start="true"
    :is-end="true"
    testid="birthday-chip"
  />
</template>
