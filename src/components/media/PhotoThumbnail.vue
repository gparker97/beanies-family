<script setup lang="ts">
/**
 * Square photo thumbnail with a loading shimmer and a broken-image
 * fallback for photos Drive can't resolve (404/403). Tap opens the viewer.
 */
import { computed, onMounted, ref, watch } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { usePhotoStore } from '@/stores/photoStore';
import { useTranslation } from '@/composables/useTranslation';
import type { UUID } from '@/types/models';

interface Props {
  photoId?: UUID;
  /** When provided, shows the pending-upload variant (no Drive URL to fetch). */
  pendingLabel?: string;
}

const props = defineProps<Props>();
defineEmits<{ open: [photoId: UUID] }>();

const store = usePhotoStore();
const { t } = useTranslation();

const url = ref<string | null>(null);
const loading = ref(false);
const loadedOnce = ref(false);
const imgError = ref(false);

const isPending = computed(() => !!props.pendingLabel);
const photoIsMissing = computed(() => !!props.photoId && store.isUnresolved(props.photoId));
const showBroken = computed(() => photoIsMissing.value || (!loading.value && imgError.value));

function resolve(): void {
  if (!props.photoId || isPending.value) {
    url.value = null;
    loading.value = false;
    return;
  }
  // Public Drive CDN URL — no OAuth, no fetch, no cache. The URL is
  // deterministic from driveFileId; if the underlying file was deleted
  // or revoked, `<img onerror>` flips us to the broken state.
  url.value = store.getPublicUrl(props.photoId, 'thumb');
  loading.value = !!url.value;
  imgError.value = false;
  loadedOnce.value = true;
}

// When `<img>` signals load error, mark the photo unresolved so
// `getPublicUrl` returns null next time (and other surfaces — viewer,
// avatar — pick up the same "broken" state). Single retry guards
// against transient Drive hiccups on the very first render.
let retriedOnce = false;
function handleImgLoaded(): void {
  loading.value = false;
}
function handleImgError(): void {
  loading.value = false;
  if (!retriedOnce) {
    retriedOnce = true;
    // Re-read the URL — cheap enough that we don't need to dedupe.
    if (props.photoId) url.value = store.getPublicUrl(props.photoId, 'thumb');
    return;
  }
  imgError.value = true;
  if (props.photoId) store.markUnresolved(props.photoId);
  console.warn('[PhotoThumbnail] image failed to load', props.photoId);
}

onMounted(resolve);
watch(
  () => props.photoId,
  () => {
    retriedOnce = false;
    resolve();
  }
);
</script>

<template>
  <button
    type="button"
    class="focus:ring-primary-500 relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 focus:ring-2 focus:outline-none"
    :class="showBroken ? 'cursor-pointer' : 'hover:opacity-90'"
    @click="photoId && $emit('open', photoId)"
  >
    <!-- Pending state — queued offline upload OR in-flight online
         upload. Brand-tinted so it reads on both light drawer
         surfaces and dark activity panels; the spinner is sm (24px)
         so the motion is unmistakable at 80px tile size. -->
    <div
      v-if="isPending"
      class="border-primary-500/40 bg-primary-500/10 text-primary-600 dark:text-primary-300 flex h-full w-full animate-pulse flex-col items-center justify-center gap-1 border-2 border-dashed"
    >
      <BeanieSpinner size="sm" />
      <span class="font-outfit text-[9px] leading-tight font-semibold">{{ pendingLabel }}</span>
    </div>

    <!-- Broken / missing state -->
    <div
      v-else-if="showBroken"
      class="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-800/40 text-white/60"
      :aria-label="t('photos.missing.tile')"
    >
      <BeanieIcon name="image-broken" size="md" />
      <span class="text-[10px]">{{ t('photos.missing.tile') }}</span>
    </div>

    <!-- Loading shimmer -->
    <div v-else-if="loading && !url" class="animate-beanie-shimmer h-full w-full bg-white/10" />

    <!-- Resolved image -->
    <img
      v-else-if="url"
      :src="url"
      :alt="''"
      class="h-full w-full object-cover"
      loading="lazy"
      @load="handleImgLoaded"
      @error="handleImgError"
    />
  </button>
</template>
