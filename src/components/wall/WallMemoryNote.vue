<script setup lang="ts">
/**
 * One text memory on the sleeping wall (#140): a saying as a sticky note, a favorite as a
 * taped card, a note as torn paper, with the owner's name small underneath.
 *
 * FIXED-LIGHT PAPER. The night face is fixed-dark in both themes (a dimmed room, not the
 * app theme) and the slideshow dims the whole layer, so this paper must read the same
 * either way. Tailwind's `dark:` variant cannot be opted out of inside a subtree, so the
 * colours below are literal light values in a scoped rule with no dark partner, on purpose.
 *
 * CLAMPED like the timeline's pieces (`ScrapbookPiece`): a title or name two lines, a note
 * body or saying four, a favorite's description two. A slot fixes only a piece's width, so an
 * unclamped note grew over the clock, and a shared screen shows an excerpt, never a whole note.
 */
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import type { SlideText } from '@/utils/wallSlideshow';
import type { FavoriteItem, MemberNote, SayingItem } from '@/types/models';

const props = defineProps<{
  piece: SlideText;
  /** Tape on a favorite card. */
  tape?: boolean;
  /** `pin` is the larger size used in a full-screen photo's top corners. */
  size?: 'slot' | 'pin';
}>();

const familyStore = useFamilyStore();

const owner = computed(
  () => familyStore.members.find((m) => m.id === props.piece.memberId)?.name ?? ''
);
const saying = computed(() =>
  props.piece.entry.type === 'saying' ? (props.piece.entry.payload as SayingItem) : null
);
const favorite = computed(() =>
  props.piece.entry.type === 'favorite' ? (props.piece.entry.payload as FavoriteItem) : null
);
const note = computed(() =>
  props.piece.entry.type === 'note' ? (props.piece.entry.payload as MemberNote) : null
);
</script>

<template>
  <div class="mem-note" :class="size === 'pin' ? 'wall-memory-pin' : 'wall-memory-slot'">
    <div v-if="saying" class="mem-sticky font-caveat wall-memory-sticky">
      <span class="line-clamp-4">{{ saying.words }}</span>
      <small v-if="owner" class="mem-who font-outfit wall-memory-who">{{ owner }}</small>
    </div>
    <div
      v-else-if="favorite"
      class="mem-card font-inter wall-memory-card"
      :class="{ 'mem-tape': tape }"
    >
      <b class="font-outfit line-clamp-2">{{ favorite.name }}</b>
      <span v-if="favorite.description" class="line-clamp-2">{{ favorite.description }}</span>
      <small v-if="owner" class="mem-who font-outfit wall-memory-who">{{ owner }}</small>
    </div>
    <div v-else-if="note" class="mem-card mem-rip font-inter wall-memory-card">
      <b class="font-outfit line-clamp-2">{{ note.title }}</b>
      <span v-if="note.body" class="line-clamp-4">{{ note.body }}</span>
      <small v-if="owner" class="mem-who font-outfit wall-memory-who">{{ owner }}</small>
    </div>
  </div>
</template>

<style scoped>
/* Literal light colours, no `html.dark` partner: see the component comment. */
.mem-sticky {
  background: #fff3a8;
  border-radius: 0.1em 0.1em 1.1em;
  box-shadow: 0 0.3em 0.9em rgb(0 0 0 / 22%);
  color: #2c3e50;
  font-weight: 700;
  line-height: 1.12;
  padding: 0.9em 0.9em 1em;
}

.mem-card {
  background: #fffaf0;
  border-radius: 0.9em;
  box-shadow: 0 0.25em 0.9em rgb(44 62 80 / 12%);
  color: #2c3e50;
  padding: 0.85em 1em;
  position: relative;
  text-align: left;
}

/* No `display` here: `line-clamp-*` makes the title its own clamped block. */
.mem-card b {
  font-weight: 700;
}

.mem-who {
  color: #4d5d6c;
  display: block;
  font-weight: 600;
  margin-top: 0.55em;
}

.mem-rip {
  border-radius: 0;
  clip-path: polygon(
    0 4%,
    6% 0,
    14% 5%,
    24% 1%,
    35% 5%,
    47% 0,
    58% 4%,
    70% 1%,
    82% 5%,
    92% 1%,
    100% 4%,
    100% 96%,
    93% 100%,
    82% 95%,
    70% 100%,
    58% 96%,
    46% 100%,
    34% 95%,
    22% 100%,
    10% 96%,
    0 100%
  );
  padding-block: 1.2em;
}

.mem-tape::before {
  background: rgb(174 214 241 / 80%);
  box-shadow: 0 1px 2px rgb(44 62 80 / 15%);
  content: '';
  height: 1.1em;
  left: 50%;
  position: absolute;
  top: -0.5em;
  transform: translateX(-50%) rotate(-4deg);
  width: 3.6em;
}
</style>
