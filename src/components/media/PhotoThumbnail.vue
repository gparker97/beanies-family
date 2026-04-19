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

async function resolve(): Promise<void> {
  if (!props.photoId || isPending.value) return;
  loading.value = true;
  imgError.value = false;
  try {
    url.value = await store.getImageUrl(props.photoId, 'thumb');
  } catch (e) {
    console.warn('[PhotoThumbnail] getImageUrl failed', e);
    url.value = null;
  } finally {
    loading.value = false;
    loadedOnce.value = true;
  }
}

// A single retry after an <img> onerror — handles transient CDN blips.
let retriedOnce = false;
async function handleImgError(): Promise<void> {
  if (retriedOnce) {
    imgError.value = true;
    return;
  }
  retriedOnce = true;
  await resolve();
}

onMounted(resolve);
watch(
  () => props.photoId,
  () => {
    retriedOnce = false;
    void resolve();
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
    <!-- Pending (queued offline) state -->
    <div
      v-if="isPending"
      class="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-800/60 text-white/80"
    >
      <BeanieSpinner size="xs" />
      <span class="text-[10px]">{{ pendingLabel }}</span>
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
      @error="handleImgError"
    />
  </button>
</template>
