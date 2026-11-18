<script setup lang="ts">
/**
 * The footer's way into the family scrapbook (#140): a picture of a scrapbook, no word.
 *
 * Faces and a second tap on a lit chip open it too, but nobody finds those by looking. This
 * is the conventional door. It renders no button outside a wall (no `WALL_MEMORIES` provider)
 * or with the viewer switched off in the wall settings. It works while the wall is locked
 * (the viewer is read-only); while the wall is asleep or the viewer is open, `open` is a
 * no-op, and on close focus comes back here.
 *
 * Drawn at the bean chips' height (2.5rem) so the footer does not grow: the page sizes its
 * layout from `window.innerHeight`, which does not see the footer. The hit area reaches
 * 2.75rem through a pseudo-element. Its own component rather than a `WallFaceButton`, whose
 * contract is a bean's face.
 *
 * ONE DOOR (#154). The circle is an inner span, so the `<button>` is a row that can also hold
 * the default slot: the footer passes the beanies.family wordmark in, and the icon and the
 * wordmark become one button. The slot is not part of the accessible name (the label is), so
 * a screen reader still hears "Open the family scrapbook", not the brand. Where there is no
 * button (outside a wall, or the viewer off) the slot is drawn on its own, plain, so the
 * caller writes its lockup once.
 */
import { computed, inject } from 'vue';
import { WALL_MEMORIES } from '@/components/wall/wallMemoriesKey';
import { useTranslation } from '@/composables/useTranslation';

const memories = inject(WALL_MEMORIES, null);
const { t } = useTranslation();

const enabled = computed(() => memories?.enabled.value === true);

function onClick(event: MouseEvent): void {
  memories?.open('footer-button', event.currentTarget as Element | null);
}
</script>

<template>
  <button
    v-if="enabled"
    type="button"
    class="relative inline-flex shrink-0 cursor-pointer items-center gap-3 rounded-full before:absolute before:-inset-0.5 before:rounded-full before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AED6F1]"
    :aria-label="t('wall.memories.open')"
    :title="t('wall.memories.open')"
    aria-haspopup="dialog"
    data-test="wall-scrapbook-button"
    @click="onClick"
  >
    <span
      class="dark:bg-surface-paper dark:ring-line grid h-10 w-10 shrink-0 -rotate-3 place-items-center rounded-full bg-[#FDF6EC] shadow-[var(--card-shadow)] dark:ring-1"
      data-test="wall-scrapbook-icon"
    >
      <!-- A terracotta album with a ringed spine, a tilted photo on the cover and a small heart. -->
      <svg class="h-8 w-8" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect x="5" y="4" width="23" height="24" rx="3.5" fill="#E67E22" />
        <rect x="5" y="4" width="5" height="24" rx="2.5" fill="#F15D22" />
        <circle cx="7.5" cy="9" r="1.1" fill="#F8F9FA" />
        <circle cx="7.5" cy="16" r="1.1" fill="#F8F9FA" />
        <circle cx="7.5" cy="23" r="1.1" fill="#F8F9FA" />
        <g transform="rotate(-5 19 14)">
          <rect x="12.5" y="8" width="13" height="11.5" rx="1.2" fill="#F8F9FA" />
          <rect x="13.8" y="9.3" width="10.4" height="7" fill="#AED6F1" />
          <circle cx="21.6" cy="11.4" r="1.3" fill="#F15D22" />
          <path d="M13.8 16.3l3.4-3.6 2.4 2.4 1.6-1.4 3 2.6z" fill="#27AE60" />
        </g>
        <path
          d="M19 22.4c1-1.3 3-.4 3 1 0 1.3-1.7 2.2-3 3.1-1.3-.9-3-1.8-3-3.1 0-1.4 2-2.3 3-1z"
          fill="#F8F9FA"
        />
      </svg>
    </span>
    <slot />
  </button>
  <slot v-else />
</template>
