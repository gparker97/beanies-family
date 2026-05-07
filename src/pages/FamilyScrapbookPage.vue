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
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import ScrapbookSpine from '@/components/scrapbook/ScrapbookSpine.vue';
import EveryoneSpread from '@/components/scrapbook/EveryoneSpread.vue';
import BeanSpread from '@/components/scrapbook/BeanSpread.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useQuickAdd } from '@/composables/useQuickAdd';
import { useMilestoneLightbox } from '@/composables/useMilestoneLightbox';
import { useFamilyStore } from '@/stores/familyStore';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { Milestone, UUID } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();
const { open: openQuickAddSheet } = useQuickAdd();
const lightbox = useMilestoneLightbox();

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
      class="relative mb-5 overflow-hidden rounded-[var(--sq)] px-5 py-5 sm:px-8 sm:py-7"
      style="
        background: linear-gradient(135deg, #fff7c8 0%, #ffe4d6 40%, #d4f1f4 80%, #e8f5e8 100%);
      "
    >
      <span
        class="pointer-events-none absolute top-3 right-7 text-[130px] opacity-10"
        style="transform: rotate(-8deg)"
        aria-hidden="true"
      >
        📖
      </span>
      <button
        type="button"
        class="font-outfit text-secondary-500/60 hover:text-primary-500 mb-1 flex items-center gap-1 text-xs font-semibold transition-colors"
        @click="router.push('/pod')"
      >
        <BeanieIcon name="chevron-left" size="xs" />
        <span>{{ t('bean.backToPod') }}</span>
      </button>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h1
            class="font-outfit text-secondary-500 text-2xl leading-tight font-extrabold break-words sm:text-3xl sm:leading-none dark:text-gray-100"
          >
            {{ t('scrapbook.title') }}
          </h1>
          <p class="font-caveat mt-1 text-xl font-medium text-[#E67E22]">
            {{ t('scrapbook.subtitle') }}
          </p>
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
