<script setup lang="ts">
/**
 * Drop-in photo-attachment UI. Integration plans (activities, family
 * members, todos, etc.) just drop this component next to the entity's
 * edit form and bind `photoIds` via v-model + the `updatePhotoIds`
 * callback.
 */
import { computed, ref } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import PhotoThumbnail from '@/components/media/PhotoThumbnail.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import { usePhotos } from '@/composables/usePhotos';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFilePicker } from '@/composables/useFilePicker';
import { useIsTouchPrimary } from '@/composables/useIsTouchPrimary';
import { useTranslation } from '@/composables/useTranslation';
import type { UUID } from '@/types/models';

interface Props {
  collection: string;
  entityId: UUID;
  photoIds: UUID[];
  currentMemberId?: UUID;
  /**
   * Per-entity cap override. Defaults to 4 (MAX_PHOTOS_PER_SET).
   * Medication bottles and cook-log dish snaps pass `:max="1"`.
   */
  max?: number;
  /**
   * Background this is rendered against. `dark` = the original
   * attached-to-activities surface (white text/borders); `light` =
   * drawer forms (slate borders + muted grey text). Defaults to
   * light since that's where every current caller lives.
   */
  tone?: 'light' | 'dark';
}

const props = withDefaults(defineProps<Props>(), {
  tone: 'light',
  max: undefined,
  currentMemberId: undefined,
});
const emit = defineEmits<{ 'update:photoIds': [ids: UUID[]] }>();

const { t } = useTranslation();

const MAX_PHOTOS_DEFAULT = 4;

// Localized hint for the "you've hit the cap" state. Renders the
// singular copy for single-photo surfaces (medication bottle, cook-log
// dish snap) and the interpolated "up to N" for multi-photo surfaces.
const maxReachedLabel = computed(() => {
  const n = props.max ?? MAX_PHOTOS_DEFAULT;
  if (n === 1) return t('photos.maxReached.one');
  return t('photos.maxReached.n').replace('{n}', String(n));
});

const { photos, pending, canAdd, atCap, uploading, add, remove } = usePhotos({
  collection: props.collection,
  entityId: computed(() => props.entityId),
  photoIds: computed(() => props.photoIds),
  currentMemberId: computed(() => props.currentMemberId),
  updatePhotoIds: (ids) => emit('update:photoIds', ids),
  max: props.max,
});

const viewerOpen = ref(false);
const viewerIndex = ref(0);

function openViewer(photoId: UUID): void {
  const idx = photos.value.findIndex((p) => p.id === photoId);
  viewerIndex.value = Math.max(0, idx);
  viewerOpen.value = true;
}

// Drag-drop
const { isDragging, bindings: dropBindings } = useFileDrop({
  accept: ['image/*', '.heic', '.heif'],
  multiple: true,
  onDrop: async (dropped) => {
    await add(dropped.map((d) => d.file));
  },
});

// Gallery picker — we keep the composable return object intact rather
// than destructuring because vue-tsc doesn't track template
// `ref="..."` references to destructured reactive refs.
//
// `multiple` is conditional on the entity cap. Forcing `multiple=false`
// for single-photo surfaces (medication bottles, cook-log dish snaps)
// lets Android Chrome offer the camera chooser for those surfaces when
// touch-primary detection misses. On multi-photo surfaces the separate
// "Take photo" tile (shown on touch-primary devices) covers the camera
// path directly via `capture="environment"`.
const galleryPicker = useFilePicker({
  accept: 'image/*',
  multiple: (props.max ?? MAX_PHOTOS_DEFAULT) > 1,
  onPick: async (files) => {
    await add(files);
  },
});

// Camera picker — only rendered on touch-primary devices (phones +
// tablets). `capture="environment"` tells the OS to open the rear
// camera app directly instead of a file chooser; camera capture is
// inherently single-shot so `multiple` is off regardless of the cap.
const cameraPicker = useFilePicker({
  accept: 'image/*',
  multiple: false,
  capture: 'environment',
  onPick: async (files) => {
    await add(files);
  },
});

const isTouchPrimary = useIsTouchPrimary();

/**
 * Let parent components open the gallery picker programmatically —
 * used by form modals that render a pre-save "Add Photo" button,
 * eagerly create the parent entity, then want the picker to open in
 * the same gesture so the user doesn't lose the click.
 */
defineExpose({
  openPicker: () => galleryPicker.open(),
});
</script>

<template>
  <div
    v-bind="dropBindings"
    class="rounded-2xl border-2 border-dashed transition-colors"
    :class="[
      isDragging
        ? 'border-primary-500 bg-primary-500/10'
        : tone === 'dark'
          ? 'border-white/10'
          : 'border-[var(--tint-slate-10)]',
      canAdd ? '' : 'opacity-60',
    ]"
  >
    <div class="flex items-center gap-2 overflow-x-auto p-2">
      <PhotoThumbnail
        v-for="photo in photos"
        :key="photo.id"
        :photo-id="photo.id"
        @open="openViewer"
      />
      <PhotoThumbnail
        v-for="entry in pending"
        :key="entry.id"
        :pending-label="t('photos.uploading')"
      />
      <!-- In-flight online uploads — one spinner tile per upload so
           the user sees the compress + Drive round-trip as it happens. -->
      <PhotoThumbnail
        v-for="n in uploading"
        :key="`uploading-${n}`"
        :pending-label="t('photos.uploading')"
      />
      <button
        v-if="canAdd && isTouchPrimary"
        type="button"
        class="hover:border-primary-500/50 flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed transition-colors"
        :class="
          tone === 'dark'
            ? 'border-white/20 text-white/70 hover:bg-white/5'
            : 'hover:text-primary-500 border-[var(--tint-slate-10)] text-[var(--color-text-muted)] hover:bg-[var(--tint-orange-4)]'
        "
        @click="cameraPicker.open"
      >
        <BeanieIcon name="camera" size="md" />
        <span class="text-[10px]">{{ t('photos.takePhoto') }}</span>
      </button>
      <button
        v-if="canAdd"
        type="button"
        class="hover:border-primary-500/50 flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed transition-colors"
        :class="
          tone === 'dark'
            ? 'border-white/20 text-white/70 hover:bg-white/5'
            : 'hover:text-primary-500 border-[var(--tint-slate-10)] text-[var(--color-text-muted)] hover:bg-[var(--tint-orange-4)]'
        "
        @click="galleryPicker.open"
      >
        <BeanieIcon name="image" size="md" />
        <span class="text-[10px]">{{
          isTouchPrimary ? t('photos.fromLibrary') : t('photos.addPhoto')
        }}</span>
      </button>
    </div>

    <!-- Empty hint / max-reached hint -->
    <p
      v-if="photos.length === 0 && pending.length === 0 && canAdd"
      class="px-3 pb-2 text-xs"
      :class="tone === 'dark' ? 'text-white/50' : 'text-[var(--color-text-muted)]'"
    >
      {{ t('photos.dropToAdd') }}
    </p>
    <p
      v-else-if="atCap"
      class="px-3 pb-2 text-xs"
      :class="tone === 'dark' ? 'text-white/50' : 'text-[var(--color-text-muted)]'"
    >
      {{ maxReachedLabel }}
    </p>

    <input
      :ref="(el) => (galleryPicker.inputRef.value = el as HTMLInputElement)"
      v-bind="galleryPicker.bindings"
    />
    <input
      :ref="(el) => (cameraPicker.inputRef.value = el as HTMLInputElement)"
      v-bind="cameraPicker.bindings"
    />
  </div>

  <PhotoViewer
    :open="viewerOpen"
    :photo-ids="photos.map((p) => p.id)"
    :initial-index="viewerIndex"
    @close="viewerOpen = false"
    @remove="remove"
  />
</template>
