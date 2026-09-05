<script setup lang="ts">
/**
 * Mobile bottom-nav v3 — 5 evenly-distributed slots: Nook, Planning,
 * Calendar, Money, Pod.
 *
 * Replaces the previous flat 6-tab strip. Nook and Calendar are leaves —
 * tapping navigates directly (Nook → /nook, Calendar → /activities). Calendar
 * renders as a raised, round center hero (see the `.calendar-hero` styles).
 * Tapping Planning, Money, or Pod opens a vertical `MobileNavBeanStack`
 * rising from the active tab; the stack carries the category's child routes
 * as labelled beans with side-card hints.
 *
 * State machine for `openCategoryId`:
 *   null               → tap leaf (Nook/Cal) → null  (router.push)
 *   null               → tap stackable cat   → <id>  (open stack)
 *   <id>               → tap same tab        → null  (close)
 *   <id>               → tap different cat   → <new> (swap, stack stays mounted)
 *   <id>               → tap leaf (Nook/Cal) → null  (close + router.push)
 *   <id>               → tap stack item bean → null  (close + router.push)
 *   <id>               → Esc/scrim           → null  (close)
 *   <id>               → route change        → null  (close)
 *   <id>               → finance perms lost  → null  (close + console.warn)
 *
 * Navigation is plain `router.push` — same as the original flat navbar.
 * No history-state markers, no async coordination — closeStack is a pure
 * UI state change.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MobileNavBeanStack from '@/components/common/MobileNavBeanStack.vue';
import NavBadge from '@/components/ui/NavBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useNavBadges, ATTENTION_DOT } from '@/composables/useNavBadges';
import { usePermissions } from '@/composables/usePermissions';
import { isRouteActive } from '@/utils/route';
import {
  MOBILE_NAV_CATEGORIES,
  type MobileCategoryId,
  type MobileNavCategory,
  type StackableCategoryId,
} from '@/constants/navigation';
import { requestGoToday } from '@/composables/usePlannerToday';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const { canViewFinances } = usePermissions();
const { categoryAttention } = useNavBadges();

const openCategoryId = ref<StackableCategoryId | null>(null);
const tabRefs = ref<Record<MobileCategoryId, HTMLButtonElement | null>>({
  nook: null,
  planning: null,
  calendar: null,
  money: null,
  pod: null,
});

function setTabRef(el: unknown, id: MobileCategoryId) {
  tabRefs.value[id] = el instanceof HTMLButtonElement ? el : null;
}

/** Tabs visible to the current member. Money is hidden when finance perms are off. */
const visibleTabs = computed<MobileNavCategory[]>(() =>
  MOBILE_NAV_CATEGORIES.filter((c) => c.id !== 'money' || canViewFinances.value)
);

/**
 * A category is "active" when the current route lives under it. Used to
 * draw the orange ring on the trigger tab even when the stack is closed.
 */
function isCategoryActive(cat: MobileNavCategory): boolean {
  if (cat.rootPath) return isRouteActive(route.path, cat.rootPath);
  return (cat.items ?? []).some((i) => isRouteActive(route.path, i.path));
}

const openCategory = computed<MobileNavCategory | null>(() =>
  openCategoryId.value
    ? (MOBILE_NAV_CATEGORIES.find((c) => c.id === openCategoryId.value) ?? null)
    : null
);

function getActiveAnchor(): HTMLElement | null {
  if (!openCategoryId.value) return null;
  return tabRefs.value[openCategoryId.value];
}

// ---------------------------------------------------------------------------
// State machine — every transition lives here.
// ---------------------------------------------------------------------------
function onTabClick(cat: MobileNavCategory) {
  // Leaf categories (Nook, Calendar) navigate directly and never open a
  // stack. MUST stay above the `!cat.items` defensive warn below — leaves
  // legitimately have no `items`, so a reorder would log a false
  // "misconfigured" warning on every leaf tap.
  if (cat.rootPath) {
    closeStack();
    navigate(cat.rootPath);
    return;
  }

  // Defensive: if the category somehow isn't stackable, do nothing.
  if (!cat.items || cat.items.length === 0) {
    console.warn(`[MobileBottomNav] tab "${cat.id}" has no items; ignoring tap`);
    return;
  }

  const id = cat.id as StackableCategoryId;
  if (openCategoryId.value === id) {
    // Same-tab tap → close.
    closeStack();
    return;
  }
  // null → open, or swap (different stackable).
  openCategoryId.value = id;
}

function onBeanNavigate(path: string) {
  closeStack();
  navigate(path);
}

function onStackClose() {
  closeStack();
}

function closeStack() {
  if (!openCategoryId.value) return;
  const lastOpened = openCategoryId.value;
  openCategoryId.value = null;
  // Restore focus to the trigger tab on close.
  void nextTick().then(() => {
    const target = tabRefs.value[lastOpened];
    if (!target) return;
    try {
      target.focus();
    } catch (err) {
      console.warn('[MobileBottomNav] focus restore failed:', err);
    }
  });
}

function navigate(path: string) {
  // The planner is reachable from two slots (center Calendar hero + the new
  // Planning-stack Activities bean); either should jump to today, including when
  // we're already on /activities (a router.push no-op, so the page's route watch
  // never fires). The signal handles both the same-page and cross-page cases.
  if (path === '/activities') requestGoToday();
  router.push(path).catch((err: unknown) => {
    // vue-router rejects on duplicate / cancelled navigation; not user-facing.
    console.warn('[MobileBottomNav] navigation swallowed:', err);
  });
}

// ---------------------------------------------------------------------------
// Reactive close triggers — route change, finance perms revoked.
// ---------------------------------------------------------------------------
watch(
  () => route.path,
  () => closeStack()
);

watch(
  () => canViewFinances.value,
  (canView) => {
    if (!canView && openCategoryId.value === 'money') {
      console.warn('[MobileBottomNav] finance permissions revoked; closing Money stack');
      closeStack();
    }
  }
);
</script>

<template>
  <nav
    class="dark:border-line dark:bg-surface-ground fixed right-0 bottom-0 left-0 z-40 flex items-stretch border-t border-gray-200 bg-white"
    style="padding-bottom: env(safe-area-inset-bottom)"
    :aria-label="t('mobile.navigation')"
  >
    <button
      v-for="cat in visibleTabs"
      :key="cat.id"
      :ref="(el) => setTabRef(el, cat.id)"
      type="button"
      class="flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-1 transition-colors"
      :aria-label="t(cat.labelKey)"
      :aria-haspopup="cat.items ? 'menu' : undefined"
      :aria-expanded="cat.items ? openCategoryId === cat.id : undefined"
      :aria-controls="cat.items ? `mobile-nav-stack-${cat.id}` : undefined"
      @click="onTabClick(cat)"
    >
      <!-- Calendar: raised, round, center one-tap hero. Centred within its
           OWN flex slot (never the viewport), so it stays correct whether 5
           tabs show or 4 (Money hidden). The label keeps the sibling
           baseline via the invisible emoji spacer. -->
      <div
        v-if="cat.id === 'calendar'"
        class="relative flex flex-col items-center gap-0.5 px-3 py-1"
      >
        <span class="calendar-hero" aria-hidden="true">{{ cat.emoji }}</span>
        <span class="text-xl leading-none opacity-0" aria-hidden="true">{{ cat.emoji }}</span>
        <span
          class="calendar-label font-outfit text-primary-500 dark:text-accent-lift text-xs font-semibold"
        >
          {{ t(cat.labelKey) }}
        </span>
      </div>

      <div
        v-else
        class="relative flex flex-col items-center gap-0.5 rounded-2xl px-3 py-1 transition-colors"
        :class="isCategoryActive(cat) ? 'bg-[rgba(241,93,34,0.08)]' : ''"
      >
        <!-- Active dot indicator on category tabs that have a stack. -->
        <span
          v-if="cat.items"
          class="absolute top-1 right-1 h-1.5 w-1.5 rounded-full transition-all"
          :class="
            openCategoryId === cat.id
              ? 'bg-primary-500 scale-150 opacity-100'
              : 'bg-secondary-500/40 scale-100 opacity-100'
          "
          aria-hidden="true"
        ></span>
        <!-- Attention aggregate: top-left of the tab when any item under
             this category has an escalating badge. The aria-label is on
             the parent button (passes through aria-haspopup/expanded);
             the dot itself is decorative via NavBadge's aria-hidden. -->
        <span
          v-if="categoryAttention[cat.id]"
          class="absolute top-1 left-1"
          :title="t('mobileNav.attentionBadge')"
        >
          <NavBadge :badge="ATTENTION_DOT" />
        </span>

        <span class="text-xl leading-none">{{ cat.emoji }}</span>
        <span
          class="font-outfit text-xs font-semibold"
          :class="
            isCategoryActive(cat) ? 'text-primary-500' : 'text-secondary-500/40 dark:text-ink-faint'
          "
        >
          {{ t(cat.labelKey) }}
        </span>
      </div>
    </button>

    <!-- Bean stack lives inside the nav so it positions relative to the tab bar. -->
    <MobileNavBeanStack
      v-if="openCategory"
      :get-anchor="getActiveAnchor"
      :category="openCategory"
      :is-open="!!openCategoryId"
      @close="onStackClose"
      @navigate="onBeanNavigate"
    />
  </nav>
</template>

<style scoped>
/* Center Calendar hero — a raised, round Heritage-Orange one-tap button.
   The round shape follows the established bean/FAB circle precedent
   (MobileNavBeanStack `.jar-bean`, QuickAddFab `.fab`), not the squircle
   rule. It is absolutely centred WITHIN its own flex slot (the calendar
   `<button>`), never the viewport, so it stays centred whether 5 tabs show
   or 4 (Money hidden). The 3px ring matches the nav surface (white /
   slate-900) so the circle reads as seated in the bar; ~15px peeks above
   the top edge. */
.calendar-hero {
  background: linear-gradient(155deg, #f15d22 0%, #e67e22 100%);
  border: 3px solid white;
  border-radius: 9999px;
  box-shadow:
    0 10px 18px -8px rgb(241 93 34 / 60%),
    0 3px 7px -3px rgb(241 93 34 / 50%),
    inset 0 1px 0 rgb(255 255 255 / 40%);
  color: white;
  display: grid;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative emoji in fixed-size brand circle */
  font-size: 22px;
  height: 46px;
  left: 50%;
  line-height: 1;
  place-items: center;
  position: absolute;
  top: -22px; /* peeks ~15px above the bar — tune against device safe-area */
  transform: translateX(-50%);
  transition:
    transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.16s ease;
  width: 46px;
}

html.dark .calendar-hero {
  /* surface-ground — matches the nav's dark surface (`dark:bg-surface-ground`) so
     the ring blends into the bar instead of showing a halo. */
  border-color: #151e27;
}

.calendar-label {
  line-height: 1.15;
}

/* Press/hover micro-interaction — kept in sync with the translateX centring;
   disabled under reduced-motion (mirrors QuickAddFab). */
button:hover .calendar-hero {
  transform: translateX(-50%) translateY(-2px);
}

button:active .calendar-hero {
  transform: translateX(-50%) translateY(1px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .calendar-hero {
    transition: none;
  }

  button:hover .calendar-hero,
  button:active .calendar-hero {
    transform: translateX(-50%);
  }
}
</style>
