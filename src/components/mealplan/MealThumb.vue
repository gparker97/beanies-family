<script setup lang="ts">
/**
 * A recipe's leading photo thumbnail on the meal board, with a graceful
 * emoji-tile fallback when the recipe has no photo (or the photo can't be
 * resolved). The fallback is load-bearing — this must NEVER render a blank
 * or broken tile. Resolves the URL via `photoStore.getPublicUrl(...,'thumb')`
 * (sync, ADR-021 public Drive URL — the same call RecipeDetailPage uses).
 */
import { ref, computed, watch } from 'vue';
import { usePhotoStore } from '@/stores/photoStore';

const props = withDefaults(
  defineProps<{
    photoIds?: string[];
    /** Emoji shown when there is no resolvable photo. */
    fallbackEmoji: string;
    /** Square side in rem. */
    sizeRem?: number;
  }>(),
  { photoIds: undefined, sizeRem: 1.75 }
);

const photoStore = usePhotoStore();

const url = computed<string | null>(() => {
  const id = props.photoIds?.[0];
  return id ? photoStore.getPublicUrl(id, 'thumb') : null;
});

// If the <img> fails to load, drop to the emoji fallback for this render.
const imgFailed = ref(false);
watch(url, () => {
  imgFailed.value = false;
});

const showImg = computed(() => !!url.value && !imgFailed.value);
</script>

<template>
  <img
    v-if="showImg"
    :src="url!"
    alt=""
    class="flex-none rounded-[9px] object-cover"
    :style="{ width: `${sizeRem}rem`, height: `${sizeRem}rem` }"
    @error="imgFailed = true"
  />
  <span
    v-else
    class="flex flex-none items-center justify-center rounded-[9px] bg-[var(--tint-orange-8)]"
    :style="{ width: `${sizeRem}rem`, height: `${sizeRem}rem`, fontSize: `${sizeRem * 0.55}rem` }"
    aria-hidden="true"
    >{{ fallbackEmoji }}</span
  >
</template>
