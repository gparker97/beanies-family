<script setup lang="ts">
/**
 * The one navigation list, shared by the desktop sidebar (`AppSidebar`) and
 * the phone hamburger drawer (`MobileHamburgerMenu`): the accordion sections
 * from `NAV_SECTIONS`, then the pinned footer (Discord + Share feedback, then
 * Help + Settings). The two surfaces differ in `density`; the sidebar passes
 * `hidePinned` for Help and Discord, which it shows as icon buttons on its
 * member card, so the remaining pinned rows (Share feedback, Settings) render
 * as ONE group. With nothing hidden (the drawer) the two groups are kept as
 * they are.
 *
 * `groups` splits the list: 'all' (default, the drawer) renders everything;
 * 'sections' only the accordion sections; 'pinned' only the pinned groups,
 * with no leading divider (the sidebar's fixed footer draws its own rule and
 * stays visible while the sections scroll above it).
 *
 * A collapsed section keeps a peek strip of icon chips under its header, one
 * tap from each page; the active page's chip carries a Heritage Orange ring.
 *
 * Active row: the most specific nav item for the route (`activeNavItem`), so
 * `/pod/cookbook/<id>` highlights Family Cookbook and `/pod/<memberId>`
 * highlights Meet the Beans.
 *
 * Auto-open: the section owning the current route is revealed on every route
 * change AND on every mount. The watch lives here, not in
 * `useSidebarAccordion`, because the component that renders the sections is
 * the one that must react; the sidebar remounts with the breakpoint and the
 * drawer's menu unmounts on every close.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import NavBadge from '@/components/ui/NavBadge.vue';
import ImageGlyph from '@/components/ui/ImageGlyph.vue';
import { useNavSelect } from '@/composables/useNavSelect';
import { useNavBadges, type NavBadge as NavBadgeType } from '@/composables/useNavBadges';
import { usePermissions } from '@/composables/usePermissions';
import { useSidebarAccordion } from '@/composables/useSidebarAccordion';
import { useTranslation } from '@/composables/useTranslation';
import {
  NAV_SECTIONS,
  activeNavItem,
  isItemFlagEnabled,
  navItemsInSection,
  type NavItemDef,
  type NavSectionDef,
} from '@/constants/navigation';
import { fillTemplate } from '@/utils/fillTemplate';

const props = withDefaults(
  defineProps<{
    density: 'sidebar' | 'drawer';
    /** Pinned row keys (nav paths) to omit; the sidebar's member card carries them as icon buttons. */
    hidePinned?: readonly string[];
    /** Which groups to render: everything, only the accordion sections, or only the pinned rows. */
    groups?: 'all' | 'sections' | 'pinned';
  }>(),
  { hidePinned: () => [], groups: 'all' }
);
/** Fired before a row's action runs (the drawer closes itself on it). */
const emit = defineEmits<{ select: [] }>();

const route = useRoute();
const { t } = useTranslation();
const { badgeFor } = useNavBadges();
const { canViewFinances } = usePermissions();
const { isOpen, toggle, reveal } = useSidebarAccordion();
const { selectItem, selectFeedback } = useNavSelect();

interface NavRow {
  key: string;
  label: string;
  emoji: string;
  badge: NavBadgeType | null;
  active: boolean;
  onSelect: () => void;
}

const activeItem = computed(() => activeNavItem(route.path));

/**
 * Desktop sidebar only: bring the current row into view. With three sections
 * open the list can be taller than a laptop viewport, so the highlighted row
 * (often in The Bean Pod, the last section) could sit below the fold of the
 * scrolling nav. On mount the row is CENTRED: the sidebar footer (profile card,
 * save status) can render after the nav and shrink it, and centring leaves
 * room for that without watching for it. Later route changes use `nearest`,
 * so clicking a visible row never jumps. Not in the drawer: it should open at
 * its controls, and any navigation closes it anyway.
 */
const navEl = ref<HTMLElement | null>(null);
function scrollCurrentIntoView(block: 'center' | 'nearest') {
  if (props.density !== 'sidebar') return;
  void nextTick(() => {
    navEl.value?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block });
  });
}

/** Reveal the current route's section and bring its row into view: on mount and every route change. */
watch(
  () => route.path,
  (_path, previous) => {
    // Nothing to reveal or scroll to in the pinned-only footer.
    if (props.groups === 'pinned') return;
    const section = activeItem.value?.section;
    if (section && section !== 'pinned') reveal(section);
    scrollCurrentIntoView(previous === undefined ? 'center' : 'nearest');
  },
  { immediate: true }
);

function toRow(item: NavItemDef): NavRow {
  return {
    key: item.path,
    label: t(item.labelKey),
    emoji: item.emoji,
    badge: badgeFor(item.path),
    active: item.path === activeItem.value?.path,
    onSelect: () => selectItem(item),
  };
}

function rowsOf(items: NavItemDef[]): NavRow[] {
  return items.filter(isItemFlagEnabled).map(toRow);
}

/**
 * Everything the menu renders, as one list of groups: each accordion section
 * (with its header), then the pinned groups (each preceded by a divider).
 * #45: the pinned footer is "connect with us" (Discord + Share feedback, which
 * opens a modal rather than a route) and "operate the app" (Help + Settings,
 * Settings anchored last).
 */
interface NavGroup {
  key: string;
  section?: NavSectionDef & { label: string };
  rows: NavRow[];
}

const sectionGroups = computed<NavGroup[]>(() =>
  NAV_SECTIONS.filter((s) => !s.requiresFinances || canViewFinances.value).map((s) => ({
    key: s.id,
    section: { ...s, label: t(s.labelKey) },
    rows: rowsOf(navItemsInSection(s.id)),
  }))
);

const pinnedGroups = computed<NavGroup[]>(() => {
  const pinned = rowsOf(navItemsInSection('pinned'));
  const feedback: NavRow = {
    key: 'feedback',
    label: t('feedback.shareEntry'),
    emoji: '📣',
    badge: null,
    active: false,
    onSelect: selectFeedback,
  };
  if (props.hidePinned.length > 0) {
    const hidden = new Set(props.hidePinned);
    const remaining = [
      ...pinned.filter((r) => r.key === '/discord'),
      feedback,
      ...pinned.filter((r) => r.key !== '/discord'),
    ].filter((r) => !hidden.has(r.key));
    // Share feedback first, then Settings (Settings stays anchored last).
    const order = (r: NavRow) => (r.key === 'feedback' ? 0 : r.key === '/settings' ? 2 : 1);
    remaining.sort((a, b) => order(a) - order(b));
    return remaining.length ? [{ key: 'pinned-rest', rows: remaining }] : [];
  }
  return [
    { key: 'pinned-community', rows: [...pinned.filter((r) => r.key === '/discord'), feedback] },
    { key: 'pinned-app', rows: pinned.filter((r) => r.key !== '/discord') },
  ];
});

const groups = computed<NavGroup[]>(() => [
  ...(props.groups === 'pinned' ? [] : sectionGroups.value),
  ...(props.groups === 'sections' ? [] : pinnedGroups.value),
]);

function select(row: NavRow) {
  emit('select');
  row.onSelect();
}

/**
 * Augment a row's accessible name when an attention count badge is present,
 * so screen readers announce e.g. "Goals, 3 need attention". Dots stay
 * decorative.
 */
function ariaLabelFor(row: NavRow): string {
  if (row.badge?.kind === 'count' && row.badge.count > 0) {
    return fillTemplate(t('nav.aria.countAttention'), { label: row.label, count: row.badge.count });
  }
  return row.label;
}

/** Both densities use text-base; only the row padding differs. */
const rowSize = computed(() =>
  props.density === 'sidebar' ? 'py-1.5 text-base' : 'py-2.5 text-base'
);
const headerPad = computed(() => (props.density === 'sidebar' ? 'py-1.5' : 'py-2'));
</script>

<template>
  <nav ref="navEl">
    <div v-for="group in groups" :key="group.key">
      <button
        v-if="group.section"
        type="button"
        class="font-outfit flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-bold tracking-wide uppercase transition-colors"
        :class="[headerPad, group.section.colorClass]"
        :aria-expanded="isOpen(group.section.id)"
        @click="toggle(group.section.id)"
      >
        <ImageGlyph
          :emoji="group.section.emoji"
          :src="group.section.iconSrc"
          surface="nav-glyph"
          class="w-6 shrink-0 text-center text-base"
        />
        <span class="flex-1 text-left">{{ group.section.label }}</span>
        <BeanieIcon
          name="chevron-down"
          size="xs"
          class="text-white/30 transition-transform duration-200"
          :class="{ 'rotate-180': !isOpen(group.section.id) }"
        />
      </button>
      <div v-else-if="props.groups !== 'pinned'" class="mx-2 my-2 h-px bg-white/[0.08]" />

      <!-- Peek strip: a collapsed section keeps its pages one tap away. -->
      <div
        v-if="group.section && !isOpen(group.section.id)"
        class="flex flex-wrap gap-1.5 pt-0.5 pr-2 pb-2 pl-3"
        data-testid="nav-peek-strip"
      >
        <button
          v-for="row in group.rows"
          :key="row.key"
          type="button"
          class="relative grid h-7 w-7 cursor-pointer place-items-center rounded-[9px] bg-white/[0.06] text-base transition-colors duration-150 hover:bg-white/[0.14] motion-reduce:transition-none"
          :class="{ 'ring-primary-500 ring-2': row.active }"
          :aria-label="ariaLabelFor(row)"
          :aria-current="row.active ? 'page' : undefined"
          :title="row.label"
          :data-testid="`nav-peek-${row.key}`"
          @click="select(row)"
        >
          <span aria-hidden="true">{{ row.emoji }}</span>
          <span
            v-if="
              row.badge &&
              ((row.badge.kind === 'count' && row.badge.count > 0) ||
                (row.badge.kind === 'dot' && row.badge.active))
            "
            class="bg-primary-500 absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full"
            aria-hidden="true"
          />
        </button>
      </div>

      <div v-show="!group.section || isOpen(group.section.id)" class="space-y-0.5">
        <button
          v-for="row in group.rows"
          :key="row.key"
          type="button"
          class="font-outfit flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-left font-medium transition-all duration-150"
          :class="[
            rowSize,
            row.active
              ? 'border-primary-500 border-l-4 bg-gradient-to-r from-[rgba(241,93,34,0.2)] to-[rgba(230,126,34,0.1)] pl-3 font-semibold text-white'
              : 'border-l-4 border-transparent text-white/40 hover:bg-white/[0.05] hover:text-white/70',
          ]"
          :aria-label="ariaLabelFor(row)"
          :aria-current="row.active ? 'page' : undefined"
          @click="select(row)"
        >
          <span class="w-6 flex-none text-center text-base" aria-hidden="true">{{
            row.emoji
          }}</span>
          <span class="min-w-0 flex-1 whitespace-nowrap">{{ row.label }}</span>
          <NavBadge class="flex-none" :badge="row.badge" />
        </button>
      </div>
    </div>
  </nav>
</template>
