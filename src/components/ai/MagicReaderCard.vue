<script setup lang="ts">
/**
 * "beanies can do magic" — the FAB quick-add sheet card. The one magic surface
 * that lives OUTSIDE a page (the sheet is mounted at the app shell), so it
 * dispatches through the `useMagicReader` singleton (`openPhotoReader` /
 * `openDocumentReader`) rather than a local emit. Self-gating: the whole card is
 * hidden unless at least one reader is available, and each chip shows only when
 * its flag + permission allow. When a single chip shows it spans full width.
 */
import { useTranslation } from '@/composables/useTranslation';
import { useMagicReader } from '@/composables/useMagicReader';

const { t } = useTranslation();
const { canReadPhoto, canReadDocument, canReadAny, openPhotoReader, openDocumentReader } =
  useMagicReader();
</script>

<template>
  <section
    v-if="canReadAny"
    class="magic-shimmer from-primary-500 to-terracotta-400 rounded-3xl bg-gradient-to-br p-4 text-white shadow-[0_12px_26px_-10px_rgba(241,93,34,0.65)]"
  >
    <h2 class="font-outfit flex items-center gap-2 text-base font-extrabold">
      <span aria-hidden="true">✨</span>
      <span>{{ t('ai.magic.title') }}</span>
    </h2>
    <p class="mt-1.5 text-xs leading-snug opacity-90">{{ t('ai.magic.subtitle') }}</p>

    <div class="relative z-[1] mt-3 flex gap-2.5">
      <button
        v-if="canReadPhoto"
        type="button"
        class="font-outfit text-primary-600 inline-flex h-[42px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3 text-sm font-bold whitespace-nowrap shadow-[0_3px_8px_-3px_rgba(44,62,80,0.28)] transition-transform hover:scale-[1.02]"
        @click="openPhotoReader"
      >
        <span aria-hidden="true">📸</span>
        <span class="truncate">{{ t('ai.magic.invite') }}</span>
      </button>
      <button
        v-if="canReadDocument"
        type="button"
        class="font-outfit text-primary-600 inline-flex h-[42px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3 text-sm font-bold whitespace-nowrap shadow-[0_3px_8px_-3px_rgba(44,62,80,0.28)] transition-transform hover:scale-[1.02]"
        @click="openDocumentReader"
      >
        <span aria-hidden="true">✈️</span>
        <span class="truncate">{{ t('ai.magic.travelBooking') }}</span>
      </button>
    </div>
  </section>
</template>
