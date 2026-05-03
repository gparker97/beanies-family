<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getAvatarImagePath } from '@/constants/avatars';
import type { AvatarVariant } from '@/constants/avatars';

interface Props {
  /** Avatar variant from the registry */
  variant: AvatarVariant;
  /** Member's profile color for the ring border + pastel background */
  color?: string;
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Accessible label */
  ariaLabel?: string;
  /**
   * Optional user-uploaded photo URL. When set AND the photo successfully
   * loads, it renders on top of the beanie variant. While loading (or on
   * error), the beanie variant stays visible — no flash. Added 2026-04
   * with The Pod's avatar-photo feature.
   */
  photoUrl?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  color: '#3b82f6',
  size: 'md',
  ariaLabel: undefined,
  photoUrl: null,
});

/**
 * Emitted when the user-supplied `photoUrl` fails to load. Consumers that
 * resolved the URL from Drive (see `useAvatarPhotoUrl`) listen for this
 * to drop their thumb-URL cache and re-fetch once — the beanie variant
 * stays visible in the meantime, so this is best-effort recovery.
 */
const emit = defineEmits<{
  'photo-error': [];
}>();

const SIZE_CLASSES: Record<string, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
};

const sizeClass = computed(() => SIZE_CLASSES[props.size] || SIZE_CLASSES.md);
const imagePath = computed(() => getAvatarImagePath(props.variant));
const isFiltered = computed(() => props.variant === 'family-filtered');

// Photo load state — only flips to `true` once the <img> fires `load`. An
// `error` event (Drive 404, CDN hiccup, bad URL) resets it and the beanie
// fallback stays visible.
const photoLoaded = ref(false);
watch(
  () => props.photoUrl,
  () => {
    photoLoaded.value = false;
  }
);
function onPhotoLoad() {
  photoLoaded.value = true;
}
function onPhotoError() {
  photoLoaded.value = false;
  if (props.photoUrl) {
    console.warn('[beanieAvatar] photo failed to load, falling back to beanie', props.photoUrl);
    emit('photo-error');
  }
}
</script>

<template>
  <div
    :class="[sizeClass, 'relative flex-shrink-0 overflow-hidden rounded-full']"
    :style="{
      border: `2px solid ${color}`,
      backgroundColor: `${color}20`,
    }"
    :aria-label="ariaLabel"
    :aria-hidden="!ariaLabel"
    role="img"
    data-testid="beanie-avatar"
    :data-variant="variant"
  >
    <img
      :src="imagePath"
      :alt="ariaLabel || ''"
      class="h-full w-full object-contain"
      draggable="false"
    />
    <!-- Optional user photo overlay. Only shows once `load` fires —
         the beanie underneath stays visible during loading and on error. -->
    <img
      v-if="photoUrl"
      :src="photoUrl"
      :alt="ariaLabel || ''"
      class="absolute inset-0 h-full w-full object-cover transition-opacity duration-200"
      :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
      draggable="false"
      @load="onPhotoLoad"
      @error="onPhotoError"
    />
    <!-- Filter badge overlay for family-filtered variant -->
    <div
      v-if="isFiltered"
      class="bg-secondary-500/80 absolute right-0 bottom-0 flex h-[40%] w-[40%] items-center justify-center rounded-full"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        class="h-[60%] w-[60%]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M1 2h14L10 8.5V13l-4 2V8.5L1 2Z" fill="white" opacity="0.9" />
      </svg>
    </div>
  </div>
</template>
