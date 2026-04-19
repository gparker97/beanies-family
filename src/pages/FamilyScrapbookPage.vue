<script setup lang="ts">
/**
 * Family Scrapbook — `/pod/scrapbook`. Cross-bean merged feed of
 * favorites + sayings + notes, sorted newest-first, with type +
 * member filter chips and a CSS-columns masonry layout.
 *
 * Page loads 30 items at a time; "Load more" appends +30. Each item
 * type gets its own template — sticky notes for sayings, polaroid-
 * style cards for photo entries (phase coming up), simple cards for
 * favorites + notes. Clicking an entry routes to the owning bean's
 * tab so the user can edit there.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import StickyNote from '@/components/pod/shared/StickyNote.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import {
  useScrapbookFeed,
  type ScrapType,
  type ScrapbookEntry,
} from '@/composables/useScrapbookFeed';
import type {
  FamilyMember,
  FavoriteItem,
  FavoriteCategory,
  MemberNote,
  SayingItem,
  UUID,
} from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();

// --- Filter state -----------------------------------------------------

const allMemberIds = computed<UUID[]>(() => familyStore.members.map((m) => m.id));
const selectedMemberIds = ref<UUID[]>([]);
const selectedTypes = ref<Set<ScrapType>>(new Set());

// "Everyone" = nothing explicitly selected → feed uses all member ids.
const effectiveMemberIds = computed(() =>
  selectedMemberIds.value.length === 0 ? allMemberIds.value : selectedMemberIds.value
);

const { entries } = useScrapbookFeed({
  memberIds: effectiveMemberIds,
  contentTypes: selectedTypes,
});

// --- Paging -----------------------------------------------------------

const PAGE_SIZE = 30;
const visibleCount = ref(PAGE_SIZE);

// Reset pagination whenever filters change — otherwise hidden items
// could already be past the visible cutoff from a previous filter.
function resetPaging(): void {
  visibleCount.value = PAGE_SIZE;
}

const visibleEntries = computed(() => entries.value.slice(0, visibleCount.value));
const canLoadMore = computed(() => entries.value.length > visibleCount.value);

// --- Type filter chips ------------------------------------------------

function toggleType(t: ScrapType): void {
  const next = new Set(selectedTypes.value);
  if (next.has(t)) next.delete(t);
  else next.add(t);
  selectedTypes.value = next;
  resetPaging();
}

function isTypeSelected(t: ScrapType): boolean {
  return selectedTypes.value.size === 0 || selectedTypes.value.has(t);
}

// --- Member filter chips ----------------------------------------------

function toggleMember(id: UUID): void {
  const idx = selectedMemberIds.value.indexOf(id);
  if (idx >= 0) selectedMemberIds.value = selectedMemberIds.value.filter((x) => x !== id);
  else selectedMemberIds.value = [...selectedMemberIds.value, id];
  resetPaging();
}

function isMemberSelected(id: UUID): boolean {
  return selectedMemberIds.value.length === 0 || selectedMemberIds.value.includes(id);
}

function clearFilters(): void {
  selectedMemberIds.value = [];
  selectedTypes.value = new Set();
  resetPaging();
}

const hasAnyFilter = computed(
  () => selectedMemberIds.value.length > 0 || selectedTypes.value.size > 0
);

// --- Render helpers ---------------------------------------------------

const FAVORITE_EMOJI: Record<FavoriteCategory, string> = {
  food: '\u{1F35C}',
  place: '\u{1F4CD}',
  book: '\u{1F4DA}',
  song: '\u{1F3B5}',
  toy: '\u{1F9F8}',
  other: '\u2728',
};

const TYPE_LABEL: Record<ScrapType, string> = {
  favorite: 'scrapbook.type.favorite',
  saying: 'scrapbook.type.saying',
  note: 'scrapbook.type.note',
};

function memberFor(id: UUID): FamilyMember | undefined {
  return familyStore.members.find((m) => m.id === id);
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function openEntry(entry: ScrapbookEntry): void {
  // Route to the owning bean's tab so edits happen where the canonical
  // content lives. The scrapbook is a read-focused surface.
  const tab =
    entry.type === 'favorite' ? 'favorites' : entry.type === 'saying' ? 'sayings' : 'notes';
  router.push(`/pod/${entry.memberId}/${tab}`);
}

// Deterministic sticky-note tint by index within the current visible
// window — keeps scatter consistent on re-render.
function stickyIndex(entry: ScrapbookEntry): number {
  return visibleEntries.value.findIndex((e) => e.id === entry.id);
}

// Typed accessors for the template (v-if narrowing across our union
// types doesn't pipe through into slot expressions reliably, so we
// expose plain helper functions instead).
function asFavorite(entry: ScrapbookEntry): FavoriteItem {
  return entry.payload as FavoriteItem;
}
function asSaying(entry: ScrapbookEntry): SayingItem {
  return entry.payload as SayingItem;
}
function asNote(entry: ScrapbookEntry): MemberNote {
  return entry.payload as MemberNote;
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <!-- Hero — multi-color pastel gradient that echoes the sticky
         notes in the feed, with a faded 📖 watermark on the right. -->
    <header
      class="relative mb-5 overflow-hidden rounded-[var(--sq)] px-8 py-7"
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
      <h1
        class="font-outfit text-secondary-500 text-3xl leading-none font-extrabold dark:text-gray-100"
      >
        {{ t('scrapbook.title') }}
      </h1>
      <p class="font-caveat mt-1 text-xl text-[#E67E22]">{{ t('scrapbook.subtitle') }}</p>
    </header>

    <!-- Filter row -->
    <div
      v-if="entries.length || hasAnyFilter"
      class="mb-5 flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="font-outfit text-[10px] font-semibold tracking-[0.08em] text-[var(--color-text-muted)] uppercase"
        >
          {{ t('scrapbook.filter.types') }}
        </span>
        <button
          v-for="ty in ['favorite', 'saying', 'note'] as ScrapType[]"
          :key="ty"
          type="button"
          class="font-outfit inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            isTypeSelected(ty) && selectedTypes.size > 0
              ? 'border-transparent bg-[var(--color-primary)] text-white'
              : 'text-secondary-500 border-[var(--tint-slate-10)] bg-[var(--color-background)] hover:bg-[var(--tint-orange-4)]'
          "
          @click="toggleType(ty)"
        >
          <span>{{ t(`scrapbook.filter.${ty}s` as never) }}</span>
        </button>
      </div>

      <div class="hidden h-6 w-px bg-[var(--tint-slate-10)] sm:block" />

      <div class="flex flex-wrap items-center gap-2">
        <span
          class="font-outfit text-[10px] font-semibold tracking-[0.08em] text-[var(--color-text-muted)] uppercase"
        >
          {{ t('scrapbook.filter.members') }}
        </span>
        <button
          v-for="m in familyStore.members"
          :key="m.id"
          type="button"
          class="font-outfit inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            isMemberSelected(m.id) && selectedMemberIds.length > 0
              ? 'border-transparent bg-[var(--color-primary)] text-white'
              : 'text-secondary-500 border-[var(--tint-slate-10)] bg-[var(--color-background)] hover:bg-[var(--tint-orange-4)]'
          "
          @click="toggleMember(m.id)"
        >
          <span
            class="inline-block h-4 w-4 flex-shrink-0 rounded-md"
            :style="{ backgroundColor: m.color }"
            aria-hidden="true"
          />
          <span>{{ m.name }}</span>
        </button>
      </div>

      <button
        v-if="hasAnyFilter"
        type="button"
        class="font-outfit text-primary-500 ml-auto text-xs font-semibold hover:underline"
        @click="clearFilters"
      >
        {{ t('action.clear') }}
      </button>
    </div>

    <!-- Masonry feed -->
    <div
      v-if="visibleEntries.length"
      class="scrapbook-feed"
      style="column-count: 3; column-gap: 18px"
    >
      <article
        v-for="entry in visibleEntries"
        :key="`${entry.type}-${entry.id}`"
        class="mb-4 cursor-pointer overflow-hidden rounded-2xl bg-white shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
        style="break-inside: avoid"
        @click="openEntry(entry)"
      >
        <!-- Header: bean color dot + name + type label -->
        <header
          class="font-outfit text-secondary-500/70 flex items-center gap-2 px-4 pt-3 text-[11px] font-semibold dark:text-gray-400"
        >
          <span
            class="inline-block h-4 w-4 flex-shrink-0 rounded-md"
            :style="{ backgroundColor: memberFor(entry.memberId)?.color ?? '#3b82f6' }"
            aria-hidden="true"
          />
          <span class="truncate">{{ memberFor(entry.memberId)?.name ?? '—' }}</span>
          <span class="ml-auto tracking-[0.06em] uppercase opacity-70">
            {{ t(TYPE_LABEL[entry.type] as never) }}
          </span>
        </header>

        <!-- Body — type-specific -->
        <!-- Saying → sticky note inside the card -->
        <div v-if="entry.type === 'saying'" class="px-3 pt-3 pb-3">
          <StickyNote
            :text="asSaying(entry).words"
            :index="stickyIndex(entry)"
            :footer-text="asSaying(entry).saidOn ?? ''"
            size="md"
          />
        </div>

        <!-- Favorite → big category emoji + name + optional description -->
        <div v-else-if="entry.type === 'favorite'" class="flex gap-3 px-4 py-3">
          <div
            class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-xl"
            aria-hidden="true"
          >
            {{ FAVORITE_EMOJI[asFavorite(entry).category] }}
          </div>
          <div class="min-w-0 flex-1">
            <h4
              class="font-outfit text-secondary-500 text-sm leading-tight font-bold dark:text-gray-100"
            >
              {{ asFavorite(entry).name }}
            </h4>
            <p
              v-if="asFavorite(entry).description"
              class="font-inter text-secondary-500/70 mt-1 text-xs leading-snug dark:text-gray-400"
            >
              {{ asFavorite(entry).description }}
            </p>
            <span
              class="font-outfit text-secondary-500/50 mt-1 inline-block text-[10px] font-semibold tracking-wide uppercase"
            >
              {{ asFavorite(entry).category }}
            </span>
          </div>
        </div>

        <!-- Note → title + body clamp -->
        <div v-else class="px-4 py-3">
          <h4 class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-100">
            {{ asNote(entry).title }}
          </h4>
          <p
            class="font-inter text-secondary-500/70 mt-1 line-clamp-4 text-xs leading-snug dark:text-gray-400"
          >
            {{ asNote(entry).body }}
          </p>
        </div>

        <!-- Date line -->
        <div
          class="font-outfit text-secondary-500/50 px-4 pb-3 text-[10px] font-semibold tracking-[0.08em] uppercase"
        >
          {{ shortDate(entry.createdAt) }}
        </div>
      </article>
    </div>

    <!-- Load more -->
    <div v-if="canLoadMore" class="mt-4 flex justify-center">
      <button
        type="button"
        class="font-outfit text-secondary-500 rounded-2xl border-2 border-[var(--tint-slate-10)] bg-white px-5 py-2 text-sm font-semibold transition-colors hover:bg-[var(--tint-orange-4)] dark:bg-slate-800 dark:text-gray-100"
        @click="visibleCount += PAGE_SIZE"
      >
        {{ t('scrapbook.loadMore') }}
        <span class="text-secondary-500/50 ml-1"> ({{ entries.length - visibleCount }}) </span>
      </button>
    </div>

    <!-- Empty states -->
    <div
      v-if="!entries.length"
      class="rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="📖"
        :message="hasAnyFilter ? t('scrapbook.noResults') : t('scrapbook.empty')"
      />
    </div>
  </main>
</template>

<style scoped>
@media (width <= 980px) {
  .scrapbook-feed {
    column-count: 2 !important;
  }
}

@media (width <= 640px) {
  .scrapbook-feed {
    column-count: 1 !important;
  }
}
</style>
