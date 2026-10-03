<script setup lang="ts">
/**
 * The magic-beans composer the FAB opens in place (#119): a focused field, attach and camera
 * icon buttons, the allowance line, and a Send pill. Direction A of
 * `docs/mockups/magic-beans-fab-composer-2026-10-03.html`.
 *
 * A VIEW, like `MagicBeansSheet`: no protocol and no readers. The draft is a `v-model` owned by
 * the host (`QuickAddSheet`), which needs it for the `had_text` dismissal signal and to survive
 * the swap picker. Send emits the TRIMMED text, only when it is non-empty (the same contract as
 * the drawer's save). Everything below the tap (busy, read-only, consent, the picker, closing
 * before the ingest) is `MagicBeansDoor`'s, reached through the host.
 *
 * It does NOT focus itself on mount. The host is the one focus owner and calls `focus()`; two
 * owners would race, and the second focus would fight the first.
 *
 * Enter inserts a newline: nothing is sent until Send is tapped (the explicit-tap rule), and a
 * pasted class-group message is several lines. Ctrl+Enter (Cmd+Enter on a Mac) is the one
 * keyboard send: it is a deliberate chord, goes through `handleSend` like the button, and does
 * nothing while Send is disabled. A desktop-only hint says so (`isMobile` comes from the host). That is also why the field is `BaseTextarea`
 * and not `AutoGrowTextarea`, which blocks Enter by design.
 *
 * No kind tiles. The FAB has always been the app-wide, hint-less door; a bank statement still
 * routes through the unhinted statement path and "Not right?" corrects any misread. The page
 * doors' drawers keep the tiles.
 *
 * Attach and camera are two plain icon buttons rather than `AiSourceButtons`, whose header says
 * "copy, do not parameterise" when a caller wants it different; their classes mirror its
 * vocabulary.
 */
import { computed, ref } from 'vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import AllowanceMeter from '@/components/billing/AllowanceMeter.vue';
import { useTranslation } from '@/composables/useTranslation';
import { looksLikeUnroutableLink } from '@/utils/recipeSourceUrl';
import { FOCUS_RING } from '@/constants/tileStyles';

const draft = defineModel<string>({ required: true });

const props = withDefaults(defineProps<{ isMobile?: boolean }>(), { isMobile: false });

const emit = defineEmits<{
  /** The trimmed draft; never emitted empty. */
  send: [text: string];
  camera: [];
  file: [];
}>();

const { t } = useTranslation();

const field = ref<InstanceType<typeof BaseTextarea> | null>(null);

/** Quiet until there is text: genuinely disabled, because there is nothing to send. */
const ready = computed(() => draft.value.trim().length > 0);

/** Non-blocking: a link that will not route is explained, never disallowed. */
const showBadLinkHint = computed(() => looksLikeUnroutableLink(draft.value));

/** Apple platforms say Cmd, everything else Ctrl. Fixed for the page's life, so not reactive. */
const IS_MAC = (() => {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /Mac/i.test(nav.userAgentData?.platform || nav.platform || '');
})();
const SHORTCUT_KEYS = IS_MAC ? 'Meta+Enter' : 'Control+Enter';
const shortcutHintKey = IS_MAC ? 'ai.capture.sendShortcutMac' : 'ai.capture.sendShortcut';
const showShortcutHint = computed(() => !props.isMobile);

/** Ctrl/Cmd+Enter sends; plain Enter (and any Shift/Alt chord) is left to the textarea. */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  if (ready.value) handleSend();
}

function handleSend(): void {
  const value = draft.value.trim();
  if (!value) return;
  emit('send', value);
}

/** Focus the field. Returns false when there was no field to focus, so the host can fall back. */
function focus(): boolean {
  return field.value?.focus() ?? false;
}

defineExpose({ focus });

/** Attach and camera share one look: a control sitting on the raised card. */
const ICON_BUTTON = [
  'inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border-2 border-[var(--tint-slate-10)] bg-white text-secondary-500 transition-colors hover:bg-[var(--tint-slate-5)] dark:border-line-strong dark:bg-surface-overlay dark:text-ink dark:hover:bg-surface-hover motion-reduce:transition-none',
  FOCUS_RING,
];
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="magic-composer">
    <!-- 1rem field (iOS zooms on focus below 16px), three lines growing to 10rem, then it
         scrolls inside itself; where `field-sizing` is unsupported it stays at three lines. -->
    <BaseTextarea
      ref="field"
      v-model="draft"
      :rows="3"
      :placeholder="t('ai.capture.placeholder')"
      :aria-label="t('ai.capture.label')"
      data-testid="magic-composer-field"
      class="field-sizing-content max-h-40 min-h-[5.5rem]"
      @keydown="handleKeydown"
    />

    <p
      v-if="showBadLinkHint"
      class="font-outfit text-primary-600 dark:text-accent-lift m-0 text-xs"
    >
      {{ t('ai.capture.badLinkHint') }}
    </p>

    <div class="flex items-center gap-2">
      <button
        type="button"
        :class="ICON_BUTTON"
        :aria-label="t('ai.picker.chooseFile')"
        :title="t('ai.picker.chooseFile')"
        data-testid="magic-composer-file"
        @click="emit('file')"
      >
        <BeanieIcon name="paperclip" size="md" />
      </button>
      <button
        type="button"
        :class="ICON_BUTTON"
        :aria-label="t('ai.picker.takePhoto')"
        :title="t('ai.picker.takePhoto')"
        data-testid="magic-composer-camera"
        @click="emit('camera')"
      >
        <BeanieIcon name="camera" size="md" />
      </button>

      <!-- The allowance beside Send, so the cost is visible before it is spent. Renders nothing
           for BYOK, beta, read-only or an unread usage; the slot is then an empty spacer. -->
      <div class="min-w-0 flex-1">
        <AllowanceMeter compact />
      </div>

      <button
        type="button"
        :disabled="!ready"
        :aria-keyshortcuts="SHORTCUT_KEYS"
        data-testid="magic-composer-send"
        class="font-outfit inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors motion-reduce:transition-none"
        :class="[
          FOCUS_RING,
          ready
            ? 'from-primary-500 to-terracotta-400 cursor-pointer bg-gradient-to-br text-white shadow-[0_6px_18px_rgba(241,93,34,0.3)]'
            : 'text-secondary-500 dark:bg-surface-overlay dark:text-ink-soft cursor-not-allowed bg-[var(--tint-slate-10)]',
        ]"
        @click="handleSend"
      >
        <BeanieIcon name="send" size="sm" />
        <span>{{ t('ai.capture.action') }}</span>
      </button>
    </div>

    <p
      v-if="showShortcutHint"
      class="text-secondary-500 dark:text-ink-faint m-0 text-right text-xs"
      data-testid="magic-composer-shortcut"
    >
      {{ t(shortcutHintKey) }}
    </p>
  </div>
</template>
