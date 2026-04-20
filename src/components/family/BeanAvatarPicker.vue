<script setup lang="ts">
/**
 * Avatar photo picker + preview wired for FamilyMember entities.
 *
 * Responsibilities:
 *   - Render BeanieAvatar with resolved photo URL (beanie variant fallback).
 *   - Pick a file, compress at 1024/q=0.92 via photoStore.addAvatarPhoto().
 *   - Track "uploaded but not saved" photoIds so the parent can tombstone
 *     orphans on close, and tombstone the prior avatar on save-replace.
 *
 * The parent owns the avatarPhotoId (via v-model) and calls
 * `onSave({ previous, uploaded })` when the form saves so this
 * component can do the right tombstones. On close-without-save, the
 * parent calls `onClose()` to clean up session-uploaded orphans.
 */
import { computed, ref } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useFilePicker } from '@/composables/useFilePicker';
import { useToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { usePhotoStore } from '@/stores/photoStore';
import type { AvatarVariant } from '@/constants/avatars';
import type { UUID } from '@/types/models';

const props = defineProps<{
  modelValue: UUID | undefined;
  variant: AvatarVariant;
  color: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [id: UUID | undefined];
  /** Emitted with the photoId of every session upload (parent tombstones on cancel). */
  uploaded: [photoId: UUID];
  /** Emitted when the user explicitly removes the current avatar. */
  removed: [photoId: UUID];
}>();

const { t } = useTranslation();
const { showToast } = useToast();
const photoStore = usePhotoStore();

const uploading = ref(false);
const { url: photoUrl, refresh: refreshPhotoUrl } = useAvatarPhotoUrl(() => props.modelValue);
const photosEnabled = computed(() => photoStore.photosEnabled);

const picker = useFilePicker({
  accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
  multiple: false,
  onPick: async (files) => {
    const file = files[0];
    if (!file) return;
    if (!photosEnabled.value) {
      showToast('warning', t('photos.cloudRequired'));
      return;
    }
    uploading.value = true;
    try {
      const newPhotoId = await photoStore.addAvatarPhoto(file);
      emit('uploaded', newPhotoId);
      emit('update:modelValue', newPhotoId);
    } catch (e) {
      console.warn('[beanAvatarPicker] upload failed', e);
      showToast('error', t('photos.avatar.uploadFailed'));
    } finally {
      uploading.value = false;
    }
  },
});

function remove() {
  const current = props.modelValue;
  if (!current) return;
  emit('removed', current);
  emit('update:modelValue', undefined);
}

// Lightbox — opens when the user taps the avatar (only when a photo is
// set AND we're not in the uploading transition). Read-only viewer so
// Replace / Remove stay on the picker below where the user expects
// them; duplicating them inside the viewer would be noise.
const viewerOpen = ref(false);
const viewerPhotoIds = computed<UUID[]>(() => (props.modelValue ? [props.modelValue] : []));

function openViewer(): void {
  if (props.disabled) return;
  if (!props.modelValue || uploading.value) return;
  viewerOpen.value = true;
}
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <input
      :ref="(el) => (picker.inputRef.value = el as HTMLInputElement)"
      v-bind="picker.bindings"
    />
    <!-- Avatar + uploading overlay (non-blocking; modal stays interactive).
         Wrapped in a button so tap/click (when a photo is set) opens the
         lightbox. The wrapper is a real <button> for keyboard + screen-
         reader affordance, but it only acts as an opener — the inner
         avatar still renders in exactly the same place. -->
    <div class="relative">
      <button
        type="button"
        class="focus:ring-primary-500 rounded-full focus:ring-offset-2 focus:outline-none dark:focus:ring-offset-slate-800"
        :class="[
          modelValue && !uploading && !disabled ? 'cursor-zoom-in focus:ring-2' : 'cursor-default',
        ]"
        :disabled="!modelValue || uploading || disabled"
        :aria-label="modelValue ? t('photos.avatar.viewLarger') : undefined"
        @click="openViewer"
      >
        <BeanieAvatar
          :variant="variant"
          :color="color"
          :photo-url="photoUrl"
          size="xl"
          :class="{ 'opacity-40 transition-opacity': uploading }"
          @photo-error="refreshPhotoUrl"
        />
      </button>
      <div
        v-if="uploading"
        class="pointer-events-none absolute inset-0 flex items-center justify-center"
        role="status"
        :aria-label="t('photos.avatar.uploading')"
      >
        <BeanieSpinner size="md" />
      </div>
    </div>
    <div v-if="!disabled && photosEnabled" class="flex items-center gap-2 text-xs">
      <button
        type="button"
        class="font-outfit text-primary-500 inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition-colors hover:bg-[var(--tint-orange-8)] disabled:opacity-50"
        :disabled="uploading"
        @click="picker.open()"
      >
        <BeanieSpinner v-if="uploading" size="xs" />
        <BeanieIcon v-else name="camera" size="xs" />
        <span>
          {{
            uploading
              ? t('photos.avatar.uploading')
              : modelValue
                ? t('photos.avatar.replace')
                : t('photos.avatar.upload')
          }}
        </span>
      </button>
      <button
        v-if="modelValue"
        type="button"
        class="font-outfit inline-flex items-center gap-1 rounded-lg border border-red-300 px-2 py-1 font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
        :disabled="uploading"
        @click="remove"
      >
        <BeanieIcon name="trash" size="xs" />
        <span>{{ t('photos.avatar.remove') }}</span>
      </button>
    </div>
    <p v-else-if="!disabled && !photosEnabled" class="text-xs text-[var(--color-text-muted)]">
      {{ t('photos.cloudRequired') }}
    </p>

    <!-- Read-only lightbox — surfaces the full-size photo. Replace / Remove
         intentionally live on the picker below, not inside the viewer, so
         the user has a single obvious place to edit. -->
    <PhotoViewer
      :open="viewerOpen"
      :photo-ids="viewerPhotoIds"
      read-only
      @close="viewerOpen = false"
    />
  </div>
</template>
