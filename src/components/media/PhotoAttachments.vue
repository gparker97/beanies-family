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
import { useTranslation } from '@/composables/useTranslation';
import type { UUID } from '@/types/models';

interface Props {
  collection: string;
  entityId: UUID;
  photoIds: UUID[];
  currentMemberId?: UUID;
}

const props = defineProps<Props>();
const emit = defineEmits<{ 'update:photoIds': [ids: UUID[]] }>();

const { t } = useTranslation();

const { photos, pending, canAdd, atCap, add, remove } = usePhotos({
  collection: props.collection,
  entityId: computed(() => props.entityId),
  photoIds: computed(() => props.photoIds),
  currentMemberId: computed(() => props.currentMemberId),
  updatePhotoIds: (ids) => emit('update:photoIds', ids),
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

// File picker — we keep the composable return object intact rather than
// destructuring because vue-tsc doesn't track template `ref="..."`
// references to destructured reactive refs.
const picker = useFilePicker({
  accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
  multiple: true,
  onPick: async (files) => {
    await add(files);
  },
});
</script>

<template>
  <div
    v-bind="dropBindings"
    class="rounded-2xl border-2 border-dashed transition-colors"
    :class="[
      isDragging ? 'border-primary-500 bg-primary-500/10' : 'border-white/10',
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
      <button
        v-if="canAdd"
        type="button"
        class="hover:border-primary-500/50 flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-white/20 text-white/70 hover:bg-white/5"
        @click="picker.open"
      >
        <BeanieIcon name="camera" size="md" />
        <span class="text-[10px]">{{ t('photos.addPhoto') }}</span>
      </button>
    </div>

    <!-- Empty hint / max-reached hint -->
    <p
      v-if="photos.length === 0 && pending.length === 0 && canAdd"
      class="px-3 pb-2 text-xs text-white/50"
    >
      {{ t('photos.dropToAdd') }}
    </p>
    <p v-else-if="atCap" class="px-3 pb-2 text-xs text-white/50">
      {{ t('photos.maxReached') }}
    </p>

    <input
      :ref="(el) => (picker.inputRef.value = el as HTMLInputElement)"
      v-bind="picker.bindings"
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
