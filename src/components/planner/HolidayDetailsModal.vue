<script setup lang="ts">
/**
 * Read-only popup for a public holiday — name (the modal title), date, country,
 * a localized name where the dataset has one, and a hedged "what this means"
 * note. Uses the standard `BaseModal` header (title + close button); no edit,
 * no delete — holidays are reference data, not activities.
 */
import { computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getCountryInfo } from '@/constants/countries';
import { formatDateFull } from '@/utils/date';
import type { HolidayOccurrence } from '@/types/models';

const props = defineProps<{
  holiday: HolidayOccurrence | null;
  open: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useTranslation();

const countryName = computed(() =>
  props.holiday
    ? (getCountryInfo(props.holiday.countryCode)?.name ?? props.holiday.countryCode)
    : ''
);
</script>

<template>
  <BaseModal :open="open" size="sm" :title="holiday?.name" @close="emit('close')">
    <div v-if="holiday" class="space-y-3">
      <p class="text-secondary-500/70 dark:text-ink-soft text-sm">
        {{ formatDateFull(holiday.date) }} · {{ countryName }} ·
        {{ t('holiday.publicHolidaySuffix') }}
      </p>
      <p v-if="holiday.nameLocal" class="font-outfit dark:text-ink-soft text-sm text-gray-500">
        {{ holiday.nameLocal }}
      </p>
      <p class="dark:text-ink text-sm leading-relaxed text-gray-700">
        {{ t('holiday.observanceNote') }}
      </p>
      <p class="dark:text-ink-faint text-xs leading-relaxed text-gray-400">
        {{ t('holiday.referenceNote') }}
      </p>
    </div>
  </BaseModal>
</template>
