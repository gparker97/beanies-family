<script setup lang="ts">
/**
 * The clickable scrapbook card on the Family Scrapbook page. Both `<EveryoneSpread>` and
 * `<BeanSpread>` compose this. Rendering lives in `<ScrapbookPiece>` (shared with the
 * wall's timeline); this wrapper only adds the `<button>`, the click and the hover lift
 * (`interactive`), so a non-clickable surface never looks clickable.
 *
 * Class fall-through: the parent owns layout/sizing via `:class`, which lands on the root
 * `<button>`. Preflight leaves the button box-neutral (no padding, border or background),
 * and each paper variant inside is `h-full w-full`, so the paper still fills the grid cell
 * the button occupies. An unknown entry type renders the piece's hidden span as the root,
 * as before, so a grid never gains an empty cell. The card emits `@click` with the entry;
 * the parent decides routing.
 *
 * PHOTO TAP (#154). The card is one `<button>`, so the photo cannot be a second button inside
 * it. Instead the one click handler looks at what was tapped: inside the piece's
 * `[data-scrap-photo]` region it emits `photo-click`, anywhere else `click`. Keyboard
 * activation (Enter / Space) targets the button itself, so it keeps emitting `click` and
 * routes as before; a keyboard user reaches the photo from the bean's page.
 */
import ScrapbookPiece, { SCRAPBOOK_PIECE_TYPES } from '@/components/scrapbook/ScrapbookPiece.vue';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import type { PhotoSize } from '@/stores/photoStore';

const props = defineProps<{
  entry: ScrapbookEntry;
  /** Stable index used by `<StickyNote>` for color + tilt cycling. */
  noteIndex?: number;
  /** Polaroid treatment for a milestone with photos; see `ScrapbookPiece`. */
  emphasizePhoto?: boolean;
  /** Polaroid photo size; the piece's default when omitted. The timeline passes `'screen'`. */
  photoSize?: PhotoSize;
}>();

const emit = defineEmits<{
  click: [entry: ScrapbookEntry];
  /** The polaroid's photo was tapped (only a milestone drawn as a polaroid has one). */
  'photo-click': [entry: ScrapbookEntry];
}>();

function handleCardClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest('[data-scrap-photo]')) {
    emit('photo-click', props.entry);
    return;
  }
  emit('click', props.entry);
}
</script>

<template>
  <button
    v-if="SCRAPBOOK_PIECE_TYPES.has(entry.type)"
    type="button"
    class="block w-full text-left"
    @click="handleCardClick"
  >
    <ScrapbookPiece
      :entry="entry"
      :note-index="noteIndex ?? 0"
      :emphasize-photo="emphasizePhoto"
      :photo-size="photoSize"
      interactive
    />
  </button>
  <ScrapbookPiece v-else :entry="entry" />
</template>
