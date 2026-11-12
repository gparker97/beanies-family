<script setup lang="ts">
/**
 * The family timeline (#140): one scrapbook, newest first, grouped by month, with a bean row
 * to narrow it and a month rail to jump around. Shared by the wall's memories viewer
 * (read-only) and the Scrapbook page's Timeline view (interactive).
 *
 * It does NOT own a scroller. The wall viewer supplies a bounded one; the Scrapbook page
 * scrolls with the document, so a phone never gets a scroller inside a scroller. The bean row
 * and the rail are sticky inside whichever one it is. A caller can tune that with four custom
 * properties:
 *  - `--scrapbook-timeline-top`: how far from the top of the scroller the sticky parts sit
 *    (a page with its own sticky header passes that header's height);
 *  - `--scrapbook-timeline-scroller-pad`: the scroller's own top padding. A sticky offset is
 *    measured inside that padding, so without it the row would park that far below the top
 *    edge with content scrolling through the gap (the app's `<main>` pads 1rem / 1.5rem);
 *  - `--scrapbook-timeline-viewport`: the visible height of the scroller, which caps the
 *    rail so a long history scrolls inside it rather than running off the screen;
 *  - `--scrapbook-timeline-rail-end`: the rail's bottom padding (1rem when unset), so a page
 *    with a floating button in its corner can let the last month scroll clear of it.
 *
 * Text sizes: the standard scale for the page, plus `wall-*` hooks that the wall's own type
 * scale (`BeanieWallPage.vue`) overrides from inside `.wall-root`. The wall rule is the more
 * specific one, so each surface gets its own size from one template.
 *
 * `readOnly` renders bare pieces with nothing to press and emits no `entry-click`; the bean
 * row and the rail still work, because they only move the reader around.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ScrapbookPiece from '@/components/scrapbook/ScrapbookPiece.vue';
import ScrapbookEntryCard from '@/components/scrapbook/ScrapbookEntryCard.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useScrapbookTimeline } from '@/composables/useScrapbookTimeline';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { formatMonthShort, formatMonthYear } from '@/utils/date';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { TimelineMonth } from '@/utils/scrapbookTimeline';
import type { FamilyMember, UUID } from '@/types/models';

const props = withDefaults(
  defineProps<{
    /**
     * The bean row, in order. Only the row: each card's owner face comes from the whole
     * family, so a pet's card has its face on a wall whose row is humans only.
     */
    beans: readonly FamilyMember[];
    /** The enabled memory types. Empty shows the `#empty` slot, never everything. */
    types: ReadonlySet<ScrapType>;
    readOnly?: boolean;
  }>(),
  { readOnly: false }
);

const emit = defineEmits<{ 'entry-click': [entry: ScrapbookEntry] }>();

/** `null` is everyone; a bean id is that bean plus the whole-family moments. */
const memberId = defineModel<UUID | null>('memberId', { default: null });

const { t, currentLanguage } = useTranslation();
const familyStore = useFamilyStore();
const { memberAvatarBindings } = useMemberAvatarBindings();
const { prefersReducedMotion } = useReducedMotion();

const { months, isEmpty } = useScrapbookTimeline({
  memberId: () => memberId.value,
  types: () => props.types,
});

/**
 * One set of avatar bindings per bean in the whole family (the feed's own roster, whatever
 * the bean row shows), built once per roster change rather than per card per render.
 */
const faceById = computed(
  () => new Map(familyStore.members.map((m) => [m.id, memberAvatarBindings(m)]))
);

/** The face of the bean whose card this is, or `null` for a whole-family moment. */
function ownerFace(entry: ScrapbookEntry) {
  return (entry.memberId && faceById.value.get(entry.memberId)) || null;
}

const monthDate = (m: TimelineMonth) => new Date(m.year, m.monthIndex, 1);
const monthLabel = (m: TimelineMonth) => formatMonthYear(monthDate(m), currentLanguage?.value);
const monthShort = (m: TimelineMonth) => formatMonthShort(monthDate(m), currentLanguage?.value);

/** The rail: months under their year, newest first (the months already are). */
const railYears = computed(() => {
  const years: { year: number; months: TimelineMonth[] }[] = [];
  for (const month of months.value) {
    const last = years[years.length - 1];
    if (last && last.year === month.year) last.months.push(month);
    else years.push({ year: month.year, months: [month] });
  }
  return years;
});

const sections = new Map<string, HTMLElement>();
function setSection(key: string, el: unknown): void {
  if (el instanceof HTMLElement) sections.set(key, el);
  else sections.delete(key);
}

function jumpTo(key: string): void {
  const section = sections.get(key);
  // `scrollIntoView` is missing in jsdom and in some embedded webviews; a rail that does
  // nothing there is better than one that throws.
  if (!section || typeof section.scrollIntoView !== 'function') return;
  section.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion.value ? 'auto' : 'smooth',
  });
}

defineExpose({ isEmpty });
</script>

<template>
  <div class="scrapbook-timeline">
    <div
      class="st-beans sticky z-[3] flex items-center gap-2.5 overflow-x-auto"
      role="group"
      :aria-label="t('scrapbook.timeline.beans')"
    >
      <button
        type="button"
        class="st-chip font-outfit wall-chip-person shrink-0 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap"
        :class="
          memberId === null ? 'st-chip-lit' : 'st-paper-tint text-secondary-500 dark:text-ink'
        "
        :aria-pressed="memberId === null"
        @click="memberId = null"
      >
        {{ t('scrapbook.spine.everyone') }}
      </button>
      <button
        v-for="bean in beans"
        :key="bean.id"
        type="button"
        class="st-chip font-outfit wall-chip-person flex shrink-0 items-center gap-2 rounded-full py-1 pr-4 pl-1 text-sm font-semibold whitespace-nowrap"
        :class="
          memberId === bean.id ? 'st-chip-lit' : 'st-paper-tint text-secondary-500 dark:text-ink'
        "
        :aria-pressed="memberId === bean.id"
        @click="memberId = bean.id"
      >
        <BeanieAvatar
          v-bind="faceById.get(bean.id) ?? memberAvatarBindings(bean)"
          aria-label=""
          fallback="initials"
          size="sm"
        />
        {{ bean.name }}
      </button>
    </div>

    <slot v-if="isEmpty" name="empty" />

    <div v-else class="flex items-start gap-3">
      <div class="@container min-w-0 flex-1 pt-2 pl-3">
        <section
          v-for="month in months"
          :key="month.key"
          :ref="(el) => setSection(month.key, el)"
          class="st-month relative border-l-2 border-[var(--tint-slate-10)] pb-6 pl-6"
          :data-month="month.key"
        >
          <h3
            class="font-outfit wall-timeline-month text-secondary-500 dark:text-ink relative mb-4 text-lg font-extrabold"
          >
            <span class="st-dot" aria-hidden="true" />
            {{ monthLabel(month) }}
          </h3>
          <div
            class="grid grid-cols-1 items-start gap-x-6 gap-y-5 @sm:grid-cols-2 @3xl:grid-cols-3"
          >
            <div
              v-for="(entry, index) in month.entries"
              :key="entry.id"
              class="st-card relative"
              :class="{ 'st-tilt': entry.type !== 'saying' }"
            >
              <!-- Two reads of one cached object per bean (a Map get): no new bindings per render. -->
              <span v-if="ownerFace(entry)" class="st-owner absolute z-[2] rounded-full">
                <BeanieAvatar v-bind="ownerFace(entry) ?? {}" fallback="initials" size="sm" />
              </span>
              <ScrapbookPiece
                v-if="readOnly"
                :entry="entry"
                :note-index="index"
                emphasize-photo
                photo-size="screen"
              />
              <ScrapbookEntryCard
                v-else
                :entry="entry"
                :note-index="index"
                emphasize-photo
                photo-size="screen"
                @click="emit('entry-click', $event)"
              />
            </div>
          </div>
        </section>
      </div>

      <nav
        class="st-rail sticky flex w-20 shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-l border-[var(--tint-slate-10)] px-2 pt-2"
        :aria-label="t('scrapbook.timeline.jump')"
      >
        <template v-for="group in railYears" :key="group.year">
          <p
            class="font-outfit wall-timeline-rail-year text-primary-700 dark:text-accent-lift mt-2 text-center text-sm font-extrabold"
          >
            {{ group.year }}
          </p>
          <button
            v-for="month in group.months"
            :key="month.key"
            type="button"
            class="st-paper-tint font-outfit wall-timeline-rail-month text-secondary-500 dark:text-ink rounded-full py-1.5 text-xs font-semibold"
            :aria-label="monthLabel(month)"
            @click="jumpTo(month.key)"
          >
            {{ monthShort(month) }}
          </button>
        </template>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.scrapbook-timeline {
  /* The bean row's fixed height, so the rail and a jumped-to month can sit just below it. */
  --st-beans-h: 3.75rem;
  --st-sticky-top: var(--scrapbook-timeline-top, 0px);

  /* The sticky `top` that puts a part at `--st-sticky-top` from the scroller's visible edge. */
  --st-stick-at: calc(var(--st-sticky-top) - var(--scrapbook-timeline-scroller-pad, 0px));
}

/*
 * The bean row paints the paper so the timeline scrolls UNDER it. Literal paper values,
 * matching `.scrapbook-paper` in style.css, because the row is only ever on that ground.
 */
.st-beans {
  background-color: #f7efe1;
  height: var(--st-beans-h);
  scrollbar-width: none;
  top: var(--st-stick-at);
}

html.dark .st-beans {
  background-color: #2a2119;
}

/* An unlit chip and a rail button: the taped-card tint (the house "dim the paper" rule). */
.st-paper-tint {
  background: #fffaf0;
}

html.dark .st-paper-tint {
  background: rgb(255 250 240 / 7%);
}

/* The lit chip: Deep Slate on light; on dark the ink becomes the ground, as the wall's pills do. */
.st-chip-lit {
  background: var(--color-secondary-500);
  color: #fff;
}

html.dark .st-chip-lit {
  background: var(--color-ink);
  color: var(--color-surface-ground);
}

.st-month {
  /* A jump lands the month heading just below the sticky bean row, never under it. */
  scroll-margin-top: calc(var(--st-sticky-top) + var(--st-beans-h) + 0.5rem);
}

html.dark .st-month {
  border-color: var(--color-line);
}

/* The month's dot on the timeline's spine: Heritage Orange, ringed in the paper colour. */
.st-dot {
  background: var(--color-primary-500);
  border-radius: 9999px;
  box-shadow: 0 0 0 0.25em #f7efe1;
  height: 0.85em;
  left: calc(-1.5rem - 1px - 0.425em);
  position: absolute;
  top: 0.35em;
  width: 0.85em;
}

html.dark .st-dot {
  box-shadow: 0 0 0 0.25em #2a2119;
}

.st-tilt:nth-child(odd) {
  transform: rotate(-1.2deg);
}

.st-tilt:nth-child(even) {
  transform: rotate(1deg);
}

/* Whose card this is: a small face over its top-left corner, ringed in the paper colour. */
.st-owner {
  box-shadow: 0 0 0 0.18rem #f7efe1;
  left: -0.6rem;
  top: -0.6rem;
}

html.dark .st-owner {
  box-shadow: 0 0 0 0.18rem #2a2119;
}

.st-rail {
  max-height: calc(
    var(--scrapbook-timeline-viewport, 100dvh) - var(--st-sticky-top) - var(--st-beans-h)
  );
  overscroll-behavior: contain;
  padding-bottom: var(--scrapbook-timeline-rail-end, 1rem);
  scrollbar-width: thin;
  top: calc(var(--st-stick-at) + var(--st-beans-h));
}

html.dark .st-rail {
  border-color: var(--color-line);
}
</style>
