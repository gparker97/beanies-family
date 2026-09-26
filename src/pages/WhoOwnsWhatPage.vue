<script setup lang="ts">
/**
 * Who Owns What (#109): the family responsibility deck. A Treehouse page with three views
 * in one segmented control, Overview (default), Deal and Deck, remembered per device and
 * deep-linkable with `?view=overview|deal|deck`. `?card=<id>` opens a card's view drawer.
 *
 * The page hosts every drawer once (view, edit / new, and in slice 3b the check-in drawer
 * and the fridge-sheet export host) and turns the views' intents into navigation between
 * them. All writes go through `responsibilityStore` (MVO); children see everything
 * read-only, and the store guard is the backstop.
 *
 * The Deal view is `DealBoard` at md+ and `DealPile` below it, both opened on
 * `dealRequest`. The first deal (`scope: 'unsorted'`) is the pile at every width, because
 * keep-or-skip is a one-card-at-a-time decision; md+ offers the board from there. The
 * check-in is `CheckInDrawer`, and the fridge sheet (Share / Export as PDF, from the ⋯ menu
 * and the Overview) runs on `useSheetExportRunner` (surface `deck-export`) with one
 * `ExportSheet` per page off-screen.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { usePersistedChoice } from '@/composables/usePersistedChoice';
import { useDeepLinkParam } from '@/composables/useDeepLinkParam';
import { confirmChoice } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useToday } from '@/composables/useToday';
import { useSheetExportRunner } from '@/composables/useSheetExportRunner';
import { useExportMemberResolver } from '@/composables/useExportMemberResolver';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslationStore } from '@/stores/translationStore';
import { getListCategory } from '@/constants/listCategories';
import {
  buildExportBlocks,
  paginateExport,
  type DeckExportModel,
  type DeckExportResolvers,
  type ExportPage,
} from '@/utils/responsibilityExportModel';
import type { LanguageCode } from '@/types/models';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import OverflowMenu, { type OverflowMenuItem } from '@/components/ui/OverflowMenu.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import DeckOverview from '@/components/responsibilities/DeckOverview.vue';
import FirstDealEmptyState from '@/components/responsibilities/FirstDealEmptyState.vue';
import DeckGrid, { type DeckFilter } from '@/components/responsibilities/DeckGrid.vue';
import CardViewDrawer from '@/components/responsibilities/CardViewDrawer.vue';
import CardEditDrawer from '@/components/responsibilities/CardEditDrawer.vue';
import DealPile from '@/components/responsibilities/DealPile.vue';
import DealBoard from '@/components/responsibilities/DealBoard.vue';
import CheckInDrawer from '@/components/responsibilities/CheckInDrawer.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ExportSheet from '@/components/export/ExportSheet.vue';
import ExportPeopleLegend from '@/components/export/ExportPeopleLegend.vue';
import ResponsibilityExportBody from '@/components/export/ResponsibilityExportBody.vue';

const VIEWS = ['overview', 'deal', 'deck'] as const;
type DeckView = (typeof VIEWS)[number];
const VIEW_LABELS: Record<DeckView, UIStringKey> = {
  overview: 'whoOwnsWhat.view.overview',
  deal: 'whoOwnsWhat.view.deal',
  deck: 'whoOwnsWhat.view.deck',
};
const RHYTHMS = [2, 4, 8, 0] as const;
const RHYTHM_LABELS: Record<(typeof RHYTHMS)[number], UIStringKey> = {
  2: 'whoOwnsWhat.rhythm.every2',
  4: 'whoOwnsWhat.rhythm.every4',
  8: 'whoOwnsWhat.rhythm.every8',
  0: 'whoOwnsWhat.rhythm.off',
};
const SURFACE = 'responsibilities';

const { t } = useTranslation();
const store = useResponsibilityStore();
const route = useRoute();
const router = useRouter();

onMounted(() => {
  void store.load();
});

const canDeal = computed(() => store.canDeal);

// ── Views ────────────────────────────────────────────────────────────────────
const view = usePersistedChoice<DeckView>(STORAGE_KEYS.WHO_OWNS_WHAT_VIEW, VIEWS, 'overview');
const viewOptions = computed(() =>
  VIEWS.map((v) => ({ value: v, label: t(VIEW_LABELS[v]), variant: 'orange' as const }))
);
function setView(value: string): void {
  if (!(VIEWS as readonly string[]).includes(value)) return;
  // A tap on the switch opens the Deal view fresh (the board at md+), never a stale request.
  if (value === 'deal') {
    dealRequest.value = null;
    pileKey.value += 1;
  }
  view.value = value as DeckView;
}

// `?view=` wins over the remembered view once, then is consumed so a later tap on the
// switch isn't fighting a stale URL.
watch(
  () => route.query.view,
  (raw) => {
    if (raw === undefined) return;
    if (typeof raw === 'string' && (VIEWS as readonly string[]).includes(raw)) {
      view.value = raw as DeckView;
    } else {
      console.warn('[WhoOwnsWhatPage] ignoring unknown ?view=', raw);
      view.value = 'overview';
    }
    void router.replace({ query: { ...route.query, view: undefined } });
  },
  { immediate: true }
);

const deckFilter = ref<DeckFilter>(null);

// ── Drawers ──────────────────────────────────────────────────────────────────
const viewCardId = ref<string | null>(null);
const editOpen = ref(false);
const editCardId = ref<string | null>(null);

function openCard(cardId: string): void {
  viewCardId.value = cardId;
}
function editCard(cardId: string): void {
  viewCardId.value = null;
  editCardId.value = cardId;
  editOpen.value = true;
}
function newCard(): void {
  editCardId.value = null;
  editOpen.value = true;
}
function closeEdit(): void {
  editOpen.value = false;
  editCardId.value = null;
}

// `?card=<id>` (a briefing row, a shared link). A card that doesn't exist (deleted, or the
// deck was restored on another device) is still CONSUMED, after saying so, so the dead
// link can't keep re-firing.
useDeepLinkParam({
  param: 'card',
  ready: () => store.isLoaded,
  open: (id) => {
    if (!store.isLoaded) return false;
    if (store.cardById(id)) {
      openCard(id);
      return true;
    }
    showToast('info', t('whoOwnsWhat.deepLink.missing'), t('whoOwnsWhat.deepLink.missingHelp'));
    logEvent({ level: 'warn', surface: SURFACE, message: 'deep_link_miss' });
    return true;
  },
});

// ── Deal ─────────────────────────────────────────────────────────────────────
/** What the deal view should open on: the whole unsorted pile, or the waiting cards. */
export interface DealRequest {
  scope: 'unsorted' | 'waiting';
  /** Start the pile at this card. */
  cardId?: string;
}
const dealRequest = ref<DealRequest | null>(null);
/** Bumped on every request so the pile takes a fresh snapshot of its queue. */
const pileKey = ref(0);
function openDeal(request: DealRequest): void {
  dealRequest.value = request;
  pileKey.value += 1;
  view.value = 'deal';
}

const { isMobile } = useBreakpoint();
/** The pile on a phone, and for the first deal at every width; the board otherwise. */
const showPile = computed(() => isMobile.value || dealRequest.value?.scope === 'unsorted');
const pileScope = computed<DealRequest['scope']>(
  () => dealRequest.value?.scope ?? (store.stats.unsorted > 0 ? 'unsorted' : 'waiting')
);
function useBoard(): void {
  dealRequest.value = null;
}

/** Children see the cards still to deal, read-only. */
const toDeal = computed(() =>
  store.resolved.filter((c) => c.status === 'unsorted' || c.status === 'waiting')
);

// ── Check-in ─────────────────────────────────────────────────────────────────
const checkInOpen = ref(false);
function openCheckIn(): void {
  checkInOpen.value = true;
}

// ── ⋯ menu ───────────────────────────────────────────────────────────────────
const hasKept = computed(() => store.stats.deck > 0);

const menuItems = computed<OverflowMenuItem[]>(() => {
  const items: OverflowMenuItem[] = [];
  if (hasKept.value) {
    items.push({ id: 'share', labelKey: 'whoOwnsWhat.menu.share', icon: '📤' });
    items.push({ id: 'export', labelKey: 'whoOwnsWhat.menu.export', icon: '📄' });
  }
  if (canDeal.value) items.push({ id: 'rhythm', labelKey: 'whoOwnsWhat.menu.rhythm', icon: '🗓️' });
  items.push({ id: 'skipped', labelKey: 'whoOwnsWhat.menu.skipped', icon: '⏭️' });
  if (canDeal.value)
    items.push({
      id: 'restore',
      labelKey: 'whoOwnsWhat.menu.restore',
      icon: '♻️',
      tone: 'danger',
    });
  return items;
});

function onMenu(id: string): void {
  if (id === 'share') exportDeck('png');
  else if (id === 'export') exportDeck('pdf');
  else if (id === 'rhythm') void chooseRhythm();
  else if (id === 'skipped') seeSkipped();
  else if (id === 'restore') void restoreDefaults();
}

// ── The fridge sheet ─────────────────────────────────────────────────────────
const { today } = useToday();
const translationStore = useTranslationStore();
const { categoryLabel } = useListCategoryLabel();
const { cardName, cardDone, cardEmoji } = useResponsibilityCardLabel();
const { getMemberName } = useMemberInfo();
const { resolveMember } = useExportMemberResolver();

const EXPORT_LOCALE: Record<LanguageCode, string> = { en: 'en-US', zh: 'zh-CN' };
/** Faces the sheet body uses beyond the shared shell's. */
const DECK_EXPORT_FONTS = [
  '700 13px Outfit',
  '700 11px Outfit',
  '600 10px Outfit',
  '400 10px Inter',
];

const exportModel = ref<DeckExportModel | null>(null);
const exportPages = ref<ExportPage[]>([]);
const exportStack = ref<HTMLElement | null>(null);

const exportResolvers: DeckExportResolvers = {
  category: (id) => {
    const def = id ? getListCategory(id) : undefined;
    return id && def
      ? { title: categoryLabel(id), emoji: def.emoji, color: def.color }
      : { title: t('lists.category.other'), emoji: '📁', color: '#94A3B8' };
  },
  name: cardName,
  done: cardDone,
  emoji: cardEmoji,
  // The sheet prints the child's name ("Mia") beside the pill, not "for Mia".
  partLabel: (card, part) =>
    card.splitMode === 'child'
      ? getMemberName(part.key, '')
      : card.splitMode === 'label'
        ? (part.label ?? '')
        : '',
  member: resolveMember,
};

const exportDate = computed(() =>
  new Intl.DateTimeFormat(EXPORT_LOCALE[translationStore.currentLanguage] ?? 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${today.value}T00:00:00`))
);
function pageLabel(index: number): string {
  const total = exportPages.value.length;
  return total > 1 ? fillTemplate(t('whoOwnsWhat.export.page'), { page: index + 1, total }) : '';
}

const {
  exportMounting,
  exportingFormat,
  exporting,
  run: runExport,
} = useSheetExportRunner({
  surface: 'deck-export',
  perfName: 'deck-export',
  build: () => {
    const model = buildExportBlocks(store.resolved, exportResolvers);
    exportModel.value = model;
    exportPages.value = paginateExport(model.blocks);
  },
  el: () => exportStack.value,
  pageEls: () =>
    Array.from(exportStack.value?.querySelectorAll<HTMLElement>('[data-export-page]') ?? []),
  filename: () => `beanies-who-owns-what-${today.value}`,
  kind: { image: 'responsibility-deck-png', pdf: 'responsibility-deck-pdf' },
  shareTitle: () => t('whoOwnsWhat.export.shareTitle'),
  failedKey: 'whoOwnsWhat.export.failed',
  failedHelpKey: 'whoOwnsWhat.export.failedHelp',
  fonts: DECK_EXPORT_FONTS,
});

/** Share = one PNG with every page stacked; Export = a PDF with one A4 page per sheet page. */
function exportDeck(format: 'png' | 'pdf'): void {
  void runExport(format === 'png' ? 'image' : 'pdf');
}

function seeSkipped(): void {
  deckFilter.value = 'skipped';
  view.value = 'deck';
}

function browseDeck(): void {
  deckFilter.value = null;
  view.value = 'deck';
}

async function chooseRhythm(): Promise<void> {
  const choice = await confirmChoice({
    variant: 'info',
    title: 'whoOwnsWhat.rhythm.title',
    message: 'whoOwnsWhat.rhythm.message',
    confirmLabel: 'action.save',
    choices: RHYTHMS.map((w) => ({ id: String(w), label: t(RHYTHM_LABELS[w]) })),
    defaultChoice: String(store.rhythmWeeks),
  });
  if (choice === null) return;
  const weeks = RHYTHMS.find((w) => String(w) === choice);
  if (weeks === undefined || weeks === store.rhythmWeeks) return;
  if (await store.setRhythm(weeks)) showToast('success', t('whoOwnsWhat.rhythm.saved'));
}

/** Requirement 15: the keep / clear choice appears only when the family has made cards. */
async function restoreDefaults(): Promise<void> {
  const custom = store.customCount;
  const choice = await confirmChoice({
    variant: 'danger',
    title: 'whoOwnsWhat.restore.title',
    message: 'whoOwnsWhat.restore.message',
    confirmLabel: 'whoOwnsWhat.restore.confirm',
    choices: custom
      ? [
          {
            id: 'keep',
            label: fillTemplate(t('whoOwnsWhat.restore.keepCustom'), { count: custom }),
          },
          { id: 'clear', label: t('whoOwnsWhat.restore.clearCustom') },
        ]
      : undefined,
    defaultChoice: 'keep',
  });
  if (choice === null) return;
  if (await store.restoreDefaults({ keepCustom: choice !== 'clear' })) {
    deckFilter.value = null;
    view.value = 'overview';
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <PageWelcomeSubtitle :text="t('whoOwnsWhat.welcomeSubtitle')" />
      <div class="flex shrink-0 items-center gap-2">
        <AddEntityButton
          v-if="canDeal"
          :label="t('whoOwnsWhat.addCard')"
          compact
          data-testid="who-owns-what-add"
          @click="newCard"
        />
        <OverflowMenu :items="menuItems" @select="onMenu" />
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <TogglePillGroup
        :model-value="view"
        :options="viewOptions"
        data-testid="who-owns-what-views"
        @update:model-value="setView"
      />
      <!-- The fridge sheet's two conventional actions, as on the meal planner. -->
      <div v-if="view === 'overview' && hasKept" class="flex flex-wrap gap-2">
        <button
          type="button"
          class="from-primary-500 to-terracotta-400 font-outfit inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          :disabled="exporting"
          data-testid="who-owns-what-share"
          @click="exportDeck('png')"
        >
          <BeanieIcon v-if="exportingFormat !== 'image'" name="share" size="sm" />
          {{
            exportingFormat === 'image'
              ? t('whoOwnsWhat.export.building')
              : t('whoOwnsWhat.menu.share')
          }}
        </button>
        <button
          type="button"
          class="font-outfit text-secondary-500 dark:bg-surface-raised dark:text-ink inline-flex items-center gap-1.5 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
          :disabled="exporting"
          data-testid="who-owns-what-export"
          @click="exportDeck('pdf')"
        >
          <BeanieIcon v-if="exportingFormat !== 'pdf'" name="download" size="sm" />
          {{
            exportingFormat === 'pdf'
              ? t('whoOwnsWhat.export.building')
              : t('whoOwnsWhat.menu.export')
          }}
        </button>
      </div>
    </div>

    <!-- Overview -->
    <template v-if="view === 'overview'">
      <FirstDealEmptyState
        v-if="store.isLoaded && store.isFirstDeal"
        :total="store.stats.total"
        :can-deal="canDeal"
        @start="openDeal({ scope: 'unsorted' })"
        @browse="browseDeck"
      />
      <DeckOverview
        v-else
        :can-deal="canDeal"
        @deal-waiting="openDeal({ scope: 'waiting' })"
        @deal-card="openDeal({ scope: 'waiting', cardId: $event })"
        @see-skipped="seeSkipped"
        @open-card="openCard"
        @start-check-in="openCheckIn"
        @set-rhythm="chooseRhythm"
      />
    </template>

    <!-- Deal: the board at md+, the pile on a phone and for the first deal. Children see
         the cards still to deal, read-only. -->
    <section v-else-if="view === 'deal'" data-testid="who-owns-what-deal">
      <template v-if="canDeal">
        <DealPile
          v-if="showPile"
          :key="pileKey"
          :scope="pileScope"
          :start-card-id="dealRequest?.cardId"
          :show-board-link="!isMobile"
          @split="editCard"
          @overview="view = 'overview'"
          @deal-waiting="openDeal({ scope: 'waiting' })"
          @use-board="useBoard"
        />
        <DealBoard
          v-else
          :focus-card-id="dealRequest?.cardId"
          @open="openCard"
          @edit="editCard"
          @new-card="newCard"
        />
      </template>
      <DeckGrid v-else :cards="toDeal" :filter="null" :show-pills="false" @open="openCard" />
    </section>

    <!-- Deck -->
    <DeckGrid
      v-else
      v-model:filter="deckFilter"
      :cards="store.resolved"
      :can-edit="canDeal"
      @open="openCard"
    />

    <!-- Drawers: mounted unconditionally, never `v-if`-gated (useFormModal seeds on open). -->
    <CardViewDrawer
      :open="!!viewCardId"
      :card-id="viewCardId"
      :can-edit="canDeal"
      @close="viewCardId = null"
      @edit="editCard"
    />
    <CardEditDrawer :open="editOpen" :card-id="editCardId" @close="closeEdit" />
    <CheckInDrawer :open="checkInOpen" @close="checkInOpen = false" />

    <!-- Off-screen fridge sheet: rendered declaratively so it inherits Pinia / i18n; one
         ExportSheet per page (the PDF's pages), stacked (the Share PNG). Unmounted by
         useSheetExportRunner's `finally`, so a thrown error can never leak it. Light only. -->
    <div v-if="exportMounting" class="export-host" aria-hidden="true">
      <div ref="exportStack" class="export-stack">
        <ExportSheet
          v-for="(page, i) in exportPages"
          :key="i"
          data-export-page
          :heading="t('whoOwnsWhat.export.heading')"
          :accent="i === 0 ? t('whoOwnsWhat.export.accent') : ''"
          :date-label="t('whoOwnsWhat.export.dealtAsOf')"
          :date-range="exportDate"
          :page-label="pageLabel(i)"
          :compact="i > 0"
          :tagline="t('app.tagline')"
        >
          <ResponsibilityExportBody :page="page" />
          <template #legend>
            <ExportPeopleLegend
              v-if="exportModel"
              :label="t('whoOwnsWhat.export.holders')"
              :people="exportModel.people"
              :hint="exportModel.hasWriteIn ? t('whoOwnsWhat.export.writeIn') : ''"
            />
          </template>
        </ExportSheet>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Off-screen host for the fridge sheet: in the layout (so fonts and images load and it has
   real dimensions to rasterise) but far off-screen and out of the a11y tree. Mirrors
   MealPlannerPage. */
.export-host {
  left: -99999px;
  pointer-events: none;
  position: fixed;
  top: 0;
}

.export-stack {
  background: #f8f9fa;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
