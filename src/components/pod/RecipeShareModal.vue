<script setup lang="ts">
/**
 * Send a recipe to anyone (#92).
 *
 * One message carries the recipe as readable text AND a link, so it is a gift to whoever
 * never taps through and an offer to whoever does. The whole recipe rides in the URL
 * FRAGMENT, which a browser never transmits — so it reaches no beanies server, log or
 * analytics event.
 *
 * ⚠️ The privacy note is scoped honestly. The `#` keeps the recipe off BEANIES' servers. It
 * does not hide it from WhatsApp: `wa.me/?text=…` puts the whole message in a query string,
 * and every channel receives the message anyway, because that is what sending a message IS.
 * Do not let the copy drift into implying otherwise.
 */
import { computed, watch } from 'vue';
import ShareSheetModal from '@/components/ui/ShareSheetModal.vue';
import ShareChannelGrid from '@/components/family/ShareChannelGrid.vue';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { shareableOrigin } from '@/utils/shareableOrigin';
import { encodeRecipeShare, MAX_SHARE_PAYLOAD_CHARS } from '@/utils/recipeShareLink';
import { buildRecipeShareText, MAX_SHARE_MESSAGE_CHARS } from '@/utils/recipeShareText';
import type { Recipe } from '@/types/models';

const props = defineProps<{
  open: boolean;
  recipe: Recipe;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();

/**
 * The fragment payload, or `null` when the recipe is too large to link at all.
 *
 * Effectively unreachable for a real recipe — 8,000 base64url characters is roughly a
 * 6,000-character recipe — but it exists so an absurd input degrades honestly rather than
 * producing a URL that silently truncates in a chat client.
 */
const payload = computed(() => {
  const encoded = encodeRecipeShare(props.recipe);
  return encoded.length > MAX_SHARE_PAYLOAD_CHARS ? null : encoded;
});

// ⚠️ `shareableOrigin()`, never `window.location.origin`. Inside the iOS shell the document
// origin is `capacitor://app.beanies.family`, so every share from the iOS app would carry a
// link that opens nothing on the recipient's phone — invisibly, because the browser and
// Android both give the right answer and the person who cannot open it is not the sender.
const link = computed(() =>
  payload.value ? `${shareableOrigin()}/recipe#${payload.value}` : null
);

const message = computed(() =>
  buildRecipeShareText({
    fields: {
      name: props.recipe.name,
      subtitle: props.recipe.subtitle,
      prepTime: props.recipe.prepTime,
      cookTime: props.recipe.cookTime,
      servings: props.recipe.servings,
      ingredients: props.recipe.ingredients ?? [],
      steps: props.recipe.steps ?? [],
      notes: props.recipe.notes,
    },
    link: link.value,
    t,
  })
);

const emailSubject = computed(() =>
  fillTemplate(t('recipeShare.modal.emailSubject'), { name: props.recipe.name })
);

/** Discord takes 2,000 characters per message and offers no share-intent URL, so a longer
 *  message is worth a quiet word beside Copy — never worth dropping the link for. */
const overDiscordLimit = computed(() => message.value.text.length > MAX_SHARE_MESSAGE_CHARS);

// Opening the sheet is the funnel's first step, so it is recorded whether or not anything is
// then sent — a share RATE needs both halves.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    logEvent({
      level: 'info',
      surface: 'recipe-share',
      message: 'share sheet opened',
      context: {
        action: 'share_opened',
        ingredient_count: props.recipe.ingredients?.length ?? 0,
        detail: `${message.value.rung}/${message.value.linkDropped ? 'no-link' : 'linked'}`,
      },
    });
    if (message.value.linkDropped) {
      logEvent({
        level: 'warn',
        surface: 'recipe-share',
        message: 'share degraded: payload over cap',
        context: { action: 'share_oversize' },
      });
    }
  },
  { immediate: true }
);

function onShared(channelId: string) {
  logEvent({
    level: 'info',
    surface: 'recipe-share',
    message: 'shared via channel',
    context: { action: 'share_sent', kind: channelId },
  });
}
</script>

<template>
  <ShareSheetModal
    :open="open"
    :title="t('recipeShare.modal.title')"
    :subtitle="recipe.name"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <!-- Oversize: there is no link, so every link-shaped channel is hidden rather than
           shown broken (Messenger can carry nothing BUT a link). Copy + the OS sheet still
           work on the full text. -->
      <div
        v-if="!link"
        class="dark:bg-surface-overlay/60 rounded-2xl bg-[var(--tint-orange-8)] p-4"
        data-testid="recipe-share-oversize"
      >
        <p class="font-outfit text-primary-500 dark:text-accent-lift text-sm font-semibold">
          {{ t('recipeShare.modal.oversizeTitle') }}
        </p>
        <p class="font-inter text-secondary-500/80 dark:text-ink-soft mt-1 text-xs leading-relaxed">
          {{ t('recipeShare.modal.oversizeBody') }}
        </p>
      </div>

      <ShareChannelGrid
        v-if="link"
        :link="link"
        :body="message.text"
        :email-subject="emailSubject"
        :copy-text="message.text"
        :system-share-title="recipe.name"
        show-system-share
        surface="recipe-share"
        @shared="onShared"
      >
        <template #footer>
          <p v-if="overDiscordLimit" class="dark:text-ink-faint text-center text-xs text-gray-400">
            {{ t('recipeShare.modal.longNote') }}
          </p>
        </template>
      </ShareChannelGrid>

      <!-- The message contains the user's own recipe, so they see exactly what leaves. -->
      <div>
        <p
          id="recipe-share-preview-label"
          class="font-outfit text-secondary-500/60 dark:text-ink-faint mb-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          {{ t('recipeShare.modal.previewLabel') }}
        </p>
        <!-- `tabindex="0"` is not decoration: the box scrolls, and without it a
             keyboard-only user cannot reach past the fold of the message this modal exists
             to let them read before it leaves (WCAG 2.1.1). -->
        <pre
          tabindex="0"
          role="region"
          aria-labelledby="recipe-share-preview-label"
          class="dark:bg-surface-overlay/50 dark:text-ink-soft font-inter max-h-48 overflow-y-auto rounded-2xl bg-gray-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-gray-600"
          data-testid="recipe-share-preview"
          >{{ message.text }}</pre>
      </div>

      <p class="dark:text-ink-faint flex items-start gap-2 text-xs text-gray-400">
        <span aria-hidden="true">🔒</span>
        <span>{{ t('recipeShare.modal.privacyNote') }}</span>
      </p>
    </div>
  </ShareSheetModal>
</template>
