<script setup lang="ts">
/**
 * The Who Owns What card a to-do was made by (`TodoItem.cardId`, #123), as a tappable link that
 * opens the card. The sibling of `LinkedActivityChip`.
 *
 * `cardId` is a soft reference: it resolves through `useTodoCardLink` (only
 * `responsibilityStore.cardById`), and on a miss this renders NOTHING. There is never a dangling
 * chip.
 *
 * Two looks, both `LinkedItemLink`: `chip` (the to-do row's metadata line, "🗑️ Trash Night ›",
 * or "🎒 School Drop-off, for Leo ›" for a part) and `row` (the "Linked Card" field in To-do
 * Details, with "Held by {name}" under it).
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoCardLink } from '@/composables/useTodoCardLink';
import { fillTemplate } from '@/utils/fillTemplate';
import LinkedItemLink from '@/components/ui/LinkedItemLink.vue';

const props = withDefaults(
  defineProps<{
    cardId: string;
    /** The part of a split card the to-do belongs to (`TodoItem.cardPartKey`). */
    partKey?: string;
    variant?: 'chip' | 'row';
  }>(),
  { partKey: undefined, variant: 'chip' }
);

const emit = defineEmits<{
  /** Fired after navigation starts, so a host drawer can close itself. */
  open: [cardId: string];
}>();

const { t } = useTranslation();
const { resolveCardLink, openCard } = useTodoCardLink();

const link = computed(() => resolveCardLink({ cardId: props.cardId, cardPartKey: props.partKey }));

/** The row names the part in its title; the chip puts it after a comma (`LinkedItemLink`'s sub). */
const title = computed(() => {
  const l = link.value;
  if (!l) return '';
  return props.variant === 'row' && l.partCaption ? `${l.name}, ${l.partCaption}` : l.name;
});

const sub = computed(() => {
  const l = link.value;
  if (!l) return '';
  if (props.variant === 'chip') return l.partCaption;
  return l.holderName ? fillTemplate(t('todo.linkedCard.heldBy'), { name: l.holderName }) : '';
});

// One bound object: `aria-label` on a component tag is typed as the native attribute, not
// `LinkedItemLink`'s required `ariaLabel` prop.
const linkProps = computed(() =>
  link.value
    ? {
        icon: link.value.emoji,
        title: title.value,
        sub: sub.value,
        ariaLabel: t('todo.linkedCard.open'),
        variant: props.variant,
      }
    : null
);

function open(): void {
  if (!link.value) return;
  openCard(link.value.cardId);
  emit('open', link.value.cardId);
}
</script>

<template>
  <LinkedItemLink v-if="linkProps" v-bind="linkProps" @click="open" />
</template>
