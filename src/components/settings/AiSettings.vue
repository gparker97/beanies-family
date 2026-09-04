<script setup lang="ts">
// beanies AI settings (#133 Phase 4). The single home for the AI surface: tier choice,
// BYOK provider/key, a "test key" check, the per-tier privacy explanation, and the
// relocated "ask before photos" consent toggle. Extracted from SettingsPage.vue (which is
// already large) following the ExchangeRateSettings/PasskeySettings precedent, so the one
// genuinely stateful settings surface is isolation-testable.
//
// INVARIANT: the managed (Tinfoil) tier has NO client key — it lives server-side in the
// ai-extract Lambda. Only BYOK stores a key (in Settings.aiApiKeys). That split is the
// privacy boundary; never persist a managed key here.
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { BaseButton } from '@/components/ui';
import SettingToggleRow from '@/components/settings/SettingToggleRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useSettingsStore } from '@/stores/settingsStore';
import { validateByokKey } from '@/services/ai/providers/validateByokKey';
import { apiKeyForProvider } from '@/utils/aiApiKeys';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { AiTier, AIProvider } from '@/types/models';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();

// ── Tier metadata — one source of truth (a future tier is one entry, compile-checked) ──
const TIER_META: Record<
  AiTier,
  { nameKey: UIStringKey; privacyKey: UIStringKey; disabled: boolean }
> = {
  managed: {
    nameKey: 'settings.ai.tier.managed',
    privacyKey: 'settings.ai.privacy.managed',
    disabled: false,
  },
  byok: {
    nameKey: 'settings.ai.tier.byok',
    privacyKey: 'settings.ai.privacy.byok',
    disabled: false,
  },
  'on-device': {
    nameKey: 'settings.ai.tier.onDevice',
    privacyKey: 'settings.ai.privacy.onDevice',
    disabled: true,
  },
};
const TIER_ORDER = ['managed', 'byok', 'on-device'] as const satisfies readonly AiTier[];

const tierOptions = computed(() =>
  TIER_ORDER.map((tk) => ({
    value: tk,
    label: t(TIER_META[tk].nameKey) + (TIER_META[tk].disabled ? t('settings.ai.comingSoon') : ''),
    disabled: TIER_META[tk].disabled,
  }))
);
const privacyText = computed(() => t(TIER_META[settingsStore.aiTier].privacyKey));

// A failed setter leaves the store value unchanged, but a native <select> keeps showing the
// user's (failed) pick — bumping this key remounts the selects so they re-read the store.
const selectRevertKey = ref(0);

async function onPickTier(value: string | number) {
  try {
    await settingsStore.setAITier(value as AiTier);
    // #133: BYOK needs a provider. Default to the one working target when none is set yet, so
    // the key field is immediately usable instead of silently no-op'ing the key save.
    if (value === 'byok' && settingsStore.aiProvider === 'none') {
      await settingsStore.setAIProvider('openai');
    }
  } catch {
    // The store already toasted; force the <select> back in sync with the unchanged store.
    selectRevertKey.value++;
  }
}

// ── BYOK provider + key. Only OpenAI extracts today; claude/gemini are honest seams. ──
const BYOK_PROVIDERS: ReadonlyArray<{ value: string; labelKey: UIStringKey; disabled: boolean }> = [
  { value: 'openai', labelKey: 'settings.ai.provider.openai', disabled: false },
  { value: 'claude', labelKey: 'settings.ai.provider.claude', disabled: true },
  { value: 'gemini', labelKey: 'settings.ai.provider.gemini', disabled: true },
];

const providerOptions = computed(() =>
  BYOK_PROVIDERS.map((p) => ({
    value: p.value,
    label: t(p.labelKey) + (p.disabled ? t('settings.ai.comingSoon') : ''),
    disabled: p.disabled,
  }))
);

const providerValue = computed(() =>
  settingsStore.aiProvider === 'none' ? '' : settingsStore.aiProvider
);

// Stored key for the current provider (shared helper — single source with useAiCapability).
function storedKey(): string {
  return apiKeyForProvider(settingsStore.aiProvider, settingsStore.settings.aiApiKeys) ?? '';
}

// Local draft of the key, seeded from the store and persisted on blur. The watch re-seeds it
// whenever the provider changes (incl. the setAIProvider in onPickTier/onPickProvider) or the
// modal (re)opens, so the field always reflects the selected provider's stored key.
const keyDraft = ref(storedKey());
watch(
  () => [settingsStore.aiProvider, props.open],
  () => {
    keyDraft.value = storedKey();
  }
);

async function onPickProvider(value: string | number) {
  if ((value as AIProvider) === settingsStore.aiProvider) return; // no-op guard — avoid a pointless write
  try {
    await settingsStore.setAIProvider(value as AIProvider);
    // keyDraft re-seeds via the watch on settingsStore.aiProvider — no manual reseed needed.
  } catch {
    selectRevertKey.value++; // store toasted; revert the <select> to the unchanged store value
  }
}

async function onSaveKey() {
  const provider = settingsStore.aiProvider;
  if (provider === 'none') return;
  const next = keyDraft.value.trim();
  if (next === storedKey()) return; // unchanged — skip the Automerge write + re-sync
  try {
    await settingsStore.setAIApiKey(provider, next);
  } catch {
    // The store toasted; keep the field's text so the user can retry.
  }
}

const showTestButton = computed(
  () => settingsStore.aiProvider === 'openai' && keyDraft.value.trim().length > 0
);
const testing = ref(false);

async function onTestKey() {
  testing.value = true;
  try {
    // validateByokKey never throws — it classifies every failure into a result reason.
    const result = await validateByokKey({ provider: 'openai', apiKey: keyDraft.value.trim() });
    if (result.ok) {
      showToast('success', t('settings.ai.test.ok.title'), t('settings.ai.test.ok.message'));
    } else if (result.reason === 'invalid_key') {
      // A rejected test key is user-recoverable input, NOT a system fault — silent so it
      // doesn't fire the Slack reporter or show "support has been notified".
      showToast(
        'error',
        t('settings.ai.test.invalid.title'),
        t('settings.ai.test.invalid.message'),
        {
          silent: true,
        }
      );
    } else {
      showToast(
        'warning',
        t('settings.ai.test.network.title'),
        t('settings.ai.test.network.message')
      );
    }
  } finally {
    testing.value = false;
  }
}

// ── Relocated consent toggle (#133): ON = ask (stores skipDocumentConsentPrompt false). ──
async function updateAskBeforePhotos(ask: boolean) {
  try {
    await settingsStore.setSkipDocumentConsentPrompt(!ask);
  } catch {
    // The store surfaced the toast; swallow to avoid an unhandled rejection.
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('settings.card.ai')"
    icon="🤖"
    icon-bg="var(--tint-silk-20)"
    :save-label="t('action.close')"
    @close="emit('close')"
    @save="emit('close')"
  >
    <div class="space-y-5">
      <!-- Tier selector + per-tier privacy explanation -->
      <div class="space-y-2">
        <BaseSelect
          :key="`tier-${selectRevertKey}`"
          :model-value="settingsStore.aiTier"
          :options="tierOptions"
          :label="t('settings.ai.tierLabel')"
          @update:model-value="onPickTier"
        />
        <p
          class="dark:bg-surface-raised dark:text-ink-soft rounded-2xl bg-[var(--tint-silk-20)] px-3 py-2.5 text-[0.8rem] leading-snug text-[var(--deep-slate)]/70"
        >
          {{ privacyText }}
        </p>
      </div>

      <!-- BYOK config — only when the user picked their own key -->
      <div v-if="settingsStore.aiTier === 'byok'" class="space-y-3">
        <BaseSelect
          :key="`provider-${selectRevertKey}`"
          :model-value="providerValue"
          :options="providerOptions"
          :label="t('settings.ai.byok.provider')"
          @update:model-value="onPickProvider"
        />
        <BaseInput
          :model-value="keyDraft"
          type="password"
          autocomplete="off"
          :label="t('settings.ai.byok.apiKey')"
          :hint="t('settings.ai.byok.apiKeyHint')"
          :placeholder="t('settings.ai.byok.apiKeyPlaceholder')"
          @update:model-value="keyDraft = String($event)"
          @blur="onSaveKey"
        />
        <BaseButton
          v-if="showTestButton"
          variant="secondary"
          size="sm"
          :loading="testing"
          @click="onTestKey"
        >
          {{ testing ? t('settings.ai.byok.testing') : t('settings.ai.byok.test') }}
        </BaseButton>
      </div>

      <!-- Relocated "ask before photos" consent toggle (divider above separates it from BYOK) -->
      <div class="dark:border-line border-t border-[var(--tint-slate-05)]">
        <SettingToggleRow
          testid="ai-consent-toggle"
          :title="t('settings.ai.askBeforePhotos')"
          :hint="t('settings.ai.askBeforePhotosHint')"
          :model-value="!settingsStore.skipDocumentConsentPrompt"
          @update:model-value="updateAskBeforePhotos"
        />
      </div>
    </div>
  </BeanieFormModal>
</template>
