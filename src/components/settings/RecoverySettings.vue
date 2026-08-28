<script setup lang="ts">
/**
 * Recovery & Backup (login rethink Phase 3): the recovery kit + the optional family
 * recovery passphrase. Orchestration lives in authStore (createRecoveryKit /
 * setRecoveryPassphrase); this card renders state and the one-time kit modal.
 *
 * Kit modal delivery reuses the export stack end-to-end: the printable card element →
 * exportElementToPng → pngBlobToPdf → shareOrDownloadFile. A PDF failure NEVER blocks
 * kit confirmation — the on-screen code is the source of truth and can be transcribed.
 */
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { generateInviteQR } from '@/utils/qrCode';
import { useSheetExport, ExportError } from '@/composables/useSheetExport';
import { shareOrDownloadFile } from '@/utils/shareOrDownloadFile';
import { generatePassphrase } from '@/utils/passphraseStrength';
import { kitDeepLink } from '@/services/auth/recoveryKit';
import { reportError } from '@/utils/errorReporter';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();
const { exportElementToPng, pngBlobToPdf } = useSheetExport();

const statusMessage = ref<{ text: string; type: 'success' | 'error' } | null>(null);

// ── Kit state ────────────────────────────────────────────────────────────────
const kitCount = computed(() => Object.keys(syncStore.envelope?.recoveryKeys ?? {}).length);
const showKitModal = ref(false);
const kitCode = ref('');
const kitId = ref('');
const kitQr = ref('');
const isGeneratingKit = ref(false);
const kitCopied = ref(false);
const kitPdfError = ref(false);
const isExportingPdf = ref(false);
const kitCardEl = ref<HTMLElement | null>(null);

async function handleGenerateKit() {
  statusMessage.value = null;
  isGeneratingKit.value = true;
  try {
    const result = await authStore.createRecoveryKit();
    if (!result.success) {
      statusMessage.value = { text: result.error, type: 'error' };
      return;
    }
    kitCode.value = result.code;
    kitId.value = result.kitId;
    kitCopied.value = false;
    kitPdfError.value = false;
    try {
      // The QR is a DEEP LINK: a phone camera pointed at the printed kit opens the app
      // straight into recovery with the code pre-filled (the code rides the fragment).
      kitQr.value = await generateInviteQR(kitDeepLink(result.code));
    } catch {
      kitQr.value = ''; // QR is an extra — the code is the credential
    }
    showKitModal.value = true;
  } finally {
    isGeneratingKit.value = false;
  }
}

async function handleCopyKitCode() {
  try {
    await navigator.clipboard.writeText(kitCode.value);
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

/** Share the kit PDF via the OS sheet (WhatsApp, Drive, …) where available. */
async function handleShareKitPdf() {
  if (!kitCardEl.value || isExportingPdf.value) return;
  kitPdfError.value = false;
  isExportingPdf.value = true;
  try {
    const png = await exportElementToPng(kitCardEl.value);
    const pdf = await pngBlobToPdf(png);
    await shareOrDownloadFile(
      pdf,
      `beanies-recovery-kit-${kitId.value}.pdf`,
      'application/pdf',
      t('recovery.kitModalTitle')
    );
  } catch (e) {
    kitPdfError.value = true;
    reportError({
      surface: 'login-flow',
      message: `kit PDF share failed${e instanceof ExportError ? ` at ${e.stage}` : ''}`,
      error: e,
      severity: 'warning',
      context: { action: 'kit_share_failed' },
    });
  } finally {
    isExportingPdf.value = false;
  }
}

async function handleDownloadKitPdf() {
  if (!kitCardEl.value || isExportingPdf.value) return;
  kitPdfError.value = false;
  isExportingPdf.value = true;
  try {
    const png = await exportElementToPng(kitCardEl.value);
    const pdf = await pngBlobToPdf(png);
    // preferDownload: "Save as PDF" means SAVE — on share-capable desktops the OS sheet
    // offered no plain save-to-disk (greg's local-test find).
    await shareOrDownloadFile(
      pdf,
      `beanies-recovery-kit-${kitId.value}.pdf`,
      'application/pdf',
      t('recovery.kitModalTitle'),
      { preferDownload: true }
    );
  } catch (e) {
    kitPdfError.value = true;
    reportError({
      surface: 'login-flow',
      message: `kit PDF export failed${e instanceof ExportError ? ` at ${e.stage}` : ''}`,
      error: e,
      severity: 'warning',
      context: { action: 'kit_pdf_failed' },
    });
  } finally {
    isExportingPdf.value = false;
  }
}

function handleKitStored() {
  // The one-time code leaves memory with the modal.
  showKitModal.value = false;
  kitCode.value = '';
  kitQr.value = '';
}

// ── Passphrase state ─────────────────────────────────────────────────────────
const hasPassphrase = computed(() => !!syncStore.envelope?.recoveryPassphrase);
const isEditingPassphrase = ref(false);
const suggested = ref('');
const useOwn = ref(false);
const ownPhrase = ref('');
const isSavingPassphrase = ref(false);

function startPassphrase() {
  statusMessage.value = null;
  suggested.value = generatePassphrase();
  useOwn.value = false;
  ownPhrase.value = '';
  isEditingPassphrase.value = true;
}

async function handleSavePassphrase() {
  statusMessage.value = null;
  const phrase = useOwn.value ? ownPhrase.value : suggested.value;
  isSavingPassphrase.value = true;
  try {
    const result = await authStore.setRecoveryPassphrase(phrase);
    if (result.success) {
      statusMessage.value = { text: t('recovery.passphraseSaved'), type: 'success' };
      isEditingPassphrase.value = false;
    } else {
      statusMessage.value = { text: result.error ?? t('auth.signInFailed'), type: 'error' };
    }
  } finally {
    isSavingPassphrase.value = false;
  }
}
</script>

<template>
  <BaseCard :title="t('recovery.sectionTitle')">
    <div
      v-if="statusMessage"
      role="alert"
      class="mb-4 rounded-xl p-3 text-sm"
      :class="
        statusMessage.type === 'success'
          ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
          : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
      "
    >
      {{ statusMessage.text }}
    </div>

    <!-- Recovery kit -->
    <div class="mb-6">
      <h4 class="font-outfit mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
        {{ t('recovery.kitTitle') }}
      </h4>
      <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
        {{ t('recovery.kitDescription') }}
      </p>
      <p class="mb-3 text-xs" :class="kitCount === 0 ? 'text-[#F15D22]' : 'text-gray-500'">
        {{
          kitCount === 0
            ? t('recovery.kitNone')
            : fillTemplate(t('recovery.kitCount'), { count: String(kitCount) })
        }}
      </p>
      <BaseButton variant="secondary" :loading="isGeneratingKit" @click="handleGenerateKit">
        {{ kitCount === 0 ? t('recovery.kitGenerate') : t('recovery.kitRegenerate') }}
      </BaseButton>
    </div>

    <!-- Recovery passphrase -->
    <div>
      <h4 class="font-outfit mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
        {{ t('recovery.passphraseTitle') }}
      </h4>
      <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
        {{ t('recovery.passphraseDescription') }}
      </p>
      <p class="mb-3 text-xs text-gray-500">
        {{ hasPassphrase ? t('recovery.passphraseIsSet') : t('recovery.passphraseNotSet') }}
      </p>

      <BaseButton v-if="!isEditingPassphrase" variant="secondary" @click="startPassphrase">
        {{ hasPassphrase ? t('recovery.passphraseChange') : t('recovery.passphraseSet') }}
      </BaseButton>

      <div v-else class="space-y-3">
        <template v-if="!useOwn">
          <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('recovery.passphraseSuggestion') }}
          </p>
          <p
            class="font-outfit rounded-xl bg-gray-50 p-3 text-center text-lg font-bold tracking-wide text-gray-900 select-all dark:bg-slate-700 dark:text-gray-100"
          >
            {{ suggested }}
          </p>
          <div class="flex gap-3">
            <BaseButton variant="secondary" type="button" @click="suggested = generatePassphrase()">
              {{ t('recovery.passphraseRegenerate') }}
            </BaseButton>
            <BaseButton variant="secondary" type="button" @click="useOwn = true">
              {{ t('recovery.passphraseUseOwn') }}
            </BaseButton>
          </div>
        </template>
        <template v-else>
          <BaseInput
            v-model="ownPhrase"
            :label="t('recovery.passphraseTitle')"
            type="text"
            autocomplete="off"
          />
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {{ t('recovery.passphraseRules') }}
          </p>
        </template>
        <div class="flex gap-3">
          <BaseButton :disabled="isSavingPassphrase" @click="handleSavePassphrase">
            {{ isSavingPassphrase ? t('common.saving') : t('action.save') }}
          </BaseButton>
          <BaseButton
            variant="ghost"
            type="button"
            :disabled="isSavingPassphrase"
            @click="isEditingPassphrase = false"
          >
            {{ t('action.cancel') }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- One-time kit modal: not closable except via the explicit stored confirmation -->
    <BaseModal
      :open="showKitModal"
      :title="t('recovery.kitModalTitle')"
      size="md"
      :closable="false"
    >
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
            {{ kitCode }}
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
              @click="handleDownloadKitPdf"
            >
              {{ t('recovery.kitDownloadPdf') }}
            </BaseButton>
            <BaseButton
              variant="secondary"
              type="button"
              :disabled="isExportingPdf"
              @click="handleShareKitPdf"
            >
              {{ t('recovery.kitShare') }}
            </BaseButton>
          </div>
          <BaseButton class="w-full" type="button" @click="handleKitStored">
            {{ t('recovery.kitConfirmStored') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </BaseCard>
</template>
