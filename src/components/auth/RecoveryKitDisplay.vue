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
import { generateInviteQR } from '@/utils/qrCode';
import { useSheetExport, ExportError } from '@/composables/useSheetExport';
import { shareOrDownloadFile } from '@/utils/shareOrDownloadFile';
import { kitDeepLink } from '@/services/auth/recoveryKit';
import { reportError } from '@/utils/errorReporter';

const props = defineProps<{
  open: boolean;
  /** Non-secret kit id printed on the card. */
  kitId: string;
  /** The one-time secret code — shown once, never persisted by this component. */
  code: string;
}>();

const emit = defineEmits<{
  /** The user explicitly confirmed the kit is stored. Host clears the code. */
  stored: [];
}>();

const { t } = useTranslation();
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
    await shareOrDownloadFile(
      pdf,
      `beanies-recovery-kit-${props.kitId}.pdf`,
      'application/pdf',
      t('recovery.kitModalTitle'),
      preferDownload ? { preferDownload: true } : undefined
    );
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
    <div ref="kitCardEl" class="rounded-2xl bg-white p-5 text-center dark:bg-slate-800">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-2 h-12 w-12"
      />
      <p class="font-outfit text-lg font-bold text-gray-900 dark:text-gray-100">
        {{ familyContextStore.activeFamilyName }}
      </p>
      <p class="mb-3 text-xs text-gray-500">{{ t('recovery.kitIdLabel') }}: {{ kitId }}</p>
      <img v-if="kitQr" :src="kitQr" alt="" class="mx-auto mb-3 h-40 w-40" />
      <p class="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {{ t('recovery.kitCodeLabel') }}
      </p>
      <div class="flex items-start gap-2 rounded-xl bg-gray-50 p-3 dark:bg-slate-700">
        <p
          class="font-outfit flex-1 text-base font-bold tracking-wider break-all text-gray-900 select-all dark:text-gray-100"
        >
          {{ code }}
        </p>
        <button
          type="button"
          class="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-slate-600 dark:hover:text-gray-200"
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
    </div>

    <p class="mt-4 rounded-xl bg-[#F15D22]/10 p-3 text-sm text-gray-700 dark:text-gray-300">
      {{ t('recovery.kitStoreWarning') }}
    </p>
    <p
      v-if="kitPdfError"
      role="alert"
      class="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
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
          {{ t('recovery.kitConfirmStored') }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
