<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { openExternal } from '@/utils/openExternal';

const props = defineProps<{
  /** Hint text to display in the popover (plain text or array of bullet items) */
  text?: string;
  /** Array of bullet items — each rendered as a line with a marker */
  items?: string[];
  /** Use light-on-dark styling for dark card backgrounds */
  dark?: boolean;
  /**
   * Optional pill trigger label (ALREADY translated — pass `t('key')`, this
   * component never calls `t()`). When set, renders a labeled "How?"-style pill
   * with the "?" badge at the end, instead of the default bare "?" badge.
   *
   * NOTE: this is the last acceptable prop-based trigger variant. A third
   * trigger shape must refactor to a `<slot name="trigger">`, not another prop.
   */
  triggerLabel?: string;
  /**
   * Optional foot link (ALREADY-translated text + absolute href). When set,
   * renders a link at the foot of the popover. Opens externally via
   * `openExternal` (native-safe). href must be absolute (cross-origin help
   * lives on the marketing apex — build with `MARKETING_URL`).
   */
  link?: { text: string; href: string };
}>();

const show = ref(false);
const el = ref<HTMLElement>();
const btn = ref<HTMLElement>();
const popover = ref<HTMLElement>();
const popoverStyle = ref<Record<string, string>>({});

function positionPopover() {
  if (!btn.value || !popover.value) return;
  const rect = btn.value.getBoundingClientRect();
  const popoverRect = popover.value.getBoundingClientRect();
  const popoverWidth = 288; // w-72 = 18rem = 288px
  const popoverHeight = popoverRect.height;
  const gap = 8;

  // Horizontal: align right edge to button right edge
  let left = rect.right - popoverWidth;
  if (left < gap) left = rect.left;
  if (left + popoverWidth > window.innerWidth - gap) left = window.innerWidth - popoverWidth - gap;

  // Vertical: default below, flip above if it would overflow the viewport
  let top = rect.bottom + gap;
  if (top + popoverHeight > window.innerHeight - gap) {
    top = rect.top - gap - popoverHeight;
    // If flipping above also overflows, pin to bottom with margin
    if (top < gap) top = window.innerHeight - popoverHeight - gap;
  }

  popoverStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
  };
}

async function toggle() {
  show.value = !show.value;
  if (show.value) {
    // Render off-screen first so we can measure, then reposition
    popoverStyle.value = { position: 'fixed', top: '-9999px', left: '-9999px' };
    await nextTick();
    positionPopover();
  }
}

/** Opens the foot link externally (native-safe) and closes the popover. */
function openLink() {
  if (!props.link) return;
  openExternal(props.link.href);
  show.value = false;
}

function onDocClick(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) show.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <span ref="el" class="relative inline-flex">
    <!-- Pill trigger: word + "?" badge (bigger tap target). Both trigger
         branches keep ref="btn" so positionPopover() can measure either. -->
    <button
      v-if="triggerLabel"
      ref="btn"
      type="button"
      class="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors"
      :class="
        dark
          ? 'bg-white/10 text-white/85 hover:bg-white/20'
          : 'bg-heritage-orange/10 text-heritage-orange hover:bg-heritage-orange/20'
      "
      @click.stop="toggle"
    >
      {{ triggerLabel }}
      <span
        class="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[0.625rem] leading-none font-bold"
        :class="dark ? 'bg-white/20' : 'bg-heritage-orange/20'"
        >?</span
      >
    </button>
    <!-- Default bare "?" badge (all existing call sites). -->
    <button
      v-else
      ref="btn"
      type="button"
      class="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-[0.625rem] leading-none font-bold"
      :class="
        dark
          ? 'bg-white/15 text-white/60 hover:bg-white/25'
          : 'dark:bg-surface-hover dark:text-ink-soft dark:hover:bg-surface-hover bg-gray-200 text-gray-500 hover:bg-gray-300'
      "
      @click.stop="toggle"
    >
      ?
    </button>
    <Teleport to="body">
      <div
        v-if="show"
        ref="popover"
        style="font-family: var(--font-inter)"
        class="z-[200] w-72 max-w-[calc(100vw-2rem)] rounded-xl p-3 text-xs leading-relaxed font-normal tracking-normal normal-case shadow-lg"
        :class="
          dark
            ? 'bg-secondary-600 border border-white/15 text-white/85'
            : 'dark:border-line-strong dark:bg-surface-overlay dark:text-ink-soft border border-gray-200 bg-white text-gray-600'
        "
        :style="popoverStyle"
        @click.stop
      >
        <!-- Plain text (or intro line before bullets) -->
        <template v-if="text">{{ text }}</template>
        <!-- Bulleted list mode -->
        <template v-if="items">
          <ul class="m-0 list-none space-y-1.5 p-0" :class="text ? 'mt-2' : ''">
            <li v-for="(item, i) in items" :key="i" class="flex gap-2">
              <span class="mt-px shrink-0 opacity-50">&#x2022;</span>
              <span>{{ item }}</span>
            </li>
          </ul>
        </template>
        <!-- Optional foot link → opens externally (native-safe) and closes. -->
        <button
          v-if="link"
          type="button"
          class="text-heritage-orange mt-2.5 block w-full cursor-pointer border-t pt-2.5 text-left text-xs font-semibold hover:underline"
          :class="dark ? 'border-white/15' : 'dark:border-line-strong border-gray-200'"
          @click.stop="openLink"
        >
          {{ link.text }}
        </button>
      </div>
    </Teleport>
  </span>
</template>
