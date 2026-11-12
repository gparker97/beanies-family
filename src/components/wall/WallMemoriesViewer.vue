<script setup lang="ts">
/**
 * The family scrapbook on the beanie wall (#140): the whole family's memories, read-only,
 * newest first, with a bean row and a month rail.
 *
 * Presentational. `useWallMemories` owns whether it is open and every way it closes; this
 * only emits `close` for the two it can see (the button and Escape) and `empty` when it
 * opened onto nothing, so "it opens blank" is answerable from the logs. The page mounts it
 * with `v-if`, so every open starts on everyone, whichever face was tapped and whichever
 * bean was picked last time.
 *
 * Read-only by design: it works while the wall is locked, so it carries no add, edit or
 * delete control, no lightbox and no link off the wall. Matches `WallSheet`: a dialog with
 * `aria-modal` and Escape, no focus trap (the app has none). Focus moves to Close on open.
 */
import { computed, onMounted, ref } from 'vue';
import ScrapbookTimeline from '@/components/scrapbook/ScrapbookTimeline.vue';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ScrapType } from '@/composables/useScrapbookFeed';
import type { WallMemoriesCloseKind, WallMemoriesEmptyDetail } from '@/composables/useWallMemories';
import type { FamilyMember, UUID } from '@/types/models';

const props = defineProps<{
  /** The bean row: the wall passes `familyStore.sortedHumans`, as the footer does. */
  beans: readonly FamilyMember[];
  /** The memory types switched on for this wall. May be empty. */
  types: ReadonlySet<ScrapType>;
}>();

const emit = defineEmits<{
  close: [kind: Extract<WallMemoriesCloseKind, 'button' | 'escape'>];
  empty: [detail: WallMemoriesEmptyDetail];
}>();

const { t } = useTranslation();

/** Local, so a fresh mount is always everyone. */
const memberId = ref<UUID | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const timeline = ref<InstanceType<typeof ScrapbookTimeline> | null>(null);

/** The heading follows the bean row, as in the approved mockup; the dialog's name does not. */
const heading = computed(() => {
  const bean = memberId.value ? props.beans.find((b) => b.id === memberId.value) : undefined;
  return bean
    ? fillTemplate(t('wall.memories.titleFor'), { name: bean.name })
    : t('wall.memories.title');
});

// Mounted only while open, so the overlay is open for this component's whole life.
useEscapeClose(ref(true), () => emit('close', 'escape'));

onMounted(() => {
  closeButton.value?.focus();
  if (timeline.value?.isEmpty) emit('empty', props.types.size === 0 ? 'types-off' : 'no-entries');
});
</script>

<template>
  <div
    class="absolute inset-0 z-[45]"
    role="dialog"
    aria-modal="true"
    :aria-label="t('wall.memories.title')"
  >
    <!-- `.scrapbook-paper` on an inner box: it sets `position: relative` unlayered, which
         would beat the `absolute` utility on the same element. -->
    <div class="scrapbook-paper flex h-full flex-col">
      <header class="kraft-band kraft-band-scrapbook flex shrink-0 items-center gap-4 px-6 py-3">
        <h2
          class="font-outfit wall-memories-title text-secondary-500 dark:text-ink min-w-0 flex-1 truncate text-2xl font-extrabold"
        >
          {{ heading }}
        </h2>
        <span
          class="font-caveat wall-memories-hand text-primary-700 dark:text-accent-lift shrink-0 text-xl font-bold"
        >
          {{ t('wall.memories.newestFirst') }}
        </span>
        <button
          ref="closeButton"
          type="button"
          class="font-outfit wall-memories-close bg-primary-500 hover:bg-primary-600 shrink-0 rounded-2xl px-5 py-2.5 text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AED6F1]"
          @click="emit('close', 'button')"
        >
          {{ t('action.close') }}
        </button>
      </header>

      <div
        class="wall-memories-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-6"
      >
        <ScrapbookTimeline
          ref="timeline"
          v-model:member-id="memberId"
          :beans="beans"
          :types="types"
          read-only
        >
          <template #empty>
            <p
              class="font-inter wall-memories-empty text-secondary-500 dark:text-ink-soft px-4 py-12 text-center text-base"
            >
              {{
                types.size === 0
                  ? t('wall.memories.empty.typesOff')
                  : t('wall.memories.empty.noEntries')
              }}
            </p>
          </template>
        </ScrapbookTimeline>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * The timeline does not own a scroller; this is it. A size container, so the timeline's
 * rail can be capped at this box's visible height (`100cqh`) and scroll inside it.
 */
.wall-memories-scroll {
  --scrapbook-timeline-viewport: 100cqh;

  container-type: size;
  overscroll-behavior: contain;
}
</style>
