<script setup lang="ts">
/**
 * Full-screen photo viewer. Wraps BaseModal with size='3xl' +
 * fullscreenMobile=true. Supports arrow-key prev/next, a download link,
 * delete confirmation, and a missing-photo affordance with
 * Replace / Remove actions when Drive can't resolve the file.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { usePhotoStore } from '@/stores/photoStore';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { useFilePicker } from '@/composables/useFilePicker';
import type { UUID } from '@/types/models';

interface Props {
  open: boolean;
  photoIds: UUID[];
  /** Which photo in `photoIds` is currently shown (defaults to 0). */
  initialIndex?: number;
  /**
   * Read-only mode: the footer Replace / Remove / Download actions are
   * hidden, leaving a pure lightbox. Used by surfaces that own their own
   * edit controls (e.g. the avatar picker exposes Replace/Remove below
   * the thumbnail — duplicating them inside the viewer would be noise).
   */
  readOnly?: boolean;
}

const props = withDefaults(defineProps<Props>(), { initialIndex: 0, readOnly: false });
const emit = defineEmits<{
  close: [];
  remove: [photoId: UUID];
}>();

const store = usePhotoStore();
const { t } = useTranslation();

const currentIndex = ref(props.initialIndex);
const fullUrl = ref<string | null>(null);
const loading = ref(false);

const currentPhotoId = computed(() => props.photoIds[currentIndex.value] ?? null);
const isMissing = computed(
  () => !!currentPhotoId.value && store.isUnresolved(currentPhotoId.value)
);
const canGoPrev = computed(() => currentIndex.value > 0);
const canGoNext = computed(() => currentIndex.value < props.photoIds.length - 1);
const positionLabel = computed(() =>
  props.photoIds.length > 1
    ? `${currentIndex.value + 1} ${t('photos.viewer.of')} ${props.photoIds.length}`
    : ''
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      currentIndex.value = props.initialIndex;
      resolve();
    }
  }
);

watch(currentPhotoId, () => {
  if (props.open) resolve();
});

function resolve(): void {
  if (!currentPhotoId.value) {
    fullUrl.value = null;
    loading.value = false;
    return;
  }
  // Public Drive CDN URL (ADR-021). No fetch, no OAuth — the `<img>`
  // downloads directly from Drive using the anyone-with-link grant
  // attached to the file at upload time.
  fullUrl.value = store.getPublicUrl(currentPhotoId.value, 'full');
  loading.value = !!fullUrl.value;
}

function handleImgLoaded(): void {
  loading.value = false;
}

function handleImgError(): void {
  loading.value = false;
  if (currentPhotoId.value) {
    store.markUnresolved(currentPhotoId.value);
    console.warn('[PhotoViewer] image failed to load', currentPhotoId.value);
  }
  fullUrl.value = null;
}

function goPrev(): void {
  if (canGoPrev.value) currentIndex.value -= 1;
}
function goNext(): void {
  if (canGoNext.value) currentIndex.value += 1;
}

function handleKeydown(e: KeyboardEvent): void {
  if (!props.open) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    goPrev();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    goNext();
  }
}

onMounted(() => document.addEventListener('keydown', handleKeydown));
onUnmounted(() => document.removeEventListener('keydown', handleKeydown));

// --- Actions ---------------------------------------------------------

async function handleDelete(): Promise<void> {
  if (!currentPhotoId.value) return;
  const ok = await confirm({
    title: 'photos.deleteConfirm.title',
    message: 'photos.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  emit('remove', currentPhotoId.value);
  emit('close');
}

// Replace action — uses useFilePicker for the new file selection.
// Kept as a composable return object (not destructured) so vue-tsc
// tracks the template ref attribute correctly.
const replacePicker = useFilePicker({
  accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
  multiple: false,
  onPick: async (files) => {
    if (!currentPhotoId.value || files.length === 0) return;
    const [file] = files;
    if (!file) return;
    try {
      await store.replacePhotoFile(currentPhotoId.value, file);
      resolve();
    } catch (e) {
      console.warn('[PhotoViewer] replace failed', e);
    }
  },
});

async function handleRemoveMissing(): Promise<void> {
  if (!currentPhotoId.value) return;
  emit('remove', currentPhotoId.value);
  emit('close');
}
</script>

<template>
  <BaseModal
    :open="open"
    size="3xl"
    fullscreen-mobile
    layer="overlay"
    :title="positionLabel"
    @close="emit('close')"
  >
    <div class="relative flex min-h-[60vh] items-center justify-center bg-black/80">
      <!-- Prev / next chevrons -->
      <button
        v-if="canGoPrev"
        type="button"
        class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
        :aria-label="t('photos.previous')"
        @click="goPrev"
      >
        <BeanieIcon name="chevron-left" size="md" />
      </button>
      <button
        v-if="canGoNext"
        type="button"
        class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
        :aria-label="t('photos.next')"
        @click="goNext"
      >
        <BeanieIcon name="chevron-right" size="md" />
      </button>

      <!-- Missing state -->
      <div
        v-if="isMissing"
        class="flex flex-col items-center gap-3 px-6 py-10 text-center text-white/80"
      >
        <BeanieIcon name="image-broken" size="xl" />
        <h2 class="text-lg font-medium">{{ t('photos.missing.title') }}</h2>
        <p class="max-w-md text-sm text-white/60">{{ t('photos.missing.body') }}</p>
      </div>

      <!-- Loading -->
      <div v-else-if="loading && !fullUrl" class="flex flex-col items-center gap-2 text-white/80">
        <BeanieSpinner size="md" />
      </div>

      <!-- Image -->
      <img
        v-else-if="fullUrl"
        :src="fullUrl"
        :alt="''"
        class="max-h-[80vh] max-w-full object-contain"
        @load="handleImgLoaded"
        @error="handleImgError"
      />
    </div>

    <template v-if="!readOnly" #footer>
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs text-gray-500 dark:text-white/60">{{ positionLabel }}</div>
        <div class="flex items-center gap-2">
          <template v-if="isMissing">
            <button
              type="button"
              class="bg-primary-500 hover:bg-primary-600 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
              @click="replacePicker.open"
            >
              {{ t('photos.replace') }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
              @click="handleRemoveMissing"
            >
              {{ t('photos.remove') }}
            </button>
          </template>
          <template v-else>
            <a
              v-if="fullUrl"
              :href="fullUrl"
              download
              class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
            >
              {{ t('photos.download') }}
            </a>
            <button
              type="button"
              class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
              @click="handleDelete"
            >
              {{ t('photos.remove') }}
            </button>
          </template>
        </div>
      </div>
      <!-- Hidden input backing the Replace action. -->
      <input
        :ref="(el) => (replacePicker.inputRef.value = el as HTMLInputElement)"
        v-bind="replacePicker.bindings"
      />
    </template>
  </BaseModal>
</template>
