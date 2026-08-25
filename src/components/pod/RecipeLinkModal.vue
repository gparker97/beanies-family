<script setup lang="ts">
/**
 * Recipe reader intake (#72).
 *
 * DESIGN NOTE — why this is the FIRST thing the user sees, not the second.
 *
 * The original flow was: tap the reader → a chooser with three equal options → if you picked
 * "link", a second modal for the URL. But the three sources are not equally used: a link is
 * the everyday case, and camera/file are the occasional one. Making the common path cost two
 * taps and a modal transition to reach a text field was the wrong shape.
 *
 * So the link field IS the modal. It opens focused and ready to paste. Camera and file stay
 * one tap away underneath, visually quieter — present, but not competing. Nothing is hidden;
 * the hierarchy just matches how the feature is actually used.
 *
 * Validation is the SAME `routeUrl` the resolver uses, so what the user is told here and what
 * the fetcher will accept can never disagree.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';
import { routeUrl } from '@/utils/recipeSourceUrl';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  submit: [url: string];
  /** Fall back to the device camera — the occasional path, not the common one. */
  camera: [];
  /** Fall back to the file picker (an image or a PDF). */
  file: [];
}>();

const { t } = useTranslation();

const link = ref('');
/** Only complain once the user has actually tried, so an empty field is never scolded. */
const touched = ref(false);
const inputWrap = ref<HTMLElement | null>(null);

const route = computed(() => routeUrl(link.value));
const isValid = computed(() => route.value.kind !== 'invalid');
const showError = computed(() => touched.value && link.value.trim().length > 0 && !isValid.value);

/** Tell the user we recognised a video, so the different behaviour is not a surprise. */
const isVideo = computed(() => route.value.kind === 'youtube');

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    link.value = '';
    touched.value = false;
    // Focus the field on open — the whole point of this layout is that you can paste
    // immediately. Guarded because BaseInput may not have mounted on the first tick.
    await nextTick();
    inputWrap.value?.querySelector('input')?.focus();
  }
);

function handleSave(): void {
  touched.value = true;
  if (!isValid.value) return;
  emit('submit', link.value.trim());
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    layer="overlay"
    :open="open"
    :title="t('recipeExtract.link.title')"
    icon="🍳"
    icon-bg="var(--tint-orange-8)"
    size="default"
    :save-disabled="!isValid"
    :save-label="t('recipeExtract.link.action')"
    @close="emit('close')"
    @save="handleSave"
  >
    <FormFieldGroup :label="t('recipeExtract.link.label')" required>
      <div ref="inputWrap">
        <BaseInput
          v-model="link"
          type="url"
          :placeholder="t('recipeExtract.link.placeholder')"
          @blur="touched = true"
          @keyup.enter="handleSave"
        />
      </div>
      <!-- Heritage Orange, never Alert Red: a mistyped link is routine, not a failure. -->
      <p v-if="showError" class="font-outfit text-primary-500 mt-1.5 text-xs">
        {{ t('recipeExtract.link.invalid') }}
      </p>
      <p v-else-if="isVideo" class="font-outfit text-secondary-500/70 mt-1.5 text-xs">
        {{ t('recipeExtract.link.videoHint') }}
      </p>
      <p v-else class="font-outfit text-secondary-500/70 mt-1.5 text-xs">
        {{ t('recipeExtract.link.hint') }}
      </p>
    </FormFieldGroup>

    <!-- Secondary sources. Deliberately quieter than the field above: a hairline divider,
         no fill, muted text. Available in one tap, but never competing with the link. -->
    <div class="mt-6">
      <div class="flex items-center gap-3">
        <span class="h-px flex-1 bg-[var(--divider,rgba(44,62,80,0.08))]"></span>
        <span
          class="font-outfit text-secondary-500/50 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase"
        >
          {{ t('recipeExtract.link.orFrom') }}
        </span>
        <span class="h-px flex-1 bg-[var(--divider,rgba(44,62,80,0.08))]"></span>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          class="font-outfit text-secondary-500 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-[var(--tint-slate-10)] bg-transparent px-3 text-sm font-semibold transition-colors hover:bg-[var(--tint-slate-5)] dark:border-slate-600 dark:text-gray-200"
          @click="emit('camera')"
        >
          <BeanieIcon name="camera" size="sm" class="opacity-60" />
          <span class="truncate">{{ t('ai.picker.takePhoto') }}</span>
        </button>
        <button
          type="button"
          class="font-outfit text-secondary-500 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-[var(--tint-slate-10)] bg-transparent px-3 text-sm font-semibold transition-colors hover:bg-[var(--tint-slate-5)] dark:border-slate-600 dark:text-gray-200"
          @click="emit('file')"
        >
          <BeanieIcon name="image" size="sm" class="opacity-60" />
          <span class="truncate">{{ t('ai.picker.chooseFile') }}</span>
        </button>
      </div>
    </div>
  </BeanieFormModal>
</template>
