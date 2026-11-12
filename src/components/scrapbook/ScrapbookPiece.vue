<script lang="ts">
/**
 * The entry types this renderer draws. Exported so `ScrapbookEntryCard` wraps only these in
 * its `<button>`; an unknown type renders this component's hidden span as the card's root,
 * exactly as before the extraction, so a grid never gains an empty cell.
 */
export const SCRAPBOOK_PIECE_TYPES: ReadonlySet<string> = new Set([
  'saying',
  'favorite',
  'milestone',
  'note',
]);
</script>

<script setup lang="ts">
/**
 * Single source for entry-type → renderer dispatch for a scrapbook entry. Presentational
 * only: no click handling, no routing. `ScrapbookEntryCard` wraps it in a `<button>` for
 * the Family Scrapbook page; the wall's timeline renders it directly. Adding a new
 * scrapbook entry type means one branch in this file, nothing else.
 *
 * Trusts `entry.type` (a discriminated union from `useScrapbookFeed`) and casts the payload
 * accordingly. No payload-shape sniffing: if a payload mismatch ever arises that's a bug in
 * `useScrapbookFeed` to fix at the source, not a defensive layer to add here.
 *
 * Each paper variant is `h-full w-full` so it fills its wrapper the way the paper button
 * used to fill its grid cell. The sticky saying is deliberately not stretched (it never
 * was). Hover lift and the polaroid photo zoom only apply when `interactive` is set, so a
 * non-clickable surface does not invite a click.
 *
 * Template comments sit inside each branch, never between branches: the dev build turns a
 * root-level comment into a fragment, which drops a caller's fall-through class.
 *
 * Photo URLs are read with `ignoreUnresolved` and failures are tracked locally (`failed`),
 * so a broken image here never marks the photo unresolved for the rest of the session.
 */
import { computed, ref, watch } from 'vue';
import StickyNote from '@/components/pod/shared/StickyNote.vue';
import MilestoneThumb from '@/components/pod/MilestoneThumb.vue';
import { usePhotoStore, type PhotoSize } from '@/stores/photoStore';
import { reportError } from '@/utils/errorReporter';
import { formatDateShort } from '@/utils/date';
import { logScrapbookImageFailed } from '@/utils/scrapbookImageFailed';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import type {
  FavoriteCategory,
  FavoriteItem,
  MemberNote,
  Milestone,
  SayingItem,
} from '@/types/models';

const props = withDefaults(
  defineProps<{
    entry: ScrapbookEntry;
    /** Stable index used by `<StickyNote>` for color + tilt cycling. */
    noteIndex?: number;
    /**
     * When true AND the entry is a milestone with photos, render a polaroid-style card with
     * the photo as the focal point and a small Caveat caption below. Used by the Everyone
     * hero block + photo-cell grid spans to give moments-with-photos visual prominence on
     * the scrapbook cover. Has no effect on other entry types.
     */
    emphasizePhoto?: boolean;
    /** Size of the polaroid photo. `'screen'` keeps a long scrolled timeline light. */
    photoSize?: PhotoSize;
    /** Set by the clickable card: enables the hover lift and the polaroid photo zoom. */
    interactive?: boolean;
  }>(),
  { noteIndex: 0, emphasizePhoto: false, photoSize: 'full', interactive: false }
);

const photoStore = usePhotoStore();

const FAVORITE_EMOJI: Record<FavoriteCategory, string> = {
  food: '\u{1F35C}', // 🍜
  place: '\u{1F4CD}', // 📍
  book: '\u{1F4DA}', // 📚
  song: '\u{1F3B5}', // 🎵
  toy: '\u{1F9F8}', // 🧸
  other: '\u{2728}', // ✨
};

// Track unknown-type reports so we don't spam Slack on every reactive recompute.
// Module-scoped for the same reason as photo collection dedup elsewhere.
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

const emphasizedPhotoId = computed<string | null>(() =>
  props.emphasizePhoto ? (milestone.value?.photoIds?.[0] ?? null) : null
);

/**
 * Polaroid hero photo URL: only resolved when emphasize-photo is on AND the entry is a
 * milestone with at least one photoId. The polaroid branch falls back to the standard
 * taped card when this returns null (missing or tombstoned photo) or the image fails.
 */
const emphasizedPhotoUrl = computed<string | null>(() => {
  const id = emphasizedPhotoId.value;
  if (!id) return null;
  return photoStore.getPublicUrl(id, props.photoSize, { ignoreUnresolved: true });
});

// A failed polaroid image drops to the taped text card for this URL (the
// `MealThumb` pattern). A new URL gets a fresh attempt.
const failed = ref(false);
watch(emphasizedPhotoUrl, () => {
  failed.value = false;
});

function onPhotoError(): void {
  if (failed.value) return;
  failed.value = true;
  const id = emphasizedPhotoId.value;
  if (!id) return;
  // eslint-disable-next-line security/detect-object-injection -- id is a UUID from the doc
  logScrapbookImageFailed(id, photoStore.photos[id]?.driveFileId);
}

const showPolaroid = computed(() => !!emphasizedPhotoUrl.value && !failed.value);

const liftClass = computed(() =>
  props.interactive ? 'transition-transform hover:scale-[1.02]' : ''
);

// Defensive default: surfaces an unknown entry type once per session per type. Used as
// the v-else branch in the template; render is suppressed via the type-narrow chain so
// this side-effect happens at computed-eval time.
const unknownTypeReported = computed(() => {
  if (SCRAPBOOK_PIECE_TYPES.has(props.entry.type)) return false;
  if (reportedUnknownTypes.has(props.entry.type)) return true;
  reportedUnknownTypes.add(props.entry.type);
  console.warn(
    '[ScrapbookPiece] unknown entry type, rendering nothing:',
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
  <StickyNote
    v-if="saying"
    :text="saying.words"
    :index="noteIndex"
    :footer-text="sayingFooter(saying)"
  />

  <div
    v-else-if="favorite"
    class="dark:bg-surface-raised block h-full w-full rounded-2xl bg-white p-4 text-left shadow-[var(--card-shadow)]"
    :class="liftClass"
  >
    <!-- Favorite: small kraft card with category emoji + name. Favorites
         don't carry photos in the current data model; photo support
         would be a future addition. -->
    <div class="flex items-start gap-3">
      <span
        class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-xl"
        aria-hidden="true"
      >
        {{ FAVORITE_EMOJI[favorite.category] }}
      </span>
      <div class="min-w-0 flex-1">
        <h4 class="font-outfit text-secondary-500 dark:text-ink truncate text-sm font-bold">
          {{ favorite.name }}
        </h4>
        <p
          v-if="favorite.description"
          class="font-inter text-secondary-400 dark:text-ink-soft mt-1 line-clamp-2 text-xs leading-snug"
        >
          {{ favorite.description }}
        </p>
      </div>
    </div>
  </div>

  <div
    v-else-if="milestone && showPolaroid"
    class="emphasized-photo-card scrap-taped block h-full w-full overflow-hidden p-0 text-left"
    :class="{ 'is-interactive': interactive }"
  >
    <!-- Milestone with emphasized photo: polaroid hero treatment. The
         photo dominates the card; title + date are a Caveat caption
         underneath. Falls back to the standard taped card below when no
         photo is resolvable or the image fails to load. -->
    <span class="emphasized-photo-img-button block w-full overflow-hidden">
      <img
        :src="emphasizedPhotoUrl!"
        referrerpolicy="no-referrer"
        loading="lazy"
        :alt="milestone.title"
        class="emphasized-photo-img"
        @error="onPhotoError"
      />
      <span
        v-if="(milestone.photoIds?.length ?? 0) > 1"
        class="font-outfit pointer-events-none absolute right-2 bottom-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-black/65 px-1.5 text-xs font-bold text-white"
        aria-hidden="true"
      >
        +{{ (milestone.photoIds?.length ?? 0) - 1 }}
      </span>
    </span>
    <span class="emphasized-photo-caption block w-full text-left">
      <span
        class="font-outfit text-primary-700 dark:text-accent-lift block text-xs font-semibold tracking-wide uppercase"
      >
        {{ formatDateShort(milestone.occurredOn) }}
      </span>
      <span
        class="font-caveat text-secondary-500 dark:text-ink mt-0.5 block text-xl leading-tight font-bold"
      >
        {{ milestone.title }}
      </span>
    </span>
  </div>

  <div v-else-if="milestone" class="scrap-taped block h-full w-full text-left" :class="liftClass">
    <!-- Milestone: taped kraft card with thumb + title + date stamp.
         `disableLightbox` keeps the thumb from intercepting a wrapping
         card's click; the lightbox is reachable from the detail view. -->
    <div class="flex items-start gap-3">
      <MilestoneThumb :milestone="milestone" size="sm" disable-lightbox ignore-unresolved />
      <div class="min-w-0 flex-1">
        <p
          class="font-outfit text-primary-700 dark:text-accent-lift text-xs font-semibold tracking-wide uppercase"
        >
          {{ formatDateShort(milestone.occurredOn) }}
        </p>
        <h4
          class="font-outfit text-secondary-500 dark:text-ink mt-0.5 truncate text-sm leading-tight font-bold"
        >
          {{ milestone.title }}
        </h4>
        <p
          v-if="milestone.description"
          class="font-inter text-secondary-400 dark:text-ink-soft mt-1 line-clamp-2 text-xs leading-snug"
        >
          {{ milestone.description }}
        </p>
      </div>
    </div>
  </div>

  <div v-else-if="note" class="scrap-ripped block h-full w-full text-left" :class="liftClass">
    <!-- Note: ripped paper card with title + body excerpt -->
    <h4 class="font-outfit text-secondary-500 dark:text-ink text-sm font-bold">
      {{ note.title }}
    </h4>
    <p
      v-if="note.body"
      class="font-inter text-secondary-400 dark:text-ink-soft mt-1 line-clamp-4 text-xs leading-snug"
    >
      {{ note.body }}
    </p>
  </div>

  <span v-else-if="unknownTypeReported" hidden aria-hidden="true">
    <!-- Unknown type: render nothing; computed above already reports.
         The hidden span keeps the ref evaluated so the side-effect runs. -->
  </span>
</template>

<style scoped>
.emphasized-photo-card {
  display: flex;
  flex-direction: column;
  position: relative;
}

.emphasized-photo-img-button {
  /* Photo gets a 4:3 aspect by default: generous for landscape, fine
     for portrait (object-cover handles aspect mismatch gracefully). */
  aspect-ratio: 4 / 3;
  position: relative;
}

.emphasized-photo-img {
  display: block;
  height: 100%;
  object-fit: cover;
  transition: transform 280ms ease;
  width: 100%;
}

.is-interactive .emphasized-photo-img-button:hover .emphasized-photo-img {
  transform: scale(1.03);
}

@media (prefers-reduced-motion: reduce) {
  .emphasized-photo-img,
  .is-interactive .emphasized-photo-img-button:hover .emphasized-photo-img {
    transform: none;
    transition: none;
  }
}

.emphasized-photo-caption {
  padding: 0.875rem 1rem 1.25rem;
}
</style>
