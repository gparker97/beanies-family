<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue';

defineProps<{
  /** Hint text to display in the popover (plain text or array of bullet items) */
  text?: string;
  /** Array of bullet items — each rendered as a line with a marker */
  items?: string[];
  /** Use light-on-dark styling for dark card backgrounds */
  dark?: boolean;
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

function onDocClick(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) show.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <span ref="el" class="relative inline-flex">
    <button
      ref="btn"
      type="button"
      class="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-[10px] leading-none font-bold"
      :class="
        dark
          ? 'bg-white/15 text-white/60 hover:bg-white/25'
          : 'bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-slate-600 dark:text-gray-300 dark:hover:bg-slate-500'
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
            : 'border border-gray-200 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-300'
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
      </div>
    </Teleport>
  </span>
</template>
