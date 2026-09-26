<script setup lang="ts">
/**
 * Who Owns What (#109): the family check-in card on the Overview (Requirement 18). The
 * rhythm, when the last one was and when the next is due, a few agenda chips, then Start
 * and (while due) Remind Me Later. With the rhythm off it offers to set one.
 *
 * Presentational: the page decides what Start opens and the Overview writes the snooze.
 * Children see it read-only (no buttons).
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import { checkInYmd, ymdOf, type CheckInAgenda } from '@/utils/responsibilityDeck';
import type { ResponsibilityCheckIn } from '@/types/models';
import BaseButton from '@/components/ui/BaseButton.vue';
import DeckPanel from './DeckPanel.vue';

const props = withDefaults(
  defineProps<{
    rhythmWeeks: number;
    lastCheckIn?: ResponsibilityCheckIn;
    /** The next due ymd, or null (rhythm off, or nothing dealt yet). */
    nextCheckIn: string | null;
    due: boolean;
    agenda: CheckInAgenda;
    canEdit?: boolean;
  }>(),
  { lastCheckIn: undefined, canEdit: false }
);
const emit = defineEmits<{ start: []; later: []; 'set-rhythm': [] }>();

const { t } = useTranslation();
const { cardName, cardEmoji } = useResponsibilityCardLabel();

/** At most two of each kind, so the chip row stays a glance. */
const AGENDA_PER_KIND = 2;

const lines = computed(() => {
  if (!props.rhythmWeeks) return [t('whoOwnsWhat.checkin.off')];
  const out: string[] = [];
  out.push(
    props.lastCheckIn
      ? fillTemplate(t('whoOwnsWhat.checkin.last'), {
          date: formatNookDate(checkInYmd(props.lastCheckIn)),
        })
      : t('whoOwnsWhat.checkin.none')
  );
  if (props.due) out.push(t('whoOwnsWhat.checkin.due'));
  else if (props.nextCheckIn)
    out.push(
      fillTemplate(t('whoOwnsWhat.checkin.next'), { date: formatNookDate(props.nextCheckIn) })
    );
  else out.push(t('whoOwnsWhat.checkin.notYet'));
  return out;
});

const chips = computed(() => {
  if (!props.rhythmWeeks) return [];
  const out: { key: string; text: string; tone: 'nobody' | 'plain' }[] = [];
  const nobody = props.agenda.nobody.length;
  if (nobody) {
    out.push({
      key: 'nobody',
      tone: 'nobody',
      text: fillTemplate(
        t(
          nobody === 1
            ? 'whoOwnsWhat.checkin.agendaNobody.one'
            : 'whoOwnsWhat.checkin.agendaNobody.other'
        ),
        { count: nobody }
      ),
    });
  }
  for (const { card, move } of props.agenda.moved.slice(0, AGENDA_PER_KIND)) {
    out.push({
      key: `moved-${card.id}`,
      tone: 'plain',
      text: `${cardEmoji(card)} ${fillTemplate(t('whoOwnsWhat.checkin.agendaMoved'), {
        card: cardName(card),
        date: formatNookDate(ymdOf(move.at)),
      })}`,
    });
  }
  for (const card of props.agenda.unchanged.slice(0, AGENDA_PER_KIND)) {
    const since = card.parts.map((p) => p.since).find(Boolean) ?? card.state?.createdAt;
    out.push({
      key: `unchanged-${card.id}`,
      tone: 'plain',
      text: `${cardEmoji(card)} ${fillTemplate(t('whoOwnsWhat.checkin.agendaUnchanged'), {
        card: cardName(card),
        date: since ? formatNookDate(ymdOf(since)) : '',
      })}`,
    });
  }
  return out;
});
</script>

<template>
  <DeckPanel
    :title="`🗓️ ${t('whoOwnsWhat.checkin.title')}`"
    :hint="rhythmWeeks ? fillTemplate(t('whoOwnsWhat.checkin.every'), { weeks: rhythmWeeks }) : ''"
    data-testid="check-in-card"
  >
    <p class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]">{{ lines.join(' ') }}</p>

    <div v-if="chips.length" class="space-y-2">
      <p
        class="font-outfit dark:text-ink-faint text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)] uppercase"
      >
        {{ t('whoOwnsWhat.checkin.agenda') }}
      </p>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="chip in chips"
          :key="chip.key"
          class="font-outfit rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="
            chip.tone === 'nobody'
              ? 'text-primary-500 dark:text-accent-lift bg-[var(--tint-orange-8)]'
              : 'dark:bg-surface-overlay dark:text-ink bg-[var(--tint-slate-5)] text-[var(--color-text)]'
          "
          >{{ chip.text }}</span
        >
      </div>
    </div>

    <div v-if="canEdit" class="flex flex-wrap gap-2 pt-1">
      <template v-if="rhythmWeeks">
        <BaseButton size="sm" data-testid="check-in-start" @click="emit('start')">
          {{ t('whoOwnsWhat.checkin.start') }}
        </BaseButton>
        <BaseButton
          v-if="due"
          variant="outline"
          size="sm"
          data-testid="check-in-later"
          @click="emit('later')"
        >
          {{ t('whoOwnsWhat.checkin.later') }}
        </BaseButton>
      </template>
      <BaseButton v-else variant="outline" size="sm" @click="emit('set-rhythm')">
        {{ t('whoOwnsWhat.checkin.setRhythm') }}
      </BaseButton>
    </div>
  </DeckPanel>
</template>
