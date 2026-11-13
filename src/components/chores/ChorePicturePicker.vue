<script setup lang="ts">
/**
 * A chore's picture (#146): an emoji, or a card-art picture with the emoji as its fallback. The
 * ONE copy of that choice, shared by the chore form and the Add Chores sheet's draft rows.
 * Picking an emoji clears the art; picking the selected art again clears it.
 *
 * Each row has a small caption (Emoji, Beanie Pictures), so the card-art tiles never read as
 * stray icons.
 *
 * Dark mode: the art tiles rest on `surface-overlay`; a selected tile is the orange tint with an
 * `accent-lift` edge; captions are `ink-soft`. The emoji grid is `EmojiPicker`'s own.
 */
import { computed } from 'vue';
import EmojiPicker from '@/components/ui/EmojiPicker.vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import { useTranslation } from '@/composables/useTranslation';
import { CHORE_ART_OPTIONS, CHORE_EMOJI_OPTIONS, choreArtSrc } from '@/constants/choreBlocks';

const props = defineProps<{
  emoji: string;
  /** The card-art key, or '' for none. */
  illustration: string;
}>();

const emit = defineEmits<{
  'update:emoji': [value: string];
  'update:illustration': [value: string];
}>();

const { t } = useTranslation();

const emojiOptions = computed(() =>
  CHORE_EMOJI_OPTIONS.map((o) => ({ emoji: o.emoji, label: t(o.labelKey) }))
);

function pickEmoji(value: string): void {
  emit('update:emoji', value);
  emit('update:illustration', '');
}

function pickArt(key: string): void {
  emit('update:illustration', props.illustration === key ? '' : key);
}
</script>

<template>
  <div data-testid="chore-picture-picker">
    <p
      class="font-outfit dark:text-ink-soft text-secondary-400 mb-1.5 text-xs font-semibold"
      data-testid="chore-picture-emoji-caption"
    >
      {{ t('choreboard.picture.emojiCaption') }}
    </p>
    <EmojiPicker :model-value="emoji" :options="emojiOptions" @update:model-value="pickEmoji" />
    <p
      class="font-outfit dark:text-ink-soft text-secondary-400 mt-3 mb-1.5 text-xs font-semibold"
      data-testid="chore-picture-art-caption"
    >
      {{ t('choreboard.picture.artCaption') }}
    </p>
    <div class="flex flex-wrap gap-2" data-testid="chore-picture-art">
      <button
        v-for="art in CHORE_ART_OPTIONS"
        :key="art.key"
        type="button"
        class="h-12 w-12 overflow-hidden rounded-xl border-2 transition-all duration-150"
        :class="
          illustration === art.key
            ? 'border-primary-500 dark:border-accent-lift bg-[var(--tint-orange-15)]'
            : 'dark:bg-surface-overlay border-transparent bg-[var(--tint-slate-5)]'
        "
        :aria-pressed="illustration === art.key ? 'true' : 'false'"
        :aria-label="t(art.labelKey)"
        :title="t(art.labelKey)"
        :data-art="art.key"
        @click="pickArt(art.key)"
      >
        <CardArt
          :card="{ emoji, illustration: choreArtSrc(art.key) }"
          img-class="h-full w-full object-contain"
        />
      </button>
    </div>
  </div>
</template>
