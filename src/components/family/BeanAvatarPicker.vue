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
const photoUrl = useAvatarPhotoUrl(() => props.modelValue);
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
</script>

<template>
  <div class="flex flex-col items-center gap-2">
    <input
      :ref="(el) => (picker.inputRef.value = el as HTMLInputElement)"
      v-bind="picker.bindings"
    />
    <BeanieAvatar :variant="variant" :color="color" :photo-url="photoUrl" size="xl" />
    <div v-if="!disabled && photosEnabled" class="flex items-center gap-2 text-xs">
      <button
        type="button"
        class="font-outfit text-primary-500 inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold transition-colors hover:bg-[var(--tint-orange-8)] disabled:opacity-50"
        :disabled="uploading"
        @click="picker.open()"
      >
        <BeanieIcon name="camera" size="xs" />
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
        class="font-outfit inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-5)] hover:text-red-500"
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
  </div>
</template>
