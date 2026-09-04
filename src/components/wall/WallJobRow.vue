<script setup lang="ts">
/**
 * One tickable job. Presentational except for the lock, which it injects
 * because it is four levels below the page.
 *
 * Ticking is the ONE thing a locked wall allows — that is the whole point of
 * the surface, and it is why the lock does not gate this handler.
 *
 * THE TICK IS ONE ORCHESTRATED BEAT, not four things happening at once. It used
 * to be exactly that: the row dimmed to 60% while the CRDT write landed, the
 * tick swapped colour with no motion, the strike and the 50% fade snapped on,
 * and then the row TELEPORTED to the bottom of its column (jobs sort
 * outstanding-first) — all while five beans animated up from where the row had
 * been a moment earlier. Four uncoordinated events read as a stutter.
 *
 * Now, from the tap:
 *   0ms    the tick fills and springs, the check draws in, beans leave the tick
 *   0ms    the strike sweeps left-to-right as the title fades back
 *   ~160ms the row GLIDES to its resting place (FLIP, see WallJobList)
 * and nothing dims at any point.
 */
import { computed, inject, ref, watch } from 'vue';
import { WALL_LOCK } from '@/components/wall/wallLockKey';
import { WALL_BURST } from '@/components/wall/wallBurstKey';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { WallJob } from '@/types/wall';

/** Long enough to cover the spring; short enough never to double-fire. */
const POP_MS = 460;

const props = defineProps<{
  job: WallJob;
  pending?: boolean;
  /** Whose job this is, when the surrounding list mixes people. */
  ownerLabel?: string;
  /**
   * That person's colour. Renders the name as a tinted pill, the same way a bean's
   * column header is washed in their colour — on a mixed list the owner is then
   * readable at a glance instead of being decoded from a line of grey text.
   */
  ownerColor?: string;
}>();
const emit = defineEmits<{ toggle: [WallJob] }>();

const { t } = useTranslation();
const lock = inject(WALL_LOCK, undefined);
const burst = inject(WALL_BURST, undefined);
const tickEl = ref<HTMLElement | null>(null);

/**
 * Show the new state the instant it is tapped, not when the write returns.
 * Waiting on the CRDT put the tick's spring at the mercy of write latency —
 * sometimes with the beans, sometimes after they had gone. Cleared as soon as
 * the store catches up, or when a refused write leaves `job.done` unchanged.
 */
const optimistic = ref<boolean | null>(null);
const isDone = computed(() => optimistic.value ?? props.job.done);

watch(
  () => props.job.done,
  () => (optimistic.value = null)
);
watch(
  () => props.pending,
  (isPending) => {
    if (!isPending) optimistic.value = null;
  }
);

/**
 * "Done 7:42" on a completed row. A wall has the width for it, and on a shared
 * screen the useful question about a ticked chore is *when* — it settles
 * "did you do that this morning or is that yesterday's tick?". Only rendered
 * once the store confirms, so it never appears against an optimistic tick that
 * has not landed.
 */
const doneAt = computed(() => {
  if (!props.job.done || !props.job.completedAt) return '';
  const when = new Date(props.job.completedAt);
  if (Number.isNaN(when.getTime())) return '';
  return fillTemplate(t('wall.doneAt'), {
    time: when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  });
});

/**
 * Only a LOCAL tick celebrates. Keying the spring off `job.done` alone meant
 * every already-done job popped on mount, so opening the board set off a dozen
 * animations nobody triggered.
 */
const celebrating = ref(false);
let popTimer: ReturnType<typeof setTimeout> | undefined;

function onTick() {
  if (props.pending) return;
  lock?.noteActivity();
  const nowDone = !isDone.value;
  optimistic.value = nowDone;

  if (nowDone) {
    celebrating.value = false;
    // Next frame, so re-ticking a row restarts the animation instead of being
    // swallowed because the class never left the element.
    requestAnimationFrame(() => (celebrating.value = true));
    if (popTimer) clearTimeout(popTimer);
    popTimer = setTimeout(() => (celebrating.value = false), POP_MS);

    // Fire on the way to DONE only, and optimistically: the burst is feedback
    // for the tap, and waiting on the write would put it a beat late on the one
    // surface where the person who tapped is standing across the room.
    if (tickEl.value) {
      const box = tickEl.value.getBoundingClientRect();
      burst?.(box.left + box.width / 2, box.top);
    }
  }
  emit('toggle', props.job);
}
</script>

<template>
  <button
    type="button"
    class="wall-job-row flex w-full items-center gap-3 py-2 text-left"
    :disabled="pending"
    :aria-pressed="isDone"
    @click="onTick"
  >
    <span
      ref="tickEl"
      class="wall-tick grid shrink-0 place-items-center rounded-full border-[2.5px] text-white"
      :class="[
        isDone ? 'is-done border-[#27AE60] bg-[#27AE60]' : 'border-[rgba(44,62,80,0.18)]',
        celebrating ? 'is-celebrating' : '',
      ]"
    >
      <span v-if="isDone" class="wall-check" aria-hidden="true">✓</span>
    </span>
    <span
      class="font-inter wall-job-title min-w-0 flex-1 leading-tight"
      :class="
        isDone ? 'text-secondary-400 dark:text-ink-faint' : 'text-secondary-500 dark:text-ink'
      "
    >
      <!--
        The strike lives on an INLINE span wrapping just the words. On the
        `flex-1` element it sized to the whole row, so the line shot out past
        the text and across the column.
      -->
      <span class="wall-strike" :class="isDone ? 'is-done' : ''">{{ job.title }}</span>
    </span>
    <span
      v-if="ownerLabel"
      class="font-inter wall-job-done-at text-secondary-500 dark:text-ink max-w-[7.5rem] shrink-0 truncate rounded-full px-2 py-0.5 font-semibold"
      :class="ownerColor ? '' : 'bg-[var(--tint-slate-10)]'"
      :style="ownerColor ? { background: `${ownerColor}2e` } : undefined"
    >
      {{ ownerLabel }}
    </span>
    <span
      v-if="doneAt"
      class="font-inter wall-job-done-at shrink-0 text-[var(--muted-text,#4d5d6c)] opacity-70"
    >
      {{ doneAt }}
    </span>
    <span v-if="job.listEmoji" class="wall-job-tag shrink-0 opacity-60" aria-hidden="true">
      {{ job.listEmoji }}
    </span>
  </button>
</template>

<style scoped>
/*
 * No `disabled:opacity-60`. Dimming the row for the duration of the write was a
 * flash of 60% opacity between the tap and the tick filling — read as a stutter,
 * and it fought the burst for attention. The button is still `disabled` so a
 * double-tap cannot fire two writes; it just no longer says so in grey.
 */
.wall-tick {
  transition:
    background-color 200ms ease,
    border-color 200ms ease;
}

.wall-tick.is-celebrating {
  animation: tick-pop 460ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes tick-pop {
  0% {
    transform: scale(1);
  }

  38% {
    transform: scale(1.22);
  }

  100% {
    transform: scale(1);
  }
}

.wall-check {
  animation: check-in 260ms 60ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
}

@keyframes check-in {
  0% {
    opacity: 0;
    transform: scale(0.4);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}

/*
 * The strike is a gradient sized from 0% to 100%, not `text-decoration`, which
 * cannot be animated — so it sweeps across the words at the speed of a pen
 * instead of appearing all at once.
 */
.wall-strike {
  background-image: linear-gradient(currentcolor, currentcolor);
  background-position: 0 58%;
  background-repeat: no-repeat;
  background-size: 0% 2px;

  /* inline, so the gradient measures the words rather than the flex track */
  display: inline;
  transition:
    background-size 260ms cubic-bezier(0.4, 0, 0.2, 1),
    color 260ms ease,
    opacity 260ms ease;
}

.wall-strike.is-done {
  background-size: 100% 2px;
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .wall-tick,
  .wall-strike {
    transition: none;
  }

  .wall-tick.is-celebrating,
  .wall-check {
    animation: none;
  }

  /* Still show the completed state — just without the sweep. */
  .wall-strike.is-done {
    text-decoration: line-through;
  }
}
</style>
