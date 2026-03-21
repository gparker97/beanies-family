<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { VacationIdea, VacationIdeaCategory, CurrencyCode } from '@/types/models';

interface Props {
  open: boolean;
  idea?: VacationIdea;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  save: [idea: VacationIdea];
  delete: [];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

const title = ref('');
const description = ref('');
const category = ref<VacationIdeaCategory | undefined>(undefined);
const location = ref('');
const suggestedDate = ref('');
const costType = ref<'free' | 'paid' | undefined>(undefined);
const estimatedCost = ref<number | undefined>(0);
const estimatedCostCurrency = ref<CurrencyCode>('USD');
const duration = ref<string>('');
const needsBooking = ref<boolean | undefined>(undefined);
const link = ref('');
const notes = ref('');

const { isEditing } = useFormModal(
  () => props.idea,
  () => props.open,
  {
    onEdit(idea) {
      title.value = idea.title ?? '';
      description.value = idea.description ?? '';
      category.value = idea.category;
      location.value = idea.location ?? '';
      suggestedDate.value = idea.suggestedDate ?? '';
      costType.value = idea.costType;
      estimatedCost.value = idea.estimatedCost ?? 0;
      estimatedCostCurrency.value =
        idea.estimatedCostCurrency ?? (settingsStore.displayCurrency as CurrencyCode);
      duration.value = idea.duration ?? '';
      needsBooking.value = idea.needsBooking;
      link.value = idea.link ?? '';
      notes.value = idea.notes ?? '';
    },
    onNew() {
      title.value = '';
      description.value = '';
      category.value = undefined;
      location.value = '';
      suggestedDate.value = '';
      costType.value = undefined;
      estimatedCost.value = 0;
      estimatedCostCurrency.value = settingsStore.displayCurrency as CurrencyCode;
      duration.value = '';
      needsBooking.value = undefined;
      link.value = '';
      notes.value = '';
    },
  }
);

const categories: { key: VacationIdeaCategory; emoji: string }[] = [
  { key: 'beach', emoji: '🏖️' },
  { key: 'activity', emoji: '🎭' },
  { key: 'food', emoji: '🍽️' },
  { key: 'sightseeing', emoji: '📸' },
  { key: 'shopping', emoji: '🛍️' },
  { key: 'nightlife', emoji: '🎉' },
  { key: 'other', emoji: '✨' },
];

const durations = ['30min', '1hr', '2hrs', 'half_day', 'full_day'] as const;

const voters = computed(() => {
  if (!props.idea) return [];
  return props.idea.votes
    .map((v) => familyStore.members.find((m) => m.id === v.memberId))
    .filter(Boolean);
});

function normalizeLink(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const normalizedLink = computed(() => normalizeLink(link.value));

function handleSave() {
  if (!props.idea) return;
  emit('save', {
    ...props.idea,
    title: title.value,
    description: description.value || undefined,
    category: category.value,
    location: location.value || undefined,
    suggestedDate: suggestedDate.value || undefined,
    costType: costType.value,
    estimatedCost: costType.value === 'paid' ? estimatedCost.value || undefined : undefined,
    estimatedCostCurrency: costType.value === 'paid' ? estimatedCostCurrency.value : undefined,
    duration: (duration.value as VacationIdea['duration']) || undefined,
    needsBooking: needsBooking.value,
    link: normalizedLink.value || undefined,
    notes: notes.value || undefined,
  });
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="isEditing ? (idea?.title ?? '') : ''"
    icon="🌟"
    icon-bg="bg-[rgba(255,217,61,0.1)]"
    save-gradient="teal"
    :show-delete="isEditing"
    @close="$emit('close')"
    @save="handleSave"
    @delete="$emit('delete')"
  >
    <div class="space-y-5">
      <!-- Category pills (above title) -->
      <FormFieldGroup :label="t('vacation.ideas.category')">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="cat in categories"
            :key="cat.key"
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              category === cat.key
                ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            @click="category = cat.key"
          >
            {{ cat.emoji }} {{ t(`vacation.ideas.category.${cat.key}`) }}
          </button>
        </div>
      </FormFieldGroup>

      <!-- Title -->
      <FormFieldGroup :label="t('vacation.field.title')" required>
        <BaseInput v-model="title" />
      </FormFieldGroup>

      <!-- Description -->
      <FormFieldGroup :label="t('vacation.field.description')">
        <textarea
          v-model="description"
          :placeholder="t('vacation.ideas.descriptionPlaceholder')"
          rows="2"
          class="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--vacation-teal)] dark:border-slate-600 dark:bg-slate-700 dark:text-white"
        />
      </FormFieldGroup>

      <!-- Date + Location -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.ideas.whichDay')">
          <BaseInput v-model="suggestedDate" type="date" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.field.location')">
          <BaseInput v-model="location" placeholder="e.g. Downtown, Beach..." />
        </FormFieldGroup>
      </div>

      <!-- Link -->
      <FormFieldGroup :label="t('vacation.field.link')">
        <div class="flex items-center gap-2">
          <BaseInput v-model="link" type="url" placeholder="https://..." class="flex-1" />
          <a
            v-if="normalizedLink"
            :href="normalizedLink"
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(0,180,216,0.08)] text-sm transition-colors hover:bg-[rgba(0,180,216,0.15)]"
            title="Visit link"
          >
            🔗
          </a>
        </div>
      </FormFieldGroup>

      <!-- Cost + Duration (side by side) -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.ideas.estimatedCost')">
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="ct in ['free', 'paid'] as const"
              :key="ct"
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                costType === ct
                  ? ct === 'free'
                    ? 'border-[#27AE60] bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
                    : 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="costType = ct"
            >
              {{ ct === 'free' ? '🆓' : '💰' }} {{ t(`vacation.ideas.${ct}`) }}
            </button>
          </div>
          <CurrencyAmountInput
            v-if="costType === 'paid'"
            v-model:amount="estimatedCost"
            v-model:currency="estimatedCostCurrency"
            class="mt-2"
            font-size="0.95rem"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.ideas.duration')">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="dur in durations"
              :key="dur"
              type="button"
              class="rounded-full border px-2 py-1 text-xs font-medium transition-colors"
              :class="
                duration === dur
                  ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                  : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
              "
              @click="duration = dur"
            >
              {{ t(`vacation.duration.${dur}`) }}
            </button>
          </div>
        </FormFieldGroup>
      </div>

      <!-- Booking needed -->
      <FormFieldGroup :label="t('vacation.ideas.bookingNeeded')">
        <div class="flex flex-wrap gap-1.5">
          <button
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              needsBooking === false
                ? 'border-[#27AE60] bg-[rgba(39,174,96,0.08)] text-[#27AE60]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            @click="needsBooking = false"
          >
            ✓ {{ t('vacation.ideas.noBookingNeeded') }}
          </button>
          <button
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              needsBooking === true
                ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            @click="needsBooking = true"
          >
            📋 {{ t('vacation.ideas.needsBooking') }}
          </button>
        </div>
      </FormFieldGroup>

      <!-- Notes -->
      <FormFieldGroup :label="t('vacation.field.notes')">
        <textarea
          v-model="notes"
          :placeholder="t('vacation.field.notesPlaceholder')"
          rows="2"
          class="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--vacation-teal)] dark:border-slate-600 dark:bg-slate-700 dark:text-white"
        />
      </FormFieldGroup>

      <!-- Who's interested -->
      <FormFieldGroup v-if="voters.length" :label="t('vacation.ideas.whosInterested')">
        <div class="flex items-center gap-1.5">
          <span
            v-for="voter in voters"
            :key="voter!.id"
            class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
            :style="{ backgroundColor: voter!.color }"
            :title="voter!.name"
          >
            {{ voter!.name.charAt(0).toUpperCase() }}
          </span>
        </div>
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
