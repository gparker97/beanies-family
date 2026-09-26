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
 * SLICE 3b MOUNT POINTS (search for "SLICE 3b"):
 *  - Deal view: `DealBoard` (md+) and `DealPile` (phone), fed by `dealRequest`.
 *  - First deal: `openDeal({ scope: 'unsorted' })` from the empty state's Start Dealing.
 *  - Check-in: `CheckInDrawer` bound to `checkInOpen` (`openCheckIn` sets it).
 *  - Fridge sheet: `exportDeck('png' | 'pdf')` from the ⋯ menu, on `useSheetExportRunner`.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { usePersistedChoice } from '@/composables/usePersistedChoice';
import { useDeepLinkParam } from '@/composables/useDeepLinkParam';
import { confirmChoice } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
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
  if ((VIEWS as readonly string[]).includes(value)) view.value = value as DeckView;
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

// ── Deal (SLICE 3b consumes `dealRequest`) ───────────────────────────────────
/** What the deal view should open on: the whole unsorted pile, or the waiting cards. */
export interface DealRequest {
  scope: 'unsorted' | 'waiting';
  /** Start the pile at this card. */
  cardId?: string;
}
const dealRequest = ref<DealRequest | null>(null);
function openDeal(request: DealRequest): void {
  dealRequest.value = request;
  view.value = 'deal';
}

/** Interim deal view until slice 3b's board and pile land: the cards still to deal. */
const toDeal = computed(() =>
  store.resolved.filter((c) => c.status === 'unsorted' || c.status === 'waiting')
);

// ── Check-in (SLICE 3b: CheckInDrawer) ───────────────────────────────────────
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

/** SLICE 3b: the fridge sheet (`useSheetExportRunner`, surface `deck-export`). */
function exportDeck(format: 'png' | 'pdf'): void {
  console.warn(`[WhoOwnsWhatPage] the fridge sheet (${format}) is wired in slice 3b`);
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

    <TogglePillGroup
      :model-value="view"
      :options="viewOptions"
      data-testid="who-owns-what-views"
      @update:model-value="setView"
    />

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

    <!-- Deal. SLICE 3b: replace this interim grid with <DealBoard> (md+) and <DealPile>
         (phone), both opened on `dealRequest`. -->
    <section v-else-if="view === 'deal'" data-testid="who-owns-what-deal">
      <DeckGrid
        :cards="toDeal"
        :filter="null"
        :show-pills="false"
        :can-edit="canDeal"
        @open="openCard"
      />
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
    <!-- SLICE 3b: <CheckInDrawer :open="checkInOpen" @close="checkInOpen = false" /> and the
         fridge-sheet export host (ResponsibilityExportBody) mount here. -->
  </div>
</template>
