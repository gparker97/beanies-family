<script setup lang="ts">
/**
 * Per-action consent for the photo → activity wedge (#133, ADR-030).
 *
 * Built on BeanieFormModal (the mandated modal hierarchy — never raw BaseModal). The
 * itemised "what / where / after" list is why this is a dedicated modal rather than a
 * useConfirm() call: useConfirm's `detail` is a single untranslated string and can't carry
 * the per-tier translated list. Info-styled and reassuring (no Alert Red — privacy is a
 * calm, deliberate choice, not an alarm).
 *
 * Confirm = @save (emits the optional "remember" choice), cancel/dismiss = @cancel. The
 * `remember` checkbox is OPTIONAL — confirming proceeds either way; ticking it asks the
 * parent to persist the family-scoped consent-skip so future extractions don't prompt.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { openExternal } from '@/utils/openExternal';
import { splitAroundAccent } from '@/utils/splitAroundAccent';
import type { AiTier } from '@/services/ai/types';

// The privacy article lives on the marketing site, which deploys via a SEPARATE manual
// pipeline (deploy-web.yml / workflow_dispatch) — an app deploy does not publish it. Until
// it is confirmed live, the checkbox renders label-only (no live link to a 404). Flip to
// true in the same change that runs deploy-web.
const PRIVACY_ARTICLE_LIVE = false;
const PRIVACY_ARTICLE_URL =
  'https://beanies.family/help/security/how-beanies-ai-handles-your-photos';

const props = defineProps<{
  open: boolean;
  /** Selected tier — drives the "where it goes" line. */
  tier: AiTier;
}>();

const emit = defineEmits<{
  confirm: [remember: boolean];
  cancel: [];
}>();

const { t } = useTranslation();

// The modal's only internal state. Reset on each open-prop edge so a stale tick never
// carries across reopen.
const remember = ref(false);
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) remember.value = false;
  }
);

// Split the intro sentence around the "secure, private" phrase so it can become
// an inline link. Reuses the shared accent-splitter (same pattern as WelcomeGate /
// LoginBackground): case-insensitive, and if the phrase isn't present in a
// translation it degrades to the whole sentence as `lead` with no link.
const introParts = computed(() =>
  splitAroundAccent(t('ai.consent.intro'), t('ai.consent.introLink'))
);

const items = computed(() => [
  { icon: '📄', label: t('ai.consent.whatLabel'), value: t('ai.consent.whatValue') },
  {
    icon: '🔒',
    label: t('ai.consent.whereLabel'),
    value: props.tier === 'byok' ? t('ai.consent.whereByok') : t('ai.consent.whereManaged'),
  },
  { icon: '🗑️', label: t('ai.consent.afterLabel'), value: t('ai.consent.afterValue') },
]);

function onConfirm(): void {
  emit('confirm', remember.value);
}
</script>

<template>
  <BeanieFormModal
    variant="modal"
    size="narrow"
    :open="open"
    :title="t('ai.consent.title')"
    icon="📸"
    icon-bg="var(--tint-orange-8)"
    :save-label="t('ai.consent.confirm')"
    @close="emit('cancel')"
    @save="onConfirm"
  >
    <!-- "secure, private" becomes an inline link to the privacy article once it
         ships (PRIVACY_ARTICLE_LIVE); until then it renders as plain emphasised
         text so the sentence still reads correctly. -->
    <p class="font-inter text-sm text-[var(--color-text)] dark:text-gray-200">
      <span>{{ introParts.lead }}</span
      ><button
        v-if="introParts.accent && PRIVACY_ARTICLE_LIVE"
        type="button"
        class="font-semibold underline underline-offset-2 hover:text-[#F15D22]"
        @click.stop.prevent="openExternal(PRIVACY_ARTICLE_URL)"
      >
        {{ introParts.accent }}</button
      ><span v-else-if="introParts.accent" class="font-semibold">{{ introParts.accent }}</span
      ><span>{{ introParts.trail }}</span>
    </p>

    <ul class="space-y-3">
      <li v-for="item in items" :key="item.label" class="flex gap-3">
        <span class="text-lg" aria-hidden="true">{{ item.icon }}</span>
        <div class="min-w-0">
          <p
            class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
          >
            {{ item.label }}
          </p>
          <p class="font-inter text-sm text-[var(--color-text)] dark:text-gray-200">
            {{ item.value }}
          </p>
        </div>
      </li>
    </ul>

    <p class="font-inter text-xs text-[var(--color-text-muted)]">
      {{ t('ai.consent.footnote') }}
    </p>

    <label class="flex cursor-pointer items-start gap-3">
      <input v-model="remember" type="checkbox" class="sr-only" />
      <span
        class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
        :class="
          remember
            ? 'border-[#F15D22] bg-[#F15D22]'
            : 'border-[var(--color-border)] bg-white dark:bg-slate-700'
        "
      >
        <svg
          v-if="remember"
          viewBox="0 0 20 20"
          fill="currentColor"
          class="h-3.5 w-3.5 text-white"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clip-rule="evenodd"
          />
        </svg>
      </span>
      <span class="font-inter text-sm text-[var(--color-text)] dark:text-gray-200">
        {{ t('ai.consent.remember') }}
        <button
          v-if="PRIVACY_ARTICLE_LIVE"
          type="button"
          class="ml-1 underline underline-offset-2 hover:text-[#F15D22]"
          @click.stop.prevent="openExternal(PRIVACY_ARTICLE_URL)"
        >
          {{ t('ai.consent.privacyLink') }}
        </button>
      </span>
    </label>
  </BeanieFormModal>
</template>
