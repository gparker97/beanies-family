<script setup lang="ts">
/**
 * Who Owns What (#109): the desktop / tablet deal board (Requirement 8, mockup section 3).
 * The meal-planner board turned sideways: a rail of cards on the left (the deck, "N cards
 * still to deal", a search over every card, To Deal / All, grouped by category, New Card)
 * and one row per non-pet member on the right, plus a Skipped row.
 *
 *  - **Drag** a rail card or a row chip onto a member's row to deal or re-deal it; onto
 *    Skipped to skip it. Native DnD through `useCardDrag`, its own payload singleton, so a
 *    meal drag can never be read as a card drag. The row flashes the drop highlight, the
 *    face bounces, and `useDealActions` shows the one undo toast.
 *  - **Tap / keyboard**: tapping a rail card opens `InlineMemberPicker` right under it (the
 *    same "Who owns it?" as the phone pile), with Skip and Split beside it. Native DnD is
 *    mouse-only, so this is the path for touch tablets and keyboard users.
 *
 * A row shows a small count caption next to the name (allowed here and in By Person only);
 * it is a caption, never a scoreboard. Writes go through `useDealActions`; the page hosts
 * the drawers (`open`, `edit`, `new-card`).
 */
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { createDragPayload } from '@/composables/useDragPayload';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { categoryTint } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { groupByCategory, type ResolvedCard, type ResolvedPart } from '@/utils/responsibilityDeck';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import InlineMemberPicker from '@/components/ui/InlineMemberPicker.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import DeckActionButton from './DeckActionButton.vue';
import { useDealActions } from './useDealActions';

const emit = defineEmits<{
  open: [cardId: string];
  edit: [cardId: string];
  'new-card': [];
}>();

/** Chips shown per row before "+N more". */
const CHIP_CAP = 10;
const SKIPPED_ROW = '__skipped';

const { t } = useTranslation();
const store = useResponsibilityStore();
const familyStore = useFamilyStore();
const { categoryLabel } = useListCategoryLabel();
const { cardName, cardDone, cardEmoji, partCaption } = useResponsibilityCardLabel();
const { memberAvatarBindings } = useMemberAvatarBindings();
const { pulse } = useAttentionPulse();
const { dragged, startDrag, endDrag } = useCardDrag();
const actions = useDealActions();

const rootEl = ref<HTMLElement | null>(null);

const tint = (card: ResolvedCard): string => categoryTint(card.category);

// ── Rail ─────────────────────────────────────────────────────────────────────
const filter = ref<'toDeal' | 'all'>('toDeal');
const query = ref('');
const filterOptions = computed(() => [
  { value: 'toDeal', label: t('whoOwnsWhat.board.filterToDeal'), variant: 'orange' as const },
  { value: 'all', label: t('whoOwnsWhat.board.filterAll'), variant: 'orange' as const },
]);

const live = computed(() => store.resolved.filter((c) => c.status !== 'skipped'));
const toDealCount = computed(() => store.stats.waiting + store.stats.unsorted);
const toDealLine = computed(() => {
  const n = toDealCount.value;
  if (!n) return t('whoOwnsWhat.board.allDealt');
  return fillTemplate(
    t(n === 1 ? 'whoOwnsWhat.board.toDeal.one' : 'whoOwnsWhat.board.toDeal.other'),
    { count: n }
  );
});

/** A search looks at every card that isn't skipped; otherwise To Deal / All decides. */
const railCards = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (q) {
    return live.value.filter(
      (c) => cardName(c).toLowerCase().includes(q) || cardDone(c).toLowerCase().includes(q)
    );
  }
  return filter.value === 'all'
    ? live.value
    : live.value.filter((c) => c.status === 'unsorted' || c.status === 'waiting');
});
const railGroups = computed(() => groupByCategory(railCards.value));
const railEmpty = computed(() =>
  query.value.trim() ? t('whoOwnsWhat.board.noMatch') : t('whoOwnsWhat.board.nothingToDeal')
);

function groupTitle(category: ResolvedCard['category'] | null): string {
  return category ? categoryLabel(category) : t('lists.category.other');
}

// ── Tap-to-deal ──────────────────────────────────────────────────────────────
const pickingId = ref<string | null>(null);
const picking = computed(() => (pickingId.value ? store.cardById(pickingId.value) : undefined));

function togglePicker(cardId: string): void {
  pickingId.value = pickingId.value === cardId ? null : cardId;
}

/** The part a deal targets: the one dragged, else the first open one, else an unsplit card's. */
function targetPart(card: ResolvedCard, partKey?: string): ResolvedPart | undefined {
  if (partKey) return card.parts.find((p) => p.key === partKey);
  return (
    card.parts.find((p) => !p.holderId) ?? (card.splitMode === 'single' ? card.parts[0] : undefined)
  );
}

function rowEl(key: string): HTMLElement | null {
  return rootEl.value?.querySelector<HTMLElement>(`[data-row="${key}"]`) ?? null;
}

function landed(key: string): void {
  const row = rowEl(key);
  pulse(row, 'drop-flash');
  pulse(row?.querySelector<HTMLElement>('[data-face]'), 'card-bounce');
}

async function dealTo(cardId: string, memberId: string, partKey?: string): Promise<boolean> {
  const card = store.cardById(cardId);
  if (!card) return false;
  const part = targetPart(card, partKey);
  // A split card with every part held: which part moves is a choice, so open the editor.
  if (!part) {
    emit('edit', cardId);
    return false;
  }
  if (part.holderId === memberId && card.status !== 'skipped') return false;
  const res = await actions.deal(cardId, part.key, memberId);
  if (!res) return false;
  landed(memberId);
  return true;
}

async function skipCard(cardId: string): Promise<boolean> {
  const card = store.cardById(cardId);
  if (!card || card.status === 'skipped') return false;
  const res = await actions.skip([cardId]);
  if (!res) return false;
  landed(SKIPPED_ROW);
  return true;
}

async function onPick(memberId: string): Promise<void> {
  const id = pickingId.value;
  if (!id) return;
  if (await dealTo(id, memberId)) pickingId.value = null;
}

/** The picker's dismiss: "Decide later" keeps an unsorted card; otherwise it just closes. */
async function onPickerCancel(): Promise<void> {
  const card = picking.value;
  pickingId.value = null;
  if (card?.status === 'unsorted') await actions.keep(card.id);
}

async function onPickerSkip(): Promise<void> {
  const id = pickingId.value;
  if (id && (await skipCard(id))) pickingId.value = null;
}

function onPickerSplit(): void {
  const id = pickingId.value;
  pickingId.value = null;
  if (id) emit('edit', id);
}

// ── Rows ─────────────────────────────────────────────────────────────────────
interface Chip {
  key: string;
  card: ResolvedCard;
  part?: ResolvedPart;
  caption: string;
}

const members = computed(() => familyStore.sortedHumans);
/** Kept cards in category order, so every row reads in the same order. */
const kept = computed(() =>
  groupByCategory(
    store.resolved.filter((c) => c.status === 'held' || c.status === 'waiting')
  ).flatMap((g) => g.cards)
);

const chipsByMember = computed(() => {
  const out = new Map<string, Chip[]>();
  for (const card of kept.value) {
    for (const part of card.parts) {
      if (!part.holderId) continue;
      const list = out.get(part.holderId) ?? [];
      list.push({ key: `${card.id}:${part.key}`, card, part, caption: partCaption(card, part) });
      out.set(part.holderId, list);
    }
  }
  return out;
});
const skippedChips = computed<Chip[]>(() =>
  groupByCategory(store.resolved.filter((c) => c.status === 'skipped'))
    .flatMap((g) => g.cards)
    .map((card) => ({ key: card.id, card, caption: '' }))
);

function countLine(memberId: string): string {
  const n = store.myCards(memberId).length;
  return fillTemplate(
    t(n === 1 ? 'whoOwnsWhat.byBean.count.one' : 'whoOwnsWhat.byBean.count.other'),
    { count: n }
  );
}

const expanded = ref(new Set<string>());
function visibleChips(key: string, chips: Chip[]): Chip[] {
  return expanded.value.has(key) ? chips : chips.slice(0, CHIP_CAP);
}
function toggleExpanded(key: string): void {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

// ── Drag and drop ────────────────────────────────────────────────────────────
const overRow = ref<string | null>(null);

function onDragOver(key: string, e: DragEvent): void {
  if (!dragged.value) return;
  e.preventDefault();
  overRow.value = key;
}
function onDragLeave(key: string): void {
  if (overRow.value === key) overRow.value = null;
}
async function onDrop(key: string): Promise<void> {
  overRow.value = null;
  const payload = dragged.value;
  endDrag();
  if (!payload) return;
  if (key === SKIPPED_ROW) await skipCard(payload.cardId);
  else await dealTo(payload.cardId, key, payload.partKey);
}

function onRailKey(e: KeyboardEvent, cardId: string): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    togglePicker(cardId);
  }
}
</script>

<script lang="ts">
export interface CardDragPayload {
  cardId: string;
  /** Set when a row chip (one held part) is dragged; a rail card deals its first open part. */
  partKey?: string;
}

/** One payload singleton for card drags, separate from the meal board's. */
export const useCardDrag = createDragPayload<CardDragPayload>('beanies-card');
</script>

<template>
  <div
    ref="rootEl"
    class="board dark:bg-surface-raised dark:border-line grid overflow-hidden rounded-3xl border border-[var(--color-border)] bg-white md:grid-cols-[17rem_minmax(0,1fr)]"
    data-testid="deal-board"
  >
    <!-- Rail -->
    <aside
      class="dark:border-line flex min-w-0 flex-col gap-2.5 border-r border-[rgb(44_62_80/6%)] p-4"
    >
      <div class="font-outfit dark:text-ink text-sm font-bold text-[var(--color-text)]">
        <span aria-hidden="true">🙋</span> {{ t('whoOwnsWhat.board.title') }}
      </div>
      <p
        class="font-outfit text-primary-500 dark:text-accent-lift -mt-1.5 text-xs font-semibold"
        data-testid="deal-board-to-deal"
      >
        {{ toDealLine }}
      </p>
      <input
        v-model="query"
        type="search"
        :placeholder="fillTemplate(t('whoOwnsWhat.board.search'), { count: live.length })"
        :aria-label="fillTemplate(t('whoOwnsWhat.board.search'), { count: live.length })"
        class="font-inter dark:bg-surface-ground dark:text-ink dark:border-line-strong w-full rounded-xl border border-[rgb(44_62_80/14%)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[#AED6F1] focus:ring-2 focus:ring-[#AED6F1]"
        data-testid="deal-board-search"
      />
      <TogglePillGroup
        v-if="!query.trim()"
        v-model="filter"
        :options="filterOptions"
        data-testid="deal-board-filter"
      />

      <div class="rail-list -mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto px-1 pb-1">
        <p
          v-if="!railGroups.length"
          class="dark:text-ink-soft py-4 text-center text-xs text-[var(--color-text-muted)]"
        >
          {{ railEmpty }}
        </p>
        <template v-for="group in railGroups" :key="group.category ?? '__other'">
          <div
            class="font-outfit dark:text-ink-faint mt-1.5 text-xs font-semibold tracking-[0.09em] text-[var(--color-text-muted)] uppercase"
          >
            {{ groupTitle(group.category) }}
          </div>
          <template v-for="card in group.cards" :key="card.id">
            <div
              draggable="true"
              role="button"
              tabindex="0"
              class="rail-card dark:bg-surface-overlay dark:border-line flex cursor-grab items-center gap-2.5 rounded-[14px] border border-[rgb(44_62_80/8%)] bg-white p-2 shadow-[var(--card-shadow)] transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:outline-none"
              :class="{ 'is-open': card.status !== 'held', 'is-picking': pickingId === card.id }"
              :style="{ '--cat': tint(card) }"
              :aria-label="fillTemplate(t('whoOwnsWhat.board.dealCard'), { card: cardName(card) })"
              :aria-expanded="pickingId === card.id"
              :data-testid="`deal-rail-${card.id}`"
              @click="togglePicker(card.id)"
              @keydown="onRailKey($event, card.id)"
              @dragstart="startDrag({ cardId: card.id }, $event)"
              @dragend="endDrag"
            >
              <span class="grip" aria-hidden="true"></span>
              <span class="thumb grid h-8 w-8 flex-none place-items-center rounded-[9px] text-lg">{{
                cardEmoji(card)
              }}</span>
              <span class="min-w-0">
                <b
                  class="font-outfit dark:text-ink block truncate text-sm leading-tight font-semibold text-[var(--color-text)]"
                  >{{ cardName(card) }}</b
                >
                <small
                  v-if="cardDone(card)"
                  class="dark:text-ink-faint block truncate text-xs text-[var(--color-text-muted)]"
                  >{{ cardDone(card) }}</small
                >
              </span>
            </div>

            <div v-if="pickingId === card.id && picking" class="flex flex-col gap-2">
              <InlineMemberPicker
                :members="members"
                :title="t('whoOwnsWhat.pile.whoOwns')"
                :subtitle="
                  targetPart(picking)
                    ? partCaption(picking, targetPart(picking)!) || undefined
                    : undefined
                "
                :back-label="
                  picking.status === 'unsorted'
                    ? t('whoOwnsWhat.pile.decideLater')
                    : t('action.cancel')
                "
                :empty-message="t('whoOwnsWhat.pile.noMembers')"
                tile-testid-prefix="deal-board-pick-"
                dismiss-style="close"
                @pick="onPick"
                @cancel="onPickerCancel"
              />
              <div class="flex gap-2">
                <DeckActionButton class="flex-1" @click="onPickerSplit">
                  <span aria-hidden="true">✂️</span> {{ t('whoOwnsWhat.pile.split') }}
                </DeckActionButton>
                <DeckActionButton
                  class="flex-1"
                  data-testid="deal-board-pick-skip"
                  @click="onPickerSkip"
                >
                  <span aria-hidden="true">⏭️</span> {{ t('whoOwnsWhat.pile.skip') }}
                </DeckActionButton>
              </div>
            </div>
          </template>
        </template>
      </div>

      <button
        type="button"
        class="font-outfit text-primary-500 dark:text-accent-lift rounded-[14px] border-[1.5px] border-dashed border-[rgb(241_93_34/50%)] bg-[var(--tint-orange-8)] py-2.5 text-sm font-bold"
        data-testid="deal-board-new"
        @click="emit('new-card')"
      >
        ＋ {{ t('whoOwnsWhat.board.newCard') }}
      </button>
      <p class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        {{ t('whoOwnsWhat.board.tip') }}
      </p>
    </aside>

    <!-- Rows: one per non-pet member, then Skipped. -->
    <div class="flex min-w-0 flex-col gap-2.5 p-4">
      <section
        v-for="m in members"
        :key="m.id"
        class="brow grid min-h-[5.75rem] grid-cols-[7rem_minmax(0,1fr)] overflow-hidden rounded-[14px] transition-colors"
        :class="{ 'is-over': overRow === m.id }"
        :style="{ '--m': memberAvatarBindings(m).color }"
        :data-row="m.id"
        :aria-label="fillTemplate(t('whoOwnsWhat.board.rowLabel'), { name: m.name })"
        :data-testid="`deal-row-${m.id}`"
        @dragover="onDragOver(m.id, $event)"
        @dragenter="onDragOver(m.id, $event)"
        @dragleave="onDragLeave(m.id)"
        @drop.prevent="onDrop(m.id)"
      >
        <div class="flex flex-col items-center justify-center gap-1 p-2 text-center">
          <span data-face class="inline-flex">
            <BeanieAvatar v-bind="memberAvatarBindings(m)" size="md" />
          </span>
          <b class="font-outfit dark:text-ink text-sm font-bold text-[var(--color-text)]">{{
            m.name
          }}</b>
          <small class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">{{
            countLine(m.id)
          }}</small>
        </div>
        <div class="cells flex flex-wrap content-start gap-1.5 p-2">
          <button
            v-for="chip in visibleChips(m.id, chipsByMember.get(m.id) ?? [])"
            :key="chip.key"
            type="button"
            draggable="true"
            class="chip"
            :style="{ '--cat': tint(chip.card) }"
            :data-testid="`deal-chip-${m.id}-${chip.key}`"
            @click="emit('open', chip.card.id)"
            @dragstart="startDrag({ cardId: chip.card.id, partKey: chip.part?.key }, $event)"
            @dragend="endDrag"
          >
            <span class="thumb" aria-hidden="true">{{ cardEmoji(chip.card) }}</span>
            <span class="truncate">{{ cardName(chip.card) }}</span>
            <small v-if="chip.caption">{{ chip.caption }}</small>
          </button>
          <button
            v-if="(chipsByMember.get(m.id)?.length ?? 0) > CHIP_CAP"
            type="button"
            class="chip more"
            @click="toggleExpanded(m.id)"
          >
            <small>{{
              expanded.has(m.id)
                ? t('whoOwnsWhat.board.less')
                : fillTemplate(t('whoOwnsWhat.board.more'), {
                    count: (chipsByMember.get(m.id)?.length ?? 0) - CHIP_CAP,
                  })
            }}</small>
          </button>
          <span v-if="dragged" class="drop">{{ t('whoOwnsWhat.board.dropDeal') }}</span>
        </div>
      </section>

      <section
        class="brow is-skipped grid min-h-[5.75rem] grid-cols-[7rem_minmax(0,1fr)] overflow-hidden rounded-[14px] transition-colors"
        :class="{ 'is-over': overRow === SKIPPED_ROW }"
        :data-row="SKIPPED_ROW"
        :aria-label="t('whoOwnsWhat.board.skippedRow')"
        data-testid="deal-row-skipped"
        @dragover="onDragOver(SKIPPED_ROW, $event)"
        @dragenter="onDragOver(SKIPPED_ROW, $event)"
        @dragleave="onDragLeave(SKIPPED_ROW)"
        @drop.prevent="onDrop(SKIPPED_ROW)"
      >
        <div class="flex flex-col items-center justify-center gap-1 p-2 text-center">
          <span
            data-face
            class="skip-face grid h-10 w-10 place-items-center rounded-full text-lg"
            aria-hidden="true"
            >⏭️</span
          >
          <b class="font-outfit dark:text-ink text-sm font-bold text-[var(--color-text)]">{{
            t('whoOwnsWhat.board.skippedRow')
          }}</b>
          <small class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">{{
            store.stats.skipped
          }}</small>
        </div>
        <div class="cells flex flex-wrap content-start gap-1.5 p-2">
          <button
            v-for="chip in visibleChips(SKIPPED_ROW, skippedChips)"
            :key="chip.key"
            type="button"
            draggable="true"
            class="chip is-skipped"
            :style="{ '--cat': tint(chip.card) }"
            :data-testid="`deal-chip-skipped-${chip.key}`"
            @click="emit('open', chip.card.id)"
            @dragstart="startDrag({ cardId: chip.card.id }, $event)"
            @dragend="endDrag"
          >
            <span class="thumb" aria-hidden="true">{{ cardEmoji(chip.card) }}</span>
            <span class="truncate">{{ cardName(chip.card) }}</span>
          </button>
          <button
            v-if="skippedChips.length > CHIP_CAP"
            type="button"
            class="chip more"
            @click="toggleExpanded(SKIPPED_ROW)"
          >
            <small>{{
              expanded.has(SKIPPED_ROW)
                ? t('whoOwnsWhat.board.less')
                : fillTemplate(t('whoOwnsWhat.board.more'), {
                    count: skippedChips.length - CHIP_CAP,
                  })
            }}</small>
          </button>
          <span v-if="dragged" class="drop">{{ t('whoOwnsWhat.board.dropSkip') }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rail-list {
  max-height: 34rem;
}

.chip .thumb {
  border-radius: 0.5625rem;
  display: grid;
  flex: none;
  font-size: 1rem;
  height: 1.75rem;
  place-items: center;
  width: 1.75rem;
}

.rail-card .thumb,
.chip .thumb {
  background: color-mix(in srgb, var(--cat) 14%, transparent);
}

html.dark .rail-card .thumb,
html.dark .chip .thumb {
  background: color-mix(in srgb, var(--cat) 24%, transparent);
}

.rail-card.is-picking {
  box-shadow: 0 0 0 2px #f15d22;
}

/* A 2×3 dot pad that reads as "grab me". */
.grip {
  background-image: radial-gradient(circle, rgb(44 62 80 / 40%) 1.5px, transparent 1.6px);
  background-size: 0.3125rem 0.3125rem;
  flex: none;
  height: 0.9375rem;
  width: 0.5rem;
}

html.dark .grip {
  background-image: radial-gradient(circle, rgb(154 169 180 / 70%) 1.5px, transparent 1.6px);
}

.brow {
  background: color-mix(in srgb, var(--m) 7%, transparent);
}

html.dark .brow {
  background: color-mix(in srgb, var(--m) 12%, var(--color-surface-raised));
}

.brow.is-skipped {
  --m: #64748b;
}

.brow.is-over {
  background: var(--tint-orange-15);
  box-shadow: inset 0 0 0 2px #f15d22;
}

html.dark .brow.is-over {
  background: color-mix(in srgb, #f15d22 18%, var(--color-surface-raised));
}

.cells {
  border-left: 1px solid rgb(44 62 80 / 5%);
}

html.dark .cells {
  border-left-color: var(--color-line);
}

.skip-face {
  background: rgb(100 116 139 / 14%);
}

html.dark .skip-face {
  background: var(--color-surface-overlay);
}

.chip {
  align-items: center;
  background: #fff;
  border: 1px solid rgb(44 62 80 / 9%);
  border-radius: 0.8125rem;
  box-shadow: var(--card-shadow);
  color: var(--color-text);
  cursor: grab;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 700;
  gap: 0.375rem;
  max-width: 100%;
  padding: 0.25rem 0.625rem 0.25rem 0.25rem;
}

.chip:hover {
  border-color: rgb(241 93 34 / 38%);
}

html.dark .chip {
  background: var(--color-surface-overlay);
  border-color: var(--color-line);
  color: var(--color-ink);
}

html.dark .chip:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-line-strong);
}

.chip small {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

html.dark .chip small {
  color: var(--color-ink-faint);
}

.chip.is-skipped,
.chip.more {
  border-style: dashed;
  box-shadow: none;
}

.chip.more {
  cursor: pointer;
  padding: 0.375rem 0.75rem;
}

.drop {
  align-items: center;
  border: 1.5px dashed rgb(241 93 34 / 50%);
  border-radius: 0.8125rem;
  color: #c2410c;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.375rem 0.75rem;
}

html.dark .drop {
  border-color: var(--color-accent-lift);
  color: var(--color-accent-lift);
}
</style>
