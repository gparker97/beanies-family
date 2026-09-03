<script setup lang="ts">
/**
 * The file-intake step for the AI "Magic beans" document readers, shared by the
 * photo→activity (FamilyPlannerPage) and document→trip (TravelPlansPage) flows.
 *
 * The page runs its consent gate first, then calls `pick()` (exposed).
 *
 * ⚠️ EXCEPT the magic-beans card (#84), which opens the picker FIRST and requests consent
 * inside the shared ingest, once a file exists. Nothing leaves the device before consent
 * either way — the gate still precedes every byte — but the ORDER differs: there the user
 * takes the photo and is then asked, so declining discards work already done. That is a
 * deliberate consequence of one button serving four sources (the type is unknown until the
 * content exists), not an oversight. Do not "restore" consent-first there without reading
 * `MagicBeansSheet`'s header. On a
 * touch-primary device `pick()` shows a small chooser — Take a photo (camera) or
 * Choose a file (image/PDF) — because a Capacitor WebView's documents picker has
 * no camera entry for the mixed image+PDF accept. On desktop it opens the file
 * dialog directly (the browser chooser already offers camera+files). The camera
 * uses an image-only `capture` input (no android.permission.CAMERA needed — the
 * system camera app handles it; mirrors PhotoAttachments). PDFs are file-only.
 *
 * The chosen File is emitted via `@file`; the page hands it to its own
 * processPhoto/processTravelDoc, which already own every offline/extraction
 * failure path — so this component adds no extraction error handling.
 */
import { ref } from 'vue';
import ChoiceModal from '@/components/ui/ChoiceModal.vue';
import { useFilePicker, type UseFilePickerReturn } from '@/composables/useFilePicker';
import { useIsTouchPrimary } from '@/composables/useIsTouchPrimary';
import { useTranslation } from '@/composables/useTranslation';
import { useToast } from '@/composables/useToast';
import { AI_PICKER_ACCEPT } from '@/constants/aiDocumentPicker';

const emit = defineEmits<{ (e: 'file', file: File): void }>();

const { t } = useTranslation();
const { showToast } = useToast();
const isTouchPrimary = useIsTouchPrimary();
const showChooser = ref(false);

function onPick(files: File[]): void {
  // The page's handler owns all downstream (offline/extraction) error handling.
  if (files[0]) emit('file', files[0]);
}

// Image-only + capture → the camera. Mixed image+PDF → the file/documents picker.
const cameraPicker = useFilePicker({
  accept: 'image/*',
  capture: 'environment',
  multiple: false,
  onPick,
});
const filePicker = useFilePicker({ accept: AI_PICKER_ACCEPT, multiple: false, onPick });

/** Open a picker, guarding the one new silent-failure surface (a null input ref). */
function openPicker(picker: UseFilePickerReturn): void {
  if (!picker.inputRef.value) {
    console.error(
      '[AiDocumentPicker] open() called before the file input mounted — ensure <AiDocumentPicker> is rendered'
    );
    showToast('error', t('ai.picker.openErrorTitle'), t('ai.picker.openErrorBody'));
    return;
  }
  picker.open();
}

/** Entry point — the page calls this AFTER its consent gate resolves. */
function pick(): void {
  if (isTouchPrimary.value) {
    showChooser.value = true;
  } else {
    openPicker(filePicker);
  }
}

/**
 * Open one source directly, skipping the chooser. The recipe reader uses these: its link
 * modal already presents the choice, so a second chooser on top would be one step too many.
 */
function pickCamera(): void {
  openPicker(cameraPicker);
}
function pickFile(): void {
  openPicker(filePicker);
}

function onChoose(id: string): void {
  showChooser.value = false;
  if (id === 'camera') return openPicker(cameraPicker);
  if (id === 'file') return openPicker(filePicker);
  console.error(`[AiDocumentPicker] unknown choice id "${id}" — nothing opened`);
}

defineExpose({ pick, pickCamera, pickFile });
</script>

<template>
  <!-- Chooser is touch-gated; the inputs render unconditionally so their refs stay live. -->
  <ChoiceModal
    :open="showChooser"
    :title="t('ai.picker.title')"
    :options="[
      { id: 'camera', icon: 'camera', label: t('ai.picker.takePhoto') },
      { id: 'file', icon: 'image', label: t('ai.picker.chooseFile') },
    ]"
    @select="onChoose"
    @close="showChooser = false"
  />
  <input
    :ref="(el) => (cameraPicker.inputRef.value = el as HTMLInputElement)"
    v-bind="cameraPicker.bindings"
  />
  <input
    :ref="(el) => (filePicker.inputRef.value = el as HTMLInputElement)"
    v-bind="filePicker.bindings"
  />
</template>
