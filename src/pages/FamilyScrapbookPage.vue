<script setup lang="ts">
/**
 * Family Scrapbook — `/pod/scrapbook`. Tabbed scrapbook of spreads.
 *
 * The horizontal `<ScrapbookSpine>` pages between **Everyone** (the
 * family bulletin board) and each bean's individual magazine-style
 * spread. Kraft-paper page background; CSS-only scrapbook decorations
 * (taped paper, ripped paper, washi tape) on the cards.
 *
 * Default landing tab = Everyone. The page's `+ Add` button opens the
 * existing QuickAddSheet flow (filtered to scrapbook-relevant items)
 * via the `useQuickAdd` singleton.
 *
 * Lightbox: `useMilestoneLightbox` is a module-level singleton (post
 * 2026-05-07 redesign), so any deeply-nested card calls `openFor(m)`
 * and the page-level `<PhotoViewer>` responds. No prop drilling.
 *
 * See docs/plans/2026-05-07-family-scrapbook-redesign.md for context.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BackLink from '@/components/common/BackLink.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import ScrapbookTimeline from '@/components/scrapbook/ScrapbookTimeline.vue';
import ScrapbookSpine from '@/components/scrapbook/ScrapbookSpine.vue';
import EveryoneSpread from '@/components/scrapbook/EveryoneSpread.vue';
import BeanSpread from '@/components/scrapbook/BeanSpread.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useQuickAdd } from '@/composables/useQuickAdd';
import { usePersistedChoice } from '@/composables/usePersistedChoice';
import { logEvent } from '@/services/telemetry/logEvent';
import { WALL_MEMORY_TYPES } from '@/utils/wallMemories';
import { useMilestoneLightbox } from '@/composables/useMilestoneLightbox';
import { useFamilyStore } from '@/stores/familyStore';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { Milestone, UUID } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();
const { open: openQuickAddSheet } = useQuickAdd();
const lightbox = useMilestoneLightbox();

// --- View switch (Spreads / Timeline) ----------------------------------

type ScrapbookView = 'spreads' | 'timeline';
const SCRAPBOOK_VIEWS: readonly ScrapbookView[] = ['spreads', 'timeline'];

/** Per device, like the cookbook's sort: one person's choice never re-lays another's screen. */
const view = usePersistedChoice<ScrapbookView>('beanies:scrapbookView', SCRAPBOOK_VIEWS, 'spreads');

const viewOptions = computed(() => [
  { value: 'spreads', label: t('scrapbook.view.spreads') },
  { value: 'timeline', label: t('scrapbook.view.timeline') },
]);

function onViewChange(next: string): void {
  if (next !== 'spreads' && next !== 'timeline') return;
  if (next === view.value) return;
  view.value = next;
  logEvent({
    level: 'info',
    surface: 'scrapbook',
    message: 'scrapbook_view_change',
    context: { kind: next },
  });
}

/** The timeline's own bean filter; the page's full memory set, never narrowed. */
const timelineMemberId = ref<UUID | null>(null);
const timelineTypes: ReadonlySet<ScrapType> = new Set(WALL_MEMORY_TYPES);

// --- Spread switcher --------------------------------------------------

const activeSpread = ref<'everyone' | UUID>('everyone');

/**
 * Direction the next page-turn animation should play. `'forward'` =
 * the new spread is later in the roster than the current one (the
 * "right page" turning leftward). `'backward'` = inverse. Set
 * BEFORE mutating `activeSpread` so the `<Transition :name>` is
 * correct by the time Vue runs the leave/enter cycle.
 */
const transitionDirection = ref<'forward' | 'backward'>('forward');

const transitionName = computed(() =>
  transitionDirection.value === 'forward' ? 'page-flip-forward' : 'page-flip-backward'
);

/**
 * Index of a spread in the spine's render order. `'everyone'` is
 * always at 0; beans follow `sortedMembers` order (humans + pets).
 * Used to decide whether a tap is forward or backward in the "book."
 */
function spreadIndex(id: 'everyone' | UUID): number {
  if (id === 'everyone') return 0;
  return familyStore.sortedMembers.findIndex((h) => h.id === id) + 1;
}

function onSpineSelect(id: 'everyone' | UUID): void {
  if (id === activeSpread.value) return;
  const oldIdx = spreadIndex(activeSpread.value);
  const newIdx = spreadIndex(id);
  transitionDirection.value = newIdx >= oldIdx ? 'forward' : 'backward';
  activeSpread.value = id;
}

// Activeguard: if the chosen bean is removed (delete / family change),
// bounce back to Everyone so we never render a BeanSpread with a stale
// UUID. `immediate: true` covers the initial-load case where
// activeSpread might somehow be a pre-existing UUID that's now gone.
watch(
  () => familyStore.sortedMembers,
  (members) => {
    if (activeSpread.value === 'everyone') return;
    const stillExists = members.some((m) => m.id === activeSpread.value);
    if (!stillExists) {
      // Treat the auto-bounce as a backward turn (returning to the
      // overview) — feels more natural than a forward-flip into the
      // overview the user didn't choose.
      transitionDirection.value = 'backward';
      activeSpread.value = 'everyone';
    }
  },
  { immediate: true }
);

// --- Add-to-scrapbook --------------------------------------------------

function openAddSheet(): void {
  openQuickAddSheet({
    filter: ['add-saying', 'add-favorite', 'add-note', 'add-milestone'],
  });
}

// FAB-driven intents arriving with `?action=add-X&memberId=Y` route
// directly to the bean's pod tab — same behaviour as before the
// redesign.
const ACTION_TO_BEAN_TAB: Record<string, 'sayings' | 'favorites' | 'notes'> = {
  'add-saying': 'sayings',
  'add-favorite': 'favorites',
  'add-note': 'notes',
};

useQuickAddIntent(async (action, { memberId }) => {
  const tab = ACTION_TO_BEAN_TAB[action];
  if (!tab || !memberId) return;
  await router.push({
    path: `/pod/${memberId}/${tab}`,
    query: { action },
  });
});

// --- Entry click dispatch ----------------------------------------------
//
// Both spreads emit `entry-click` with a ScrapbookEntry. Family-wide
// milestones (memberId === null) have no per-bean tab to route to, so
// we open the lightbox if photos exist and otherwise no-op. Bean-owned
// entries route to the owning bean's pod tab.

const TYPE_TO_TAB: Record<ScrapType, string> = {
  saying: 'sayings',
  favorite: 'favorites',
  note: 'notes',
  milestone: 'milestones',
};

function onEntryClick(entry: ScrapbookEntry): void {
  if (entry.type === 'milestone' && entry.memberId === null) {
    lightbox.openFor(entry.payload as Milestone);
    return;
  }
  if (entry.memberId === null) return;
  const tab = TYPE_TO_TAB[entry.type];
  if (!tab) return;
  router.push(`/pod/${entry.memberId}/${tab}`);
}
</script>

<template>
  <div
    class="scrapbook-paper relative -mx-4 -my-4 min-h-screen px-4 py-4 sm:-mx-6 sm:-my-6 sm:px-6 sm:py-6"
  >
    <!-- Hero header — kept from previous design (multicolor kraft band
         with 📖 watermark). The "+ Add to scrapbook" button stays here. -->
    <header
      class="kraft-band kraft-band-scrapbook relative mb-5 overflow-hidden rounded-[var(--sq)] px-5 py-5 sm:px-8 sm:py-7"
    >
      <span
        class="pointer-events-none absolute top-3 right-7 text-[8.125rem] opacity-10"
        style="transform: rotate(-8deg)"
        aria-hidden="true"
      >
        📖
      </span>
      <BackLink :fallback="'/pod'" :label="t('bean.backToPod')" class="mb-1" />
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h1
            class="font-outfit text-secondary-500 dark:text-ink text-2xl leading-tight font-extrabold break-words sm:text-3xl sm:leading-none"
          >
            {{ t('scrapbook.title') }}
          </h1>
          <p class="font-caveat dark:text-terracotta-lift mt-1 text-xl font-medium text-[#E67E22]">
            {{ t('scrapbook.subtitle') }}
          </p>
          <!-- The pills' resting ink is slate-500, made for white cards; on this pastel band it
               measures 3.6-3.8:1. Scoped here to the house muted ink for tinted grounds
               (`--muted-text`, 5.4:1 on the band), so other callers keep their look. Dark mode
               reads `ink-soft` from the pill itself and never sees this token. -->
          <div
            role="group"
            :aria-label="t('scrapbook.view.label')"
            class="mt-3 [--color-text-muted:var(--muted-text)]"
          >
            <TogglePillGroup
              :model-value="view"
              :options="viewOptions"
              @update:model-value="onViewChange"
            />
          </div>
        </div>
        <button
          type="button"
          class="font-outfit bg-primary-500 hover:bg-primary-600 inline-flex flex-shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors"
          :aria-label="t('scrapbook.add')"
          @click="openAddSheet"
        >
          <BeanieIcon name="plus" size="xs" />
          <span class="hidden sm:inline">{{ t('scrapbook.add') }}</span>
        </button>
      </div>
    </header>

    <!-- The app's <main> scrolls this page and pads its top by 1rem (md: 1.5rem). Telling the
         timeline lets its bean row stick flush under the app header instead of that far below.
         `timeline-fit` gives it the scroller's real visible height for its month rail. -->
    <ScrapbookTimeline
      v-if="view === 'timeline'"
      v-model:member-id="timelineMemberId"
      class="timeline-fit [--scrapbook-timeline-scroller-pad:1rem] md:[--scrapbook-timeline-scroller-pad:1.5rem]"
      :beans="familyStore.sortedMembers"
      :types="timelineTypes"
      :read-only="false"
      @entry-click="onEntryClick"
    >
      <template #empty>
        <p class="font-caveat dark:text-ink-soft text-secondary-500 py-8 text-center text-xl">
          {{ t('scrapbook.everyone.empty') }}
        </p>
      </template>
    </ScrapbookTimeline>

    <template v-else>
      <ScrapbookSpine
        :beans="familyStore.sortedMembers"
        :active-id="activeSpread"
        @select="onSpineSelect"
      />

      <div class="spread-stage">
        <Transition :name="transitionName" mode="out-in">
          <EveryoneSpread
            v-if="activeSpread === 'everyone'"
            key="everyone"
            @entry-click="onEntryClick"
            @open-add="openAddSheet"
            @select-bean="onSpineSelect"
          />
          <BeanSpread
            v-else
            :key="activeSpread"
            :member-id="activeSpread"
            @entry-click="onEntryClick"
            @open-add="openAddSheet"
          />
        </Transition>
      </div>
    </template>

    <!-- Read-only lightbox for milestone photos. Wired to the
         module-level `useMilestoneLightbox` singleton so any
         deeply-nested card opens it directly via `openFor`. -->
    <PhotoViewer
      :open="lightbox.isOpen.value"
      :photo-ids="lightbox.photoIds.value"
      :initial-index="0"
      read-only
      @close="lightbox.close"
    />
  </div>
</template>

<style scoped>
/*
 * The timeline's month rail is capped to the visible part of the scroller, so a long history
 * scrolls inside the rail instead of running below the fold. That is `<main>` (App.vue
 * publishes its height, so the app header and any banner are already out of it) less the
 * phone tab bar that overlays its bottom (unset on desktop, so 0).
 *
 * The quick-add button floats in the bottom-right corner (`QuickAddFab`: 4rem tall, at
 * `--fab-anchor-bottom` from the screen's bottom), over the rail's last buttons. The rail's
 * end padding lets its last month scroll clear of it: the button's top, measured from the
 * rail's bottom edge (which sits above the tab bar on a phone), plus a small gap. The wall
 * viewer has no such button and keeps the default.
 */
.timeline-fit {
  --scrapbook-timeline-viewport: calc(var(--app-main-h, 100dvh) - var(--mobile-nav-h, 0px));
  --scrapbook-timeline-rail-end: calc(var(--fab-anchor-bottom) + 4.5rem - var(--mobile-nav-h, 0px));
}

/* 3D perspective on the spread container so child rotateY transforms
   read as a paper-page hinging in/out, not a flat sprite skew. */
.spread-stage {
  perspective: 1500px;
}

/* ── Page-flip transition between spreads ─────────────────────────────
 * Two directional variants — `forward` plays when the user picks a
 * spread later in the spine roster; `backward` for earlier. Both pivot
 * the leaving page on its inside edge (toward the spine of the book)
 * so the motion reads as turning a real page.
 *
 * Uses `mode="out-in"` (set in the template), so the leave finishes
 * before the enter starts. Total ~530ms — long enough to register as
 * a deliberate gesture, short enough not to feel sluggish.
 *
 * Falls back to a simple opacity crossfade under prefers-reduced-motion.
 * ─────────────────────────────────────────────────────────────────── */

/* Forward turn — old page hinges on its LEFT edge and rotates out
   leftward; new page enters from the right hinged on its left edge. */
.page-flip-forward-leave-active {
  transform-origin: left center;
  transition:
    transform 260ms cubic-bezier(0.4, 0, 0.7, 0.2),
    opacity 220ms ease-in;
}

.page-flip-forward-leave-to {
  opacity: 0;
  transform: rotateY(-65deg);
}

.page-flip-forward-enter-active {
  transform-origin: left center;
  transition:
    transform 280ms cubic-bezier(0.2, 0.6, 0.3, 1),
    opacity 240ms ease-out;
}

.page-flip-forward-enter-from {
  opacity: 0;
  transform: rotateY(65deg);
}

/* Backward turn — mirror image, hinge on the RIGHT edge. */
.page-flip-backward-leave-active {
  transform-origin: right center;
  transition:
    transform 260ms cubic-bezier(0.4, 0, 0.7, 0.2),
    opacity 220ms ease-in;
}

.page-flip-backward-leave-to {
  opacity: 0;
  transform: rotateY(65deg);
}

.page-flip-backward-enter-active {
  transform-origin: right center;
  transition:
    transform 280ms cubic-bezier(0.2, 0.6, 0.3, 1),
    opacity 240ms ease-out;
}

.page-flip-backward-enter-from {
  opacity: 0;
  transform: rotateY(-65deg);
}

@media (prefers-reduced-motion: reduce) {
  .page-flip-forward-enter-active,
  .page-flip-forward-leave-active,
  .page-flip-backward-enter-active,
  .page-flip-backward-leave-active {
    transition: opacity 200ms ease;
  }

  .page-flip-forward-enter-from,
  .page-flip-forward-leave-to,
  .page-flip-backward-enter-from,
  .page-flip-backward-leave-to {
    opacity: 0;
    transform: none;
  }
}
</style>
