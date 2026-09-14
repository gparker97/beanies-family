<script setup lang="ts">
/**
 * "Night now" on the wall face, beside the view switcher.
 *
 * WHY IT IS A PEER OF THE SWITCHER RATHER THAN A BUTTON INSIDE IT
 * The switcher is a radio group: `WALL_VIEWS`, one active, `aria-pressed` on each. Night is an
 * ACTION, not a fifth view — putting it in that group would make one of the "views" a thing you
 * cannot be in, and would need a special case in an otherwise data-driven loop. Same pill
 * treatment so it reads as a peer control, its own element so it reads as a different KIND of
 * control.
 *
 * It was previously reachable only from the lock menu, two taps behind a ⋯ — which on a
 * wall-mounted tablet is exactly the kind of thing nobody finds. The lock-menu entry stays: it
 * is where someone goes who is already locking the wall for the night.
 *
 * ⚠️ Sized by the same `.wall-switch-btn` rule the switcher's buttons use, for the reason that
 * rule's own comment gives — a control a child reaches for on a wall-mounted tablet needs the
 * full target, and a missed tap on a wall looks identical to nothing having happened.
 *
 * ⚠️ FULL OPACITY, deliberately. It first carried the switcher's inactive class string verbatim,
 * `opacity-50 hover:opacity-100` — which on a touch-only wall never un-fades, and which beside
 * that switcher is the encoding for "not the active view". It read as a disabled fifth tab: the
 * exact misreading being a peer was meant to avoid. The feedback is a background on press, not a
 * permanent dimming.
 */
import { useTranslation } from '@/composables/useTranslation';

defineEmits<{ nightNow: [] }>();
const { t } = useTranslation();
</script>

<template>
  <div
    class="dark:bg-surface-raised flex shrink-0 rounded-[18px] bg-white p-1 shadow-[var(--card-shadow)]"
  >
    <button
      type="button"
      class="wall-switch-btn dark:hover:bg-surface-hover grid place-items-center rounded-[14px] bg-transparent transition-colors hover:bg-[var(--tint-slate-5)]"
      :title="t('wall.lock.nightNow')"
      :aria-label="t('wall.lock.nightNow')"
      @click="$emit('nightNow')"
    >
      <span aria-hidden="true">🌙</span>
    </button>
  </div>
</template>
