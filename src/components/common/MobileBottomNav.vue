<script setup lang="ts">
/**
 * Mobile bottom-nav v3 — 4 category tabs.
 *
 * Replaces the previous flat 6-tab strip. Tapping Nook navigates directly
 * to /nook. Tapping Planning, Money, or Pod opens a vertical
 * `MobileNavBeanStack` rising from the active tab; the stack carries the
 * category's child routes as labelled beans with side-card hints.
 *
 * State machine for `openCategoryId`:
 *   null               → tap Nook            → null  (router.push)
 *   null               → tap stackable cat   → <id>  (open stack)
 *   <id>               → tap same tab        → null  (close)
 *   <id>               → tap different cat   → <new> (swap, stack stays mounted)
 *   <id>               → tap Nook            → null  (close + router.push)
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
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { isRouteActive } from '@/utils/route';
import {
  MOBILE_NAV_CATEGORIES,
  type MobileCategoryId,
  type MobileNavCategory,
  type StackableCategoryId,
} from '@/constants/navigation';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const { canViewFinances } = usePermissions();

const openCategoryId = ref<StackableCategoryId | null>(null);
const tabRefs = ref<Record<MobileCategoryId, HTMLButtonElement | null>>({
  nook: null,
  planning: null,
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
  // Nook: leaf, always navigates and never opens.
  if (cat.id === 'nook') {
    closeStack();
    if (cat.rootPath) navigate(cat.rootPath);
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
    class="fixed right-0 bottom-0 left-0 z-40 flex items-stretch border-t border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"
    style="padding-bottom: env(safe-area-inset-bottom)"
    :aria-label="t('mobile.navigation')"
  >
    <button
      v-for="cat in visibleTabs"
      :key="cat.id"
      :ref="(el) => setTabRef(el, cat.id)"
      type="button"
      class="flex min-h-[56px] flex-1 cursor-pointer flex-col items-center justify-center gap-1 transition-colors"
      :aria-label="t(cat.labelKey)"
      :aria-haspopup="cat.items ? 'menu' : undefined"
      :aria-expanded="cat.items ? openCategoryId === cat.id : undefined"
      :aria-controls="cat.items ? `mobile-nav-stack-${cat.id}` : undefined"
      @click="onTabClick(cat)"
    >
      <div
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

        <span class="text-xl leading-none">{{ cat.emoji }}</span>
        <span
          class="font-outfit text-xs font-semibold"
          :class="isCategoryActive(cat) ? 'text-primary-500' : 'text-secondary-500/40'"
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
