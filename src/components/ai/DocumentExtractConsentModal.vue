<script setup lang="ts">
/**
 * Per-action consent for the photo → activity wedge (#133, ADR-030).
 *
 * ⚠️ `layer="top"` is load-bearing, not cosmetic. This is a GATE: it asks permission before
 * anything leaves the device, so a version of it the user cannot see is a security-UX
 * failure, not a z-index nit. It previously defaulted to `layer="base"` (z-50) — the same
 * layer as `QuickAddSheet` — and since App.vue mounts the quick-add sheet LATER in the body,
 * equal z-index meant the sheet painted over this dialog. Every in-app magic-beans capture
 * (#84) requests consent while that sheet is open, so the prompt was invisible and the flow
 * appeared to hang on its own await. Do not lower this.
 *
 * Built on BeanieFormModal (the mandated modal hierarchy — never raw BaseModal). The
 * itemised "what / where / after" list is why this is a dedicated modal rather than a
 * useConfirm() call: useConfirm's `detail` is a single untranslated string and can't carry
 * the per-tier translated list. Info-styled and reassuring (no Alert Red — privacy is a
 * calm, deliberate choice, not an alarm).
 *
 * SELF-CONTAINED (#64). This reads its own open state from the `useDocumentConsent`
 * singleton and its own tier from `useAiCapability`, exactly as `ConfirmModal` reads
 * `useConfirm`. It takes NO props and is mounted ONCE, in `App.vue`. Consent can be requested
 * from the app shell (a share arriving before any page exists) and from inside another modal
 * (`RecipeFormModal`), neither of which can host a per-page mount.
 *
 * The `remember` checkbox is OPTIONAL — confirming proceeds either way; ticking it persists
 * the family-scoped consent-skip so future extractions don't prompt.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { openExternal } from '@/utils/openExternal';
import { splitAroundAccent } from '@/utils/splitAroundAccent';
import BetaBadge from '@/components/ui/BetaBadge.vue';
import { useAiCapability } from '@/composables/useAiCapability';
import { useDocumentConsent } from '@/composables/useDocumentConsent';

// The privacy article lives on the marketing site (deployed via deploy-web.yml). LIVE as of
// the 2026-06-07 soft launch — this change ships alongside that web deploy, so the consent
// links resolve. (If the article is ever pulled, set this back to false.)
const PRIVACY_ARTICLE_LIVE = true;
const PRIVACY_ARTICLE_URL =
  'https://beanies.family/help/security/how-beanies-ai-handles-your-photos';

const { t } = useTranslation();
const { consentOpen, resolveConsent, onConsentConfirm } = useDocumentConsent();
// Tier drives the "where it goes" line, and is read here rather than passed in so the single
// global mount needs no wiring in App.vue.
const { tier } = useAiCapability();

// The modal's only internal state. Reset on each open-prop edge so a stale tick never
// carries across reopen.
const remember = ref(false);
watch(consentOpen, (isOpen) => {
  if (isOpen) remember.value = false;
});

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
    value: tier.value === 'byok' ? t('ai.consent.whereByok') : t('ai.consent.whereManaged'),
  },
  { icon: '🗑️', label: t('ai.consent.afterLabel'), value: t('ai.consent.afterValue') },
]);

function onConfirm(): void {
  void onConsentConfirm(remember.value);
}
</script>

<template>
  <BeanieFormModal
    variant="modal"
    layer="top"
    size="narrow"
    :open="consentOpen"
    :title="t('ai.consent.title')"
    icon="✨"
    icon-bg="var(--tint-orange-8)"
    :save-label="t('ai.consent.confirm')"
    @close="resolveConsent(false)"
    @save="onConfirm"
  >
    <!-- Beta: the AI document readers are an early release. -->
    <div>
      <BetaBadge />
    </div>

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

    <!-- Clear "learn more" link to the privacy help article (opens a real new tab
         via openExternal, which is PWA-safe). -->
    <button
      v-if="PRIVACY_ARTICLE_LIVE"
      type="button"
      class="font-outfit inline-flex items-center gap-1 text-sm font-semibold text-[#F15D22] underline underline-offset-2 hover:text-[#D14D1A]"
      @click.stop.prevent="openExternal(PRIVACY_ARTICLE_URL)"
    >
      {{ t('ai.consent.learnMore') }}
      <span aria-hidden="true">↗</span>
    </button>

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
      </span>
    </label>
  </BeanieFormModal>
</template>
