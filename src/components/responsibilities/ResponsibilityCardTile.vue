<script setup lang="ts">
/**
 * Who Owns What (#109): one portrait card in the Deck view. A category-tinted slab with
 * the emoji (or the hero illustration once it exists), then the name, the done line and
 * who holds it: one row per part, "Nobody Yet" for an open part, "since" and the
 * previous holder for an unsplit card. Skipped cards (the skipped filter) carry
 * "Bring Back" for grown-ups.
 *
 * The whole tile opens the card (a stretched button, last in the DOM so a missing z-index
 * degrades loudly); "Bring Back" sits above it. Purely presentational: writes are the
 * parent's job.
 */
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import { ymdOf, type ResolvedCard, type ResolvedPart } from '@/utils/responsibilityDeck';
import MemberChip from '@/components/ui/MemberChip.vue';

const props = withDefaults(
  defineProps<{
    card: ResolvedCard;
    /** Grown-ups see "Bring Back" on skipped cards; children see a status chip. */
    canEdit?: boolean;
  }>(),
  { canEdit: false }
);
const emit = defineEmits<{ open: [cardId: string]; 'bring-back': [cardId: string] }>();

const { t } = useTranslation();
const { getMemberName } = useMemberInfo();
const { cardName, cardDone, cardEmoji } = useResponsibilityCardLabel();

/** Fallback when a category is unknown to this build (a newer client's card). */
const FALLBACK_TINT = '#94A3B8';
const tint = computed(() => getListCategory(props.card.category)?.color ?? FALLBACK_TINT);

const name = computed(() => cardName(props.card));
const done = computed(() => cardDone(props.card));
const emoji = computed(() => cardEmoji(props.card));

const isKept = computed(() => props.card.status === 'held' || props.card.status === 'waiting');
/** Kept, but nobody holds any part: drawn as a ghosted, dashed card. */
const isOpen = computed(() => isKept.value && props.card.parts.every((p) => !p.holderId));
const isSkipped = computed(() => props.card.status === 'skipped');

/** "for Mia" on a child split, the family's label on a label split. */
function partCaption(part: ResolvedPart): string {
  if (props.card.splitMode === 'child') {
    return fillTemplate(t('whoOwnsWhat.card.forChild'), { name: getMemberName(part.key, '') });
  }
  return props.card.splitMode === 'label' ? (part.label ?? '') : '';
}

/** "Since 3 Mar" (+ "before that greg") for an unsplit, held card. */
const history = computed(() => {
  if (props.card.splitMode !== 'single') return '';
  const part = props.card.parts[0];
  if (!part?.holderId || !part.since) return '';
  const date = formatNookDate(ymdOf(part.since));
  return part.previousHolderId
    ? fillTemplate(t('whoOwnsWhat.card.sinceBefore'), {
        date,
        name: getMemberName(part.previousHolderId, ''),
      })
    : fillTemplate(t('whoOwnsWhat.card.since'), { date });
});

const splitCaption = computed(() => {
  if (props.card.splitMode === 'child') return t('whoOwnsWhat.card.splitChild');
  if (props.card.splitMode === 'label') return t('whoOwnsWhat.card.splitLabel');
  return '';
});

// Hero illustrations are optional assets; until one exists the card shows its emoji.
// A src that failed once is remembered for the session, so a missing file 404s once,
// not on every render of every shelf.
const illustration = computed(() =>
  props.card.illustration && !failedIllustrations.has(props.card.illustration)
    ? props.card.illustration
    : undefined
);
const illustrationFailed = ref(false);
function onIllustrationError(): void {
  if (props.card.illustration) failedIllustrations.add(props.card.illustration);
  illustrationFailed.value = true;
}
</script>

<script lang="ts">
const failedIllustrations = new Set<string>();
</script>

<template>
  <article
    class="card-tile group dark:bg-surface-raised dark:border-line-strong relative flex flex-col rounded-2xl border border-[var(--color-border)] bg-white shadow-[var(--card-shadow)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]"
    :class="{ 'is-open': isOpen, 'is-skipped': isSkipped }"
    :style="{ '--cat': tint }"
    :data-testid="`card-tile-${card.id}`"
  >
    <div class="slab relative grid place-items-center overflow-hidden rounded-t-2xl">
      <img
        v-if="illustration && !illustrationFailed"
        :src="illustration"
        alt=""
        class="h-20 w-20 object-contain"
        loading="lazy"
        @error="onIllustrationError"
      />
      <span v-else class="glyph text-4xl leading-none" aria-hidden="true">{{ emoji }}</span>
      <span
        class="pointer-events-none absolute -right-1.5 -bottom-3 text-5xl leading-none opacity-[0.07]"
        aria-hidden="true"
        >{{ emoji }}</span
      >
    </div>

    <div class="flex flex-1 flex-col gap-1 p-3">
      <p
        class="font-outfit dark:text-ink text-sm leading-tight font-semibold text-[var(--color-text)]"
      >
        {{ name }}
      </p>
      <p
        v-if="done"
        class="dark:text-ink-faint text-xs leading-snug text-[var(--color-text-muted)]"
      >
        {{ done }}
      </p>

      <div class="mt-auto flex flex-col gap-1 pt-1.5">
        <template v-if="isSkipped">
          <button
            v-if="canEdit"
            type="button"
            class="font-outfit text-primary-500 dark:text-accent-lift relative z-20 self-start rounded-full bg-[var(--tint-orange-8)] px-2.5 py-1 text-xs font-bold transition-colors hover:bg-[var(--tint-orange-15)] dark:hover:bg-[var(--tint-orange-15)]"
            :data-testid="`card-bring-back-${card.id}`"
            @click.stop="emit('bring-back', card.id)"
          >
            <span aria-hidden="true">↩</span> {{ t('whoOwnsWhat.deck.bringBack') }}
          </button>
          <span v-else class="status-chip">{{ t('whoOwnsWhat.card.skipped') }}</span>
        </template>

        <span v-else-if="card.status === 'unsorted'" class="status-chip">
          {{ t('whoOwnsWhat.card.unsorted') }}
        </span>

        <template v-else>
          <span
            v-if="splitCaption"
            class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
          >
            {{ splitCaption }}
          </span>
          <span
            v-for="part in card.parts"
            :key="part.key"
            class="flex min-w-0 items-center gap-1 text-xs"
          >
            <!-- A split part leads with what it is ("for Mia", "upstairs"), so the row
                 still reads when a narrow tile truncates it. -->
            <span
              v-if="partCaption(part)"
              class="dark:text-ink-faint min-w-0 truncate text-[var(--color-text-muted)]"
              >{{ partCaption(part) }} ·</span
            >
            <template v-if="part.holderId">
              <MemberChip :member-id="part.holderId" size="dot" class="shrink-0" />
              <span
                class="font-outfit dark:text-ink shrink-0 truncate font-semibold text-[var(--color-text)]"
              >
                {{ getMemberName(part.holderId, '') }}
              </span>
            </template>
            <span
              v-else
              class="font-outfit text-primary-500 dark:text-accent-lift shrink-0 rounded-full bg-[var(--tint-orange-8)] px-1.5 py-0.5 font-semibold"
            >
              {{ t('whoOwnsWhat.deck.nobody') }}
            </span>
          </span>
          <span v-if="history" class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
            {{ history }}
          </span>
        </template>
      </div>
    </div>

    <button
      type="button"
      class="focus-visible:ring-primary-500 absolute inset-0 z-10 rounded-2xl focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      :aria-label="fillTemplate(t('whoOwnsWhat.card.open'), { card: name })"
      :data-testid="`card-open-${card.id}`"
      @click="emit('open', card.id)"
    />
  </article>
</template>

<style scoped>
.card-tile {
  min-height: 13.5rem;
}

.slab {
  background: color-mix(in srgb, var(--cat) 12%, transparent);
  flex: 0 0 auto;
  height: 6rem;
}

html.dark .slab {
  background: color-mix(in srgb, var(--cat) 18%, transparent);
}

/* Kept with nobody, and skipped: ghosted, dashed, no shadow. */
.card-tile.is-open,
.card-tile.is-skipped {
  background: #f3f5f7;
  border-style: dashed;
  border-width: 1.5px;
  box-shadow: none;
}

html.dark .card-tile.is-open,
html.dark .card-tile.is-skipped {
  background: var(--color-surface-overlay);
  border-color: var(--color-line-strong);
}

.card-tile.is-open .slab,
.card-tile.is-skipped .slab {
  background: transparent;
}

.card-tile.is-open .glyph,
.card-tile.is-skipped .glyph {
  filter: grayscale(1);
  opacity: 0.55;
}

.status-chip {
  align-self: flex-start;
  background: var(--tint-slate-5);
  border-radius: 9999px;
  color: var(--color-text-muted);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.5rem;
}

html.dark .status-chip {
  background: var(--color-surface-hover);
  color: var(--color-ink-soft);
}
</style>
