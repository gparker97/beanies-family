<script setup lang="ts">
/**
 * An archived cycle, read-only.
 *
 * Deliberately NOT `ListItemRow`. That component always renders a tappable checkbox that
 * emits `toggle` — only its *text* is read-only by default — so reusing it here would put
 * a control on screen that looks interactive and silently does nothing. It is also typed
 * on `FamilyListItem`, which would force a synthetic id onto every id-less
 * `ListCycleMark`. A dozen lines of static markup is less code than that adapter, and it
 * makes "history cannot be edited" structural: there is no handler to forget to wire.
 *
 * Equally deliberately not a `readOnly` prop on `ListDetailModal` — that is ~700 lines of
 * editing machinery, and threading a flag through fifteen controls is both more code and
 * a far larger regression surface on the app's most delicate modal.
 */
import { computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort } from '@/utils/date';
import { getListCategory } from '@/constants/listCategories';

const props = defineProps<{ cycleId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const listStore = useListStore();

const cycle = computed(() => listStore.cycles.find((c) => c.id === props.cycleId) ?? null);

const accent = computed(() =>
  cycle.value
    ? (getListCategory(cycle.value.category)?.color ?? 'var(--color-primary-500)')
    : 'var(--color-primary-500)'
);
const pct = computed(() =>
  cycle.value && cycle.value.total ? Math.round((cycle.value.done / cycle.value.total) * 100) : 0
);
const progressLabel = computed(() =>
  cycle.value
    ? fillTemplate(t('lists.progress'), {
        done: String(cycle.value.done),
        total: String(cycle.value.total),
      })
    : ''
);
const whenLabel = computed(() => {
  if (!cycle.value) return '';
  const { startedOn, endedOn } = cycle.value;
  return startedOn === endedOn
    ? formatDateShort(endedOn)
    : `${formatDateShort(startedOn)} – ${formatDateShort(endedOn)}`;
});
</script>

<template>
  <BeanieFormModal
    v-if="cycle"
    variant="drawer"
    :open="true"
    :title="cycle.title"
    :icon="cycle.emoji"
    icon-bg="var(--tint-slate-10)"
    size="narrow"
    :save-label="t('action.close')"
    :show-delete="false"
    @close="emit('close')"
    @save="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs text-[var(--color-text-muted)]">{{ whenLabel }}</span>
        <MemberChip :member-id="cycle.ownerId" size="sm" />
      </div>

      <div class="flex items-center gap-2">
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
          <span
            class="block h-full rounded-full"
            :style="{ width: `${pct}%`, backgroundColor: accent }"
          />
        </span>
        <span class="text-xs font-medium text-[var(--color-text-muted)]">{{ progressLabel }}</span>
      </div>

      <!-- Static rows: no checkbox, no emit, nothing to tap. -->
      <ul class="flex flex-col gap-1.5">
        <li
          v-for="(mark, i) in cycle.items"
          :key="`${i}-${mark.title}`"
          class="flex items-center gap-2.5 rounded-xl bg-[var(--tint-slate-5)] px-3 py-2"
        >
          <span
            class="text-sm"
            :class="mark.done ? 'text-[#27AE60]' : 'text-[var(--color-text-muted)] opacity-50'"
            aria-hidden="true"
            >{{ mark.done ? '✓' : '○' }}</span
          >
          <span
            class="flex-1 text-sm"
            :class="
              mark.done ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'
            "
            >{{ mark.title }}</span
          >
          <MemberChip v-if="mark.by" :member-id="mark.by" size="dot" />
        </li>
      </ul>
    </div>
  </BeanieFormModal>
</template>
