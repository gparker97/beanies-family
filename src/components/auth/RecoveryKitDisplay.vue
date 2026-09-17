<script setup lang="ts">
/**
 * The ONE-TIME recovery-kit display modal (login rethink Phase 4) — extracted
 * verbatim from RecoverySettings so the create wizard's mandatory kit step and the
 * Settings regenerate flow render the SAME surface (DRY: one kit surface, two hosts).
 *
 * Contract: not closable except via the explicit "I stored my kit" confirmation
 * (emits `stored`; the HOST clears the code from its state — the code never
 * outlives the modal). Delivery reuses the export stack end-to-end: printable card
 * element → exportElementToPng → pngBlobToPdf → shareOrDownloadFile. A PDF failure
 * NEVER blocks confirmation — the on-screen code is the source of truth.
 */
import { ref, watch } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { useClipboard } from '@/composables/useClipboard';
import { generateInviteQR } from '@/utils/qrCode';
import { useSheetExport, ExportError, prewarmSheetExport } from '@/composables/useSheetExport';
import { deliverFile } from '@/utils/deliverFile';
import { kitDeepLink } from '@/services/auth/recoveryKit';
import { reportError } from '@/utils/errorReporter';

const props = defineProps<{
  open: boolean;
  /** Non-secret kit id printed on the card. */
  kitId: string;
  /** The one-time secret code — shown once, never persisted by this component. */
  code: string;
  /**
   * The member's magic link, when this is the CREATION step (Requirement 10: kit and
   * link on ONE screen, one confirm).
   *
   * ⚠️ Rendered INSIDE `kitCardEl`, deliberately. That element is what the PDF/share
   * stack exports, so both artefacts land in the one saved file — which is what "save
   * these two things" should actually mean. Putting the link beside the card instead
   * would have needed its own export path for no gain.
   *
   * Absent on the Settings regenerate flow, where there is no link to show.
   */
  magicLink?: string;
  /**
   * Set when the creation step TRIED to mint a link and could not (offline, publish
   * refused). The step degrades to kit-only and says so — it never blocks. See below.
   */
  magicLinkErrorKey?: string;
}>();

const emit = defineEmits<{
  /** The user explicitly confirmed the kit is stored. Host clears the code. */
  stored: [];
}>();

const { t } = useTranslation();
// Its own instance so a magic-link copy failure dedupes separately from the kit code's.
const {
  copied: magicLinkCopied,
  error: magicLinkCopyError,
  copy: copyMagicLink,
} = useClipboard({ surface: 'login-flow' });
const familyContextStore = useFamilyContextStore();
const { exportElementToPng, pngBlobToPdf } = useSheetExport();

const kitQr = ref('');
const kitCopied = ref(false);
const kitPdfError = ref(false);
const isExportingPdf = ref(false);
const kitCardEl = ref<HTMLElement | null>(null);

watch(
  () => [props.open, props.code] as const,
  async ([open, code]) => {
    kitCopied.value = false;
    kitPdfError.value = false;
    if (!open || !code) {
      kitQr.value = '';
      return;
    }
    // ⚠️ Warm the export CHUNKS, not the font CSS — this comment used to claim both, after
    // the font prewarm was deliberately removed from `prewarmSheetExport` for competing with
    // pod setup for the network during family creation. The chunks are a different trade: they
    // are needed for `navigator.share({files})` to survive iOS WebKit's transient user
    // activation, which a cold dynamic-import at tap time loses.
    //
    // Deliberately kept despite the same critical-path concern: this is fire-and-forget, the
    // alternative is a Share button that silently does nothing on iOS, and the kit is the one
    // artefact that gets a person back into their pod.
    prewarmSheetExport();
    try {
      // The QR is a DEEP LINK: a phone camera pointed at the printed kit opens the
      // app straight into recovery with the code pre-filled (code rides the fragment).
      kitQr.value = await generateInviteQR(kitDeepLink(code));
    } catch {
      kitQr.value = ''; // QR is an extra — the code is the credential
    }
  },
  { immediate: true }
);

async function handleCopyKitCode() {
  try {
    await navigator.clipboard.writeText(props.code);
    kitCopied.value = true;
    setTimeout(() => (kitCopied.value = false), 2000);
  } catch (e) {
    reportError({
      surface: 'login-flow',
      message: 'kit code copy failed',
      error: e,
      severity: 'warning',
      context: { action: 'kit_copy_failed' },
    });
  }
}

async function exportKitPdf(preferDownload: boolean) {
  if (!kitCardEl.value || isExportingPdf.value) return;
  kitPdfError.value = false;
  isExportingPdf.value = true;
  try {
    const png = await exportElementToPng(kitCardEl.value);
    const pdf = await pngBlobToPdf(png);
    // preferDownload: "Save as PDF" means SAVE — on share-capable desktops the OS
    // sheet offered no plain save-to-disk (greg's local-test find).
    // The result MUST be inspected: `shareOrDownloadFile` RETURNS a failure
    // rather than throwing, so discarding it (as this did) meant the error
    // banner never rendered and the user was invited to press "I've stored it"
    // for a kit that was never saved. `errorUi: 'caller'` because the banner
    // below is this component's own visible error.
    const result = await deliverFile({
      blob: pdf,
      filename: `beanies-recovery-kit-${props.kitId}.pdf`,
      mimeType: 'application/pdf',
      title: t('recovery.kitModalTitle'),
      kind: 'recovery-kit-pdf',
      preferDownload,
      errorUi: 'caller',
    });
    // A cancel must LEAVE the banner as it is, not clear it. Assigning the
    // comparison cleared a banner raised by a previous failed attempt, and on
    // native `preferDownload` is ignored (the sheet is the only way out), so
    // dismissing the sheet looked exactly like a fix: the user then pressed
    // "I've stored my kit" and the host burned the one-time code for a kit that
    // was never saved. Only a real outcome moves the flag.
    if (result.delivered) kitPdfError.value = false;
    else if (result.outcome === 'failed') kitPdfError.value = true;
  } catch (e) {
    kitPdfError.value = true;
    reportError({
      surface: 'login-flow',
      message: `kit PDF ${preferDownload ? 'export' : 'share'} failed${
        e instanceof ExportError ? ` at ${e.stage}` : ''
      }`,
      error: e,
      severity: 'warning',
      context: { action: preferDownload ? 'kit_pdf_failed' : 'kit_share_failed' },
    });
  } finally {
    isExportingPdf.value = false;
  }
}
</script>

<template>
  <!-- One-time kit modal: not closable except via the explicit stored confirmation -->
  <BaseModal :open="open" :title="t('recovery.kitModalTitle')" size="md" :closable="false">
    <!-- ⚠️ ABOVE the card, not below it. This explains what the kit IS, and it used to sit
         underneath as a footnote — which put "save this now" ahead of "here is what this
         is" on the one screen where someone has to decide how carefully to treat an
         artefact they have never seen before. -->
    <p class="dark:text-ink-soft mb-4 rounded-xl bg-[#F15D22]/10 p-3 text-sm text-gray-700">
      {{ t('recovery.kitStoreWarning') }}
    </p>

    <div ref="kitCardEl" class="dark:bg-surface-raised rounded-2xl bg-white p-5 text-center">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-2 h-12 w-12"
      />
      <p class="font-outfit dark:text-ink text-lg font-bold text-gray-900">
        {{ familyContextStore.activeFamilyName }}
      </p>
      <p class="mb-3 text-xs text-gray-500">{{ t('recovery.kitIdLabel') }}: {{ kitId }}</p>
      <img v-if="kitQr" :src="kitQr" alt="" class="mx-auto mb-3 h-40 w-40" />
      <p class="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {{ t('recovery.kitCodeLabel') }}
      </p>
      <div class="dark:bg-surface-overlay flex items-start gap-2 rounded-xl bg-gray-50 p-3">
        <p
          class="font-outfit dark:text-ink flex-1 text-base font-bold tracking-wider break-all text-gray-900 select-all"
        >
          {{ code }}
        </p>
        <button
          type="button"
          class="dark:hover:bg-surface-hover dark:hover:text-ink shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
          :title="kitCopied ? t('recovery.kitCopied') : t('recovery.kitCopyCode')"
          :aria-label="t('recovery.kitCopyCode')"
          @click="handleCopyKitCode"
        >
          <svg
            v-if="!kitCopied"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          <svg
            v-else
            class="h-4 w-4 text-green-500"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>

      <!-- CREATION STEP ONLY. Inside `kitCardEl` so the saved PDF carries BOTH artefacts.
           Each states its own lifetime, because they do not share one: the kit is
           permanent, the link lasts 7 days, and a single heading over both would flatten
           exactly the distinction that decides how carefully each is stored. -->
      <template v-if="magicLink || magicLinkErrorKey">
        <hr class="dark:border-line my-4 border-gray-200" />
        <p class="font-outfit dark:text-ink text-left text-sm font-bold text-gray-900">
          {{ t('magicLink.title') }}
        </p>
        <template v-if="magicLink">
          <!-- Emphasised deliberately: at `text-xs text-gray-600` this read as a footnote
               under the kit, and it is the line that tells someone the link is the
               temporary artefact of the two on this screen. -->
          <p class="dark:text-ink mt-1 text-left text-sm font-semibold text-gray-900">
            {{ t('magicLink.creationLead') }}
          </p>
          <div
            class="dark:bg-surface-overlay mt-2 flex items-start gap-2 rounded-xl bg-gray-50 p-2.5"
          >
            <p
              class="dark:text-ink-soft flex-1 text-left font-mono text-xs break-all text-gray-600 select-all"
            >
              {{ magicLink }}
            </p>
            <!-- ⚠️ A BUTTON, not just `select-all`. Copying is the save action here, and
                 tap-to-select then long-press on a wrapped monospace URL is not one.
                 `useClipboard` surfaces and reports a failed copy, which a selection
                 cannot. Excluded from the PDF export — a printed page has no clipboard. -->
            <!-- ⚠️ `outline`, NOT `secondary`. `secondary` paints `dark:bg-surface-overlay`,
                 which is exactly this container's own background — in dark mode the button
                 vanished into the box and read as bare text while the footer buttons kept
                 their chrome. An outline's affordance is its border, so it stays a button
                 whatever surface it lands on. -->
            <BaseButton
              variant="outline"
              size="sm"
              type="button"
              data-testid="copy-magic-link"
              data-export-hide
              @click="copyMagicLink(magicLink)"
            >
              {{ magicLinkCopied ? t('login.copied') : t('login.copyLink') }}
            </BaseButton>
          </div>
          <p
            v-if="magicLinkCopyError"
            role="alert"
            class="dark:text-danger-lift mt-1 text-left text-xs text-red-600"
          >
            {{ t('share.copyFailedHelp') }}
          </p>
        </template>
        <!-- ⚠️ DEGRADED, NEVER BLOCKING. This step is an unclosable modal at the end of a
             create flow that already loses 47% of its starters; a network dependency that
             can wedge the final screen is not an acceptable trade for a convenience
             credential. The kit above is the guaranteed artefact, the confirm button
             stays enabled, and the person is told where to get a link later. -->
        <p v-else class="dark:text-ink-soft mt-1 text-left text-xs text-gray-600">
          {{ t('magicLink.mintFailed') }}
        </p>
      </template>
    </div>

    <p
      v-if="kitPdfError"
      role="alert"
      class="dark:text-danger-lift mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20"
    >
      {{ t('recovery.kitPdfFailed') }}
    </p>

    <template #footer>
      <div class="flex w-full flex-col gap-3">
        <div class="grid grid-cols-2 gap-3">
          <BaseButton
            variant="secondary"
            type="button"
            :disabled="isExportingPdf"
            @click="exportKitPdf(true)"
          >
            {{ t('recovery.kitDownloadPdf') }}
          </BaseButton>
          <BaseButton
            variant="secondary"
            type="button"
            :disabled="isExportingPdf"
            @click="exportKitPdf(false)"
          >
            {{ t('recovery.kitShare') }}
          </BaseButton>
        </div>
        <BaseButton class="w-full" type="button" @click="emit('stored')">
          {{ magicLink ? t('setup.saveBothConfirm') : t('recovery.kitConfirmStored') }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
