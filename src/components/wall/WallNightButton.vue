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
      class="wall-switch-btn text-secondary-500 dark:text-ink grid place-items-center rounded-[14px] bg-transparent opacity-50 transition-opacity hover:opacity-100"
      :title="t('wall.lock.nightNow')"
      :aria-label="t('wall.lock.nightNow')"
      @click="$emit('nightNow')"
    >
      <span aria-hidden="true">🌙</span>
    </button>
  </div>
</template>
