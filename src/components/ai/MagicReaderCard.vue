<script setup lang="ts">
/**
 * "beanies can do magic" — the FAB quick-add sheet card.
 *
 * ONE button since #84. It used to carry three chips (📸 invite / ✈️ travel booking /
 * 🍳 recipe), each opening a different reader, which meant the user had to declare what their
 * photo or document WAS before beanies had looked at it. That is the AI's job — and picking
 * wrong produced a bad extraction rather than a helpful error. See `MagicBeansSheet`.
 *
 * Self-gating on `canReadAny`, exactly as before. That is permission-neutral by construction
 * rather than by flag state: `gate('recipe')` is ungated, so `canReadAny` reduces to
 * `canEditActivities` unconditionally — the two feature flags never entered into it.
 *
 * ⚠️ The `AiDocumentPicker` is mounted HERE, on the card, and not inside the sheet. On native,
 * the camera intent backgrounds the app; if the component holding the hidden input unmounts
 * while that is happening, the `change` callback lands on a dead input and the photo silently
 * vanishes. The card stays mounted while the magic drawer is open, so the ref stays live. If
 * this ever proves fragile on a real device, hoist the picker to the app shell beside
 * `AiProcessingOverlay` — do NOT paper over it with a retry.
 */
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMagicReader } from '@/composables/useMagicReader';
import { ingestInAppSource, logCaptureOpened } from '@/composables/useSharedDocumentIngest';
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import MagicBeansSheet from '@/components/ai/MagicBeansSheet.vue';
import BetaBadge from '@/components/ui/BetaBadge.vue';

const { t } = useTranslation();
const { canReadAny } = useMagicReader();

const sheetOpen = ref(false);

/**
 * The denominator for the whole in-app funnel — see `logCaptureOpened`. Fired at the TAP so
 * abandonment is measurable; every later event in the funnel is a fraction of this.
 */
function openSheet(): void {
  logCaptureOpened();
  sheetOpen.value = true;
}
const picker = ref<InstanceType<typeof AiDocumentPicker> | null>(null);

/**
 * Every path closes the sheet FIRST. See the sheet's header for the three separate things
 * that break otherwise — the overlay z-index collision, the body-scroll lock, and
 * `openQuickAdd()` refusing while an overlay is open, which leaves the FAB dead.
 *
 * The ingest is deliberately NOT awaited: it owns its own errors (`withIngestLock`'s catch
 * reports and toasts) and runs for several seconds behind the global reading overlay. Awaiting
 * here would add nothing and would keep this component's handler alive across a navigation.
 */
function handlePaste(text: string): void {
  sheetOpen.value = false;
  void ingestInAppSource({ kind: 'paste', text });
}

// The camera needs the image-only `capture` input, NOT the mixed accept: in a Capacitor
// WebView an `image/*,application/pdf` accept routes to the system documents picker, which
// has no camera entry at all. That is the whole reason `AiDocumentPicker` exposes two.
function handleCamera(): void {
  sheetOpen.value = false;
  picker.value?.pickCamera();
}

function handleFile(): void {
  sheetOpen.value = false;
  picker.value?.pickFile();
}

function handlePickedFile(file: File): void {
  void ingestInAppSource({ kind: 'file', file });
}
</script>

<template>
  <section
    v-if="canReadAny"
    class="magic-shimmer from-primary-500 to-terracotta-400 rounded-3xl bg-gradient-to-br p-4 text-white shadow-[0_12px_26px_-10px_rgba(241,93,34,0.65)]"
  >
    <h2 class="font-outfit flex items-center gap-2 text-base font-extrabold">
      <span aria-hidden="true">✨</span>
      <span>{{ t('ai.magic.title') }}</span>
      <BetaBadge tone="onAccent" class="ml-auto" />
    </h2>
    <p class="mt-1.5 text-xs leading-snug opacity-90">{{ t('ai.magic.subtitle') }}</p>

    <div class="relative z-[1] mt-3">
      <button
        type="button"
        class="font-outfit text-primary-600 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3 text-sm font-bold whitespace-nowrap shadow-[0_3px_8px_-3px_rgba(44,62,80,0.28)] transition-transform hover:scale-[1.02]"
        @click="openSheet"
      >
        <span aria-hidden="true">✨</span>
        <span class="truncate">{{ t('ai.magic.action') }}</span>
      </button>
    </div>

    <AiDocumentPicker ref="picker" @file="handlePickedFile" />
    <MagicBeansSheet
      :open="sheetOpen"
      @close="sheetOpen = false"
      @submit="handlePaste"
      @camera="handleCamera"
      @file="handleFile"
    />
  </section>
</template>
