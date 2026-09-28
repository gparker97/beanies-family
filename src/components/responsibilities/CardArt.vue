<script setup lang="ts">
/**
 * Who Owns What (#109): a card's icon, the hero illustration when the card has one and its
 * emoji otherwise (and as the fallback). The ONE place a card maps onto `ImageGlyph`, so the
 * telemetry surface and the field mapping cannot drift between the dozen places a card shows.
 *
 * Reads the already-resolved `emoji` / `illustration` (`resolveDeck`), not the label
 * composable: this renders up to ~80 times per page. Size and grey-out come from the caller
 * (`imgClass`, fallthrough `class`); the caller's own element owns any tinted box.
 */
import ImageGlyph from '@/components/ui/ImageGlyph.vue';
import type { ResolvedCard } from '@/utils/responsibilityDeck';

withDefaults(
  defineProps<{ card: Pick<ResolvedCard, 'emoji' | 'illustration'>; imgClass?: string }>(),
  { imgClass: undefined }
);
</script>

<template>
  <ImageGlyph
    :emoji="card.emoji"
    :src="card.illustration"
    surface="card-art"
    :img-class="imgClass"
  />
</template>
