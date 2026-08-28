<script setup lang="ts">
/**
 * Recovery & Backup (login rethink Phase 3): the recovery kit + the optional family
 * recovery passphrase. Orchestration lives in authStore (createRecoveryKit /
 * setRecoveryPassphrase); this card renders state and the one-time kit modal.
 *
 * The one-time kit modal itself is the shared `RecoveryKitDisplay` (Phase 4) — the
 * create wizard's mandatory kit step renders the same surface. Confirming it stored
 * also stamps the doc-side `recoveryKitConfirmedAt` signal the kit nag keys on.
 */
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { generatePassphrase } from '@/utils/passphraseStrength';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const settingsStore = useSettingsStore();

const statusMessage = ref<{ text: string; type: 'success' | 'error' } | null>(null);

// ── Kit state ────────────────────────────────────────────────────────────────
const kitCount = computed(() => Object.keys(syncStore.envelope?.recoveryKeys ?? {}).length);
const showKitModal = ref(false);
const kitCode = ref('');
const kitId = ref('');
const isGeneratingKit = ref(false);

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
    showKitModal.value = true;
  } finally {
    isGeneratingKit.value = false;
  }
}

async function handleKitStored() {
  // The one-time code leaves memory with the modal.
  showKitModal.value = false;
  kitCode.value = '';
  // Doc-side confirmation signal (Phase 4): the kit nag keys on this, and for
  // kit-born families it is the ONLY evidence anyone actually stored a code.
  await settingsStore.markRecoveryKitConfirmed();
  await syncStore.syncNowBounded();
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

    <RecoveryKitDisplay
      :open="showKitModal"
      :kit-id="kitId"
      :code="kitCode"
      @stored="handleKitStored"
    />
  </BaseCard>
</template>
