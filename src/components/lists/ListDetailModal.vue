<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useActivityStore } from '@/stores/activityStore';
import { useToday } from '@/composables/useToday';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { LIST_CATEGORIES, getListCategory } from '@/constants/listCategories';
import { isRecurring } from '@/utils/listLifecycle';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort } from '@/utils/date';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import ListItemRow from './ListItemRow.vue';
import type { ListCategory, ListFrequency } from '@/types/models';

const props = defineProps<{ listId: string | null }>();
const emit = defineEmits<{ close: []; deleted: [id: string] }>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();
const vacationStore = useVacationStore();
const activityStore = useActivityStore();
const { today } = useToday();
const { categoryLabel } = useListCategoryLabel();
const { getMemberName } = useMemberInfo();

const list = computed(() =>
  props.listId ? (listStore.lists.find((l) => l.id === props.listId) ?? null) : null
);
const meId = computed(() => familyStore.currentMember?.id ?? '');

// Meta-band pills are display by default; tapping one reveals an inline editor.
const editingCategory = ref(false);
const editingOwner = ref(false);
const editingLink = ref<'trip' | 'activity' | null>(null);
watch(
  () => props.listId,
  () => {
    editingCategory.value = false;
    editingOwner.value = false;
    editingLink.value = null;
  }
);

const category = computed(() => (list.value ? getListCategory(list.value.category) : undefined));

function setCategory(value: ListCategory): void {
  if (list.value) void listStore.updateList(list.value.id, { category: value });
  editingCategory.value = false;
}
function setOwner(value: string | string[]): void {
  const id = Array.isArray(value) ? value[0] : value;
  if (list.value && id) void listStore.updateList(list.value.id, { ownerId: id });
  editingOwner.value = false;
}

// Repeats / frequency / due date
const lifecycleOptions = computed(() => [
  { value: 'oneoff', label: t('lists.detail.oneoff') },
  { value: 'recurring', label: t('lists.detail.recurring') },
]);
function setLifecycle(value: string): void {
  const l = list.value;
  if (!l) return;
  if (value === 'recurring') {
    void listStore.updateList(l.id, {
      lifecycle: 'recurring',
      frequency: l.frequency ?? 'weekly',
      dueDate: undefined,
      lastResetDate: today.value,
      cycleCelebrated: false,
    });
  } else {
    void listStore.updateList(l.id, {
      lifecycle: 'oneoff',
      frequency: undefined,
      lastResetDate: undefined,
      cycleCelebrated: undefined,
    });
  }
}
const freqOptions = computed(() => [
  { value: 'daily', label: t('lists.detail.freq.daily') },
  { value: 'weekly', label: t('lists.detail.freq.weekly') },
  { value: 'monthly', label: t('lists.detail.freq.monthly') },
]);
function setFrequency(value: string): void {
  if (list.value) void listStore.updateList(list.value.id, { frequency: value as ListFrequency });
}
function setDueDate(value: string): void {
  if (list.value) void listStore.updateList(list.value.id, { dueDate: value || undefined });
}

// Meta-band due / recurrence pill text
const recurrenceText = computed(() => {
  const l = list.value;
  if (!l || !isRecurring(l)) return '';
  const key = `lists.status.repeats.${l.frequency ?? 'weekly'}` as 'lists.status.repeats.weekly';
  return t(key);
});
const dueText = computed(() => {
  const l = list.value;
  if (!l || isRecurring(l) || !l.dueDate) return '';
  return fillTemplate(t('lists.status.due'), { date: formatDateShort(l.dueDate) });
});

// Items
function toggleItem(itemId: string): void {
  if (list.value) void listStore.toggleItem(list.value.id, itemId, meId.value);
}
function removeItem(itemId: string): void {
  if (list.value) void listStore.removeItem(list.value.id, itemId);
}
const newItem = ref('');
function addItem(): void {
  const title = newItem.value.trim();
  if (list.value && title) {
    void listStore.addItem(list.value.id, title);
    newItem.value = '';
  }
}

// ── Linking to a trip / activity ──────────────────────────────────────────
// Both lists keep their soonest date (for the row label) and are searchable.
const linkSearch = ref('');
const upcomingTrips = computed(() =>
  vacationStore.upcomingVacations.map((v) => ({ id: v.id, name: v.name, date: v.startDate }))
);
const upcomingActivities = computed(() => {
  const seen = new Set<string>();
  const out: { id: string; title: string; date: string }[] = [];
  // upcomingActivities is date-sorted (soonest first) — keep the first occurrence.
  for (const { activity, date } of activityStore.upcomingActivities) {
    if (seen.has(activity.id)) continue;
    seen.add(activity.id);
    out.push({ id: activity.id, title: activity.title, date });
  }
  return out;
});
const matches = (text: string) =>
  text.toLowerCase().includes(linkSearch.value.trim().toLowerCase());
const filteredTrips = computed(() => upcomingTrips.value.filter((tr) => matches(tr.name)));
const filteredActivities = computed(() => upcomingActivities.value.filter((a) => matches(a.title)));
const linkedTripName = computed(() => {
  const id = list.value?.linkedVacationId;
  return id ? (upcomingTrips.value.find((v) => v.id === id)?.name ?? '') : '';
});
const linkedActivityName = computed(() => {
  const id = list.value?.linkedActivityId;
  return id ? (upcomingActivities.value.find((a) => a.id === id)?.title ?? '') : '';
});
function openLinkPicker(kind: 'trip' | 'activity'): void {
  linkSearch.value = '';
  editingLink.value = editingLink.value === kind ? null : kind;
}
function linkTrip(id: string): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedVacationId: id });
  editingLink.value = null;
}
function linkActivity(id: string): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedActivityId: id });
  editingLink.value = null;
}
const shortDate = (d?: string): string => (d ? formatDateShort(d) : '');
function unlinkTrip(): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedVacationId: undefined });
}
function unlinkActivity(): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedActivityId: undefined });
}

async function handleDelete(): Promise<void> {
  const l = list.value;
  if (!l) return;
  const ok = await showConfirm({
    title: 'lists.detail.deleteConfirm.title',
    message: 'lists.detail.deleteConfirm.message',
    variant: 'danger',
  });
  if (!ok) return;
  await listStore.deleteList(l.id);
  emit('deleted', l.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    v-if="list"
    variant="drawer"
    :open="true"
    :title="list.title"
    :icon="list.emoji"
    icon-bg="var(--tint-orange-12)"
    size="narrow"
    :save-label="t('action.close')"
    save-gradient="orange"
    :show-delete="true"
    @close="emit('close')"
    @save="emit('close')"
    @delete="handleDelete"
  >
    <div class="space-y-4">
      <!-- Meta band: category · owner · due/recurrence (pills, never a dropdown) -->
      <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3.5">
        <button type="button" class="mb-pill" @click="editingCategory = !editingCategory">
          <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: category?.color }" />
          {{ categoryLabel(list.category) }}
        </button>
        <button type="button" class="mb-pill" @click="editingOwner = !editingOwner">
          <MemberChip :member-id="list.ownerId" size="dot" />
          {{ getMemberName(list.ownerId, '') }}
        </button>
        <span v-if="dueText" class="mb-pill mb-due"
          ><span aria-hidden="true">📅</span> {{ dueText }}</span
        >
        <span v-else-if="recurrenceText" class="mb-pill mb-recur"
          ><span aria-hidden="true">🔁</span> {{ recurrenceText }}</span
        >
      </div>

      <!-- Inline category picker (pills) -->
      <div v-if="editingCategory" class="flex flex-wrap gap-2">
        <button
          v-for="cat in LIST_CATEGORIES"
          :key="cat.id"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            list.category === cat.id
              ? 'border-[var(--color-primary-500)] bg-[var(--tint-orange-12)] text-[var(--color-primary-500)]'
              : 'border-[var(--color-border)] bg-white text-[var(--color-text-muted)] dark:bg-slate-800'
          "
          @click="setCategory(cat.id)"
        >
          <span aria-hidden="true">{{ cat.emoji }}</span> {{ categoryLabel(cat.id) }}
        </button>
      </div>
      <!-- Inline owner picker -->
      <FamilyChipPicker
        v-if="editingOwner"
        :model-value="list.ownerId"
        mode="single"
        compact
        @update:model-value="setOwner"
      />

      <!-- Items -->
      <div>
        <ListItemRow
          v-for="item in list.items"
          :key="item.id"
          :item="item"
          removable
          @toggle="toggleItem"
          @remove="removeItem"
        />
        <div class="mt-2">
          <BaseInput
            v-model="newItem"
            :placeholder="t('lists.detail.addItem')"
            @keyup.enter="addItem"
          />
        </div>
      </div>

      <!-- Repeats? -->
      <div class="setsec">
        <p class="lbl">{{ t('lists.detail.repeatsLabel') }}</p>
        <TogglePillGroup
          :model-value="isRecurring(list) ? 'recurring' : 'oneoff'"
          :options="lifecycleOptions"
          @update:model-value="setLifecycle"
        />
        <template v-if="isRecurring(list)">
          <div class="mt-2">
            <FrequencyChips
              :model-value="list.frequency ?? 'weekly'"
              :options="freqOptions"
              @update:model-value="setFrequency"
            />
          </div>
          <p class="mt-2 text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.recurringHint') }}
          </p>
        </template>
      </div>

      <!-- Due date (one-off only) -->
      <div v-if="!isRecurring(list)" class="setsec">
        <p class="lbl">{{ t('lists.detail.dueDateLabel') }}</p>
        <BeanieDatePicker :model-value="list.dueDate ?? ''" @update:model-value="setDueDate" />
      </div>

      <!-- Link -->
      <div class="setsec">
        <p class="lbl">{{ t('lists.detail.linkLabel') }}</p>
        <div class="flex flex-wrap gap-2">
          <span v-if="list.linkedVacationId" class="link-chip">
            <span aria-hidden="true">✈️</span>
            {{ fillTemplate(t('lists.detail.linkedToTrip'), { name: linkedTripName }) }}
            <button
              type="button"
              class="unlink"
              :aria-label="t('lists.detail.unlink')"
              @click="unlinkTrip"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </span>
          <button v-else type="button" class="linkpill" @click="openLinkPicker('trip')">
            <span aria-hidden="true">✈️</span> {{ t('lists.detail.linkTrip') }}
          </button>

          <span v-if="list.linkedActivityId" class="link-chip">
            <span aria-hidden="true">📅</span>
            {{ fillTemplate(t('lists.detail.linkedToActivity'), { name: linkedActivityName }) }}
            <button
              type="button"
              class="unlink"
              :aria-label="t('lists.detail.unlink')"
              @click="unlinkActivity"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </span>
          <button v-else type="button" class="linkpill" @click="openLinkPicker('activity')">
            <span aria-hidden="true">📅</span> {{ t('lists.detail.linkActivity') }}
          </button>
        </div>

        <!-- Trip picker: search + scrollable list with dates -->
        <div v-if="editingLink === 'trip'" class="mt-2">
          <BaseInput
            v-model="linkSearch"
            :placeholder="t('lists.detail.linkSearch')"
            class="mb-1.5"
          />
          <p v-if="!upcomingTrips.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noUpcomingTrips') }}
          </p>
          <p v-else-if="!filteredTrips.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noMatches') }}
          </p>
          <div class="max-h-44 space-y-1 overflow-y-auto">
            <button
              v-for="trip in filteredTrips"
              :key="trip.id"
              type="button"
              class="picker-row"
              @click="linkTrip(trip.id)"
            >
              <span aria-hidden="true">✈️</span>
              <span class="flex-1 truncate">{{ trip.name }}</span>
              <span v-if="trip.date" class="text-[0.7rem] text-[var(--color-text-muted)]">{{
                shortDate(trip.date)
              }}</span>
            </button>
          </div>
        </div>
        <!-- Activity picker: search + scrollable list with dates -->
        <div v-else-if="editingLink === 'activity'" class="mt-2">
          <BaseInput
            v-model="linkSearch"
            :placeholder="t('lists.detail.linkSearch')"
            class="mb-1.5"
          />
          <p v-if="!upcomingActivities.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noUpcomingActivities') }}
          </p>
          <p v-else-if="!filteredActivities.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noMatches') }}
          </p>
          <div class="max-h-44 space-y-1 overflow-y-auto">
            <button
              v-for="act in filteredActivities"
              :key="act.id"
              type="button"
              class="picker-row"
              @click="linkActivity(act.id)"
            >
              <span aria-hidden="true">📅</span>
              <span class="flex-1 truncate">{{ act.title }}</span>
              <span class="text-[0.7rem] text-[var(--color-text-muted)]">{{
                shortDate(act.date)
              }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>

<style scoped>
.mb-pill {
  align-items: center;
  background: #fff;
  border-radius: 999px;
  box-shadow: var(--card-shadow, 0 4px 20px rgb(44 62 80 / 5%));
  color: var(--color-text);
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 0.375rem;
  padding: 0.375rem 0.6875rem;
}

:global(.dark) .mb-pill {
  background: var(--color-surface, #1e293b);
}

.mb-due {
  background: linear-gradient(135deg, var(--color-primary-500), #e67e22);
  color: #fff;
  font-weight: 700;
}

.mb-recur {
  background: var(--tint-purple-12, rgb(155 89 182 / 12%));
  color: #7c3aed;
}

.setsec {
  background: #fff;
  border-radius: 1rem;
  box-shadow: var(--card-shadow, 0 4px 20px rgb(44 62 80 / 5%));
  padding: 0.75rem 0.875rem;
}

:global(.dark) .setsec {
  background: var(--color-surface, #1e293b);
}

.lbl {
  color: var(--color-text-muted);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  margin-bottom: 0.5625rem;
  text-transform: uppercase;
}

.linkpill,
.link-chip {
  align-items: center;
  background: var(--tint-slate-5, rgb(44 62 80 / 5%));
  border-radius: 999px;
  color: var(--color-text-muted);
  display: inline-flex;
  font-size: 0.74rem;
  font-weight: 600;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
}

.link-chip {
  background: rgb(42 157 143 / 12%);
  color: #2a9d8f;
}

.unlink {
  margin-left: 0.25rem;
  opacity: 0.7;
}

.picker-row {
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  color: var(--color-text);
  display: flex;
  font-size: 0.82rem;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
  width: 100%;
}
</style>
