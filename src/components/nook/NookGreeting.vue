<script setup lang="ts">
import { computed } from 'vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { formatTodayCaption, toDateInputValue } from '@/utils/date';

const { t } = useTranslation();
const familyStore = useFamilyStore();
const { isDesktop } = useBreakpoint();

const memberName = computed(() => familyStore.currentMember?.name || '');

const greetingParts = computed(() => {
  const raw = t('nook.welcomeHome');
  const idx = raw.indexOf('{name}');
  if (idx === -1) return { before: raw, after: '' };
  return { before: raw.slice(0, idx), after: raw.slice(idx + 6) };
});

const todayDate = computed(() => formatTodayCaption(toDateInputValue(new Date())));

// Conversational caption for compact (mobile/tablet) screens — date inline +
// "your family at a glance". The header on those breakpoints does NOT show
// the date, so this caption carries it. Same {date}-placeholder split pattern
// as the welcome greeting above so the date can be styled separately.
const captionParts = computed(() => {
  const raw = t('nook.todayCaption');
  const idx = raw.indexOf('{date}');
  if (idx === -1) return { before: raw, after: '' };
  return { before: raw.slice(0, idx), after: raw.slice(idx + 6) };
});
</script>

<template>
  <div>
    <h1 class="font-outfit text-secondary-500 text-2xl leading-tight font-bold dark:text-gray-100">
      {{ greetingParts.before }}<span class="text-primary-500">{{ memberName }}</span
      >{{ greetingParts.after }}
    </h1>
    <!-- Compact (mobile/tablet): date inline as part of the section caption.
         The compact AppHeader skips the date; this is the single anchor. -->
    <p v-if="!isDesktop" class="text-secondary-500/55 mt-1 text-sm dark:text-gray-400">
      {{ captionParts.before
      }}<span class="font-outfit text-primary-500 font-semibold">{{ todayDate }}</span
      >{{ captionParts.after }}
    </p>
    <!-- Desktop: header already carries the date — body caption is just the descriptor. -->
    <p v-else class="text-secondary-500/40 mt-1 text-sm dark:text-gray-400">
      {{ t('nook.familyAtAGlance') }}
    </p>
  </div>
</template>
