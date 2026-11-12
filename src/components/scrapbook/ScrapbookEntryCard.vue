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
}>();

function handleCardClick(): void {
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
