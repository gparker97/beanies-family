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
import { attachmentKind } from '@/utils/attachmentKind';
import { pdfToPageImages } from '@/utils/pdfRender';
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

// Inline PDF pages rendered via pdf.js (mobile/PWA webviews show a dead native
// fallback for an <iframe> PDF, so we rasterize the pages ourselves). Object URLs,
// revoked on navigation / close / unmount. When no pages render (fetch or render
// failure), the template falls back to the open/download actions.
const pdfPages = ref<string[]>([]);
const pdfTruncated = ref(false);

function cleanupPdfPages(): void {
  for (const url of pdfPages.value) URL.revokeObjectURL(url);
  pdfPages.value = [];
  pdfTruncated.value = false;
}

const currentPhotoId = computed(() => props.photoIds[currentIndex.value] ?? null);
const currentPhoto = computed(() =>
  currentPhotoId.value ? store.photos[currentPhotoId.value] : undefined
);
const isPdfDoc = computed(
  () => !!currentPhoto.value && attachmentKind(currentPhoto.value) === 'pdf'
);
const docFileName = computed(() => currentPhoto.value?.fileName);
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
    } else {
      cleanupPdfPages();
    }
  }
);

watch(currentPhotoId, () => {
  if (props.open) resolve();
});

function resolve(): void {
  cleanupPdfPages();
  if (!currentPhotoId.value) {
    fullUrl.value = null;
    loading.value = false;
    return;
  }
  if (isPdfDoc.value) {
    // PDFs need real bytes — the lh3 image CDN (getPublicUrl) can't serve them.
    // getBlobUrl does an authorized alt=media download → a same-origin object URL
    // (backs the download + open-in-new-tab links). We then read those bytes back
    // and rasterize every page with pdf.js so the document renders inline on every
    // platform — an <iframe> PDF dies in mobile/PWA webviews. The store caches the
    // blob URL per driveFileId (revoked centrally), so we don't revoke it here; the
    // per-page object URLs we DO own and revoke (cleanupPdfPages).
    const id = currentPhotoId.value;
    loading.value = true;
    fullUrl.value = null;
    void store
      .getBlobUrl(id)
      .then(async (url) => {
        if (currentPhotoId.value !== id) return; // navigated away mid-fetch
        fullUrl.value = url; // null → getBlobUrl marked it unresolved → missing state
        if (!url) {
          loading.value = false;
          return;
        }
        try {
          const bytes = await (await fetch(url)).arrayBuffer();
          if (currentPhotoId.value !== id) return;
          const { urls, truncated } = await pdfToPageImages(bytes);
          if (currentPhotoId.value !== id) {
            for (const u of urls) URL.revokeObjectURL(u);
            return;
          }
          pdfPages.value = urls;
          pdfTruncated.value = truncated;
        } catch (e) {
          if (currentPhotoId.value !== id) return;
          console.warn('[PhotoViewer] PDF render failed — falling back to open/download', id, e);
        } finally {
          if (currentPhotoId.value === id) loading.value = false;
        }
      })
      .catch((e) => {
        if (currentPhotoId.value !== id) return;
        console.warn('[PhotoViewer] PDF fetch failed', id, e);
        loading.value = false;
      });
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
  } else if (e.key === 'Escape') {
    // The floating X was the ONLY way out of this viewer — no backdrop close, and neither
    // this component nor BaseModal handled Escape. That is an accessibility problem on its
    // own (a modal must be dismissable from the keyboard), and it is what made the
    // safe-area bug above so painful: with the X sitting under the status bar on native,
    // there was no second way out at all.
    e.preventDefault();
    emit('close');
  }
}

onMounted(() => document.addEventListener('keydown', handleKeydown));
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  cleanupPdfPages();
});

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
    flush-body
    layer="overlay"
    @close="emit('close')"
  >
    <!--
      Slight warm shift on the dim layer (rgb(20 15 15 / 0.96) instead of
      pure black/95). Imperceptible to the casual viewer, but stops the
      modal from feeling clinical against the warm Heritage Orange / Cloud
      White palette in the rest of the app. The photo still reads as the
      hero; the chrome should not compete.
    -->
    <div
      class="relative flex h-full min-h-[60vh] items-center justify-center"
      style="background: rgb(20 15 15 / 96%)"
    >
      <!--
        Floating close button. BaseModal is mounted without a title or
        header slot here — that suppresses its built-in X entirely so
        the chrome stays clean against the photo. Position info is
        carried by the pip dots at the bottom + the sr-only aria-live
        announcement, not a header. Slight scale-up on hover gives a
        tactile cue without introducing brand color (which would
        compete with the photo).
      -->
      <!--
        The top offset carries the SAFE-AREA INSET, not a bare `top-4`.

        On native the WebView deliberately draws under a transparent status bar
        (`setDecorFitsSystemWindows(false)` in MainActivity, ADR-029), so 16px from the top of
        the viewport puts this button behind the system clock — visible, but the OS takes the
        taps. Reported from a device: the only way out of a photo was the back gesture.
        `env(safe-area-inset-top)` is 0 on the web, so the web position is unchanged.
      -->
      <button
        type="button"
        class="absolute right-4 z-10 rounded-full bg-black/55 p-2.5 text-white shadow-lg backdrop-blur-sm transition-all duration-150 hover:scale-110 hover:bg-black/75 active:scale-95"
        style="top: calc(env(safe-area-inset-top, 0px) + 1rem)"
        :aria-label="t('photos.close')"
        @click="emit('close')"
      >
        <BeanieIcon name="close" size="md" />
      </button>

      <!-- Prev / next chevrons — same restraint as close. -->
      <button
        v-if="canGoPrev"
        type="button"
        class="absolute top-1/2 left-3 z-10 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white shadow-lg backdrop-blur-sm transition-all duration-150 hover:scale-110 hover:bg-black/70 active:scale-95"
        :aria-label="t('photos.previous')"
        @click="goPrev"
      >
        <BeanieIcon name="chevron-left" size="md" />
      </button>
      <button
        v-if="canGoNext"
        type="button"
        class="absolute top-1/2 right-3 z-10 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white shadow-lg backdrop-blur-sm transition-all duration-150 hover:scale-110 hover:bg-black/70 active:scale-95"
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

      <!--
        PDF — rasterized inline via pdf.js (every page), because mobile/PWA
        webviews show a dead native fallback for an <iframe> PDF. Spinner while
        rendering; the pages scroll; an always-works "Open in new tab" action
        (and the footer Download) hand off to an external viewer. If pdf.js can't
        render it, fall back to those actions with a note.
      -->
      <!--
        `absolute inset-0` (not h-full) so the stacked pages scroll WITHIN the
        body instead of growing the flex-1 body past the modal's max-height,
        which would clip the footer (delete/download) off the bottom — the
        height-constrained <img> branch below doesn't hit this, tall PDF pages do.
      -->
      <div
        v-else-if="isPdfDoc"
        class="absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto px-4 py-6"
      >
        <div v-if="loading" class="flex flex-1 flex-col items-center justify-center text-white/80">
          <BeanieSpinner size="md" />
        </div>
        <template v-else-if="pdfPages.length">
          <img
            v-for="(pageUrl, i) in pdfPages"
            :key="i"
            :src="pageUrl"
            alt=""
            class="w-full max-w-3xl rounded-xl bg-white shadow-lg"
          />
          <p v-if="pdfTruncated" class="text-xs text-white/55">
            {{ t('photos.pdf.truncated') }}
          </p>
          <a
            v-if="fullUrl"
            :href="fullUrl"
            target="_blank"
            rel="noopener"
            class="font-outfit from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 mt-1 inline-flex items-center gap-2 rounded-[16px] bg-gradient-to-r px-5 py-3 text-sm font-bold text-white no-underline shadow-sm transition-all duration-200 hover:shadow-md"
          >
            ↗ {{ t('photos.openInNewTab') }}
          </a>
        </template>
        <!-- Render failed (or no bytes) → the open/download actions still work. -->
        <div v-else class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span class="text-5xl" aria-hidden="true">📄</span>
          <p class="max-w-xs text-sm text-white/70">{{ t('photos.pdf.previewFailed') }}</p>
          <a
            v-if="fullUrl"
            :href="fullUrl"
            target="_blank"
            rel="noopener"
            class="font-outfit from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 inline-flex items-center gap-2 rounded-[16px] bg-gradient-to-r px-5 py-3 text-sm font-bold text-white no-underline shadow-sm transition-all duration-200 hover:shadow-md"
          >
            ↗ {{ t('photos.openInNewTab') }}
          </a>
        </div>
      </div>

      <!-- Loading (images) -->
      <div v-else-if="loading && !fullUrl" class="flex flex-col items-center gap-2 text-white/80">
        <BeanieSpinner size="md" />
      </div>

      <!--
        Image — fills the body container (edge-to-edge on mobile via
        BaseModal's flush-body). `object-contain` preserves aspect ratio;
        max-h/max-w-full keeps it within the frame without overflow.
        The drop-shadow gives the photo a subtle float against the
        backdrop — same trick as a polaroid against a dark surface.
      -->
      <!--
        `referrerpolicy="no-referrer"` strips the Referer so Google's
        lh3 CDN rate-limits by IP rather than per-origin (see
        BeanieAvatar.vue for the full rationale — caught 2026-05-04
        with localhost:5173 hitting 429s on a shared per-Referer
        bucket).
      -->
      <img
        v-else-if="fullUrl"
        :src="fullUrl"
        :alt="''"
        class="max-h-full max-w-full object-contain"
        style="filter: drop-shadow(0 25px 50px rgb(0 0 0 / 60%))"
        referrerpolicy="no-referrer"
        @load="handleImgLoaded"
        @error="handleImgError"
      />

      <!--
        Position pip indicator — visible only when there's more than one
        photo. Replaces the small "1 of 3" text in the footer with a
        centered row of dots, current dot in Heritage Orange. Visual
        rather than verbal; reads at-a-glance without taking eye-time
        away from the image. Aria-live announces position change for
        screen readers, since the dots themselves are decorative.
      -->
      <div
        v-if="photoIds.length > 1"
        class="absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-2 backdrop-blur-sm"
        style="bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem)"
        aria-hidden="true"
      >
        <span
          v-for="(_id, i) in photoIds"
          :key="i"
          class="block h-1.5 rounded-full transition-all duration-200"
          :class="i === currentIndex ? 'bg-primary-500 w-5' : 'w-1.5 bg-white/55 hover:bg-white/80'"
        />
      </div>
      <span class="sr-only" aria-live="polite">{{ positionLabel }}</span>
    </div>

    <template v-if="!readOnly" #footer>
      <!--
        Footer mirrors BeanieFormModal's convention:
          - Leftmost: destructive 🗑️ icon-only button (red-tinted square).
          - Adjacent: secondary utility actions as icon-only buttons (here:
            📥 Download, hidden in the missing-photo state).
          - Rightmost: flex-1 gradient-orange primary with a clear label
            ("Close" normally; "Replace photo" when the file is missing).
        Position info ("1 of 3") is already rendered as pip dots inside
        the photo area, so the footer dropped the redundant text label.
      -->
      <div class="flex items-center gap-3">
        <!-- Destructive: trash icon, same shape as BeanieFormModal's delete. -->
        <button
          type="button"
          :aria-label="t('photos.remove')"
          class="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-[14px] text-xl transition-all duration-150 hover:scale-105"
          style="background: rgb(239 68 68 / 8%)"
          @click="isMissing ? handleRemoveMissing() : handleDelete()"
        >
          🗑️
        </button>

        <!-- Utility: download. Hidden in the missing-photo state because
             there's no file to download. Slate-tinted bg differentiates
             "safe utility" from the destructive trash. -->
        <a
          v-if="!isMissing && fullUrl"
          :href="fullUrl"
          :download="docFileName || ''"
          :aria-label="t('photos.download')"
          class="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-[14px] text-xl no-underline transition-all duration-150 hover:scale-105"
          style="background: rgb(44 62 80 / 6%)"
        >
          📥
        </a>

        <!-- Primary: Close (or Replace photo when the file is missing).
             Mirrors BeanieFormModal's flex-1 gradient-orange Save button. -->
        <!-- Replace is image-only: replacePhotoFile compresses, which would
             corrupt a PDF. For a missing PDF we fall through to Close. -->
        <button
          v-if="isMissing && !isPdfDoc"
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 flex-1 rounded-[16px] bg-gradient-to-r py-3.5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:shadow-md"
          @click="replacePicker.open"
        >
          {{ t('photos.replace') }}
        </button>
        <button
          v-else
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 flex-1 rounded-[16px] bg-gradient-to-r py-3.5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:shadow-md"
          @click="emit('close')"
        >
          {{ t('action.close') }}
        </button>
      </div>
      <!-- Hidden input backing the Replace action. -->
      <input
        :ref="(el) => (replacePicker.inputRef.value = el as HTMLInputElement)"
        v-bind="replacePicker.bindings"
      />
    </template>
  </BaseModal>
</template>
