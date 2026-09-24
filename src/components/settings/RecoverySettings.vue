<script setup lang="ts">
/**
 * Recovery & Backup (login rethink Phase 3): the recovery kit + the optional family
 * recovery passphrase. Orchestration lives in authStore (createRecoveryKit /
 * setRecoveryPassphrase); this card renders state and the one-time kit modal.
 *
 * The one-time kit modal itself is the shared `RecoveryKitDisplay` (Phase 4) — the
 * create wizard's mandatory kit step renders the same surface. Generate → show →
 * confirm-stored is the shared `useRecoveryKitFlow` (also the kit nag and the sign-out
 * kit guard); confirming stamps the doc-side `recoveryKitConfirmedAt` / `Via` signals.
 */
import { ref, computed, nextTick, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import RecoveryKitDisplay from '@/components/auth/RecoveryKitDisplay.vue';
import RecoveryKitsModal from '@/components/settings/RecoveryKitsModal.vue';
import SettingsAdminOnlyNotice from '@/components/settings/SettingsAdminOnlyNotice.vue';
import { useRecoveryKitFlow } from '@/composables/useRecoveryKitFlow';
import {
  approveReplace,
  invalidateKit,
  toastKitInvalidateOutcome,
} from '@/composables/useRecoveryKitActions';
import { usePermissions } from '@/composables/usePermissions';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDate } from '@/utils/date';
import { generatePassphrase } from '@/utils/passphraseStrength';
import { emitKitInvalidateOutcome } from '@/services/telemetry/loginFlowEvents';
import type { RecoveryKitSummary } from '@/services/auth/recoveryKit';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const { canManagePod } = usePermissions();

const statusMessage = ref<{ text: string; type: 'success' | 'error' } | null>(null);

// ── Kit state ────────────────────────────────────────────────────────────────
const kitFlow = useRecoveryKitFlow();
const showKits = ref(false);
/** A kit action is in flight; the list disables its actions meanwhile (see the modal). */
const kitActionBusy = ref(false);
const kitSummary = computed(() => {
  const kits = syncStore.recoveryKits;
  const live = syncStore.liveRecoveryKitCount;
  const newest = kits.find(
    (k): k is Extract<RecoveryKitSummary, { status: 'live' }> => k.status === 'live'
  );
  return fillTemplate(t('recovery.kitSummary'), {
    live: String(live),
    invalidated: String(kits.length - live),
    newest: newest ? formatDate(newest.createdAt) : '',
  });
});

/**
 * The kit being replaced (#99), set only between an approved Replace and the new kit's
 * stored confirmation. This host owns it rather than the shared flow: the kit nag and the
 * sign-out guard use the same flow and never replace anything.
 */
const replacingKitId = ref<string | null>(null);

/** Mint a kit through the shared flow. No confirm here: callers decide (see below). */
async function mintKit() {
  statusMessage.value = null;
  // The list and the kit modal are both base-layer modals; close the list first.
  showKits.value = false;
  await kitFlow.generate();
  if (kitFlow.error.value) statusMessage.value = { text: kitFlow.error.value, type: 'error' };
}

/**
 * Create a New Kit from the drawer or the Manage Kits footer: a moment to reconsider
 * before a new full-access key exists, leading with how many are already live and the
 * fact a new kit does not switch the old ones off. The Replace flow has its own confirm
 * and calls `mintKit` directly, so nobody sees two confirms in a row.
 */
async function handleGenerateKit() {
  const live = syncStore.liveRecoveryKitCount;
  const detail =
    live === 0
      ? t('recovery.kitCreateHaveNone')
      : live === 1
        ? t('recovery.kitCreateHaveOne')
        : fillTemplate(t('recovery.kitCreateHaveMany'), { count: String(live) });
  const confirmed = await showConfirm({
    title: 'recovery.kitCreateTitle',
    message: 'recovery.kitCreateBody',
    detail,
    detailTone: live > 0 ? 'caution' : undefined,
    variant: 'info',
    confirmLabel: 'recovery.kitCreateConfirm',
  });
  if (!confirmed) return;
  await mintKit();
}

// ── Empty state: draw the eye to the create button when the drawer opens with no live
// kit. The drawer's content mounts on every open, so `onMounted` is "on open"; the short
// delay lets the drawer's slide-in finish so the pulse is seen, not hidden by it.
const createButtonWrap = ref<HTMLElement | null>(null);
const { pulse } = useAttentionPulse();
onMounted(async () => {
  if (syncStore.liveRecoveryKitCount !== 0 || !canManagePod.value) return;
  await nextTick();
  window.setTimeout(() => pulse(createButtonWrap.value, 'attention-pulse-twice'), 350);
});

async function handleInvalidateKit(kit: RecoveryKitSummary) {
  // The confirm (top layer) and the PIN gate (gate layer) paint over the open list.
  kitActionBusy.value = true;
  try {
    await invalidateKit(kit);
  } finally {
    kitActionBusy.value = false;
  }
}

async function handleReplaceKit(kit: RecoveryKitSummary) {
  kitActionBusy.value = true;
  try {
    if (!(await approveReplace(kit))) return;
    replacingKitId.value = kit.kitId;
    await mintKit();
    // A failed mint leaves no pending replacement.
    if (kitFlow.error.value) replacingKitId.value = null;
  } finally {
    kitActionBusy.value = false;
  }
}

async function handleKitStored(via: 'saved' | 'acknowledged') {
  // Taken and cleared BEFORE the await, so a second `stored` event during a slow
  // invalidation cannot retire the old kit twice.
  const oldKit = replacingKitId.value;
  replacingKitId.value = null;
  // Doc-side confirmation signal (Phase 4): the kit nag keys on it, and for kit-born
  // families it is the ONLY evidence anyone actually stored a code. A push that did not
  // land is shown (the flow sets `error` to the not-synced message and reports it).
  const durable = await kitFlow.confirmStored(via);
  if (oldKit && durable) {
    // The old kit's revoke can take 40 s on a slow link; keep the list's actions disabled
    // for the whole of it, exactly as for a plain Invalidate.
    kitActionBusy.value = true;
    try {
      toastKitInvalidateOutcome(await authStore.invalidateRecoveryKit(oldKit, { kind: 'replace' }));
    } finally {
      kitActionBusy.value = false;
    }
    return;
  }
  if (oldKit && !durable) {
    // The old kit stays valid on purpose: the replacement is not on file yet. Two live
    // kits now exist, so Manage Kits offers Invalidate on the old one once synced.
    emitKitInvalidateOutcome({
      outcome: 'refused',
      kind: 'replace',
      errorCode: 'confirm_not_synced',
    });
    statusMessage.value = { text: t('recovery.kitReplaceNotSynced'), type: 'error' };
    return;
  }
  if (!durable && kitFlow.error.value) {
    statusMessage.value = { text: kitFlow.error.value, type: 'error' };
  }
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
          ? 'dark:text-success-lift bg-green-50 text-green-700 dark:bg-green-900/20'
          : 'dark:text-danger-lift bg-red-50 text-red-600 dark:bg-red-900/20'
      "
    >
      {{ statusMessage.text }}
    </div>

    <!-- Recovery kit -->
    <div class="mb-6">
      <h4 class="font-outfit dark:text-ink mb-1 text-base font-semibold text-gray-900">
        {{ t('recovery.kitTitle') }}
      </h4>
      <p class="dark:text-ink-soft mb-3 text-sm text-gray-600">
        {{ t('recovery.kitDescription') }}
      </p>
      <p
        class="mb-3 text-xs"
        :class="
          syncStore.liveRecoveryKitCount === 0
            ? 'dark:text-accent-lift text-[#F15D22]'
            : 'dark:text-ink-faint text-gray-500'
        "
      >
        {{ syncStore.liveRecoveryKitCount === 0 ? t('recovery.kitNone') : kitSummary }}
      </p>
      <!-- A kit resets every PIN, so minting one is manager-only; everyone may see the list. -->
      <SettingsAdminOnlyNotice v-if="!canManagePod" class="mb-3" />
      <div class="flex flex-wrap gap-2">
        <BaseButton variant="outline" type="button" @click="showKits = true">
          {{ t('recovery.kitsManage') }}
        </BaseButton>
        <div v-if="canManagePod" ref="createButtonWrap" class="inline-flex rounded-2xl">
          <BaseButton
            variant="secondary"
            :loading="kitFlow.isGenerating.value"
            :disabled="kitFlow.isConfirming.value"
            @click="handleGenerateKit"
          >
            {{
              syncStore.liveRecoveryKitCount === 0
                ? t('recovery.kitGenerate')
                : t('recovery.kitRegenerate')
            }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Recovery passphrase -->
    <div>
      <h4 class="font-outfit dark:text-ink mb-1 text-base font-semibold text-gray-900">
        {{ t('recovery.passphraseTitle') }}
      </h4>
      <p class="dark:text-ink-soft mb-3 text-sm text-gray-600">
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
          <p class="dark:text-ink-soft text-sm font-medium text-gray-700">
            {{ t('recovery.passphraseSuggestion') }}
          </p>
          <p
            class="font-outfit dark:bg-surface-overlay dark:text-ink rounded-xl bg-gray-50 p-3 text-center text-lg font-bold tracking-wide text-gray-900 select-all"
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
          <p class="dark:text-ink-soft mt-2 text-xs text-gray-500">
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

    <RecoveryKitsModal
      :open="showKits"
      :kits="syncStore.recoveryKits"
      :can-manage="canManagePod"
      :busy="kitActionBusy"
      @close="showKits = false"
      @create="handleGenerateKit"
      @invalidate="handleInvalidateKit"
      @replace="handleReplaceKit"
    />

    <RecoveryKitDisplay
      :open="kitFlow.showKit.value"
      :kit-id="kitFlow.kitId.value"
      :code="kitFlow.kitCode.value"
      @stored="handleKitStored"
    />
  </BaseCard>
</template>
