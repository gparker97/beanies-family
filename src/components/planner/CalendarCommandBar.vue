<script setup lang="ts">
/**
 * Sticky command bar — the calendar's persistent chrome and the page hero.
 *
 * Presentational shell only: it composes existing children (`ViewToggle`,
 * `MemberChipFilter`, `MemberFilterMobileMenu`, `CalendarTripRibbon`) and the
 * absorbed `CalendarNavBar` prev/today/next markup, and emits intents upward.
 * It holds NO store access, navigation math, or persistence — those live in
 * the page (`usePlannerNavigation`, `useMemberFilterChips`) and the ribbon.
 *
 * Sticks to the top of the `<main>` scroll container, bleeding into its
 * padding (`-mx-4 px-4 md:-mx-6 md:px-6` + `-mt-4 pt-4 md:-mt-6 md:pt-6`) so
 * the period label and controls never scroll out of view and the bar reads
 * flush when pinned. `AppHeader` lives outside `<main>`, so `top-0` is correct.
 */
import ViewToggle from '@/components/planner/ViewToggle.vue';
import MemberChipFilter from '@/components/common/MemberChipFilter.vue';
import MemberFilterMobileMenu from '@/components/planner/MemberFilterMobileMenu.vue';
import CalendarPeriodNav from '@/components/planner/CalendarPeriodNav.vue';
import CalendarTripRibbon from '@/components/planner/CalendarTripRibbon.vue';
import MagicBeansDoor from '@/components/ai/MagicBeansDoor.vue';
import MagicReaderPill from '@/components/ai/MagicReaderPill.vue';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import HamburgerButton from '@/components/common/HamburgerButton.vue';
import SearchButton from '@/components/common/SearchButton.vue';
import NotificationsBell from '@/components/notifications/NotificationsBell.vue';
import { onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMobileMenu, useHeaderReclaimed } from '@/composables/useMobileMenu';
import { useSyncStore } from '@/stores/syncStore';
import { SAVE_STATUS_PRESENTATION } from '@/components/ui/saveStatusPresentation';
import type { PlannerView } from '@/composables/usePlannerNavigation';

defineProps<{
  label: string;
  activeView: PlannerView;
  canAdd: boolean;
  isAllActive: boolean;
  isMemberActive: (id: string) => boolean;
  activeMemberNames: string[];
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
  today: [];
  'update:activeView': [view: string];
  add: [];
  'open-agenda': [];
  'select-all': [];
  'select-member': [id: string];
  'vacation-click': [id: string];
}>();

const { t } = useTranslation();

// On the mobile/tablet planner, the global AppHeader is hidden (App.vue) and
// this bar IS the top bar — so it hosts its own hamburger (opens the same
// MobileHamburgerMenu) and search. `headerReclaimed` is the single shared
// predicate (see useMobileMenu) so App.vue and this bar can't disagree.
const { toggle: toggleMenu } = useMobileMenu();
const headerReclaimed = useHeaderReclaimed();

// Collapsed-state save cue on the hamburger (degraded/critical only).
const syncStore = useSyncStore();
const saveNeedsAttention = computed(() => SAVE_STATUS_PRESENTATION[syncStore.saveStatus].attention);

// Publish this bar's rendered height as a CSS var so the views can dock their
// own column headers (weekday row / member row) right beneath it via
// `sticky; top: var(--planner-cmdbar-h)`. A ResizeObserver keeps it correct as
// the bar's height changes (ribbon collapse, mobile two-row layout, member-chip
// wrap). This is a layout-measurement concern, not business logic.
const rootEl = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;

function publishHeight(): void {
  if (typeof document === 'undefined' || !rootEl.value) return;
  // Measurement must never throw out of the ResizeObserver callback — a single
  // failure would kill the observer and freeze the docking offset for the views.
  try {
    document.documentElement.style.setProperty(
      '--planner-cmdbar-h',
      `${rootEl.value.offsetHeight}px`
    );
  } catch (err) {
    console.warn('[CalendarCommandBar] failed to publish --planner-cmdbar-h', err);
  }
}

onMounted(() => {
  publishHeight();
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    ro = new ResizeObserver(() => publishHeight());
    ro.observe(rootEl.value);
  }
});

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  if (typeof document !== 'undefined') {
    document.documentElement.style.removeProperty('--planner-cmdbar-h');
  }
});
</script>

<template>
  <div
    ref="rootEl"
    class="dark:border-line dark:bg-surface-ground sticky top-0 z-30 -mx-4 mb-1 border-b border-gray-200/70 bg-white px-4 pt-3 pb-2.5 shadow-[0_4px_16px_-12px_rgba(44,62,80,0.18)] md:-mx-6 md:px-6 md:pt-4 md:pb-3"
  >
    <!-- Top row: period hero + nav (+ mobile menu / pinned filter / search), then controls -->
    <div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
      <!-- ⚠️ `min-w-0 flex-1` on the GROUP is what pins the nav cluster. Both halves matter and
           each was found by measuring:
             · `flex-1` — the group ALWAYS takes the free space, so the controls beside it sit
               at the container's right edge rather than wherever the title happens to end.
             · `min-w-0` — a flex item's default `min-width: auto` is its content's min-content,
               and a `truncate` title is `white-space: nowrap`, so its min-content is the WHOLE
               string. Without this the group refuses to shrink below the full title however
               shrinkable its children are, the row overflows, and everything after it moves.
           Result, measured: the prev arrow sits at 615px in month, week AND day view, and at
           every step within each. See `CalendarPeriodNav` for what it was before. -->
      <div class="flex min-w-0 flex-1 items-center gap-2 sm:justify-start">
        <!-- Mobile only: the planner reclaims the top bar, so the hamburger that
             opens the shared MobileHamburgerMenu lives here (AppHeader is hidden). -->
        <HamburgerButton v-if="headerReclaimed" :alert="saveNeedsAttention" @click="toggleMenu" />

        <!-- The label crossfades because on the mobile month stream it changes
             as you SCROLL past a boundary — an instant swap there reads as a
             glitch. The wrapper is load-bearing: `mode="out-in"` removes the
             <h1> from the DOM between phases, and the <h1> WAS the row's only
             flexible child, so without a stable wrapper the whole sticky header
             collapsed on every boundary and the nav cluster slid left and
             snapped back. The wrapper keeps the flex slot; only its contents
             fade.

             ⚠️ `flex-1` at EVERY width — never `sm:flex-none`, which is `flex-shrink: 0` and so
             REFUSES to shrink. A long day title ("Wednesday, 25 February 2026") then overflowed
             the row and shoved everything after it sideways, including the nav cluster that had
             just been moved out of its way. Measured: the prev arrow tracked the label exactly,
             633 → 704 → 674 → 707 → 731 → 695 px across six presses. Shrinkable, `truncate`
             finally has a constrained width to bite on, the row never overflows, and the
             right-hand controls stay where `sm:ml-auto` puts them. -->
        <!-- ⚠️ NO width floor here, deliberately. One was tried (`min-w-[6rem]`) to stop the
             title being squeezed to nothing, and measured: at 360/375/390px it pushed the bell
             and search 50/35/20px past the page edge, because every other child of this row is
             `flex-shrink-0` and nothing could absorb it. A truncated month beats controls off
             the screen, and `truncate` has handled the narrow case on phones all along. -->
        <div class="min-w-0 flex-1">
          <Transition name="cal-label" mode="out-in">
            <h1
              :key="label"
              class="font-outfit text-secondary-500 dark:text-ink truncate text-xl font-extrabold sm:text-2xl"
            >
              {{ label }}
            </h1>
          </Transition>
        </div>

        <!-- RECLAIMED-HEADER WIDTHS ONLY. This row has always been stable here — the title
             above is `flex-1`, so it absorbs the slack and the cluster is already pinned.

             ⚠️ `v-if="headerReclaimed"`, NOT a breakpoint class. The mobile filter and the
             inline trip chip — the two things whose width moves the arrows — are themselves
             `v-if="headerReclaimed"`, so the nav has to key on the SAME condition or the two
             disagree. `sm:` (640px) left a 128px band rendering both; `md:` narrowed it but is
             a `rem` breakpoint against `useBreakpoint`'s `px`, so at a non-default browser font
             size the band simply reopens, wider. This also means one nav exists at a time
             instead of two, so a `getByLabel` query cannot go ambiguous. -->
        <CalendarPeriodNav
          v-if="headerReclaimed"
          @prev="emit('prev')"
          @today="emit('today')"
          @next="emit('next')"
        />

        <!-- Mobile only: notification bell + search (re-homed from the hidden
             AppHeader, which is suppressed on the mobile planner). The member
             filter lives on the controls row below so this identity row stays
             uncrowded and the period label never truncates. -->
        <div v-if="headerReclaimed" class="flex flex-shrink-0 items-center gap-1.5">
          <NotificationsBell />
          <SearchButton />
        </div>
      </div>

      <!-- Secondary controls — view toggle + agenda (day) + inline trip chip
           (mobile) + Add. Kept as one wrapper so Phase 2 can collapse it on
           scroll-down while the pinned member filter above stays visible. -->
      <div class="flex items-center justify-between gap-2 sm:ml-auto sm:justify-end">
        <div class="flex items-center gap-2">
          <button
            v-if="activeView === 'day'"
            type="button"
            class="text-secondary-500/70 hover:text-primary-500 font-outfit dark:text-ink-soft dark:hover:bg-surface-hover inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold transition-colors hover:bg-gray-100"
            :title="t('planner.openAgenda')"
            :aria-label="t('planner.openAgenda')"
            @click="emit('open-agenda')"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span class="hidden sm:inline">{{ t('planner.agenda') }}</span>
          </button>

          <!-- The other arm of the same condition, so the mobile-only filter and trip chip are
               genuinely absent rather than merely usually absent. Placed BEFORE the view toggle,
               so everything to its right has a fixed width: the toggle, the magic pill and Add.
               Its x is therefore a constant — in every locale, at every text size, whatever the
               period label says, and the same across a view switch.

               ⚠️ `v-if="!headerReclaimed"`, NOT `v-else`. Vue pairs `v-else` with the
               IMMEDIATELY PRECEDING `v-if`, which here is the agenda button's
               `activeView === 'day'` — so the nav rendered in month view and vanished in day
               view. Caught by measuring; the suite was green. -->
          <CalendarPeriodNav
            v-if="!headerReclaimed"
            @prev="emit('prev')"
            @today="emit('today')"
            @next="emit('next')"
          />

          <ViewToggle
            :active-view="activeView"
            :compact="headerReclaimed"
            @update:active-view="emit('update:activeView', $event)"
          />

          <!-- Mobile member filter — kept compact (icon-only when "all"; shows
               the member name(s) when filtered) so "whose plans" stays explicit
               without crowding the row. Pinned in Phase 2 (won't auto-hide). -->
          <MemberFilterMobileMenu
            v-if="headerReclaimed"
            :is-all-active="isAllActive"
            :is-member-active="isMemberActive"
            :active-member-names="activeMemberNames"
            @select-all="emit('select-all')"
            @select-member="emit('select-member', $event)"
          />
        </div>

        <div class="flex items-center gap-2">
          <!-- Mobile inline trip chip; desktop keeps the labelled ribbon row below -->
          <CalendarTripRibbon
            v-if="headerReclaimed"
            inline
            @vacation-click="emit('vacation-click', $event)"
          />

          <!-- "✨ Magic beans". The shared responsive AI pill: compact ✨ circle on mobile,
               full label on sm:+ — identical to Travel and the cookbook so the door is the
               same everywhere.

               The pill sits INSIDE MagicBeansDoor's trigger slot, so the door owns the sheet,
               the picker, consent and the busy guard, and its `canReadAny` gate removes the
               affordance and its tap together. The old per-kind gate is gone: every door can
               now produce every kind, so gating this one on the photo reader would hide a
               button that still works. -->
          <MagicBeansDoor hint="event">
            <template #trigger="{ open }">
              <MagicReaderPill :label="t('ai.magic.perform')" @click="open" />
            </template>
          </MagicBeansDoor>

          <AddEntityButton
            v-if="canAdd"
            :label="t('planner.addActivity')"
            compact
            @click="emit('add')"
          />
        </div>
      </div>
    </div>

    <!-- Desktop member chips on their own row (mobile uses the pinned filter above) -->
    <div v-if="!headerReclaimed" class="mt-3 hidden sm:flex">
      <MemberChipFilter
        :is-all-active="isAllActive"
        :is-member-active="isMemberActive"
        @select-all="emit('select-all')"
        @select-member="emit('select-member', $event)"
      />
    </div>

    <!-- Desktop trip ribbon on its own row (mobile uses the inline chip above) -->
    <CalendarTripRibbon
      v-if="!headerReclaimed"
      class="mt-3"
      @vacation-click="emit('vacation-click', $event)"
    />
  </div>
</template>

<style scoped>
/* Month-label crossfade (see the Transition in the template). */
.cal-label-enter-active,
.cal-label-leave-active {
  transition: opacity 140ms ease;
}

.cal-label-enter-from,
.cal-label-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .cal-label-enter-active,
  .cal-label-leave-active {
    transition: none;
  }
}
</style>
