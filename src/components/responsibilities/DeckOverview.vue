<script setup lang="ts">
/**
 * Who Owns What (#109): the Overview, the default view (Requirement 7, mockup sections 1
 * and 2). It answers "is every job covered?", never "who holds more?": the ring counts
 * cards dealt against the deck, categories show coverage and faces, and NO per-person
 * total appears anywhere on this surface.
 *
 * Sections: summary (ring, legend, Deal the Last N, See the Skipped Pile), By Category,
 * the family check-in, Waiting for a Holder, Recent Moves and a few Facts. Desktop is
 * two columns; a phone stacks them.
 *
 * Reads the store (views read reactive state) and emits every intent that opens another
 * surface; the page owns the deal pile, the drawers and the check-in drawer. The one
 * write here is the check-in snooze, a `notificationsStore` read-mark.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useToday } from '@/composables/useToday';
import { useMemberInfo, isAdultMember } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { showToast } from '@/composables/useToast';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { CARD_CHECKIN_PREFIX } from '@/utils/notifications';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import {
  buildCheckInAgenda,
  recentMoves,
  ymdOf,
  type RecentItem,
} from '@/utils/responsibilityDeck';
import type { FamilyMember } from '@/types/models';
import BaseButton from '@/components/ui/BaseButton.vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import DeckPanel from './DeckPanel.vue';
import DeckRing from './DeckRing.vue';
import CategoryCoverage from './CategoryCoverage.vue';
import CheckInCard from './CheckInCard.vue';

withDefaults(defineProps<{ canDeal?: boolean }>(), { canDeal: false });
const emit = defineEmits<{
  /** Open the deal view over every waiting card. */
  'deal-waiting': [];
  /** Open the deal pile at one card. */
  'deal-card': [cardId: string];
  'see-skipped': [];
  'open-card': [cardId: string];
  'start-check-in': [];
  'set-rhythm': [];
}>();

const { t } = useTranslation();
const { today } = useToday();
const store = useResponsibilityStore();
const familyStore = useFamilyStore();
const notificationsStore = useNotificationsStore();
const { getMemberName } = useMemberInfo();
const { cardName, cardDone, cardEmoji } = useResponsibilityCardLabel();

/** Waiting cards listed before "Open the Deal View" takes over. */
const WAITING_SHOWN = 5;

const stats = computed(() => store.stats);

const headline = computed(() => {
  const { deck, waiting } = stats.value;
  if (!deck) return t('whoOwnsWhat.overview.empty');
  if (!waiting) return t('whoOwnsWhat.overview.allHeld');
  return fillTemplate(
    t(waiting === 1 ? 'whoOwnsWhat.overview.waiting.one' : 'whoOwnsWhat.overview.waiting.other'),
    { count: waiting }
  );
});

const legend = computed(() => [
  { key: 'held', count: stats.value.held, label: t('whoOwnsWhat.overview.legend.held') },
  { key: 'waiting', count: stats.value.waiting, label: t('whoOwnsWhat.overview.legend.waiting') },
  { key: 'skipped', count: stats.value.skipped, label: t('whoOwnsWhat.overview.legend.skipped') },
]);

const waitingShown = computed(() => store.waiting.slice(0, WAITING_SHOWN));

// ── Check-in ─────────────────────────────────────────────────────────────────
const agenda = computed(() =>
  buildCheckInAgenda(store.resolved, store.moves, store.checkInSince, today.value)
);

function snoozeCheckIn(): void {
  if (!store.nextCheckIn) return;
  // The same read the briefing's check-in row is dismissed with; it hides the reminder for
  // a week from now. `markRead` reports its own failures (notifications-markRead).
  notificationsStore.markRead(CARD_CHECKIN_PREFIX + store.nextCheckIn);
  showToast('success', t('whoOwnsWhat.checkin.snoozed'));
}

// ── Recent moves ─────────────────────────────────────────────────────────────
const recent = computed(() =>
  recentMoves(store.moves, store.checkIns, store.states, today.value, 5)
);

function recentText(item: RecentItem): string {
  if (item.kind === 'checkin') {
    return item.checkIn.redealt
      ? fillTemplate(t('whoOwnsWhat.recent.checkinRedealt'), { count: item.checkIn.redealt })
      : t('whoOwnsWhat.recent.checkin');
  }
  const card = store.cardById(item.cardId);
  const name = card ? cardName(card) : '';
  if (item.kind === 'redeal') {
    return fillTemplate(t('whoOwnsWhat.recent.redeal'), {
      card: name,
      from: getMemberName(item.move.fromId, ''),
      to: getMemberName(item.move.toId, ''),
    });
  }
  const key =
    item.kind === 'custom'
      ? 'whoOwnsWhat.recent.custom'
      : item.kind === 'split'
        ? 'whoOwnsWhat.recent.split'
        : 'whoOwnsWhat.recent.skip';
  return fillTemplate(t(key), { card: name });
}

function recentIcon(item: RecentItem): string {
  if (item.kind === 'checkin') return '🗓️';
  const card = store.cardById(item.cardId);
  return card ? cardEmoji(card) : '🃏';
}

// ── Facts ────────────────────────────────────────────────────────────────────
const adults = computed(() => familyStore.members.filter(isAdultMember));

/** Every grown-up holds at least one kept "just for me" card. */
const everyAdultHasMe = computed(() =>
  adults.value.every((a) =>
    store.resolved.some(
      (c) =>
        c.category === 'me' &&
        (c.status === 'held' || c.status === 'waiting') &&
        c.parts.some((p) => p.holderId === a.id)
    )
  )
);

/** Children holding at least one card: faces only. */
const kidsHolding = computed<FamilyMember[]>(() =>
  familyStore.sortedHumans.filter((m) => !isAdultMember(m) && store.myCards(m.id).length > 0)
);
</script>

<template>
  <div class="grid gap-5 lg:grid-cols-2 lg:items-start" data-testid="deck-overview">
    <div class="flex min-w-0 flex-col gap-5">
      <!-- Summary -->
      <DeckPanel>
        <div class="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <DeckRing :held="stats.held" :deck="stats.deck" />
          <div class="flex min-w-0 flex-1 flex-col gap-3.5">
            <p
              class="font-outfit dark:text-ink text-base font-semibold text-[var(--color-text)]"
              data-testid="overview-headline"
            >
              {{ headline }}
            </p>
            <ul class="space-y-1.5 text-sm">
              <li v-for="row in legend" :key="row.key" class="flex items-center gap-2">
                <span class="legend-key h-3 w-3 shrink-0 rounded-full" :class="row.key" />
                <strong class="font-outfit dark:text-ink text-[var(--color-text)]">{{
                  row.count
                }}</strong>
                <span class="dark:text-ink-soft text-[var(--color-text-muted)]">{{
                  row.label
                }}</span>
              </li>
              <li class="dark:text-ink-faint pl-5 text-xs text-[var(--color-text-muted)]">
                {{
                  fillTemplate(t('whoOwnsWhat.overview.legend.total'), {
                    deck: stats.deck,
                    total: stats.total,
                  })
                }}
              </li>
            </ul>
            <div class="flex flex-wrap gap-2">
              <BaseButton
                v-if="canDeal && stats.waiting"
                size="sm"
                data-testid="overview-deal-last"
                @click="emit('deal-waiting')"
              >
                {{
                  stats.waiting === 1
                    ? t('whoOwnsWhat.overview.dealLast.one')
                    : fillTemplate(t('whoOwnsWhat.overview.dealLast.other'), {
                        count: stats.waiting,
                      })
                }}
              </BaseButton>
              <BaseButton
                v-if="stats.skipped"
                variant="outline"
                size="sm"
                data-testid="overview-see-skipped"
                @click="emit('see-skipped')"
              >
                {{ t('whoOwnsWhat.overview.seeSkipped') }}
              </BaseButton>
            </div>
          </div>
        </div>
      </DeckPanel>

      <DeckPanel
        v-if="store.coverage.length"
        :title="t('whoOwnsWhat.overview.byCategory')"
        :hint="t('whoOwnsWhat.overview.byCategoryHint')"
      >
        <CategoryCoverage :rows="store.coverage" />
      </DeckPanel>
    </div>

    <div class="flex min-w-0 flex-col gap-5">
      <CheckInCard
        :rhythm-weeks="store.rhythmWeeks"
        :last-check-in="store.lastCheckIn"
        :next-check-in="store.nextCheckIn"
        :due="store.checkInDue"
        :agenda="agenda"
        :can-edit="canDeal"
        @start="emit('start-check-in')"
        @later="snoozeCheckIn"
        @set-rhythm="emit('set-rhythm')"
      />

      <DeckPanel v-if="store.waiting.length" :title="t('whoOwnsWhat.overview.waitingTitle')">
        <template #aside>
          <button
            type="button"
            class="font-outfit text-primary-500 dark:text-accent-lift text-xs font-semibold whitespace-nowrap hover:underline"
            @click="emit('deal-waiting')"
          >
            {{ t('whoOwnsWhat.overview.openDeal') }}
          </button>
        </template>
        <ul class="space-y-2">
          <li
            v-for="card in waitingShown"
            :key="card.id"
            class="dark:bg-surface-overlay flex items-center gap-3 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-3 text-left"
              @click="emit('open-card', card.id)"
            >
              <span class="text-xl" aria-hidden="true">{{ cardEmoji(card) }}</span>
              <span class="min-w-0">
                <span
                  class="font-outfit dark:text-ink block truncate text-sm font-semibold text-[var(--color-text)]"
                  >{{ cardName(card) }}</span
                >
                <span
                  class="dark:text-ink-faint block truncate text-xs text-[var(--color-text-muted)]"
                  >{{ cardDone(card) }}</span
                >
              </span>
            </button>
            <button
              v-if="canDeal"
              type="button"
              class="font-outfit text-primary-500 dark:text-accent-lift shrink-0 rounded-xl bg-[var(--tint-orange-8)] px-3 py-1.5 text-xs font-bold transition-colors hover:bg-[var(--tint-orange-15)] dark:hover:bg-[var(--tint-orange-15)]"
              :data-testid="`overview-deal-${card.id}`"
              @click="emit('deal-card', card.id)"
            >
              {{ t('whoOwnsWhat.overview.deal') }}
            </button>
          </li>
        </ul>
        <p
          v-if="store.waiting.length > WAITING_SHOWN"
          class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
        >
          {{
            fillTemplate(t('whoOwnsWhat.overview.waitingMore'), {
              count: store.waiting.length - WAITING_SHOWN,
            })
          }}
        </p>
      </DeckPanel>

      <DeckPanel
        :title="t('whoOwnsWhat.overview.recentTitle')"
        :hint="t('whoOwnsWhat.overview.recentHint')"
      >
        <ul v-if="recent.length" class="space-y-2.5">
          <li
            v-for="item in recent"
            :key="`${item.kind}:${item.at}`"
            class="flex items-start gap-3"
          >
            <span class="text-base leading-6" aria-hidden="true">{{ recentIcon(item) }}</span>
            <span class="dark:text-ink min-w-0 flex-1 text-sm text-[var(--color-text)]">
              {{ recentText(item) }}
            </span>
            <span
              class="dark:text-ink-faint text-xs whitespace-nowrap text-[var(--color-text-muted)]"
            >
              {{ formatNookDate(ymdOf(item.at)) }}
            </span>
          </li>
        </ul>
        <p v-else class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
          {{ t('whoOwnsWhat.overview.recentEmpty') }}
        </p>
      </DeckPanel>

      <DeckPanel v-if="stats.deck">
        <ul class="space-y-3.5" data-testid="overview-facts">
          <li v-if="adults.length" class="flex items-start gap-3">
            <span class="text-base leading-6" aria-hidden="true">✨</span>
            <span class="min-w-0 flex-1">
              <span
                class="font-outfit dark:text-ink block text-sm font-semibold text-[var(--color-text)]"
              >
                {{ everyAdultHasMe ? t('whoOwnsWhat.facts.meOk') : t('whoOwnsWhat.facts.meNudge') }}
                <span
                  v-if="everyAdultHasMe"
                  class="dark:text-success-lift text-green-600"
                  aria-hidden="true"
                  >✓</span
                >
              </span>
              <span class="dark:text-ink-faint block text-xs text-[var(--color-text-muted)]">
                {{
                  everyAdultHasMe
                    ? t('whoOwnsWhat.facts.meOkHint')
                    : t('whoOwnsWhat.facts.meNudgeHint')
                }}
              </span>
            </span>
          </li>
          <li v-if="stats.splitCount" class="flex items-start gap-3">
            <span class="text-base leading-6" aria-hidden="true">✂️</span>
            <span class="min-w-0 flex-1">
              <span
                class="font-outfit dark:text-ink block text-sm font-semibold text-[var(--color-text)]"
              >
                {{
                  stats.splitCount === 1
                    ? t('whoOwnsWhat.facts.split.one')
                    : fillTemplate(t('whoOwnsWhat.facts.split.other'), { count: stats.splitCount })
                }}
              </span>
              <span class="dark:text-ink-faint block text-xs text-[var(--color-text-muted)]">
                {{ t('whoOwnsWhat.facts.splitHint') }}
              </span>
            </span>
          </li>
          <li v-if="kidsHolding.length" class="flex items-start gap-3">
            <span class="text-base leading-6" aria-hidden="true">🌱</span>
            <span class="min-w-0 flex-1">
              <span
                class="font-outfit dark:text-ink block text-sm font-semibold text-[var(--color-text)]"
              >
                {{ t('whoOwnsWhat.facts.kids') }}
              </span>
              <span class="dark:text-ink-faint block text-xs text-[var(--color-text-muted)]">
                {{ t('whoOwnsWhat.facts.kidsHint') }}
              </span>
            </span>
            <ActivityOwnerStack :members="kidsHolding" size="xs" :max="4" />
          </li>
        </ul>
      </DeckPanel>
    </div>
  </div>
</template>

<style scoped>
.legend-key.held {
  background: linear-gradient(135deg, #f15d22, #e67e22);
}

.legend-key.waiting {
  background: repeating-linear-gradient(135deg, #f15d22 0 2px, transparent 2px 5px);
  box-shadow: inset 0 0 0 1.5px #f15d22;
}

html.dark .legend-key.waiting {
  background: repeating-linear-gradient(
    135deg,
    var(--color-accent-lift) 0 2px,
    transparent 2px 5px
  );
  box-shadow: inset 0 0 0 1.5px var(--color-accent-lift);
}

.legend-key.skipped {
  background: rgb(44 62 80 / 15%);
}

html.dark .legend-key.skipped {
  background: var(--color-line-strong);
}
</style>
