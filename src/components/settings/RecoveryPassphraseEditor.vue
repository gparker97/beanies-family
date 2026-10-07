<script setup lang="ts">
/**
 * The optional family recovery passphrase: suggestion, "use my own phrase" with a live
 * strength check, and Save. Extracted from RecoverySettings so the kit half stays small.
 *
 * Save is disabled until the verdict is `ok`; the same verdict function guards the store's
 * `setRecoveryPassphrase`, so the meter and Save cannot disagree.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import { PASSPHRASE_REFUSAL_KEY, generatePassphrase } from '@/utils/passphraseStrength';
import type { PassphraseVerdict } from '@/utils/passphraseStrength';

const props = defineProps<{
  hasPassphrase: boolean;
  /** The current passphrase is an older, shorter suggestion: show the gentle nudge. */
  legacyPending: boolean;
}>();
const emit = defineEmits<{ saved: [] }>();

const { t } = useTranslation();
const authStore = useAuthStore();

const CHECK_DEBOUNCE_MS = 150;

const isEditing = ref(false);
const suggested = ref('');
const isSuggesting = ref(false);
const useOwn = ref(false);
const ownPhrase = ref('');
const verdict = ref<PassphraseVerdict | null>(null);
const isSaving = ref(false);
const errorText = ref('');

async function suggest() {
  isSuggesting.value = true;
  try {
    suggested.value = await generatePassphrase();
  } finally {
    isSuggesting.value = false;
  }
}

async function start() {
  errorText.value = '';
  useOwn.value = false;
  ownPhrase.value = '';
  verdict.value = null;
  suggested.value = '';
  isEditing.value = true;
  await suggest();
}

// Debounced live check; a sequence number drops answers that arrive out of order.
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
watch(ownPhrase, (phrase) => {
  clearTimeout(timer);
  const mine = ++seq;
  if (!phrase.trim()) {
    verdict.value = null;
    return;
  }
  timer = setTimeout(async () => {
    const v = await authStore.checkFamilyPassphrase(phrase.trim());
    if (mine === seq) verdict.value = v;
  }, CHECK_DEBOUNCE_MS);
});
onBeforeUnmount(() => clearTimeout(timer));

const score = computed(() => verdict.value?.score ?? 0);
const SEGMENTS = [0, 1, 2, 3, 4];
const filled = computed(() => (verdict.value ? score.value + 1 : 0));
const strengthLabel = computed(() => {
  // Typing has started but the (debounced, chunk-loading) check has not answered yet.
  if (!verdict.value) return t('action.loading');
  if (score.value >= 4) return t('recovery.strengthStrong');
  if (score.value === 3) return t('recovery.strengthGood');
  if (score.value === 2) return t('recovery.strengthFair');
  return t('recovery.strengthWeak');
});

const verdictMessage = computed(() => {
  const v = verdict.value;
  if (!v || v.ok) return '';
  return t(PASSPHRASE_REFUSAL_KEY[v.reason]);
});
const hintText = computed(() => {
  const v = verdict.value;
  return v && !v.ok && v.hintKey ? t(v.hintKey) : '';
});

const canSave = computed(() =>
  useOwn.value ? verdict.value?.ok === true : !!suggested.value && !isSuggesting.value
);

async function save() {
  errorText.value = '';
  isSaving.value = true;
  try {
    const result = await authStore.setRecoveryPassphrase(
      useOwn.value ? ownPhrase.value : suggested.value
    );
    if (result.success) {
      isEditing.value = false;
      emit('saved');
    } else {
      errorText.value = result.error ?? t('auth.signInFailed');
    }
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div>
    <h4 class="font-outfit dark:text-ink mb-1 text-base font-semibold text-gray-900">
      {{ t('recovery.passphraseTitle') }}
    </h4>
    <p class="dark:text-ink-soft mb-3 text-sm text-gray-600">
      {{ t('recovery.passphraseDescription') }}
    </p>
    <p
      class="dark:text-ink-faint text-xs text-gray-500"
      :class="props.legacyPending ? 'mb-1' : 'mb-3'"
    >
      {{ props.hasPassphrase ? t('recovery.passphraseIsSet') : t('recovery.passphraseNotSet') }}
    </p>
    <InferredHint
      v-if="props.legacyPending"
      class="mb-3"
      :text="t('recovery.passphraseLegacyNudge')"
    />

    <BaseButton v-if="!isEditing" variant="secondary" @click="start">
      {{ props.hasPassphrase ? t('recovery.passphraseChange') : t('recovery.passphraseSet') }}
    </BaseButton>

    <div v-else class="space-y-3">
      <p
        v-if="errorText"
        role="alert"
        class="dark:text-danger-lift rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20"
      >
        {{ errorText }}
      </p>
      <template v-if="!useOwn">
        <p class="dark:text-ink-soft text-sm font-medium text-gray-600">
          {{ t('recovery.passphraseSuggestion') }}
        </p>
        <p
          data-testid="passphrase-suggestion"
          class="font-outfit dark:text-ink dark:bg-surface-overlay rounded-xl bg-[var(--tint-slate-5)] p-3 text-center text-lg font-bold tracking-wide text-gray-900 select-all"
        >
          {{ isSuggesting ? t('action.loading') : suggested }}
        </p>
        <div class="flex gap-3">
          <BaseButton variant="secondary" type="button" :disabled="isSuggesting" @click="suggest">
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
        <div v-if="ownPhrase.trim()" class="mt-2">
          <div
            role="meter"
            data-testid="strength-meter"
            :aria-label="t('recovery.strengthLabel')"
            aria-valuemin="0"
            aria-valuemax="4"
            :aria-valuenow="score"
            class="flex gap-1"
          >
            <!-- Decorative segments: the orange to terracotta gradient reads the same on dark. -->
            <span
              v-for="n in SEGMENTS"
              :key="n"
              class="h-2 flex-1 rounded-full"
              :class="
                n < filled
                  ? 'bg-gradient-to-r from-[#F15D22] to-[#E67E22]'
                  : 'dark:bg-surface-overlay bg-[var(--tint-slate-5)]'
              "
            />
          </div>
          <p data-testid="strength-label" class="dark:text-ink-soft mt-1 text-xs text-gray-600">
            {{ strengthLabel }}
          </p>
          <p v-if="verdictMessage" class="dark:text-ink-soft mt-1 text-xs text-gray-600">
            {{ verdictMessage }}
          </p>
          <p v-if="hintText" class="dark:text-ink-soft text-xs text-gray-600">{{ hintText }}</p>
        </div>
        <p class="dark:text-ink-soft mt-2 text-xs text-gray-600">
          {{ t('recovery.passphraseRules') }}
        </p>
      </template>
      <div class="flex gap-3">
        <BaseButton :disabled="isSaving || !canSave" @click="save">
          {{ isSaving ? t('common.saving') : t('action.save') }}
        </BaseButton>
        <BaseButton variant="ghost" type="button" :disabled="isSaving" @click="isEditing = false">
          {{ t('action.cancel') }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
