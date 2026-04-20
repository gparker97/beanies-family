<script setup lang="ts">
/**
 * Read-only block of text that stays inline when short, line-clamps
 * when long, and offers a compact toggle to reveal the rest. URLs in
 * the text auto-link (escaped + wrapped safely — no raw HTML from
 * user input ever reaches the DOM).
 *
 * Used in the travel-plan timeline for prose fields (notes, location,
 * description, address) where multi-line content was previously jammed
 * into a single-line `<input>` and became unreadable. Editing now
 * happens via the ✏️ button on the segment card, which opens the edit
 * modal — this component is display-only.
 *
 * Overflow is measured at runtime via `ResizeObserver`, so the "Show
 * more" toggle only appears when the text actually overflows the
 * clamped height. Short text renders with no visual affordance.
 */
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  text: string;
  /** Lines visible when collapsed. Default 2. */
  maxLines?: number;
  /** Typography classes for the text body — caller controls look. */
  textClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  maxLines: 2,
  textClass: 'font-outfit text-sm font-medium text-gray-900 dark:text-gray-100',
});

const { t } = useTranslation();

const expanded = ref(false);
const overflowed = ref(false);
const textEl = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;

function measure(): void {
  const el = textEl.value;
  if (!el || expanded.value) return;
  overflowed.value = el.scrollHeight - el.clientHeight > 1;
}

onMounted(() => {
  nextTick(measure);
  if (typeof ResizeObserver !== 'undefined' && textEl.value) {
    observer = new ResizeObserver(() => measure());
    observer.observe(textEl.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});

watch(
  () => props.text,
  () => {
    nextTick(measure);
  }
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Autolink http(s) URLs. Trailing sentence punctuation stays outside
// the <a> so "See https://foo.com." doesn't link the period.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;

function renderText(raw: string): string {
  const escaped = escapeHtml(raw);
  return escaped.replace(URL_RE, (match) => {
    const trail = match.match(/[.,!?;:)]+$/);
    const url = trail ? match.slice(0, -trail[0].length) : match;
    const trailing = trail ? trail[0] : '';
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow" class="text-[var(--vacation-teal)] underline decoration-dotted underline-offset-2 hover:decoration-solid">${url}</a>${trailing}`;
  });
}

const html = computed(() => renderText(props.text));
</script>

<template>
  <div class="expandable-text min-w-0">
    <!-- eslint-disable-next-line vue/no-v-html -- html is safe: raw text is
         HTML-escaped via escapeHtml() first, then only <a> tags we construct
         are re-injected for URL autolinking. No other markup from user input
         survives the escape pass. -->
    <div
      ref="textEl"
      :class="['text-body', textClass, expanded ? '' : 'clamp']"
      :style="{ '--max-lines': String(maxLines) }"
      v-html="html"
    />
    <button
      v-if="overflowed || expanded"
      type="button"
      class="font-outfit mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold tracking-[0.12em] text-[var(--vacation-teal)] uppercase hover:underline"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('action.showLess') : t('action.showMore') }}
      <span aria-hidden="true">{{ expanded ? '↑' : '↓' }}</span>
    </button>
  </div>
</template>

<style scoped>
.text-body {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.clamp {
  -webkit-box-orient: vertical;
  display: -webkit-box;
  -webkit-line-clamp: var(--max-lines);
  line-clamp: var(--max-lines);
  overflow: hidden;
}
</style>
