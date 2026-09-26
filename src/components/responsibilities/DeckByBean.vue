<script setup lang="ts">
/**
 * Who Owns What (#109): "By Person", everything one member holds (mockup section 7).
 *
 * One row per current non-pet member: face, name, role, their cards as small chips (a
 * split part names its child or label). The count is a small caption beside the name,
 * never a big number, so the view reads as "what does Mia look after?" rather than as a
 * league table. This and the deal rail are the only places a per-person count appears.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo, getMemberRoleLabel } from '@/composables/useMemberInfo';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useFamilyStore } from '@/stores/familyStore';
import { categoryTint } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';

const props = defineProps<{ cards: readonly ResolvedCard[] }>();
const emit = defineEmits<{ open: [cardId: string] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const { getMemberName } = useMemberInfo();
const { memberAvatarBindings } = useMemberAvatarBindings();
const { cardName, cardEmoji } = useResponsibilityCardLabel();

interface Mini {
  key: string;
  cardId: string;
  label: string;
  tint: string;
}

const rows = computed(() =>
  familyStore.sortedHumans.map((member) => {
    const minis: Mini[] = [];
    for (const card of props.cards) {
      if (card.status !== 'held' && card.status !== 'waiting') continue;
      for (const part of card.parts) {
        if (part.holderId !== member.id) continue;
        const suffix =
          card.splitMode === 'child'
            ? getMemberName(part.key, '')
            : card.splitMode === 'label'
              ? (part.label ?? '')
              : '';
        minis.push({
          key: `${card.id}:${part.key}`,
          cardId: card.id,
          label: `${cardEmoji(card)} ${cardName(card)}${suffix ? `, ${suffix}` : ''}`,
          tint: categoryTint(card.category),
        });
      }
    }
    const count = new Set(minis.map((m) => m.cardId)).size;
    return { member, minis, count };
  })
);

function countLabel(count: number): string {
  return fillTemplate(
    t(count === 1 ? 'whoOwnsWhat.byBean.count.one' : 'whoOwnsWhat.byBean.count.other'),
    { count }
  );
}
</script>

<template>
  <div class="grid gap-3 lg:grid-cols-2" data-testid="deck-by-bean">
    <div
      v-for="row in rows"
      :key="row.member.id"
      class="dark:border-line dark:bg-surface-raised flex flex-col gap-2.5 rounded-2xl border border-[var(--color-border)] bg-white p-3.5 shadow-[var(--card-shadow)]"
    >
      <div class="flex items-center gap-3">
        <BeanieAvatar v-bind="memberAvatarBindings(row.member)" fallback="initials" size="sm" />
        <div class="min-w-0 flex-1">
          <p
            class="font-outfit dark:text-ink truncate text-base font-semibold text-[var(--color-text)]"
          >
            {{ row.member.name }}
          </p>
          <p class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
            {{ getMemberRoleLabel(row.member, t) }} · {{ countLabel(row.count) }}
          </p>
        </div>
      </div>
      <div v-if="row.minis.length" class="flex flex-wrap gap-1.5">
        <button
          v-for="mini in row.minis"
          :key="mini.key"
          type="button"
          class="mini font-outfit dark:text-ink dark:bg-surface-overlay dark:hover:bg-surface-hover rounded-full bg-[var(--tint-slate-5)] py-1 pr-2.5 pl-2 text-xs font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--tint-slate-10)]"
          :style="{ '--cat': mini.tint }"
          @click="emit('open', mini.cardId)"
        >
          {{ mini.label }}
        </button>
      </div>
      <p v-else class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        {{ t('whoOwnsWhat.byBean.none') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.mini {
  box-shadow: inset 3px 0 0 var(--cat);
}
</style>
