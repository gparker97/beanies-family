<script setup lang="ts">
/**
 * "Have a magic link? Paste it here" — the manual rescue for a link that would not open.
 *
 * ⚠️ SHARED, because it belongs on more than one screen. Someone holding a link that failed
 * is on the welcome gate OR stuck on the join screen, and they cannot be expected to know
 * which of those is the right place to try again. It lived inline in `WelcomeGate` and was
 * needed in both, so it is one component rather than two drifting copies.
 *
 * ⚠️ MANUAL PASTE ONLY — never a silent clipboard read. iOS surfaces a system banner for
 * clipboard access, and for a product whose pitch is privacy, reading what someone copied
 * without asking is the wrong instinct.
 *
 * It navigates, then emits. The host decides what else that means: the welcome gate has to
 * switch its own view, and the join screen has to re-run its flow, because pasting the SAME
 * link changes no URL and therefore fires no route watcher.
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { parseInviteLink } from '@/services/crypto/inviteService';
import { useTranslation } from '@/composables/useTranslation';

const emit = defineEmits<{
  /** A link parsed and the router was pushed. The host re-derives its own state. */
  submitted: [];
}>();

const { t } = useTranslation();
const router = useRouter();

const showPaste = ref(false);
const pastedLink = ref('');
const pasteError = ref(false);

function openPastedLink(): void {
  pasteError.value = false;
  // ⚠️ Normalise a missing scheme first. `parseInviteLink` does `new URL(raw)` with no
  // base, and the commonest way a chat app renders a copied link is `app.beanies.family/
  // join?…` with no `https://`. The fallback that exists to rescue a failed deep link was
  // rejecting the most likely input with "check it copied fully" — when it had.
  const raw = pastedLink.value.trim();
  const normalised = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = parseInviteLink(normalised);
  // ⚠️ `parseInviteLink` returns null on a malformed URL and SILENTLY DROPS an
  // undecodable `ref`/`hint`. A paste box is exactly where a truncated link arrives —
  // chat apps wrap long URLs — so that silence has to be broken here rather than
  // becoming a dead-end spinner three screens later.
  if (!parsed) {
    pasteError.value = true;
    return;
  }
  // ⚠️ Forward what `parseInviteLink` RESOLVED, never a re-parse of the raw string.
  // It deliberately accepts hash-routed links (`…/#/join?fam=…&t=…`), so re-deriving from
  // `new URL(...).search` validated the hash form and then forwarded an EMPTY query —
  // routing to a bare `/join`, where the joiner met the generic "how to join" card with no
  // error, no token and no family. One parser, one answer.
  void router.push({
    path: '/join',
    query: {
      fam: parsed.familyId,
      ...(parsed.token ? { t: parsed.token } : {}),
      ...(parsed.provider ? { p: parsed.provider } : {}),
      ...(parsed.fileId ? { fileId: parsed.fileId } : {}),
      ...(parsed.fileName ? { ref: btoa(unescape(encodeURIComponent(parsed.fileName))) } : {}),
      ...(parsed.inviteeEmail
        ? { hint: btoa(unescape(encodeURIComponent(parsed.inviteeEmail))) }
        : {}),
      ...(parsed.linkMode ? { lk: '1' } : {}),
      ...(parsed.magicLink ? { ml: '1' } : {}),
      ...(parsed.memberId ? { m: parsed.memberId } : {}),
    },
  });

  // ⚠️ EMIT AS WELL AS PUSH, because the push alone does nothing on the most likely retry.
  // Someone whose link failed is already at `/join?...`; pasting THE SAME link resolves as a
  // duplicated navigation, so `fullPath` never changes and no watcher fires. The gesture
  // that exists to rescue a failed link would silently do nothing.
  emit('submitted');
}
</script>

<template>
  <div class="text-center">
    <!-- ⚠️ A BORDERED BUTTON, not an underlined caption. This was `text-xs text-gray-500
         underline`, which is the styling of a legal footnote, on the one control a person
         holding a broken link actually needs. They reached instead for the big cards above
         it, which is the wrong flow entirely. -->
    <button
      v-if="!showPaste"
      type="button"
      class="dark:border-line-strong dark:text-ink-soft dark:hover:border-primary-400 dark:hover:bg-surface-hover mx-auto flex items-center gap-2 rounded-full border-2 border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-all hover:-translate-y-px hover:border-[#F15D22] hover:bg-[#F15D22]/5"
      data-testid="open-paste-link"
      @click="showPaste = true"
    >
      <!-- Link glyph: the same object the sentence is about -->
      <svg
        class="dark:text-primary-400 h-4 w-4 text-[#F15D22]"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5"
        />
      </svg>
      {{ t('magicLink.pastePrompt') }}
    </button>

    <!-- ⚠️ A CONTAINED PANEL WITH ITS OWN GROUND. Open, this was a hairline `border-gray-200`
         input floating on the card's white, which read as almost nothing — and on dark it had
         no partner at all. It now sits on its own surface with a real border, so it is
         obviously a thing you type into. -->
    <div
      v-else
      class="dark:border-line dark:bg-surface-overlay space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left"
    >
      <label for="pasted-link" class="dark:text-ink block text-sm font-semibold text-gray-900">
        {{ t('magicLink.pasteLabel') }}
      </label>
      <input
        id="pasted-link"
        v-model="pastedLink"
        type="url"
        inputmode="url"
        autocomplete="off"
        class="dark:border-line-strong dark:bg-surface-raised dark:text-ink dark:placeholder:text-ink-faint w-full rounded-xl border border-gray-300 bg-white p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#F15D22] focus:ring-2 focus:ring-[#F15D22]/20 focus:outline-none"
        :placeholder="t('magicLink.pastePlaceholder')"
      />
      <button
        type="button"
        class="bg-primary-500 hover:bg-primary-600 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors"
        data-testid="submit-paste-link"
        @click="openPastedLink"
      >
        {{ t('magicLink.pasteAction') }}
      </button>
      <p v-if="pasteError" role="alert" class="dark:text-danger-lift text-xs text-red-600">
        {{ t('magicLink.pasteUnparseable') }}
      </p>
    </div>
  </div>
</template>
