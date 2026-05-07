<script setup lang="ts">
/**
 * Single source for entry-type → renderer dispatch on the Family
 * Scrapbook page. Both `<EveryoneSpread>` and `<BeanSpread>` compose
 * this so the type-aware mapping lives in one place — adding a new
 * scrapbook entry type means one branch in this file, nothing else.
 *
 * Trusts `entry.type` (a discriminated union from `useScrapbookFeed`)
 * and casts the payload accordingly. No payload-shape sniffing — if a
 * payload mismatch ever arises that's a bug in `useScrapbookFeed` to
 * fix at the source, not a defensive layer to add here.
 *
 * Class fall-through: the parent owns layout/sizing via `:class`. The
 * card emits `@click` with the entry; the parent decides routing.
 */
import { computed } from 'vue';
import StickyNote from '@/components/pod/shared/StickyNote.vue';
import MilestoneThumb from '@/components/pod/MilestoneThumb.vue';
import { useMilestoneLightbox } from '@/composables/useMilestoneLightbox';
import { usePhotoStore } from '@/stores/photoStore';
import { reportError } from '@/utils/errorReporter';
import { formatDateShort } from '@/utils/date';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import type {
  FavoriteCategory,
  FavoriteItem,
  MemberNote,
  Milestone,
  SayingItem,
} from '@/types/models';

const props = defineProps<{
  entry: ScrapbookEntry;
  /** Stable index used by `<StickyNote>` for color + tilt cycling. */
  noteIndex?: number;
  /**
   * When true AND the entry is a milestone with photos, render a
   * polaroid-style card with the photo as the focal point and a small
   * Caveat caption below. Used by the Everyone hero block + photo-cell
   * grid spans to give moments-with-photos visual prominence on the
   * scrapbook cover. Has no effect on other entry types.
   */
  emphasizePhoto?: boolean;
}>();

const emit = defineEmits<{
  click: [entry: ScrapbookEntry];
}>();

const lightbox = useMilestoneLightbox();
const photoStore = usePhotoStore();

/**
 * Polaroid hero photo URL — only resolved when emphasize-photo is on
 * AND the entry is a milestone with at least one photoId. The
 * polaroid template branch falls back to standard rendering if this
 * returns null (e.g. Drive 404'd the photo).
 */
const emphasizedPhotoUrl = computed<string | null>(() => {
  if (!props.emphasizePhoto) return null;
  const m = props.entry.type === 'milestone' ? (props.entry.payload as Milestone) : null;
  const id = m?.photoIds?.[0];
  if (!id) return null;
  return photoStore.getPublicUrl(id, 'full');
});

const FAVORITE_EMOJI: Record<FavoriteCategory, string> = {
  food: '\u{1F35C}', // 🍜
  place: '\u{1F4CD}', // 📍
  book: '\u{1F4DA}', // 📚
  song: '\u{1F3B5}', // 🎵
  toy: '\u{1F9F8}', // 🧸
  other: '\u{2728}', // ✨
};

// Track unknown-type reports so we don't spam Slack on every reactive
// recompute. Module-scoped for the same reason as photo collection
// dedup elsewhere.
const reportedUnknownTypes = new Set<string>();

const saying = computed<SayingItem | null>(() =>
  props.entry.type === 'saying' ? (props.entry.payload as SayingItem) : null
);
const favorite = computed<FavoriteItem | null>(() =>
  props.entry.type === 'favorite' ? (props.entry.payload as FavoriteItem) : null
);
const milestone = computed<Milestone | null>(() =>
  props.entry.type === 'milestone' ? (props.entry.payload as Milestone) : null
);
const note = computed<MemberNote | null>(() =>
  props.entry.type === 'note' ? (props.entry.payload as MemberNote) : null
);

function handleCardClick(): void {
  emit('click', props.entry);
}

function handleMilestoneThumbLightbox(): void {
  if (milestone.value) lightbox.openFor(milestone.value);
}

// Defensive default: surfaces an unknown entry type once per session
// per type. Used as the v-else branch in the template; render is
// suppressed via the type-narrow chain so this side-effect happens at
// computed-eval time.
const unknownTypeReported = computed(() => {
  const knownTypes = new Set(['saying', 'favorite', 'milestone', 'note']);
  if (knownTypes.has(props.entry.type)) return false;
  if (reportedUnknownTypes.has(props.entry.type)) return true;
  reportedUnknownTypes.add(props.entry.type);
  console.warn(
    '[ScrapbookEntryCard] unknown entry type — rendering nothing:',
    props.entry.type,
    props.entry.id
  );
  reportError({
    surface: 'ScrapbookEntryCard',
    message: 'unknown entry type',
    context: { entryId: props.entry.id, type: props.entry.type },
  });
  return true;
});

function sayingFooter(s: SayingItem): string {
  const parts: string[] = [];
  if (s.saidOn) parts.push(formatDateShort(s.saidOn));
  if (s.place) parts.push(s.place);
  return parts.join(' · ');
}
</script>

<template>
  <!-- Saying — sticky-note quote card -->
  <button v-if="saying" type="button" class="block w-full text-left" @click="handleCardClick">
    <StickyNote :text="saying.words" :index="noteIndex ?? 0" :footer-text="sayingFooter(saying)" />
  </button>

  <!-- Favorite — small kraft card with category emoji + name. Favorites
       don't carry photos in the current data model; photo support
       would be a future addition. -->
  <button
    v-else-if="favorite"
    type="button"
    class="block w-full rounded-2xl bg-white p-4 text-left shadow-[var(--card-shadow)] transition-transform hover:scale-[1.02] dark:bg-slate-800"
    @click="handleCardClick"
  >
    <div class="flex items-start gap-3">
      <span
        class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-xl"
        aria-hidden="true"
      >
        {{ FAVORITE_EMOJI[favorite.category] }}
      </span>
      <div class="min-w-0 flex-1">
        <h4 class="font-outfit text-secondary-500 truncate text-sm font-bold dark:text-gray-100">
          {{ favorite.name }}
        </h4>
        <p
          v-if="favorite.description"
          class="font-inter text-secondary-500/70 mt-1 line-clamp-2 text-xs leading-snug dark:text-gray-400"
        >
          {{ favorite.description }}
        </p>
      </div>
    </div>
  </button>

  <!-- Milestone with emphasized photo — polaroid hero treatment. The
       photo dominates the card; title + date are a Caveat caption
       underneath. Tap the photo opens the lightbox; tap the caption
       routes to the bean's pod. Falls back to the standard taped-card
       branch below when no photo is resolvable. -->
  <div
    v-else-if="milestone && emphasizedPhotoUrl"
    class="emphasized-photo-card scrap-taped block w-full overflow-hidden p-0"
  >
    <button
      type="button"
      class="emphasized-photo-img-button block w-full cursor-zoom-in overflow-hidden"
      :aria-label="`Open photo for ${milestone.title}`"
      @click.stop="handleMilestoneThumbLightbox"
    >
      <img
        :src="emphasizedPhotoUrl"
        referrerpolicy="no-referrer"
        loading="lazy"
        :alt="milestone.title"
        class="emphasized-photo-img"
      />
      <span
        v-if="(milestone.photoIds?.length ?? 0) > 1"
        class="font-outfit pointer-events-none absolute right-2 bottom-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-black/65 px-1.5 text-[10px] font-bold text-white"
        aria-hidden="true"
      >
        +{{ (milestone.photoIds?.length ?? 0) - 1 }}
      </span>
    </button>
    <button
      type="button"
      class="emphasized-photo-caption block w-full text-left"
      @click="handleCardClick"
    >
      <p
        class="font-outfit text-primary-600 text-[10px] font-semibold tracking-wide uppercase dark:text-orange-300"
      >
        {{ formatDateShort(milestone.occurredOn) }}
      </p>
      <p
        class="font-caveat text-secondary-500 mt-0.5 text-xl leading-tight font-bold dark:text-gray-100"
      >
        {{ milestone.title }}
      </p>
    </button>
  </div>

  <!-- Milestone — taped kraft card with thumb (lightbox-on-photo-click)
       + title + date stamp. The milestone thumb's own click opens the
       lightbox; clicking elsewhere on the card emits @click for routing. -->
  <button
    v-else-if="milestone"
    type="button"
    class="scrap-taped block w-full text-left transition-transform hover:scale-[1.02]"
    @click="handleCardClick"
  >
    <div class="flex items-start gap-3">
      <MilestoneThumb
        :milestone="milestone"
        size="sm"
        @open-lightbox="handleMilestoneThumbLightbox"
      />
      <div class="min-w-0 flex-1">
        <p
          class="font-outfit text-primary-600 text-[10px] font-semibold tracking-wide uppercase dark:text-orange-300"
        >
          {{ formatDateShort(milestone.occurredOn) }}
        </p>
        <h4
          class="font-outfit text-secondary-500 mt-0.5 truncate text-sm leading-tight font-bold dark:text-gray-100"
        >
          {{ milestone.title }}
        </h4>
        <p
          v-if="milestone.description"
          class="font-inter text-secondary-500/70 mt-1 line-clamp-2 text-xs leading-snug dark:text-gray-400"
        >
          {{ milestone.description }}
        </p>
      </div>
    </div>
  </button>

  <!-- Note — ripped paper card with title + body excerpt -->
  <button
    v-else-if="note"
    type="button"
    class="scrap-ripped block w-full text-left transition-transform hover:scale-[1.02]"
    @click="handleCardClick"
  >
    <h4 class="font-outfit text-secondary-500 text-sm font-bold dark:text-gray-100">
      {{ note.title }}
    </h4>
    <p
      v-if="note.body"
      class="font-inter text-secondary-500/80 mt-1 line-clamp-4 text-xs leading-snug dark:text-gray-300"
    >
      {{ note.body }}
    </p>
  </button>

  <!-- Unknown type — render nothing; computed above already reports.
       The hidden span keeps the ref evaluated so the side-effect runs. -->
  <span v-else-if="unknownTypeReported" hidden aria-hidden="true" />
</template>

<style scoped>
.emphasized-photo-card {
  display: flex;
  flex-direction: column;
  position: relative;
}

.emphasized-photo-img-button {
  /* Photo gets a 4:3 aspect by default — generous for landscape, fine
     for portrait (object-cover handles aspect mismatch gracefully). */
  aspect-ratio: 4 / 3;
  background: transparent;
  border: 0;
  position: relative;
}

.emphasized-photo-img {
  display: block;
  height: 100%;
  object-fit: cover;
  transition: transform 280ms ease;
  width: 100%;
}

.emphasized-photo-img-button:hover .emphasized-photo-img {
  transform: scale(1.03);
}

.emphasized-photo-caption {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0.875rem 1rem 1.25rem;
}

@media (prefers-reduced-motion: reduce) {
  .emphasized-photo-img,
  .emphasized-photo-img-button:hover .emphasized-photo-img {
    transform: none;
    transition: none;
  }
}
</style>
