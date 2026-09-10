<script setup lang="ts">
/**
 * The trip, as a spine: every booking, in the order it happens, grouped by day.
 *
 * A trip really IS a sequence, so the rail carries information rather than
 * decorating. It also makes "four flights" countable from across a kitchen,
 * which is the thing that failed: the wall used to build its own leg list from
 * `travelSegments.slice(0, 3)`, so a family with four flights saw three, and
 * hotels and ground transport never reached the screen at all.
 *
 * Its own component rather than a seventh branch inlined in `WallSheet`, which
 * is already long enough to stop being read. This branch is the least coupled
 * of them: no target, no member filter, no pending state, and it emits nothing.
 *
 * Everything it displays is computed by `useVacationTimeline`, the same rule the
 * travel page renders, so the wall cannot hold a second opinion about when a
 * flight leaves or what a trip contains. This file only decides how it looks at
 * wall scale.
 */
import SegmentWhenBand from '@/components/travel/SegmentWhenBand.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { DateGroup, TimelineItem } from '@/composables/useVacationTimeline';

defineProps<{
  /** Dated bookings, already ordered and grouped. */
  groups: DateGroup[];
  /** Bookings with no date yet. Shown, never dropped. */
  undated: TimelineItem[];
}>();

const { t } = useTranslation();
</script>

<template>
  <div class="wall-trip-timeline">
    <div v-for="group in groups" :key="group.date" class="wall-day">
      <div class="wall-day-rail">
        <span class="wall-day-chip font-outfit">{{ group.label }}</span>
      </div>
      <div class="wall-day-items">
        <div v-for="item in group.items" :key="item.id" class="wall-node">
          <div class="wall-node-rail">
            <span
              class="wall-node-dot dark:bg-surface-raised grid place-items-center rounded-full bg-white"
              :class="item.kind === 'accommodation' ? 'is-stay' : ''"
              aria-hidden="true"
              >{{ item.icon }}</span
            >
          </div>
          <div class="min-w-0">
            <p class="font-outfit wall-sheet-line mb-1 flex flex-wrap items-center gap-2 font-bold">
              <span class="dark:text-ink text-secondary-500">{{ item.title }}</span>
              <span
                v-if="item.keyValue"
                class="font-inter wall-card-sub text-[var(--muted-text,#4d5d6c)]"
              >
                {{ item.keyValue }}
              </span>
              <!--
                Same gold "needs booking" treatment the sheet header already
                uses, so one trip does not describe an unbooked thing two ways.
              -->
              <span
                v-if="item.status === 'pending'"
                class="font-outfit wall-card-sub dark:text-terracotta-lift ml-auto rounded-lg bg-[var(--vacation-gold-tint,rgba(255,217,61,0.18))] px-2 py-0.5 font-semibold text-amber-700"
              >
                <span aria-hidden="true">⏳</span> {{ t('wall.trip.unbookedLeg') }}
              </span>
            </p>
            <SegmentWhenBand v-if="item.timing" :band="item.timing.band" />
          </div>
        </div>
      </div>
    </div>

    <!--
      A hotel with no dates yet would otherwise simply be absent, which is
      indistinguishable from the bug this replaces.
    -->
    <template v-if="undated.length">
      <p
        class="font-outfit wall-list-title dark:text-ink-soft mt-4 mb-1 font-bold tracking-[0.08em] text-[var(--muted-text,#4d5d6c)] uppercase"
      >
        {{ t('vacation.stillDeciding') }}
      </p>
      <div v-for="item in undated" :key="item.id" class="wall-node">
        <div class="wall-node-rail">
          <span
            class="wall-node-dot dark:bg-surface-raised grid place-items-center rounded-full bg-white"
            aria-hidden="true"
            >{{ item.icon }}</span
          >
        </div>
        <p class="font-outfit wall-sheet-line dark:text-ink text-secondary-500 min-w-0 font-bold">
          {{ item.title }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * The rail. `--vacation-teal` and its tints already carry dark partners in
 * `style.css`, so every colour here resolves in both modes with no local
 * override; nothing is painted with a raw hex.
 */
.wall-day,
.wall-node {
  display: grid;
  gap: 0 0.9rem;
  grid-template-columns: 3.25rem 1fr;
}

.wall-day-rail,
.wall-node-rail {
  align-items: center;
  display: flex;
  justify-content: center;
  position: relative;
}

/* One continuous line behind every node, drawn per day block. */
.wall-day-rail::before {
  background: var(--vacation-teal-15);
  bottom: 0;
  content: '';
  left: 50%;
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  width: 2px;
}

.wall-day-chip {
  background: var(--vacation-teal);
  border-radius: 0.65rem;
  color: #04323b;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.2;
  padding: 0.3rem 0.35rem;
  position: relative;
  text-align: center;
  width: 100%;
  z-index: 1;
}

.wall-day-items {
  padding-block: 0.15rem 1.1rem;
}

.wall-node {
  margin-top: 0.85rem;
}

.wall-day-items > .wall-node:first-child {
  margin-top: 0;
}

.wall-node-dot {
  border: 2px solid var(--vacation-teal-15);
  font-size: 1.15rem;
  height: 2.4rem;
  position: relative;
  width: 2.4rem;
  z-index: 1;
}

/*
 * A stay is a SPAN, not a moment: it covers the nights between two flights, so
 * it reads as a bracket rather than a disc. The band underneath already says
 * check in and check out, so nothing new had to be invented to show it.
 */
.wall-node-dot.is-stay {
  border-radius: 0.9rem;
  border-style: dashed;
  height: 3.1rem;
}

@media (width <= 700px) {
  .wall-day,
  .wall-node {
    gap: 0 0.6rem;
    grid-template-columns: 2.6rem 1fr;
  }

  .wall-node-dot {
    font-size: 1rem;
    height: 2.1rem;
    width: 2.1rem;
  }
}
</style>
