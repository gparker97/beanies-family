<script setup lang="ts">
/**
 * Per-action consent for the photo → activity wedge (#133, ADR-030).
 *
 * ⚠️ `layer="gate"` is load-bearing, not cosmetic, and it is the ONLY user of that layer.
 * This is a GATE: it asks permission before anything leaves the device, so a version of it
 * the user cannot see is a security-UX failure, not a z-index nit.
 *
 * It has been bitten TWICE by the same mechanic — equal z-index is decided by DOM order, and
 * App.vue mounts this modal before the router-view, so it loses every tie. First at `base`
 * (z-50) against `QuickAddSheet`; then at `top` (z-[250]) against `MagicBeansSheet`, once
 * that moved to `top` to clear the recipe form. Both times the prompt was invisible, the flow
 * appeared to hang on its own await, and every in-app capture was dead for any family that
 * had not ticked "don't ask again" — which is the default.
 *
 * `gate` (z-[260]) ends the pattern by putting this above `top` rather than level with it.
 * Do not lower it, and do not give a second surface that layer.
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
 * the skip its line describes: the family-scoped document skip, or a non-document variant's
 * own (the ingredients prompt, #116), so it never skips a prompt the family has not seen.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { openExternal } from '@/utils/openExternal';
import { splitAroundAccent } from '@/utils/splitAroundAccent';
import BetaBadge from '@/components/ui/BetaBadge.vue';
import { useAiCapability } from '@/composables/useAiCapability';
import { useDocumentConsent, type ConsentRequest } from '@/composables/useDocumentConsent';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';

// The privacy article lives on the marketing site (deployed via deploy-web.yml). LIVE as of
// the 2026-06-07 soft launch — this change ships alongside that web deploy, so the consent
// links resolve. (If the article is ever pulled, set this back to false.)
const PRIVACY_ARTICLE_LIVE = true;
const PRIVACY_ARTICLE_URL =
  'https://beanies.family/help/security/how-beanies-ai-handles-your-photos';

const { t } = useTranslation();
const { consentOpen, consentRequest, resolveConsent, onConsentConfirm } = useDocumentConsent();

/**
 * The copy each prompt shows, per variant. ONE table keyed like `useDocumentConsent`'s
 * `ACKNOWLEDGEMENTS`, so a new variant without its own copy is a compile error rather than a
 * prompt that borrows the generic "read this photo, document or selected text" wording for
 * something it is not.
 *
 *  - `transactions` (#107): the family's past merchant names and categories travel with the
 *    pages, and the read costs one bean per page (its extra "what it costs" row is below).
 *  - `ingredients` (#116, ✨ Find Duplicates): the lines on a shopping list, which is family data
 *    (so the generic "never any of your family's data" would be false). A free list tidy, so
 *    neither "attached to this item" nor "gimme those beans!" applies.
 */
interface ConsentCopy {
  title: UIStringKey;
  icon: string;
  intro: UIStringKey;
  what: UIStringKey;
  after: UIStringKey;
  confirm: UIStringKey;
  /** The "don't ask again" line: it must describe the skip `onConsentConfirm` records. */
  remember: UIStringKey;
}
const GENERIC_COPY: ConsentCopy = {
  title: 'ai.consent.title',
  icon: '✨',
  intro: 'ai.consent.intro',
  what: 'ai.consent.whatValue',
  after: 'ai.consent.afterValue',
  confirm: 'ai.consent.confirm',
  remember: 'ai.consent.remember',
};
const VARIANT_COPY: Record<ConsentRequest['kind'], ConsentCopy> = {
  transactions: {
    title: 'ai.consent.statement.title',
    icon: '🏦',
    intro: 'ai.consent.statement.intro',
    what: 'ai.consent.statement.whatValue',
    after: 'ai.consent.statement.afterValue',
    confirm: 'ai.consent.statement.confirm',
    // A statement IS a document the family chose, so the family-wide line is true of it.
    remember: 'ai.consent.remember',
  },
  ingredients: {
    title: 'ai.consent.title',
    icon: '✨',
    intro: 'ai.consent.ingredients.intro',
    what: 'ai.consent.ingredients.whatValue',
    after: 'ai.consent.ingredients.afterValue',
    confirm: 'ai.consent.ingredients.confirm',
    // Its own skip, never the family-wide document one (see useDocumentConsent).
    remember: 'ai.consent.ingredients.remember',
  },
};
const copy = computed(() =>
  consentRequest.value ? VARIANT_COPY[consentRequest.value.kind] : GENERIC_COPY
);

/** The bank-statement request, for its per-page cost row; null for every other prompt. */
const statement = computed(() =>
  consentRequest.value?.kind === 'transactions' ? consentRequest.value : null
);
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
  splitAroundAccent(t(copy.value.intro), t('ai.consent.introLink'))
);

const items = computed(() => {
  const c = copy.value;
  const request = statement.value;
  return [
    { icon: '📄', label: t('ai.consent.whatLabel'), value: t(c.what) },
    {
      icon: '🔒',
      label: t('ai.consent.whereLabel'),
      value: tier.value === 'byok' ? t('ai.consent.whereByok') : t('ai.consent.whereManaged'),
    },
    ...(request
      ? [
          {
            icon: '🫘',
            label: t('ai.consent.statement.readsLabel'),
            value: fillTemplate(
              t(
                request.reads === 1
                  ? 'ai.consent.statement.reads.one'
                  : 'ai.consent.statement.reads.other'
              ),
              { count: String(request.reads) }
            ),
          },
        ]
      : []),
    { icon: '🗑️', label: t('ai.consent.afterLabel'), value: t(c.after) },
  ];
});

function onConfirm(): void {
  void onConsentConfirm(remember.value);
}
</script>

<template>
  <BeanieFormModal
    variant="modal"
    layer="gate"
    size="narrow"
    :open="consentOpen"
    :title="t(copy.title)"
    :icon="copy.icon"
    icon-bg="var(--tint-orange-8)"
    :save-label="t(copy.confirm)"
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
    <p class="font-inter dark:text-ink text-sm text-[var(--color-text)]">
      <span>{{ introParts.lead }}</span
      ><button
        v-if="introParts.accent && PRIVACY_ARTICLE_LIVE"
        type="button"
        class="dark:hover:text-accent-lift font-semibold underline underline-offset-2 hover:text-[#F15D22]"
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
          <p class="font-inter dark:text-ink text-sm text-[var(--color-text)]">
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
      class="font-outfit dark:text-accent-lift dark:hover:text-ink inline-flex items-center gap-1 text-sm font-semibold text-[#F15D22] underline underline-offset-2 hover:text-[#D14D1A]"
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
            : 'dark:bg-surface-overlay border-[var(--color-border)] bg-white'
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
      <span class="font-inter dark:text-ink text-sm text-[var(--color-text)]">
        {{ t(copy.remember) }}
      </span>
    </label>
  </BeanieFormModal>
</template>
